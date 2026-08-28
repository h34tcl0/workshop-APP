import { store } from "../db.js";
import { executeWithRetry } from "./client.js";
import { buildEventPayload, type ScheduledTaskPayload } from "./eventFormatter.js";

export interface CalendarSyncResult {
  success: boolean;
  eventId?: string | null;
  notFound?: boolean;
  error?: string;
}

function getCalendarConfig(userId: number) {
  const settings = store.getAppSettings(userId);
  if (!settings.google_calendar_enabled || !settings.google_calendar_id || !settings.google_calendar_id.trim()) {
    return null;
  }
  const timezone = (settings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
  return { calendarId: settings.google_calendar_id.trim(), timezone };
}

export async function createWorkshopEvent(
  calendarClient: any,
  initError: string | null,
  userId: number,
  evalDate: string,
  startTime: string,
  endTime: string,
  scheduledTasks: ScheduledTaskPayload[]
): Promise<CalendarSyncResult> {
  const config = getCalendarConfig(userId);
  if (!config) return { success: false, error: "Google Calendar not connected or disabled" };
  if (!calendarClient) return { success: false, error: initError || "Missing environment variables or credentials file." };

  try {
    const eventPayload = buildEventPayload(evalDate, startTime, endTime, scheduledTasks, config.timezone);
    const res = (await executeWithRetry(
      `createWorkshopEvent for User #${userId}`,
      () => calendarClient.events.insert({ calendarId: config.calendarId, requestBody: eventPayload })
    )) as any;

    const eventId = res.data?.id || null;
    console.log(`[GoogleCalendarService] Event created (${eventId}) in Google Calendar (${config.calendarId}) for User #${userId} on ${evalDate}.`);
    return { success: true, eventId };
  } catch (err: any) {
    const errorMsg = err?.response?.data?.error_description || err?.response?.data?.error?.message || err?.message || String(err);
    console.warn(`[GoogleCalendarService] Could not create event for User #${userId} (${config.calendarId}) on ${evalDate}: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

export async function updateWorkshopEvent(
  calendarClient: any,
  userId: number,
  eventId: string,
  evalDate: string,
  startTime: string,
  endTime: string,
  scheduledTasks: ScheduledTaskPayload[]
): Promise<CalendarSyncResult> {
  const config = getCalendarConfig(userId);
  if (!config) return { success: false, error: "Google Calendar not connected or disabled" };
  if (!calendarClient) return { success: false, error: "Google Calendar credentials not initialized" };

  try {
    const eventPayload = buildEventPayload(evalDate, startTime, endTime, scheduledTasks, config.timezone);
    await executeWithRetry(
      `updateWorkshopEvent for User #${userId} (${eventId})`,
      () => calendarClient.events.patch({ calendarId: config.calendarId, eventId, requestBody: eventPayload })
    );

    console.log(`[GoogleCalendarService] Event updated (${eventId}) in Google Calendar (${config.calendarId}) for User #${userId} on ${evalDate}.`);
    return { success: true, eventId };
  } catch (err: any) {
    const status = err?.code || err?.response?.status || err?.status;
    const errorMsg = err?.response?.data?.error_description || err?.response?.data?.error?.message || err?.message || String(err);
    if (status === 404 || status === 410 || errorMsg.includes("Not Found") || errorMsg.includes("notFound") || errorMsg.includes("deleted")) {
      console.warn(`[GoogleCalendarService] Event ${eventId} not found (404) on Google Calendar. Will trigger re-creation.`);
      return { success: false, notFound: true, error: "Event not found on Google Calendar" };
    }
    console.warn(`[GoogleCalendarService] Could not update event ${eventId} in Google Calendar: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

export async function deleteWorkshopEvent(
  calendarClient: any,
  userId: number,
  eventId: string
): Promise<CalendarSyncResult> {
  const config = getCalendarConfig(userId);
  if (!config) return { success: false, error: "Google Calendar not connected or disabled" };
  if (!calendarClient) return { success: false, error: "Google Calendar credentials not initialized" };

  try {
    await executeWithRetry(
      `deleteWorkshopEvent for User #${userId} (${eventId})`,
      () => calendarClient.events.delete({ calendarId: config.calendarId, eventId })
    );

    console.log(`[GoogleCalendarService] Event deleted (${eventId}) from Google Calendar (${config.calendarId}) for User #${userId}.`);
    return { success: true };
  } catch (err: any) {
    const status = err?.code || err?.response?.status || err?.status;
    const errorMsg = err?.response?.data?.error_description || err?.response?.data?.error?.message || err?.message || String(err);
    if (status === 404 || status === 410 || errorMsg.includes("Not Found") || errorMsg.includes("notFound") || errorMsg.includes("deleted")) {
      console.log(`[GoogleCalendarService] Event ${eventId} was already deleted on Google Calendar.`);
      return { success: true, notFound: true };
    }
    console.warn(`[GoogleCalendarService] Could not delete event ${eventId} from Google Calendar: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

export async function listFutureWorkshopEvents(
  calendarClient: any,
  userId: number,
  fromIsoDate: string
): Promise<{ success: boolean; events?: Array<{ id: string; summary: string; start: string; description: string }>; error?: string }> {
  const config = getCalendarConfig(userId);
  if (!config) return { success: false, error: "Google Calendar not connected or disabled" };
  if (!calendarClient) return { success: false, error: "Google Calendar credentials not initialized" };

  try {
    const timeMin = new Date(`${fromIsoDate}T00:00:00`).toISOString();
    const res = (await executeWithRetry(
      `listFutureWorkshopEvents for User #${userId}`,
      () => calendarClient.events.list({
        calendarId: config.calendarId,
        timeMin: timeMin,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 100
      })
    )) as any;

    const items = res.data?.items || [];
    const workshopEvents = items
      .filter((item: any) => {
        const extShared = item.extendedProperties?.shared?.workshop_os_event;
        const extPrivate = item.extendedProperties?.private?.app;
        if (extShared === "true" || extPrivate === "workshop-os") return true;

        const summary = item.summary || "";
        const desc = item.description || "";
        return desc.includes("WORKSHOP OS - Bloque Macro de Trabajo") ||
          (desc.includes("Tareas Agendadas:") && summary.startsWith("🔨 Taller Carpintería"));
      })
      .map((item: any) => ({
        id: item.id,
        summary: item.summary || "",
        start: item.start?.dateTime || item.start?.date || "",
        description: item.description || ""
      }));

    return { success: true, events: workshopEvents };
  } catch (err: any) {
    const errorMsg = err?.response?.data?.error_description || err?.response?.data?.error?.message || err?.message || String(err);
    console.warn(`[GoogleCalendarService] Error listing calendar events for User #${userId}:`, errorMsg);
    return { success: false, error: errorMsg };
  }
}
