import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { store } from "./db.js";

export class GoogleCalendarService {
  private calendar: any = null;
  private calendarId: string;

  constructor() {
    this.calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
    this.init();
  }

  private init() {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.cwd(), "google-credentials.json");
    if (!fs.existsSync(credPath)) {
      return;
    }

    try {
      const rawData = fs.readFileSync(credPath, "utf8");
      const credentials = JSON.parse(rawData);

      let auth: any;
      if (credentials.type === "service_account") {
        const jwt = google.auth.fromJSON(credentials) as any;
        jwt.scopes = ["https://www.googleapis.com/auth/calendar"];
        auth = jwt;
      } else if (credentials.type === "authorized_user" || credentials.refresh_token) {
        auth = google.auth.fromJSON(credentials);
      } else {
        auth = new google.auth.GoogleAuth({
          keyFile: credPath,
          scopes: ["https://www.googleapis.com/auth/calendar"]
        });
      }

      this.calendar = google.calendar({ version: "v3", auth });
    } catch (err) {
      console.warn("[MockCalendarService] Google Calendar Service not initialized due to credential parsing error:", err);
      this.calendar = null;
    }
  }

  async createWorkshopEvent(
    evalDate: string,
    startTime: string,
    endTime: string,
    scheduledTasks: Array<{ title: string; estimated_hours: number }>
  ): Promise<boolean> {
    if (!this.calendar) {
      console.log(`[MockCalendarService] Google Calendar Service not initialized. Event simulated for ${evalDate} (${startTime} - ${endTime}).`);
      return false;
    }

    try {
      const settings = store.getAppSettings() as any;
      const timezone = settings?.timezone || process.env.TIMEZONE || "America/Santiago";

      const taskLines = scheduledTasks && scheduledTasks.length > 0
        ? scheduledTasks.map(t => `- ${t.title} (${t.estimated_hours}h)`).join("\n")
        : "- Sin tareas especificadas";

      const summary = `🔨 Taller Carpintería (${startTime} - ${endTime})`;
      const description = `🔨 WORKSHOP OS - Bloque Macro de Trabajo\n\nTareas Agendadas:\n${taskLines}`;

      const startFormatted = startTime.length === 5 ? `${startTime}:00` : startTime;
      const endFormatted = endTime.length === 5 ? `${endTime}:00` : endTime;

      const event = {
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

      await this.calendar.events.insert({
        calendarId: this.calendarId,
        requestBody: event
      });

      console.log(`[GoogleCalendarService] Event created successfully in Google Calendar for ${evalDate}.`);
      return true;
    } catch (err) {
      console.error(`[GoogleCalendarService] Error creating event in Google Calendar for ${evalDate}:`, err);
      return false;
    }
  }
}

export const calendarService = new GoogleCalendarService();
