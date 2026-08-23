import { store } from "./db.js";
import { evaluateDayFeasibility, evaluateDayWithOverrides, computeHourlyClimateMap, compressClimateSegments, detectNewWeatherRisk } from "./evaluator.js";
import { getHourlyForecast, OpenMeteoWeatherService, MockWeatherService } from "./weatherService.js";
import { getHolidayDatesForRange } from "./holidaysService.js";
import { TelegramBotService } from "./telegramBot.js";
import { calendarService } from "./calendarService.js";
import { DayEvaluation, DayStatus, HourlyForecast, TaskStatus, Task } from "./types.js";
import { getLocalDateIso, getLocalHoursAndMinutes, getTargetTimeZone, LocalDate } from "./dateUtils.js";
import { NotificationDispatcher } from "./notificationDispatcher.js";

export { getLocalDateIso, getLocalHoursAndMinutes, getTargetTimeZone, LocalDate, NotificationDispatcher };

const activeEvaluationLocks = new Map<number, number>();
let lockTimeoutMsOverride: number | null = null;

export const LOCK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutos

export function setLockTimeoutForTest(ms: number | null): void {
  lockTimeoutMsOverride = ms;
}

function getEffectiveLockTimeoutMs(): number {
  return lockTimeoutMsOverride ?? LOCK_TIMEOUT_MS;
}

export function isEvaluationInProgress(userId: number): boolean {
  const lockTimestamp = activeEvaluationLocks.get(userId);
  if (!lockTimestamp) {
    return false;
  }

  const now = Date.now();
  const timeoutMs = getEffectiveLockTimeoutMs();
  const elapsedMs = now - lockTimestamp;

  if (elapsedMs > timeoutMs) {
    const elapsedSec = Math.round(elapsedMs / 1000);
    console.warn(`[Scheduler] ALERTA: lock de evaluación para usuario ${userId} liberado por timeout de seguridad (${elapsedSec}s transcurridos) — investigar causa.`);
    activeEvaluationLocks.delete(userId);
    return false;
  }

  return true;
}

export function acquireEvaluationLock(userId: number): boolean {
  if (isEvaluationInProgress(userId)) {
    return false;
  }

  activeEvaluationLocks.set(userId, Date.now());
  return true;
}

export function releaseEvaluationLock(userId: number): void {
  activeEvaluationLocks.delete(userId);
}

export async function syncMultiDayCalendar(
  userId: number,
  horizonEvaluations: Array<{ date_iso: string; evaluation: DayEvaluation }>
): Promise<{ synced: boolean; reason: string }> {
  return reconcileCalendarEvents(userId, horizonEvaluations);
}

/**
 * Reconciliador exhaustivo de Google Calendar:
 * 1. Procesa las evaluaciones del horizonte activo:
 *    - Si un día es viable con tareas: crea o actualiza el evento (o recrea si fue borrado con 404).
 *    - Si un día pasa a DAY_BLOCKED o pierde sus tareas: elimina el evento de Google Calendar y limpia la BD.
 * 2. Reconcilia los daily_logs futuros más allá del horizonte actual:
 *    - Si tienen google_event_id pero no son viables o no tienen tareas agendadas, elimina el evento huérfano.
 */
