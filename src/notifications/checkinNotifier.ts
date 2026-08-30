import { store } from "../db.js";
import { TelegramBotService } from "../telegramBot.js";
import { DayStatus, TaskStatus } from "../types.js";
import { getLocalDateIso, getLocalHoursAndMinutes } from "../dateUtils.js";
import { getTargetChatId } from "./targetChat.js";

/**
 * Despacha el prompt de Check-in nocturno / cierre de jornada (Tier 3).
 * Se dispara a partir de appSettings.checkin_hour siempre que el día no haya sido resuelto.
 */
export async function processCheckinNotification(
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
  if (!dailyLog) {
    return false;
  }

  let taskIds: number[] = [];
  try {
    taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]");
  } catch (_) {}

  // Si no hay tareas agendadas en absoluto y el día no fue viable, omitir
  if (taskIds.length === 0 && dailyLog.status !== DayStatus.DAY_VIABLE) {
    return false;
  }

  if (!force && (dailyLog.checkin_sent || dailyLog.checkin_resolved)) {
    return false;
  }

  if (!force && localTime.hours < appSettings.checkin_hour) {
    return false;
  }

  const scheduledTasks = taskIds
    .map(tid => store.getTask(userId, tid))
    .filter((t): t is any => t != null && t.status !== TaskStatus.COMPLETED);

  if (scheduledTasks.length === 0) {
    // Si no hay tareas agendadas pendientes, no despachamos prompt
    return false;
  }

  const targetChatId = getTargetChatId(userId, appSettings.telegram_chat_id);
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
