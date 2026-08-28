import { store } from "../db.js";
import { calendarService } from "../calendarService.js";
import { DayEvaluation, DayStatus } from "../types.js";
import { getLocalDateIso } from "../dateUtils.js";

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
