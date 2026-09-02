import { store } from "../db.js";
import { TelegramBotService } from "../telegramBot.js";
import { NotificationDispatcher } from "../notificationDispatcher.js";
import { getLocalDateIso, getLocalHoursAndMinutes } from "../dateUtils.js";
import { acquireEvaluationLock, releaseEvaluationLock } from "./locks.js";
import { runMorningEvaluation } from "./horizonRunner.js";

export async function processWorkStartNotificationsForUser(
  userId: number,
  nowDate?: Date,
  force: boolean = false
): Promise<{ sent: boolean; reason: string }> {
  return NotificationDispatcher.processWorkStartNotification(userId, nowDate, force);
}

export async function processCheckinForUser(
  userId: number,
  nowDate?: Date,
  force: boolean = false,
  options?: { skipLock?: boolean }
): Promise<void> {
  const needsLock = !options?.skipLock;
  if (needsLock) {
    if (!acquireEvaluationLock(userId)) {
      console.warn(`[Scheduler] Se omitió el check-in para el Usuario #${userId}: evaluación/check-in en curso.`);
      return;
    }
  }

  try {
    await NotificationDispatcher.processCheckinNotification(userId, nowDate, force);
  } finally {
    if (needsLock) {
      releaseEvaluationLock(userId);
    }
  }
}

export async function runCheckinTick(nowDate?: Date, force: boolean = false, targetUserId?: number): Promise<void> {
  if (targetUserId) {
    const targetUser = store.getUserById(targetUserId);
    if (targetUser && targetUser.status === 'active') {
      await processCheckinForUser(targetUserId, nowDate, force);
    }
    return;
  }

  const users = store.getActiveUsers();
  for (const user of users) {
    try {
      await processCheckinForUser(user.id, nowDate, force);
    } catch (err) {
      console.error(`[Scheduler] Error in checkin tick for User #${user.id}:`, err);
    }
  }
}

export async function processWeatherAlertForUser(userId: number, nowDate?: Date): Promise<void> {
  return NotificationDispatcher.processWeatherAlert(userId, nowDate);
}

export async function runWeatherAlertTick(nowDate?: Date): Promise<void> {
  const users = store.getActiveUsers();
  for (const user of users) {
    try {
      await processWeatherAlertForUser(user.id, nowDate);
    } catch (err) {
      console.error(`[Scheduler] Error in weather alert tick for User #${user.id}:`, err);
    }
  }
}

export async function runWorkStartTick(nowDate?: Date): Promise<void> {
  const users = store.getActiveUsers();
  for (const user of users) {
    try {
      await processWorkStartNotificationsForUser(user.id, nowDate);
    } catch (err) {
      console.error(`[Scheduler] Error in work start notification tick for User #${user.id}:`, err);
    }
  }
}

export async function runMorningEvalTick(nowDate?: Date): Promise<void> {
  const now = nowDate || new Date();
  const users = store.getActiveUsers();

  for (const user of users) {
    try {
      const appSettings = store.getAppSettings(user.id);
      const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
      const todayIso = getLocalDateIso(now, userTz);
      const localTime = getLocalHoursAndMinutes(now, userTz);

      const triggerHour = (appSettings.operational_start_hour - appSettings.morning_eval_lead_hours + 24) % 24;

      if (localTime.hours < triggerHour) continue;

      await runMorningEvaluation(user.id, todayIso);
    } catch (err) {
      console.error(`[Scheduler] Error in morning eval tick for User #${user.id}:`, err);
    }
  }
}

let daemonIntervals: NodeJS.Timeout[] = [];

export function startDaemon(): void {
  console.log("[Daemon] WORKSHOP OS Multi-Tenant Precision Scheduler starting...");
  console.log("  • Tier 1 (Horizon Evaluation & Calendar Mirror Sync): Dynamic trigger at operational start time");
  console.log("  • Tier 2 (Work Start Telegram Notification): Triggered at the beginning of active work block");
  console.log("  • Tier 3 (Night Check-in): Fixed trigger at configured check-in hour");
  console.log("  • Tier 4 (Urgent Weather Monitor): Active work window scan with 5-min 3-message alert bursts");

  stopDaemon();

  TelegramBotService.startPolling();

  runMorningEvalTick().catch(err => console.error("[Daemon Tier 1 Error]:", err));
  runWorkStartTick().catch(err => console.error("[Daemon Tier 2 Error]:", err));
  runCheckinTick().catch(err => console.error("[Daemon Tier 3 Error]:", err));
  runWeatherAlertTick().catch(err => console.error("[Daemon Tier 4 Error]:", err));

  const t1 = setInterval(() => {
    runMorningEvalTick().catch(err => console.error("[Daemon Tier 1 Error]:", err));
  }, 15 * 60 * 1000);

  const t2 = setInterval(() => {
    runWorkStartTick().catch(err => console.error("[Daemon Tier 2 Error]:", err));
  }, 5 * 60 * 1000);

  const t3 = setInterval(() => {
    runCheckinTick().catch(err => console.error("[Daemon Tier 3 Error]:", err));
  }, 15 * 60 * 1000);

  const t4 = setInterval(() => {
    runWeatherAlertTick().catch(err => console.error("[Daemon Tier 4 Error]:", err));
  }, 5 * 60 * 1000);

  daemonIntervals.push(t1, t2, t3, t4);
}

export function stopDaemon(): void {
  TelegramBotService.stopPolling();
  if (daemonIntervals.length > 0) {
    console.log("[Daemon] Stopping background scheduler daemon...");
    daemonIntervals.forEach(clearInterval);
    daemonIntervals = [];
  }
}