export async function reconcileCalendarEvents(
  userId: number,
  horizonEvaluations?: Array<{ date_iso: string; evaluation: DayEvaluation }>
): Promise<{ synced: boolean; reason: string; deletedOrphansCount?: number }> {
  const appSettings = store.getAppSettings(userId);

  if (!appSettings.google_calendar_enabled || !appSettings.google_calendar_id || !appSettings.google_calendar_id.trim()) {
    return { synced: false, reason: "ℹ️ Google Calendar no configurado / deshabilitado" };
  }

  const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
  const todayIso = getLocalDateIso(new Date(), userTz);

  let successCount = 0;
  let failCount = 0;
  const processedDates = new Set<string>();

  // 1. Procesar evaluaciones del horizonte si fueron provistas
  if (horizonEvaluations && horizonEvaluations.length > 0) {
    for (const item of horizonEvaluations) {
      const evalDate = item.date_iso;
      processedDates.add(evalDate);
      const evalRes = item.evaluation;

      const dailyLog = store.getDailyLogByDate(userId, evalDate);
      const existingEventId = dailyLog?.google_event_id || null;

      const isViable = evalRes.status === DayStatus.DAY_VIABLE &&
        Boolean(evalRes.window) &&
        Boolean(evalRes.scheduled_tasks && evalRes.scheduled_tasks.length > 0);

      if (isViable && evalRes.window) {
        const tasksForCal = (evalRes.scheduled_tasks || []).map(t => ({
          title: t.title,
          estimated_hours: t.estimated_hours
        }));

        if (existingEventId) {
          // Update existing event on Google Calendar
          const updateRes = await calendarService.updateWorkshopEvent(
            userId,
            existingEventId,
            evalDate,
            evalRes.window.start_time,
            evalRes.window.end_time,
            tasksForCal
          );

          if (updateRes.notFound) {
            // Event was deleted externally (404/410). Clear reference and reconstruct!
            console.log(`[Calendar Reconciler] Event ${existingEventId} on ${evalDate} returned 404. Re-creating event...`);
            if (dailyLog) {
              store.updateDailyLog(userId, dailyLog.id, { google_event_id: null, calendar_created: false });
            }
            const createRes = await calendarService.createWorkshopEvent(
              userId,
              evalDate,
              evalRes.window.start_time,
              evalRes.window.end_time,
              tasksForCal
            );
            if (createRes.success && createRes.eventId) {
              if (dailyLog) {
                store.updateDailyLog(userId, dailyLog.id, { google_event_id: createRes.eventId, calendar_created: true });
              }
              successCount++;
            } else {
              failCount++;
            }
          } else if (updateRes.success) {
            if (dailyLog) {
              store.updateDailyLog(userId, dailyLog.id, { calendar_created: true });
            }
            successCount++;
          } else {
            failCount++;
          }
        } else {
          // Create new event on Google Calendar
          const createRes = await calendarService.createWorkshopEvent(
            userId,
            evalDate,
            evalRes.window.start_time,
            evalRes.window.end_time,
            tasksForCal
          );
          if (createRes.success && createRes.eventId) {
            if (dailyLog) {
              store.updateDailyLog(userId, dailyLog.id, { google_event_id: createRes.eventId, calendar_created: true });
            }
            successCount++;
          } else {
            failCount++;
          }
        }
      } else {
        // Day is inviable or has no tasks -> Delete event from Google Calendar if reference exists
        if (existingEventId) {
          console.log(`[Calendar Reconciler] Day ${evalDate} is no longer viable with tasks (${evalRes.status}). Deleting event ${existingEventId}...`);
          await calendarService.deleteWorkshopEvent(userId, existingEventId);
          if (dailyLog) {
            store.updateDailyLog(userId, dailyLog.id, { google_event_id: null, calendar_created: false });
          }
          successCount++;
        }
      }
    }
  }

  // 2. Reconciliar todos los daily_logs futuros que tienen google_event_id y no fueron procesados arriba
  let deletedOrphansCount = 0;
  const futureLogsWithEvent = store.getFutureDailyLogsWithEvent(userId, todayIso);
  for (const log of futureLogsWithEvent) {
    if (processedDates.has(log.eval_date)) continue;

    let hasTasks = false;
    try {
      const taskIds = JSON.parse(log.scheduled_task_ids || "[]");
      hasTasks = taskIds.length > 0;
    } catch (_) {}

    const isStillViable = log.status === DayStatus.DAY_VIABLE && hasTasks && Boolean(log.window_start) && Boolean(log.window_end);

    if (!isStillViable && log.google_event_id) {
      console.log(`[Calendar Reconciler] Orphan event ${log.google_event_id} detected on inactive/blocked day ${log.eval_date}. Cleaning up...`);
      await calendarService.deleteWorkshopEvent(userId, log.google_event_id);
      store.updateDailyLog(userId, log.id, { google_event_id: null, calendar_created: false });
      deletedOrphansCount++;
    }
  }

  if (failCount === 0) {
    return {
      synced: true,
      reason: `📅 Reconciliación Google Calendar completada (${successCount} días sincronizados, ${deletedOrphansCount} huérfanos eliminados)`,
      deletedOrphansCount
    };
  } else {
    return {
      synced: false,
      reason: `⚠️ Reconciliación parcial (${successCount} ok, ${failCount} con error, ${deletedOrphansCount} huérfanos eliminados)`,
      deletedOrphansCount
    };
  }
}

