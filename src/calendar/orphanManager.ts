import { store } from "../db.js";
import { deleteWorkshopEvent, listFutureWorkshopEvents } from "./syncService.js";

export async function previewOrphanCalendarEvents(
  calendarClient: any,
  userId: number,
  fromIsoDate: string
): Promise<{
  success: boolean;
  orphanEvents: Array<{ id: string; summary: string; start: string; description: string }>;
  totalEventsChecked: number;
  error?: string;
}> {
  const listRes = await listFutureWorkshopEvents(calendarClient, userId, fromIsoDate);
  if (!listRes.success || !listRes.events) {
    return { success: false, orphanEvents: [], totalEventsChecked: 0, error: listRes.error };
  }

  const futureLogs = store.getFutureDailyLogsWithEvent(userId, fromIsoDate);
  const validEventIds = new Set<string>();

  for (const log of futureLogs) {
    let hasTasks = false;
    try {
      const taskIds = JSON.parse(log.scheduled_task_ids || "[]");
      hasTasks = taskIds.length > 0;
    } catch (_) {}

    if (log.status === "DAY_VIABLE" && hasTasks && log.google_event_id) {
      validEventIds.add(log.google_event_id.trim());
    }
  }

  const orphanEvents = listRes.events.filter(event => !validEventIds.has(event.id.trim()));

  return {
    success: true,
    orphanEvents,
    totalEventsChecked: listRes.events.length
  };
}

export async function cleanupOrphanCalendarEvents(
  calendarClient: any,
  userId: number,
  fromIsoDate: string,
  targetEventIds?: string[]
): Promise<{ success: boolean; deletedCount: number; deletedEventIds: string[]; error?: string }> {
  const listRes = await listFutureWorkshopEvents(calendarClient, userId, fromIsoDate);
  if (!listRes.success || !listRes.events) {
    return { success: false, deletedCount: 0, deletedEventIds: [], error: listRes.error };
  }

  const futureLogs = store.getFutureDailyLogsWithEvent(userId, fromIsoDate);
  const validEventIds = new Set<string>();

  for (const log of futureLogs) {
    let hasTasks = false;
    try {
      const taskIds = JSON.parse(log.scheduled_task_ids || "[]");
      hasTasks = taskIds.length > 0;
    } catch (_) {}

    if (log.status === "DAY_VIABLE" && hasTasks && log.google_event_id) {
      validEventIds.add(log.google_event_id.trim());
    }
  }

  const allowedTargetIds = targetEventIds ? new Set(targetEventIds.map(id => id.trim())) : null;
  const deletedEventIds: string[] = [];

  for (const event of listRes.events) {
    const eventIdTrimmed = event.id.trim();
    if (!validEventIds.has(eventIdTrimmed)) {
      if (allowedTargetIds && !allowedTargetIds.has(eventIdTrimmed)) {
        continue;
      }

      console.log(`[GoogleCalendarService] Deleting orphan event ${event.id} ('${event.summary}' at ${event.start}) for User #${userId}...`);
      const delRes = await deleteWorkshopEvent(calendarClient, userId, event.id);
      if (delRes.success) {
        deletedEventIds.push(event.id);
      }
    }
  }

  return {
    success: true,
    deletedCount: deletedEventIds.length,
    deletedEventIds
  };
}
