import { AppSettings } from "../../types.js";
import { getTimezoneByCoords } from "../../dateUtils.js";
import { getDb } from "../connection.js";

export class SettingsRepository {
  getAppSettings(userId: number): AppSettings {
    const db = getDb();
    const defaultCalId = userId === 1 ? (process.env.GOOGLE_CALENDAR_ID || null) : null;
    const defaultCalEnabled = userId === 1 && Boolean(process.env.GOOGLE_CALENDAR_ID) ? 1 : 0;

    // Insertar atómicamente si no existe para evitar la condición de carrera (TOCTOU)
    db.prepare(`
      INSERT INTO app_settings (
        user_id, operational_start_hour, operational_end_hour, max_humidity_percent,
        latitude, longitude, setup_hours, teardown_hours, min_work_hours,
        min_work_hours_unless_final, min_rain_precipitation_mm, checkin_hour,
        morning_eval_lead_hours, exclude_saturdays, exclude_sundays, exclude_holidays,
        require_curing_before_cutoff, telegram_chat_id, google_calendar_id, google_calendar_enabled
      ) VALUES (?, 9, 18, 80.0, -32.99, -71.27, 1.0, 1.0, 3.0, 1.0, 0.1, 19, 1, 1, 1, 1, 1, NULL, ?, ?)
      ON CONFLICT(user_id) DO NOTHING;
    `).run(userId, defaultCalId, defaultCalEnabled);

    const row = db.prepare("SELECT * FROM app_settings WHERE user_id = ?").get(userId) as any;

    const telegramChatId = row.telegram_chat_id ? String(row.telegram_chat_id).trim() : null;

    let googleCalId = row.google_calendar_id ? String(row.google_calendar_id).trim() : null;
    if (!googleCalId && userId === 1 && process.env.GOOGLE_CALENDAR_ID) {
      googleCalId = process.env.GOOGLE_CALENDAR_ID.trim();
    }

    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    const computedTz = getTimezoneByCoords(lat, lon);
    const tz = row.timezone && String(row.timezone).trim() ? String(row.timezone).trim() : computedTz;

    if (!row.timezone || String(row.timezone).trim() !== tz) {
      try {
        db.prepare("UPDATE app_settings SET timezone = ? WHERE user_id = ?").run(tz, userId);
      } catch (_) {}
    }

    const workshopType = (row.workshop_type && ["outdoor", "covered", "indoor"].includes(String(row.workshop_type)))
      ? (String(row.workshop_type) as "outdoor" | "covered" | "indoor")
      : "outdoor";

    return {
      operational_start_hour: Number(row.operational_start_hour),
      operational_end_hour: Number(row.operational_end_hour),
      max_humidity_percent: Number(row.max_humidity_percent),
      latitude: lat,
      longitude: lon,
      setup_hours: Number(row.setup_hours),
      teardown_hours: Number(row.teardown_hours),
      min_work_hours: Number(row.min_work_hours),
      min_work_hours_unless_final: Number(row.min_work_hours_unless_final),
      min_rain_precipitation_mm: Number(row.min_rain_precipitation_mm),
      checkin_hour: Number(row.checkin_hour),
      morning_eval_lead_hours: Number(row.morning_eval_lead_hours),
      exclude_saturdays: Boolean(row.exclude_saturdays),
      exclude_sundays: Boolean(row.exclude_sundays),
      exclude_holidays: Boolean(row.exclude_holidays),
      require_curing_before_cutoff: Boolean(row.require_curing_before_cutoff),
      telegram_chat_id: telegramChatId,
      google_calendar_id: googleCalId,
      google_calendar_enabled: Boolean(row.google_calendar_enabled || (userId === 1 && process.env.GOOGLE_CALENDAR_ID)),
      timezone: tz,
      workshop_type: workshopType,
      max_rain_probability: row.max_rain_probability != null ? Number(row.max_rain_probability) : 40,
      max_wind_gust_carpentry: row.max_wind_gust_carpentry != null ? Number(row.max_wind_gust_carpentry) : 40.0,
      max_wind_gust_paint: row.max_wind_gust_paint != null ? Number(row.max_wind_gust_paint) : 25.0,
      dew_point_margin_c: row.dew_point_margin_c != null ? Number(row.dew_point_margin_c) : 3.0,
      min_temp_pva_c: row.min_temp_pva_c != null ? Number(row.min_temp_pva_c) : 10.0,
      min_temp_epoxy_c: row.min_temp_epoxy_c != null ? Number(row.min_temp_epoxy_c) : 15.0,
      max_humidity_varnish: row.max_humidity_varnish != null ? Number(row.max_humidity_varnish) : 80.0,
      max_humidity_pva: row.max_humidity_pva != null ? Number(row.max_humidity_pva) : 90.0
    };
  }

