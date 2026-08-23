import { store } from "./db.js";
import { TelegramBotService } from "./telegramBot.js";
import { DayEvaluation, DayStatus, HourlyForecast, TaskStatus } from "./types.js";
import { getLocalDateIso, getLocalHoursAndMinutes } from "./dateUtils.js";
import { getHourlyForecast } from "./weatherService.js";

/**
 * NotificationDispatcher
 * 
 * Módulo especializado y desacoplado para gestionar el despacho de notificaciones
 * de Workshop OS a través de canales externos (Telegram Bot, alertas climáticas, check-in).
 */
export class NotificationDispatcher {
  /**
   * Resuelve el ID de chat de Telegram configurado para el usuario o fallback de sistema.
   */
  public static getTargetChatId(userId: number, telegramChatIdFromSettings?: string | null): string {
    let targetChatId = telegramChatIdFromSettings ? telegramChatIdFromSettings.trim() : "";
    if (!targetChatId && userId === 1 && process.env.TELEGRAM_CHAT_ID) {
      targetChatId = process.env.TELEGRAM_CHAT_ID.trim();
    }
    return targetChatId;
  }

  /**
   * Despacha la notificación de Inicio de Jornada de Trabajo (Tier 2).
   */
  public static async processWorkStartNotification(
    userId: number,
    nowDate?: Date,
    force: boolean = false
  ): Promise<{ sent: boolean; reason: string }> {
    const now = nowDate || new Date();
    const appSettings = store.getAppSettings(userId);
    const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
    const todayIso = getLocalDateIso(now, userTz);
    const localTime = getLocalHoursAndMinutes(now, userTz);

    const dailyLog = store.getDailyLogByDate(userId, todayIso);
    if (!dailyLog || dailyLog.status !== DayStatus.DAY_VIABLE || !dailyLog.window_start || !dailyLog.window_end) {
      return { sent: false, reason: "ℹ️ No hay jornada viable para hoy" };
    }

    if (!force && dailyLog.telegram_notified) {
      return { sent: false, reason: "ℹ️ Notificación de inicio de jornada ya enviada previamente hoy" };
    }

    const [sH, sM] = dailyLog.window_start.split(":").map(Number);
    const [eH, eM] = dailyLog.window_end.split(":").map(Number);
    const windowStartH = sH + sM / 60.0;
    const windowEndH = eH + eM / 60.0;
    const nowH = localTime.totalHours;

    if (!force && nowH < windowStartH) {
      return {
        sent: false,
        reason: `ℹ️ Notificación programada para el inicio del bloque de trabajo (${dailyLog.window_start} hrs)`
      };
    }

    if (!force && nowH >= windowEndH) {
      return {
        sent: false,
        reason: `ℹ️ La jornada de hoy (${dailyLog.window_start} - ${dailyLog.window_end}) ya finalizó`
      };
    }

    let taskIds: number[] = [];
    try {
      taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]");
    } catch (_) {}

    const tasks = taskIds
      .map(tid => store.getTask(userId, tid))
      .filter((t): t is any => t != null && t.status !== TaskStatus.COMPLETED);

    if (tasks.length === 0) {
      store.updateDailyLog(userId, dailyLog.id, { telegram_notified: true });
      return { sent: false, reason: "ℹ️ Sin tareas agendadas hoy (notificación omitida)" };
    }

    const targetChatId = this.getTargetChatId(userId, appSettings.telegram_chat_id);
    if (!targetChatId) {
      return { sent: false, reason: "⚠️ Chat ID de Telegram no configurado" };
    }

