import { store } from "../db.js";
import { TelegramBotService } from "../telegramBot.js";
import { DayEvaluation, DayStatus, TaskStatus } from "../types.js";
import { getLocalDateIso, getLocalHoursAndMinutes } from "../dateUtils.js";
import { getTargetChatId } from "./targetChat.js";

/**
 * Despacha la notificación de Inicio de Jornada de Trabajo (Tier 2).
 * Se dispara cuando la hora actual está dentro de la ventana de trabajo agendada (window_start <= now < window_end).
 */
export async function processWorkStartNotification(
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
  const windowStartH = sH + (sM || 0) / 60.0;
  const windowEndH = eH + (eM || 0) / 60.0;
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
    // No marcar telegram_notified si no hay tareas para notificar
    return { sent: false, reason: "ℹ️ Sin tareas agendadas hoy (notificación omitida)" };
  }

  const targetChatId = getTargetChatId(userId, appSettings.telegram_chat_id);
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
      start_hour: sH,
      end_hour: eH,
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