export async function processWorkStartNotificationsForUser(
  userId: number,
  nowDate?: Date,
  force: boolean = false
): Promise<{ sent: boolean; reason: string }> {
  return NotificationDispatcher.processWorkStartNotification(userId, nowDate, force);
}

export async function runMorningEvaluation(
  userId: number,
  targetDateIso?: string,
  mockScenario?: string,
  options?: { skipLock?: boolean; silent?: boolean; nowDate?: Date }
): Promise<{
  evalResult: DayEvaluation;
  status: DayStatus;
  reason: string;
  telegramSent: boolean;
  telegramReason: string;
  calendarSynced: boolean;
  calendarReason: string;
}> {
  const needsLock = !options?.skipLock;
  if (needsLock) {
    if (!acquireEvaluationLock(userId)) {
      console.warn(`[Scheduler] Se omitió la evaluación para el Usuario #${userId}: ya hay una evaluación en curso.`);
      throw new Error("EVALUATION_IN_PROGRESS");
    }
  }

  try {
    const now = options?.nowDate || new Date();
    const appSettings = store.getAppSettings(userId);
    const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
    const todayIso = targetDateIso || getLocalDateIso(now, userTz);
    console.log(`[Scheduler] Running Multi-Day Evaluation for User #${userId} starting ${todayIso} (TZ: ${userTz})...`);

    const pendingTasks = store.getPendingTasks(userId);

    const forecastDaysCount = appSettings.forecast_days || 7;
    const horizonEvaluations: Array<{ date_iso: string; evaluation: DayEvaluation }> = [];

    let simulatedPendingTasks = [...pendingTasks];
    const startLocalDate = LocalDate.fromIso(todayIso);

    // Carga en lote del pronóstico meteorológico para todo el horizonte (1 sola petición o caché activa)
    let weeklyForecastMap = new Map<string, HourlyForecast[]>();
    if (mockScenario) {
      console.log(`[Scheduler] Using Mock Weather Scenario '${mockScenario}' for User #${userId}`);
      const mockSvc = new MockWeatherService(mockScenario);
      for (let i = 0; i < forecastDaysCount; i++) {
        const dateIso = startLocalDate.addDays(i).toIso();
        weeklyForecastMap.set(dateIso, mockSvc.getHourlyForecast(dateIso));
      }
    } else {
      const weatherSvc = new OpenMeteoWeatherService(appSettings.latitude, appSettings.longitude);
      weeklyForecastMap = await weatherSvc.getWeeklyForecast(todayIso, forecastDaysCount);
      console.log(`[Scheduler] Weather loaded for User #${userId}: ${weeklyForecastMap.size} days via OpenMeteo/Cache (${appSettings.latitude}, ${appSettings.longitude})`);
    }

    for (let i = 0; i < forecastDaysCount; i++) {
      const dateIso = startLocalDate.addDays(i).toIso();

      const dayForecasts: HourlyForecast[] = weeklyForecastMap.get(dateIso) || [];

      let dayHolidays = new Set<string>();
      if (appSettings.exclude_holidays) {
        try {
          dayHolidays = getHolidayDatesForRange(dateIso, dateIso);
        } catch (_) {}
      }

      const dayOverride = store.getDayOverride(userId, dateIso);
      const forcedRows = store.getForcedTasksForDate(userId, dateIso);

      const forcedTasksWithHours = forcedRows.map(fr => ({
        task: store.getTask(userId, fr.task_id),
        forced_start_hour: fr.forced_start_hour,
        forced_id: fr.id,
        id: fr.id
      })).filter((item): item is { task: Task; forced_start_hour: number; forced_id: number; id: number } => item.task != null);

      let isDayClosed = false;
      let closedReason = "";

      if (dateIso === todayIso) {
        const todayLog = store.getDailyLogByDate(userId, todayIso);

        if (todayLog && Boolean(todayLog.checkin_resolved)) {
          isDayClosed = true;
          closedReason = "Jornada concluida (cerrada manualmente por el usuario).";
        } else {
          // Si el día no fue cerrado por check-in, verificar si la hora actual local ya sobrepasó la ventana operativa de hoy
          const localHm = getLocalHoursAndMinutes(now, userTz);
          // Sólo si estamos en el mismo día real y la hora actual supera el final operativo del día
          const realWorldToday = getLocalDateIso(now, userTz);
          if (dateIso === realWorldToday) {
            const currentDecHour = localHm.totalHours;
            const endLimit = (dayOverride && dayOverride.custom_end_hour != null) ? dayOverride.custom_end_hour : appSettings.operational_end_hour;
            const minWork = appSettings.min_work_hours || 2.0;

            if (currentDecHour >= endLimit) {
              isDayClosed = true;
              closedReason = `Jornada concluida (horario operativo finalizado a las ${endLimit}:00).`;
            } else if (currentDecHour + minWork > endLimit) {
              isDayClosed = true;
              closedReason = `Jornada no asignable: tiempo restante insuficiente para la ventana mínima (${minWork.toFixed(1)}h antes de las ${endLimit}:00).`;
            }
          }
        }
      }

      const evalResult = evaluateDayWithOverrides(
        dateIso,
        simulatedPendingTasks,
        dayForecasts,
        appSettings,
        dayHolidays,
        dayOverride,
        forcedTasksWithHours,
        {
          isTodayClosed: isDayClosed,
          closedReason: closedReason
        }
      );

      let windowStart: string | null = null;
      let windowEnd: string | null = null;
      let netWorkHours: number | null = null;
      let tasksSummary: string | null = null;
      let scheduledTaskIds: string | null = null;

      if (evalResult.status === DayStatus.DAY_VIABLE && evalResult.window) {
        windowStart = evalResult.window.start_time;
        windowEnd = evalResult.window.end_time;
        netWorkHours = evalResult.window.net_work_hours;
        if (evalResult.scheduled_tasks) {
          tasksSummary = evalResult.scheduled_tasks.map(t => t.title).join(", ");
          scheduledTaskIds = JSON.stringify(evalResult.scheduled_tasks.map(t => t.id));

          const scheduledIds = new Set(evalResult.scheduled_tasks.map(t => t.id));
          simulatedPendingTasks = simulatedPendingTasks.filter(t => !scheduledIds.has(t.id));
        }
      }
      if (forcedTasksWithHours.length > 0) {
        const forcedIds = new Set(forcedTasksWithHours.map(ft => ft.task.id));
        simulatedPendingTasks = simulatedPendingTasks.filter(t => !forcedIds.has(t.id));
      }

      const existingLog = store.getDailyLogByDate(userId, dateIso);
      const isNewLog = !existingLog;

      const logData: any = {
        eval_date: dateIso,
        status: evalResult.status,
        block_reason: evalResult.reason,
        window_start: windowStart,
        window_end: windowEnd,
        net_work_hours: netWorkHours,
        tasks_summary: tasksSummary,
        scheduled_task_ids: scheduledTaskIds,
        morning_climate_snapshot: JSON.stringify(evalResult.climate_segments || []),
        hourly_forecast: JSON.stringify(evalResult.hourly_forecast || [])
      };

      if (isNewLog) {
        logData.checkin_sent = false;
        logData.checkin_resolved = false;
        logData.telegram_notified = false;
        logData.calendar_created = false;
        logData.google_event_id = null;
      }

      store.saveDailyLog(userId, logData);
      horizonEvaluations.push({ date_iso: dateIso, evaluation: evalResult });
    }

    const todayItem = horizonEvaluations.find(h => h.date_iso === todayIso) || horizonEvaluations[0];
    const todayEval = todayItem.evaluation;

    // Execute Mirror Sync with Google Calendar across the horizon
    const calSync = await syncMultiDayCalendar(userId, horizonEvaluations);

    // Check Telegram Work Start notification for today (unless evaluation is marked silent)
    const tgResult = options?.silent
      ? { sent: false, reason: "Evaluación silenciosa (sin notificación de Telegram)" }
      : await processWorkStartNotificationsForUser(userId, now);

    console.log(`[Scheduler] Multi-Day Evaluation completed for User #${userId} starting ${todayIso}: ${todayEval.status} - ${todayEval.reason}`);
    return {
      evalResult: todayEval,
      status: todayEval.status,
      reason: todayEval.reason,
      telegramSent: tgResult.sent,
      telegramReason: tgResult.reason,
      calendarSynced: calSync.synced,
      calendarReason: calSync.reason
    };
  } finally {
    if (needsLock) {
      releaseEvaluationLock(userId);
    }
  }
}

