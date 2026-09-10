import { store } from "../db.js";
import { TelegramBotService } from "../telegramBot.js";
import { NotificationDispatcher } from "../notificationDispatcher.js";
import { getLocalDateIso, getLocalHoursAndMinutes } from "../dateUtils.js";
import { acquireEvaluationLock, releaseEvaluationLock } from "./locks.js";
import { runMorningEvaluation } from "./horizonRunner.js";
import { DayService } from "../services/dayService.js";

export async function processWorkStartNotificationsForUser(
  userId: number,
  nowDate?: Date,
  force: boolean = false
): Promise<{ sent: boolean; reason: string }> {
  return NotificationDispatcher.processWorkStartNotification(userId, nowDate, force);
}

/**
 * Proceso silencioso de catch-up al arrancar el servidor o ciclo para auto-cerrar
 * jornadas vencidas acumuladas sin check-in resuelto.
 */
export async function runCatchupOverdueDaysTick(nowDate?: Date): Promise<void> {
  const now = nowDate || new Date();
  const users = store.getActiveUsers();

  for (const user of users) {
    try {
      const appSettings = store.getAppSettings(user.id);
      const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
      const todayIso = getLocalDateIso(now, userTz);
      const count = await DayService.autoCloseOverdueDays(user.id, todayIso);
      if (count > 0) {
        console.log(`[Scheduler] Auto-cerradas silenciosamente ${count} jornada(s) vencida(s) acumuladas para Usuario #${user.id}.`);
      }
    } catch (err) {
      console.error(`[Scheduler] Error in catchup overdue days for User #${user.id}:`, err);
    }
  }
}


export async function processCheckinForUser(
  userId: number,
  nowDate?: Date,
  force: boolean = false,
  options?: { skipLock?: boolean; maxRetries?: number; retryDelayMs?: number }
): Promise<void> {
  const needsLock = !options?.skipLock;
  if (needsLock) {
    const maxRetries = options?.maxRetries ?? 3;
    const retryDelayMs = options?.retryDelayMs ?? 3000;
    let acquired = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (acquireEvaluationLock(userId)) {
        acquired = true;
        break;
      }
      if (attempt < maxRetries) {
        console.warn(`[Scheduler] Lock de evaluación ocupado para Usuario #${userId} en check-in (intento ${attempt}/${maxRetries}). Reintentando en ${retryDelayMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }

    if (!acquired) {
      console.warn(`[Scheduler] Se omitió el check-in para el Usuario #${userId}: evaluación/check-in en curso tras ${maxRetries} intentos.`);
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

      // Auto-cierre silencioso de días atrasados antes de evaluar la nueva jornada
      await DayService.autoCloseOverdueDays(user.id, todayIso);

      await runMorningEvaluation(user.id, todayIso);
    } catch (err) {
      console.error(`[Scheduler] Error in morning eval tick for User #${user.id}:`, err);
    }
  }
}

let daemonIntervals: NodeJS.Timeout[] = [];
let daemonTimeouts: NodeJS.Timeout[] = [];

export function startDaemon(): void {
  console.log("[Daemon] WORKSHOP OS Multi-Tenant Precision Scheduler starting...");
  console.log("  • Tier 1 (Horizon Evaluation & Calendar Mirror Sync): Dynamic trigger at operational start time (every 15 min)");
  console.log("  • Tier 2 (Work Start Telegram Notification): Triggered at the beginning of active work block (every 5 min)");
  console.log("  • Tier 3 (Night Check-in): Fixed trigger at configured check-in hour (every 15 min, offset by 2 min from Tier 1)");
  console.log("  • Tier 4 (Urgent Weather Monitor): Active work window scan with 5-min 3-message alert bursts");
  console.log("  • Silent Catch-up (Overdue Auto-close): Resolves accumulated past days without user interaction/notifications");

  stopDaemon();

  TelegramBotService.startPolling();

  // Catch-up silencioso de arranque: resuelve días vencidos acumulados sin notificar
  runCatchupOverdueDaysTick().catch(err => console.error("[Daemon Catchup Error]:", err));

  // Tier 1 immediately and every 15 min
  runMorningEvalTick().catch(err => console.error("[Daemon Tier 1 Error]:", err));
  const t1 = setInterval(() => {
    runMorningEvalTick().catch(err => console.error("[Daemon Tier 1 Error]:", err));
  }, 15 * 60 * 1000);

  // Tier 2 immediately and every 5 min
  runWorkStartTick().catch(err => console.error("[Daemon Tier 2 Error]:", err));
  const t2 = setInterval(() => {
    runWorkStartTick().catch(err => console.error("[Daemon Tier 2 Error]:", err));
  }, 5 * 60 * 1000);

  // Tier 4 immediately and every 5 min
  runWeatherAlertTick().catch(err => console.error("[Daemon Tier 4 Error]:", err));
  const t4 = setInterval(() => {
    runWeatherAlertTick().catch(err => console.error("[Daemon Tier 4 Error]:", err));
  }, 5 * 60 * 1000);

  // Tier 3: Desfasar el arranque 2 minutos respecto a Tier 1 para evitar colisiones de lock
  const t3Timeout = setTimeout(() => {
    runCheckinTick().catch(err => console.error("[Daemon Tier 3 Error]:", err));
    const t3 = setInterval(() => {
      runCheckinTick().catch(err => console.error("[Daemon Tier 3 Error]:", err));
    }, 15 * 60 * 1000);
    daemonIntervals.push(t3);
  }, 2 * 60 * 1000);

  daemonTimeouts.push(t3Timeout);
  daemonIntervals.push(t1, t2, t4);
}

export function stopDaemon(): void {
  TelegramBotService.stopPolling();
  if (daemonTimeouts.length > 0) {
    daemonTimeouts.forEach(clearTimeout);
    daemonTimeouts = [];
  }
  if (daemonIntervals.length > 0) {
    console.log("[Daemon] Stopping background scheduler daemon...");
    daemonIntervals.forEach(clearInterval);
    daemonIntervals = [];
  }
}
