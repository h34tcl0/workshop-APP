import { store } from "../db.js";
import { TelegramBotService } from "../telegramBot.js";
import { DayStatus } from "../types.js";
import { getLocalDateIso, getLocalHoursAndMinutes } from "../dateUtils.js";
import { getHourlyForecast } from "../weatherService.js";
import { getTargetChatId } from "./targetChat.js";

const FIVE_MIN_MS = 5 * 60 * 1000;
const MAX_BURST_RETRIES = 3;

/**
 * Procesa el monitoreo y despacho de alertas climáticas intradía (Lluvia de emergencia / Aviso de humedad) (Tier 4).
 * REGLA DE ORO: Las alertas se envían ÚNICAMENTE mientras el operario está trabajando activamente (window_start <= hora_actual < window_end).
 */
export async function processWeatherAlert(
  userId: number,
  nowDate?: Date
): Promise<void> {
  const now = nowDate || new Date();
  const appSettings = store.getAppSettings(userId);
  const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
  const todayIso = getLocalDateIso(now, userTz);
  const localTime = getLocalHoursAndMinutes(now, userTz);
  const currentLocalHour = localTime.totalHours;

  // Límite global de horario operativo
  if (currentLocalHour < appSettings.operational_start_hour || currentLocalHour >= appSettings.operational_end_hour) {
    return;
  }

  const dailyLog = store.getDailyLogByDate(userId, todayIso);
  // Regla: No alertar si el día no es viable o si el check-in ya fue resuelto
  if (!dailyLog || dailyLog.status !== DayStatus.DAY_VIABLE || dailyLog.checkin_resolved) {
    return;
  }

  // Determinar ventana agendada de trabajo de hoy
  let startHourLimit = appSettings.operational_start_hour;
  let endHourLimit = appSettings.operational_end_hour;

  if (dailyLog.window_start && dailyLog.window_end) {
    const [wStartH, wStartM] = dailyLog.window_start.split(":").map(Number);
    const [wEndH, wEndM] = dailyLog.window_end.split(":").map(Number);
    startHourLimit = wStartH + (wStartM || 0) / 60.0;
    endHourLimit = wEndH + (wEndM || 0) / 60.0;
  }

  // REGLA DE ORO: No enviar alertas antes del inicio de ventana ni al finalizar o superar window_end
  if (currentLocalHour < startHourLimit || currentLocalHour >= endHourLimit) {
    return;
  }

  const targetChatId = getTargetChatId(userId, appSettings.telegram_chat_id);
  if (!targetChatId) {
    return;
  }

  const telegramSvc = new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN, targetChatId);

  try {
    const forecasts = await getHourlyForecast(todayIso, appSettings.latitude, appSettings.longitude);
    const startHourInt = Math.max(Math.floor(currentLocalHour), Math.floor(startHourLimit));
    const endHourInt = Math.ceil(endHourLimit);

    const remainingWorkForecasts = forecasts.filter(f => f.hour >= startHourInt && f.hour <= endHourInt);

    // 1. Detección de Lluvia en lo que resta de la jornada activa
    const rainForecast = remainingWorkForecasts.find(f =>
      (f.precipitation_probability != null && f.precipitation_probability >= 30) ||
      (f.precipitation_mm != null && f.precipitation_mm >= appSettings.min_rain_precipitation_mm)
    );

    // 2. Detección de Humedad alta en lo que resta de la jornada activa
    const humidityForecast = remainingWorkForecasts.find(f => f.relative_humidity > appSettings.max_humidity_percent);

    const locPrefix = `📍 *Taller (${appSettings.latitude.toFixed(2)}, ${appSettings.longitude.toFixed(2)}):* `;
    const previousRainHour: number | null = dailyLog.last_rain_alert_hour ?? null;
    const rainHour = rainForecast ? rainForecast.hour : null;
    const isRainAdvanced = rainHour != null && previousRainHour != null && rainHour < previousRainHour;
    const isNewRainAlert = rainHour != null && !dailyLog.intraday_alert_triggered;

    // A) Nueva alerta de lluvia O lluvia adelantada respecto a la alerta anterior
    if (rainForecast && (isNewRainAlert || isRainAdvanced)) {
      const criticalTimeStr = `${String(rainHour).padStart(2, "0")}:00`;
      const precipMm = rainForecast.precipitation_mm || 0;

      const detailsText = isRainAdvanced
        ? `🚨 *¡ALERTA URGENTE DE LLUVIA ADELANTADA!*\n${locPrefix}La lluvia se ha ADELANTADO a las ${criticalTimeStr} hrs (prevista antes a las ${String(previousRainHour).padStart(2, "0")}:00 hrs). Precipitación: ${precipMm.toFixed(1)} mm.`
        : `🌧️ *¡ALERTA DE LLUVIA EN TALLER!*\n${locPrefix}Se pronostica lluvia a las ${criticalTimeStr} hrs (Precipitación: ${precipMm.toFixed(1)} mm).`;

      await telegramSvc.sendIntradayEmergencyAlertBurst(dailyLog.id, detailsText);

      store.updateDailyLog(userId, dailyLog.id, {
        intraday_alert_triggered: true,
        intraday_alert_acknowledged: false,
        intraday_alert_last_sent_at: now.toISOString(),
        intraday_alert_burst_count: 1,
        last_rain_alert_hour: rainHour
      });
      console.log(`[Scheduler] Intraday Rain Emergency Alert triggered for User #${userId} on ${todayIso}: ${detailsText}`);
      return;
    }

    // B) Reintentos de ráfaga de lluvia cada 5 min (hasta máx 3 ráfagas, solo si sigue lloviendo y no fue confirmada)
    if (dailyLog.intraday_alert_triggered && !dailyLog.intraday_alert_acknowledged) {
      const burstCount = dailyLog.intraday_alert_burst_count || 0;

      // Si el pronóstico se despejó o ya alcanzó el máximo de 3 ráfagas, detener reintentos
      if (!rainForecast || burstCount >= MAX_BURST_RETRIES) {
        return;
      }

      const lastSentIso = dailyLog.intraday_alert_last_sent_at;
      const lastSentMs = lastSentIso ? new Date(lastSentIso).getTime() : 0;
      const elapsedMs = now.getTime() - lastSentMs;

      if (elapsedMs >= FIVE_MIN_MS) {
        const criticalTimeStr = rainHour != null ? `${String(rainHour).padStart(2, "0")}:00` : "las próximas horas";
        const precipMm = rainForecast.precipitation_mm || 0;
        const alertMsg = `🌧️ *¡ALERTA DE LLUVIA EN TALLER!*\n${locPrefix}Se pronostica lluvia a las ${criticalTimeStr} hrs (Precipitación: ${precipMm.toFixed(1)} mm).`;

        await telegramSvc.sendIntradayEmergencyAlertBurst(dailyLog.id, alertMsg);

        const newBurstCount = burstCount + 1;
        store.updateDailyLog(userId, dailyLog.id, {
          intraday_alert_last_sent_at: now.toISOString(),
          intraday_alert_burst_count: newBurstCount
        });
        console.log(`[Scheduler] Intraday Rain alert retry #${newBurstCount} sent for User #${userId} on ${todayIso}.`);
      }
      return;
    }

    // C) Aviso Informativo de Humedad (1 único mensaje al día, no requiere confirmación ni ráfaga)
    if (humidityForecast && !dailyLog.humidity_alert_sent) {
      const humidityHour = humidityForecast.hour;
      const humidityPct = Math.round(humidityForecast.relative_humidity);
      const timeStr = `${String(humidityHour).padStart(2, "0")}:00`;
      const humidMsg = `💧 *Aviso Informativo de Humedad*\n${locPrefix}Se pronostica humedad relativa alta (${humidityPct}%, máx. permitido: ${appSettings.max_humidity_percent}%) a las ${timeStr} hrs.\n_(Este mensaje es solo informativo y no requiere confirmación)_`;

      const sent = await telegramSvc.sendTelegramMessage(targetChatId, humidMsg);
      if (sent) {
        store.updateDailyLog(userId, dailyLog.id, {
          humidity_alert_sent: true
        });
        console.log(`[Scheduler] Informativo de Humedad enviado para User #${userId} el ${todayIso}`);
      }
    }
  } catch (err) {
    console.error(`[Scheduler] Error checking updated weather for alert tick (User #${userId}):`, err);
  }
}