  updateAppSettings(userId: number, data: Partial<AppSettings>): AppSettings {
    const db = getDb();
    const current = this.getAppSettings(userId);
    const updated = { ...current, ...data };

    const updatedLat = Number(updated.latitude);
    const updatedLon = Number(updated.longitude);
    const computedTz = getTimezoneByCoords(updatedLat, updatedLon);
    const tz = data.timezone && String(data.timezone).trim() ? String(data.timezone).trim() : computedTz;
    updated.timezone = tz;

    const newChatId = updated.telegram_chat_id ? String(updated.telegram_chat_id).trim() : null;
    if (newChatId) {
      // Unlink telegram_chat_id from any other user to guarantee single-user uniqueness
      db.prepare(
        "UPDATE app_settings SET telegram_chat_id = NULL WHERE CAST(telegram_chat_id AS TEXT) = ? AND user_id != ?"
      ).run(newChatId, userId);
    }

    db.prepare(
      `UPDATE app_settings SET
        operational_start_hour = ?,
        operational_end_hour = ?,
        max_humidity_percent = ?,
        latitude = ?,
        longitude = ?,
        setup_hours = ?,
        teardown_hours = ?,
        min_work_hours = ?,
        min_work_hours_unless_final = ?,
        min_rain_precipitation_mm = ?,
        checkin_hour = ?,
        morning_eval_lead_hours = ?,
        exclude_saturdays = ?,
        exclude_sundays = ?,
        exclude_holidays = ?,
        require_curing_before_cutoff = ?,
        telegram_chat_id = ?,
        google_calendar_id = ?,
        google_calendar_enabled = ?,
        timezone = ?,
        workshop_type = ?,
        max_rain_probability = ?,
        max_wind_gust_carpentry = ?,
        max_wind_gust_paint = ?,
        dew_point_margin_c = ?,
        min_temp_pva_c = ?,
        min_temp_epoxy_c = ?,
        max_humidity_varnish = ?,
        max_humidity_pva = ?
      WHERE user_id = ?;`
    ).run(
      updated.operational_start_hour,
      updated.operational_end_hour,
      updated.max_humidity_percent,
      updated.latitude,
      updated.longitude,
      updated.setup_hours,
      updated.teardown_hours,
      updated.min_work_hours,
      updated.min_work_hours_unless_final,
      updated.min_rain_precipitation_mm,
      updated.checkin_hour,
      updated.morning_eval_lead_hours,
      updated.exclude_saturdays ? 1 : 0,
      updated.exclude_sundays ? 1 : 0,
      updated.exclude_holidays ? 1 : 0,
      updated.require_curing_before_cutoff ? 1 : 0,
      newChatId,
      updated.google_calendar_id ? String(updated.google_calendar_id).trim() : null,
      updated.google_calendar_enabled ? 1 : 0,
      updated.timezone,
      updated.workshop_type || "outdoor",
      updated.max_rain_probability != null ? updated.max_rain_probability : 40,
      updated.max_wind_gust_carpentry != null ? updated.max_wind_gust_carpentry : 40.0,
      updated.max_wind_gust_paint != null ? updated.max_wind_gust_paint : 25.0,
      updated.dew_point_margin_c != null ? updated.dew_point_margin_c : 3.0,
      updated.min_temp_pva_c != null ? updated.min_temp_pva_c : 10.0,
      updated.min_temp_epoxy_c != null ? updated.min_temp_epoxy_c : 15.0,
      updated.max_humidity_varnish != null ? updated.max_humidity_varnish : 80.0,
      updated.max_humidity_pva != null ? updated.max_humidity_pva : 90.0,
      userId
    );

    return updated;
  }

