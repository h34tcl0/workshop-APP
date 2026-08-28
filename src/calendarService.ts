import { initGoogleCalendarClient } from "./calendar/client.js";
import type { ScheduledTaskPayload } from "./calendar/eventFormatter.js";
import {
  type CalendarSyncResult,
  createWorkshopEvent,
  updateWorkshopEvent,
  deleteWorkshopEvent,
  listFutureWorkshopEvents
} from "./calendar/syncService.js";
import {
  previewOrphanCalendarEvents,
  cleanupOrphanCalendarEvents
} from "./calendar/orphanManager.js";

export type { CalendarSyncResult, ScheduledTaskPayload };

export class GoogleCalendarService {
  private calendar: any = null;
  private calendarId: string;
  public serviceAccountEmail: string | null = null;
  private initError: string | null = null;

  constructor() {
    this.calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
    this.init();
  }

  private init() {
    const initRes = initGoogleCalendarClient();
    this.calendar = initRes.calendar;
    this.serviceAccountEmail = initRes.serviceAccountEmail;
    this.initError = initRes.initError;
  }

  async createWorkshopEvent(
    userId: number,
    evalDate: string,
    startTime: string,
    endTime: string,
    scheduledTasks: ScheduledTaskPayload[]
  ): Promise<CalendarSyncResult> {
    return createWorkshopEvent(
      this.calendar,
      this.initError,
      userId,
      evalDate,
      startTime,
      endTime,
      scheduledTasks
    );
  }

  async updateWorkshopEvent(
    userId: number,
    eventId: string,
    evalDate: string,
    startTime: string,
    endTime: string,
    scheduledTasks: ScheduledTaskPayload[]
  ): Promise<CalendarSyncResult> {
    return updateWorkshopEvent(
      this.calendar,
      userId,
      eventId,
      evalDate,
      startTime,
      endTime,
      scheduledTasks
    );
  }

  async deleteWorkshopEvent(
    userId: number,
    eventId: string
  ): Promise<CalendarSyncResult> {
    return deleteWorkshopEvent(this.calendar, userId, eventId);
  }

  async listFutureWorkshopEvents(
    userId: number,
    fromIsoDate: string
  ): Promise<{ success: boolean; events?: Array<{ id: string; summary: string; start: string; description: string }>; error?: string }> {
    return listFutureWorkshopEvents(this.calendar, userId, fromIsoDate);
  }

  async previewOrphanCalendarEvents(
    userId: number,
    fromIsoDate: string
  ): Promise<{
    success: boolean;
    orphanEvents: Array<{ id: string; summary: string; start: string; description: string }>;
    totalEventsChecked: number;
    error?: string;
  }> {
    return previewOrphanCalendarEvents(this.calendar, userId, fromIsoDate);
  }

  async cleanupOrphanCalendarEvents(
    userId: number,
    fromIsoDate: string,
    targetEventIds?: string[]
  ): Promise<{ success: boolean; deletedCount: number; deletedEventIds: string[]; error?: string }> {
    return cleanupOrphanCalendarEvents(this.calendar, userId, fromIsoDate, targetEventIds);
  }
}

export const calendarService = new GoogleCalendarService();
