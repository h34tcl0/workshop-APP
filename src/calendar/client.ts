import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { isValidPrivateKey, cleanPrivateKey, extractValidJson } from "./cryptoUtils.js";

export { isValidPrivateKey, cleanPrivateKey, extractValidJson };

export async function executeWithRetry<T>(
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

export interface CalendarClientInitResult {
  calendar: any;
  serviceAccountEmail: string | null;
  initError: string | null;
}

export function initGoogleCalendarClient(): CalendarClientInitResult {
  let auth: any = null;
  let serviceAccountEmail: string | null = null;
  let initError: string | null = null;

  try {
    // 1. Check direct JSON credentials in environment variable
    if (process.env.GOOGLE_CREDENTIALS_JSON && process.env.GOOGLE_CREDENTIALS_JSON.trim()) {
      const rawJson = process.env.GOOGLE_CREDENTIALS_JSON.trim();
      const jsonToParse = extractValidJson(rawJson) || rawJson;
      if (jsonToParse.startsWith("{") || jsonToParse.startsWith("[")) {
        try {
          const credentials = JSON.parse(jsonToParse);
          if (credentials.private_key && typeof credentials.private_key === "string") {
            credentials.private_key = cleanPrivateKey(credentials.private_key);
            if (!isValidPrivateKey(credentials.private_key)) {
              console.warn("[GoogleCalendarService] GOOGLE_CREDENTIALS_JSON contains an invalid private key format.");
            } else {
              if (credentials.client_email) {
                serviceAccountEmail = credentials.client_email;
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

    // 2. Check individual environment variables
    if (!auth && process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      const clientEmail = process.env.GOOGLE_CLIENT_EMAIL.trim();
      const privateKey = cleanPrivateKey(process.env.GOOGLE_PRIVATE_KEY);
      if (!isValidPrivateKey(privateKey)) {
        initError = "GOOGLE_PRIVATE_KEY has an invalid or unsupported PEM private key format.";
        console.warn(`[GoogleCalendarService] ${initError}`);
      } else {
        serviceAccountEmail = clientEmail;
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
      const candidatePaths = [
        process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim(),
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH?.trim(),
        path.join(process.cwd(), "data", "google-credentials.json"),
        path.join(process.cwd(), "google-credentials.json")
      ].filter((p): p is string => Boolean(p));

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
          let fileKeyError: string | null = null;
          const rawData = fs.readFileSync(selectedPath, "utf8").trim();
          const jsonToParse = extractValidJson(rawData) || rawData;
          const credentials = JSON.parse(jsonToParse);
          if (credentials.private_key && typeof credentials.private_key === "string") {
            credentials.private_key = cleanPrivateKey(credentials.private_key);
            if (!isValidPrivateKey(credentials.private_key)) {
              fileKeyError = `File '${selectedPath}' contains an invalid private_key format.`;
              console.warn(`[GoogleCalendarService] ${fileKeyError}`);
            }
          }
          if (!fileKeyError) {
            if (credentials.client_email) {
              serviceAccountEmail = credentials.client_email;
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
            initError = null;
            console.log(`[GoogleCalendarService] Credenciales cargadas desde: ${selectedPath}`);
          } else {
            initError = fileKeyError;
          }
        } catch (fileErr: any) {
          initError = `Error leyendo/parseando el archivo de credenciales en '${selectedPath}': ${fileErr.message || fileErr}`;
          console.warn(`[GoogleCalendarService] ${initError}`);
        }
      } else {
        initError = `No se encontró ningún archivo de credenciales de Google Calendar. Rutas probadas: ${uniquePaths.join(", ")}`;
        console.warn(`[GoogleCalendarService] ${initError}`);
      }
    }

    const calendar = auth ? google.calendar({ version: "v3", auth, timeout: 10000 }) : null;
    return { calendar, serviceAccountEmail, initError };
  } catch (err: any) {
    initError = `Credential parsing error: ${err.message || err}`;
    console.warn("[GoogleCalendarService] Google Calendar Service not initialized due to credential error:", err);
    return { calendar: null, serviceAccountEmail: null, initError };
  }
}