    const telegramSvc = new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN, targetChatId);

    let climateSegments = [];
    try {
      climateSegments = JSON.parse(dailyLog.morning_climate_snapshot || "[]");
    } catch (_) {}

    const evalResult: DayEvaluation = {
      eval_date: todayIso,
      status: DayStatus.DAY_VIABLE,
      reason: dailyLog.block_reason || "Día viable con tareas agendadas",
      window: {
        start_time: dailyLog.window_start || "09:00",
        end_time: dailyLog.window_end || "18:00",
        start_hour: 9,
        end_hour: 18,
        total_duration_hours: (dailyLog.net_work_hours || 0) + 2,
        net_work_hours: dailyLog.net_work_hours || 0,
        is_viable: true
      },
      scheduled_tasks: tasks,
      climate_segments: climateSegments
    };

    const sent = await telegramSvc.sendWorkStartNotification(evalResult);
    if (sent) {
      store.updateDailyLog(userId, dailyLog.id, { telegram_notified: true });
      console.log(`[Scheduler] Telegram Work Start Notification sent for User #${userId} on ${todayIso}.`);
      return { sent: true, reason: "🚀 Notificación de inicio de jornada enviada a Telegram" };
    } else {
      return { sent: false, reason: "❌ Error al enviar notificación a Telegram" };
    }
  }

  /**
   * Despacha el prompt de Check-in nocturno/cierre de jornada (Tier 3).
   */
  public static async processCheckinNotification(
    userId: number,
    nowDate?: Date,
    force: boolean = false
  ): Promise<boolean> {
    const now = nowDate || new Date();
    const appSettings = store.getAppSettings(userId);
    const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
    const todayIso = getLocalDateIso(now, userTz);
    const localTime = getLocalHoursAndMinutes(now, userTz);

    const dailyLog = store.getDailyLogByDate(userId, todayIso);
    if (!dailyLog || dailyLog.status !== DayStatus.DAY_VIABLE) {
      return false;
    }

    if (!force && (dailyLog.checkin_sent || dailyLog.checkin_resolved)) {
      return false;
    }

    if (!force && localTime.hours < appSettings.checkin_hour) {
      return false;
    }

    let taskIds: number[] = [];
    try {
      taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]");
    } catch (_) {}

    const scheduledTasks = taskIds
      .map(tid => store.getTask(userId, tid))
      .filter((t): t is any => t != null && t.status !== TaskStatus.COMPLETED);

    if (scheduledTasks.length === 0) {
      store.updateDailyLog(userId, dailyLog.id, { checkin_sent: true, checkin_resolved: true });
      return false;
    }

    const targetChatId = this.getTargetChatId(userId, appSettings.telegram_chat_id);
    if (!targetChatId) {
      console.log(`[Telegram] SKIPPED: No valid chatId provided for userId ${userId}`);
      return false;
    }

    const telegramSvc = new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN, targetChatId);
    const sent = await telegramSvc.sendCheckinPrompt(dailyLog.id, scheduledTasks);
    if (sent) {
      store.updateDailyLog(userId, dailyLog.id, { checkin_sent: true });
      console.log(`[Scheduler] Sent check-in prompt for User #${userId} on ${todayIso} (${scheduledTasks.length} tasks).`);
      return true;
    }
    return false;
  }

  /**
   * Procesa el monitoreo y despacho de alertas climáticas intradía (Lluvia de emergencia / Aviso de humedad) (Tier 4).
   */
  public static async processWeatherAlert(
    userId: number,
    nowDate?: Date
  ): Promise<void> {
    const now = nowDate || new Date();
    const appSettings = store.getAppSettings(userId);
    const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
    const todayIso = getLocalDateIso(now, userTz);
    const localTime = getLocalHoursAndMinutes(now, userTz);
    const currentLocalHour = localTime.totalHours;

    // STRICT OPERATIONAL HOURS CHECK: Alertas sólo dentro de la jornada laboral
    if (currentLocalHour < appSettings.operational_start_hour || currentLocalHour >= appSettings.operational_end_hour) {
      return;
    }

    const dailyLog = store.getDailyLogByDate(userId, todayIso);
    if (!dailyLog || dailyLog.status !== DayStatus.DAY_VIABLE) {
      return;
    }

    // Determinar rango de horas a monitorear (priorizar ventana agendada de tareas)
    let startHourLimit = appSettings.operational_start_hour;
    let endHourLimit = appSettings.operational_end_hour;

    if (dailyLog.window_start && dailyLog.window_end) {
      const [wStartH, wStartM] = dailyLog.window_start.split(":").map(Number);
      const [wEndH, wEndM] = dailyLog.window_end.split(":").map(Number);
      startHourLimit = wStartH + (wStartM || 0) / 60.0;
      endHourLimit = wEndH + (wEndM || 0) / 60.0;
    }

    // Si la hora local actual ya superó el horario de término de tareas de hoy, no enviar más alertas
    if (currentLocalHour >= endHourLimit) {
      return;
    }

    const targetChatId = this.getTargetChatId(userId, appSettings.telegram_chat_id);
    if (!targetChatId) {
      return;
    }

    const telegramSvc = new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN, targetChatId);

    try {
      const forecasts = await getHourlyForecast(todayIso, appSettings.latitude, appSettings.longitude);
      const startHourInt = Math.max(Math.floor(currentLocalHour), Math.floor(startHourLimit));
      const endHourInt = Math.ceil(endHourLimit);

      const remainingWorkForecasts = forecasts.filter(f => f.hour >= startHourInt && f.hour <= endHourInt);

      // 1. Detección de Lluvia
      const rainForecast = remainingWorkForecasts.find(f =>
        (f.precipitation_probability != null && f.precipitation_probability >= 30) ||
        (f.precipitation_mm != null && f.precipitation_mm >= appSettings.min_rain_precipitation_mm)
      );

      // 2. Detección de Humedad alta
      const humidityForecast = remainingWorkForecasts.find(f => f.relative_humidity > appSettings.max_humidity_percent);

      const locPrefix = `📍 *Taller (${appSettings.latitude.toFixed(2)}, ${appSettings.longitude.toFixed(2)}):* `;

      // Extraer hora de lluvia previamente alertada de la columna dedicada
      const previousRainHour: number | null = dailyLog.last_rain_alert_hour ?? null;

      const rainHour = rainForecast ? rainForecast.hour : null;
      const isRainAdvanced = rainHour != null && previousRainHour != null && rainHour < previousRainHour;
      const isNewRainAlert = rainHour != null && !dailyLog.intraday_alert_triggered;

      // A) Si hay una nueva lluvia o la lluvia se ADELANTÓ respecto a la alerta anterior
      if (rainForecast && (isNewRainAlert || isRainAdvanced)) {
        const criticalTimeStr = `${String(rainHour).padStart(2, "0")}:00`;
        const precipMm = rainForecast.precipitation_mm || 0;

        const detailsText = isRainAdvanced
          ? `🚨 *¡ALERTA URGENTE DE LLUVIA ADELANTADA!*\n${locPrefix}La lluvia se ha ADELANTADO a las ${criticalTimeStr} hrs (prevista antes a las ${String(previousRainHour).padStart(2, "0")}:00 hrs). Precipitación: ${precipMm.toFixed(1)} mm.`
          : `🌧️ *¡ALERTA DE LLUVIA EN TALLER!*\n${locPrefix}Se pronostica lluvia a las ${criticalTimeStr} hrs (Precipitación: ${precipMm.toFixed(1)} mm).`;

        // Intentar envío de ráfaga
        await telegramSvc.sendIntradayEmergencyAlertBurst(dailyLog.id, detailsText);

        // Persistencia atómica e incondicional del estado de alerta
        const nowIso = now.toISOString();
        store.updateDailyLog(userId, dailyLog.id, {
          intraday_alert_triggered: true,
          intraday_alert_acknowledged: false, // Forzar nueva confirmación si es nueva o si la lluvia se adelantó
          intraday_alert_last_sent_at: nowIso,
          intraday_alert_burst_count: 1,
          last_rain_alert_hour: rainHour
        });
        console.log(`[Scheduler] Intraday Rain Emergency Alert triggered for User #${userId} on ${todayIso}: ${detailsText}`);
        return;
      }

      // B) Si hay alerta de lluvia activa pero NO ha sido confirmada -> Ráfaga de reintento cada 5 min
      if (dailyLog.intraday_alert_triggered && !dailyLog.intraday_alert_acknowledged) {
        const lastSentIso = dailyLog.intraday_alert_last_sent_at;
        const lastSentMs = lastSentIso ? new Date(lastSentIso).getTime() : 0;
        const elapsedMs = now.getTime() - lastSentMs;
        const FIVE_MIN_MS = 5 * 60 * 1000;

        if (elapsedMs >= FIVE_MIN_MS) {
          let alertMsg = "Cambio climático imprevisto detectado en taller.";
          if (rainForecast && rainHour != null) {
            const criticalTimeStr = `${String(rainHour).padStart(2, "0")}:00`;
            const precipMm = rainForecast.precipitation_mm || 0;
            alertMsg = `🌧️ *¡ALERTA DE LLUVIA EN TALLER!*\n${locPrefix}Se pronostica lluvia a las ${criticalTimeStr} hrs (Precipitación: ${precipMm.toFixed(1)} mm).`;
          }
          await telegramSvc.sendIntradayEmergencyAlertBurst(dailyLog.id, alertMsg);

          const nowIso = now.toISOString();
          const burstCount = (dailyLog.intraday_alert_burst_count || 0) + 1;
          store.updateDailyLog(userId, dailyLog.id, {
            intraday_alert_last_sent_at: nowIso,
            intraday_alert_burst_count: burstCount
          });
          console.log(`[Scheduler] Intraday Rain alert retry #${burstCount} sent for User #${userId} on ${todayIso}.`);
        }
        return;
      }

      // C) Si NO hay lluvia (o la lluvia está confirmada), evaluar Aviso Informativo de Humedad de forma INDEPENDIENTE
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
}