  getUserByTelegramChatId(telegramChatId: string | number): { id: number; email: string } | undefined {
    if (telegramChatId === undefined || telegramChatId === null || telegramChatId === "") return undefined;
    const chatStr = String(telegramChatId).trim();
    if (!chatStr) return undefined;

    const db = getDb();
    const rows = db.prepare(`
      SELECT u.id, u.email
      FROM users u
      JOIN app_settings s ON s.user_id = u.id
      WHERE CAST(s.telegram_chat_id AS TEXT) = ?
      ORDER BY u.id DESC
    `).all(chatStr) as any[];

    if (rows.length > 0) {
      const primary = rows[0];
      if (rows.length > 1) {
        const duplicateUserIds = rows.slice(1).map(r => Number(r.id));
        for (const dupId of duplicateUserIds) {
          db.prepare("UPDATE app_settings SET telegram_chat_id = NULL WHERE user_id = ?").run(dupId);
        }
        console.warn(`[DB] Cleaned duplicate telegram_chat_id (${chatStr}) from duplicate user(s): ${duplicateUserIds.join(', ')}. Retained for active user #${primary.id}`);
      }
      return { id: Number(primary.id), email: String(primary.email) };
    }

    return undefined;
  }

  generateTelegramLinkCode(userId: number): { code: string; expiresAt: string } {
    const db = getDb();
    db.prepare("DELETE FROM telegram_link_codes WHERE user_id = ? AND used_at IS NULL").run(userId);

    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 dígitos, 100000-999999
    const nowIso = new Date().toISOString();
    const expiresAtMs = Date.now() + 10 * 60 * 1000; // 10 minutos (milisegundos Unix)

    db.prepare(
      "INSERT INTO telegram_link_codes (user_id, code, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).run(userId, code, expiresAtMs, nowIso);

    return { code, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  consumeTelegramLinkCode(code: string, chatId: string): { success: boolean; userId?: number; email?: string; error?: string } {
    const trimmedCode = String(code).trim();
    if (!trimmedCode) return { success: false, error: "Código inválido o expirado. Generá uno nuevo desde la app." };

    const db = getDb();
    const row = db.prepare(
      "SELECT id, user_id, expires_at FROM telegram_link_codes WHERE code = ? AND used_at IS NULL"
    ).get(trimmedCode) as any;

    if (!row) {
      return { success: false, error: "Código inválido o expirado. Generá uno nuevo desde la app." };
    }

    let expiryMs: number;
    const rawExpires = row.expires_at;

    if (typeof rawExpires === "number" || (typeof rawExpires === "string" && /^\d+$/.test(rawExpires.trim()))) {
      expiryMs = Number(rawExpires);
    } else {
      const isoStr = String(rawExpires || "").trim();
      if (!isoStr.endsWith("Z")) {
        console.warn(`[OTP] Código de vinculación ID #${row.id} con formato ISO no-UTC sin sufijo 'Z': ${isoStr}. Rechazado por fail-fast.`);
        return { success: false, error: "Código inválido o expirado. Generá uno nuevo desde la app." };
      }
      expiryMs = Date.parse(isoStr);
    }

    if (isNaN(expiryMs) || expiryMs < Date.now()) {
      return { success: false, error: "Código inválido o expirado. Generá uno nuevo desde la app." };
    }

    const userId = Number(row.user_id);
    const chatStr = String(chatId).trim();

    db.prepare(
      "UPDATE app_settings SET telegram_chat_id = NULL WHERE CAST(telegram_chat_id AS TEXT) = ? AND user_id != ?"
    ).run(chatStr, userId);

    db.prepare("UPDATE app_settings SET telegram_chat_id = ? WHERE user_id = ?").run(chatStr, userId);

    db.prepare("UPDATE telegram_link_codes SET used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);

    const userRow = db.prepare("SELECT email FROM users WHERE id = ?").get(userId) as any;

    return { success: true, userId, email: userRow ? String(userRow.email) : undefined };
  }

  unlinkTelegram(userId: number): void {
    const db = getDb();
    db.prepare("UPDATE app_settings SET telegram_chat_id = NULL WHERE user_id = ?").run(userId);
  }

  unlinkTelegramByChatId(chatId: string): void {
    const db = getDb();
    db.prepare("UPDATE app_settings SET telegram_chat_id = NULL WHERE CAST(telegram_chat_id AS TEXT) = ?").run(chatId.trim());
  }
}

export const settingsRepo = new SettingsRepository();