export async function triggerSilentReevaluation(userId: number, targetDateIso?: string): Promise<void> {
  try {
    await runMorningEvaluation(userId, targetDateIso, undefined, { silent: true });
  } catch (err: any) {
    if (err?.message === "EVALUATION_IN_PROGRESS") {
      console.log(`[Scheduler] Silent re-evaluation skipped for User #${userId}: lock active.`);
    } else {
      console.error(`[Scheduler] Error in triggerSilentReevaluation for User #${userId}:`, err);
    }
  }
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
    await processCheckinForUser(targetUserId, nowDate, force);
    return;
  }

  const users = store.getAllUsers();
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
  const users = store.getAllUsers();
  for (const user of users) {
    try {
      await processWeatherAlertForUser(user.id, nowDate);
    } catch (err) {
      console.error(`[Scheduler] Error in weather alert tick for User #${user.id}:`, err);
    }
  }
}

export async function runWorkStartTick(nowDate?: Date): Promise<void> {
  const users = store.getAllUsers();
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
  const users = store.getAllUsers();

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

  // Initialize Telegram background polling if bot token is present
  TelegramBotService.startPolling();

  // Initial execution of tiers on startup
  runMorningEvalTick().catch(err => console.error("[Daemon Tier 1 Error]:", err));
  runWorkStartTick().catch(err => console.error("[Daemon Tier 2 Error]:", err));
  runCheckinTick().catch(err => console.error("[Daemon Tier 3 Error]:", err));
  runWeatherAlertTick().catch(err => console.error("[Daemon Tier 4 Error]:", err));

  // Tier 1: Morning & Horizon Evaluation loop (every 15 minutes)
  const t1 = setInterval(() => {
    runMorningEvalTick().catch(err => console.error("[Daemon Tier 1 Error]:", err));
  }, 15 * 60 * 1000);

  // Tier 2: Work Start Notification loop (every 5 minutes)
  const t2 = setInterval(() => {
    runWorkStartTick().catch(err => console.error("[Daemon Tier 2 Error]:", err));
  }, 5 * 60 * 1000);

  // Tier 3: Night Check-in loop (every 15 minutes)
  const t3 = setInterval(() => {
    runCheckinTick().catch(err => console.error("[Daemon Tier 3 Error]:", err));
  }, 15 * 60 * 1000);

  // Tier 4: Urgent Weather Monitor loop (every 5 minutes for intraday alerts)
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
