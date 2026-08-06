import { google } from "googleapis";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { store } from "./db.js";

export interface CalendarSyncResult {
  success: boolean;
  eventId?: string | null;
  notFound?: boolean;
  error?: string;
}

async function executeWithRetry<T>(
  operationName: string,
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  initialDelayMs: number = 1000
): Promise<T> {
  let attempt = 1;
  let delay = initialDelayMs;

  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.code || err?.response?.status || err?.status || (typeof err?.code === 'number' ? err.code : undefined);
      const is429 = status === 429 || (err?.message && String(err.message).includes("429")) || (err?.message && String(err.message).toLowerCase().includes("rate limit"));
      const is5xx = typeof status === 'number' && status >= 500 && status < 600;

      const shouldRetry = (is429 || is5xx) && attempt < maxAttempts;

      if (!shouldRetry) {
        throw err;
      }

      console.warn(`[GoogleCalendarService] Retry ${attempt}/${maxAttempts - 1} for '${operationName}' due to ${is429 ? '429 Rate Limit' : `HTTP ${status} Transient Error`}. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
      delay *= 2;
    }
  }
}

export class GoogleCalendarService {
  private calendar: any = null;
  private calendarId: string;
  public serviceAccountEmail: string | null = null;
  private initError: string | null = null;

  constructor() {
    this.calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
    this.init();
  }

  private isValidPrivateKey(key: string): boolean {
    if (!key || !key.trim()) return false;
    try {
      crypto.createPrivateKey(key);
      return true;
    } catch (_) {
      return false;
    }
  }

  private cleanPrivateKey(key: string): string {
    if (!key) return "";
    let k = key.trim();
    if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
      k = k.slice(1, -1).trim();
    }
    k = k.replace(/\\n/g, "\n").replace(/\r/g, "");

    if (k.includes("-----BEGIN PRIVATE KEY-----")) {
      const lines = k.split("\n").map(l => l.trim()).filter(Boolean);
      const bodyLines = lines.filter(l => !l.includes("BEGIN") && !l.includes("END"));
      return `-----BEGIN PRIVATE KEY-----\n${bodyLines.join("\n")}\n-----END PRIVATE KEY-----\n`;
    }
    if (k.includes("-----BEGIN RSA PRIVATE KEY-----")) {
      const lines = k.split("\n").map(l => l.trim()).filter(Boolean);
      const bodyLines = lines.filter(l => !l.includes("BEGIN") && !l.includes("END"));
      return `-----BEGIN RSA PRIVATE KEY-----\n${bodyLines.join("\n")}\n-----END RSA PRIVATE KEY-----\n`;
    }
    if (!k.includes("-----BEGIN")) {
      return `-----BEGIN PRIVATE KEY-----\n${k}\n-----END PRIVATE KEY-----\n`;
    }
    return k;
  }

  private init() {
    try {
      let auth: any = null;

      // 1. Check direct JSON credentials in environment variable (GOOGLE_CREDENTIALS_JSON)
      if (process.env.GOOGLE_CREDENTIALS_JSON && process.env.GOOGLE_CREDENTIALS_JSON.trim()) {
        const rawJson = process.env.GOOGLE_CREDENTIALS_JSON.trim();
        if (rawJson.startsWith("{") || rawJson.startsWith("[")) {
          try {
            const credentials = JSON.parse(rawJson);
            if (credentials.private_key && typeof credentials.private_key === "string") {
              credentials.private_key = this.cleanPrivateKey(credentials.private_key);
              if (!this.isValidPrivateKey(credentials.private_key)) {
                console.warn("[GoogleCalendarService] GOOGLE_CREDENTIALS_JSON contains an invalid private key format.");
              } else {
                if (credentials.client_email) {
                  this.serviceAccountEmail = credentials.client_email;
                }
                if (credentials.type === "service_account") {
                  const jwt = google.auth.fromJSON(credentials) as any;
                  jwt.scopes = ["https://www.googleapis.com/auth/calendar"];
                  auth = jwt;
                } else {
                  auth = google.auth.fromJSON(credentials);
                }
                console.log("[GoogleCalendarService] Initialized successfully using GOOGLE_CREDENTIALS_JSON environment variable.");
              }
            }
          } catch (jsonErr: any) {
            console.warn("[GoogleCalendarService] GOOGLE_CREDENTIALS_JSON is not valid JSON:", jsonErr.message);
          }
        } else {
          console.warn("[GoogleCalendarService] GOOGLE_CREDENTIALS_JSON environment variable does not contain valid JSON (skipping).");
        }
      }

      // 2. Check individual environment variables (GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY)
      if (!auth && process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        const clientEmail = process.env.GOOGLE_CLIENT_EMAIL.trim();
        const privateKey = this.cleanPrivateKey(process.env.GOOGLE_PRIVATE_KEY);
        if (!this.isValidPrivateKey(privateKey)) {
          this.initError = "GOOGLE_PRIVATE_KEY has an invalid or unsupported PEM private key format.";
          console.warn(`[GoogleCalendarService] ${this.initError}`);
        } else {
          this.serviceAccountEmail = clientEmail;
          auth = new google.auth.JWT({
            email: clientEmail,
            key: privateKey,
            scopes: ["https://www.googleapis.com/auth/calendar"]
          });
          console.log(`[GoogleCalendarService] Initialized successfully using GOOGLE_CLIENT_EMAIL (${clientEmail}) & GOOGLE_PRIVATE_KEY.`);
        }
      }

      // 3. Check credentials file path fallback list
      if (!auth) {
        const candidatePaths: string[] = [];

        if (process.env.GOOGLE_APPLICATION_CREDENTIALS && process.env.GOOGLE_APPLICATION_CREDENTIALS.trim()) {
          candidatePaths.push(process.env.GOOGLE_APPLICATION_CREDENTIALS.trim());
        }
        if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH && process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH.trim()) {
          candidatePaths.push(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH.trim());
        }
        candidatePaths.push(path.join(process.cwd(), "data", "google-credentials.json"));
        candidatePaths.push(path.join(process.cwd(), "google-credentials.json"));

        const uniquePaths = Array.from(new Set(candidatePaths));
        let selectedPath: string | null = null;

        for (const p of uniquePaths) {
          if (fs.existsSync(p)) {
            selectedPath = p;
            break;
          }
        }

        if (selectedPath) {
          try {
            const rawData = fs.readFileSync(selectedPath, "utf8");
            const credentials = JSON.parse(rawData);
            if (credentials.private_key && typeof credentials.private_key === "string") {
              credentials.private_key = this.cleanPrivateKey(credentials.private_key);
              if (!this.isValidPrivateKey(credentials.private_key)) {
                this.initError = `File '${selectedPath}' contains an invalid private_key format.`;
                console.warn(`[GoogleCalendarService] ${this.initError}`);
              }
            }
            if (!this.initError) {
              if (credentials.client_email) {
                this.serviceAccountEmail = credentials.client_email;
              }

              if (credentials.type === "service_account") {
                const jwt = google.auth.fromJSON(credentials) as any;
                jwt.scopes = ["https://www.googleapis.com/auth/calendar"];
                auth = jwt;
              } else if (credentials.type === "authorized_user" || credentials.refresh_token) {
                auth = google.auth.fromJSON(credentials);
              } else {
                auth = new google.auth.GoogleAuth({
                  keyFile: selectedPath,
                  scopes: ["https://www.googleapis.com/auth/calendar"]
                });
              }
              console.log(`[GoogleCalendarService] Credenciales cargadas desde: ${selectedPath}`);
            }
          } catch (fileErr: any) {
            this.initError = `Error leyendo/parseando el archivo de credenciales en '${selectedPath}': ${fileErr.message || fileErr}`;
            console.warn(`[GoogleCalendarService] ${this.initError}`);
          }
        } else {
          this.initError = `No se encontró ningún archivo de credenciales de Google Calendar. Rutas probadas: ${uniquePaths.join(", ")}`;
          console.warn(`[GoogleCalendarService] ${this.initError}`);
        }
      }

      if (auth) {
        this.calendar = google.calendar({ version: "v3", auth });
      } else {
        this.calendar = null;
      }
    } catch (err: any) {
      this.initError = `Credential parsing error: ${err.message || err}`;
      console.warn("[GoogleCalendarService] Google Calendar Service not initialized due to credential error:", err);
      this.calendar = null;
    }
  }

  private buildEventPayload(
    evalDate: string,
    startTime: string,
    endTime: string,
    scheduledTasks: Array<{ title: string; estimated_hours: number }>,
    timezone: string
  ) {
    const taskLines = scheduledTasks && scheduledTasks.length > 0
      ? scheduledTasks.map(t => `- ${t.title} (${t.estimated_hours}h)`).join("\n")
      : "- Sin tareas especificadas";

    const summary = `🔨 Taller Carpintería (${startTime} - ${endTime})`;
    const description = `🔨 WORKSHOP OS - Bloque Macro de Trabajo\n\nTareas Agendadas:\n${taskLines}`;

    const startFormatted = startTime.length === 5 ? `${startTime}:00` : startTime;
    const endFormatted = endTime.length === 5 ? `${endTime}:00` : endTime;

    return {
      summary,
      description,
      start: {
        dateTime: `${evalDate}T${startFormatted}`,
        timeZone: timezone
      },
      end: {
        dateTime: `${evalDate}T${endFormatted}`,
        timeZone: timezone
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 60 },
          { method: "popup", minutes: 30 }
        ]
      }
    };
  }

  async createWorkshopEvent(
    userId: number,
    evalDate: string,
    startTime: string,
    endTime: string,
    scheduledTasks: Array<{ title: string; estimated_hours: number }>
  ): Promise<CalendarSyncResult> {
    const settings = store.getAppSettings(userId);

    if (!settings.google_calendar_enabled || !settings.google_calendar_id || !settings.google_calendar_id.trim()) {
      return { success: false, error: "Google Calendar not connected or disabled" };
    }

    if (!this.calendar) {
      const reason = this.initError || "Missing environment variables or credentials file.";
      return { success: false, error: reason };
    }

    const targetCalendarId = settings.google_calendar_id.trim();

    try {
      const timezone = (settings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
      const eventPayload = this.buildEventPayload(evalDate, startTime, endTime, scheduledTasks, timezone);

      const res = (await executeWithRetry(
        `createWorkshopEvent for User #${userId}`,
        () => this.calendar.events.insert({
          calendarId: targetCalendarId,
          requestBody: eventPayload
        })
      )) as any;

      const eventId = res.data?.id || null;
      console.log(`[GoogleCalendarService] Event created (${eventId}) in Google Calendar (${targetCalendarId}) for User #${userId} on ${evalDate}.`);
      return { success: true, eventId };
    } catch (err: any) {
      const errorMsg = err?.response?.data?.error_description || err?.response?.data?.error?.message || err?.message || String(err);
      console.warn(`[GoogleCalendarService] Could not create event for User #${userId} (${targetCalendarId}) on ${evalDate}: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  async updateWorkshopEvent(
    userId: number,
    eventId: string,
    evalDate: string,
    startTime: string,
    endTime: string,
    scheduledTasks: Array<{ title: string; estimated_hours: number }>
  ): Promise<CalendarSyncResult> {
    const settings = store.getAppSettings(userId);

    if (!settings.google_calendar_enabled || !settings.google_calendar_id || !settings.google_calendar_id.trim()) {
      return { success: false, error: "Google Calendar not connected or disabled" };
    }

    if (!this.calendar) {
      return { success: false, error: "Google Calendar credentials not initialized" };
    }

    const targetCalendarId = settings.google_calendar_id.trim();

    try {
      const timezone = (settings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
      const eventPayload = this.buildEventPayload(evalDate, startTime, endTime, scheduledTasks, timezone);

      await executeWithRetry(
        `updateWorkshopEvent for User #${userId} (${eventId})`,
        () => this.calendar.events.patch({
          calendarId: targetCalendarId,
          eventId: eventId,
          requestBody: eventPayload
        })
      );

      console.log(`[GoogleCalendarService] Event updated (${eventId}) in Google Calendar (${targetCalendarId}) for User #${userId} on ${evalDate}.`);
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

  async deleteWorkshopEvent(
    userId: number,
    eventId: string
  ): Promise<CalendarSyncResult> {
    const settings = store.getAppSettings(userId);

    if (!settings.google_calendar_enabled || !settings.google_calendar_id || !settings.google_calendar_id.trim()) {
      return { success: false, error: "Google Calendar not connected or disabled" };
    }

    if (!this.calendar) {
      return { success: false, error: "Google Calendar credentials not initialized" };
    }

    const targetCalendarId = settings.google_calendar_id.trim();

    try {
      await executeWithRetry(
        `deleteWorkshopEvent for User #${userId} (${eventId})`,
        () => this.calendar.events.delete({
          calendarId: targetCalendarId,
          eventId: eventId
        })
      );

      console.log(`[GoogleCalendarService] Event deleted (${eventId}) from Google Calendar (${targetCalendarId}) for User #${userId}.`);
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
}

export const calendarService = new GoogleCalendarService();
