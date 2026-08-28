import { DailyLog, DayStatus } from "../../types.js";
import { getDb } from "../connection.js";

export class DailyLogRepository {
  private rowToDailyLog(row: any): DailyLog {
    return {
      id: Number(row.id),
      user_id: Number(row.user_id),
      eval_date: String(row.eval_date),
      status: row.status as DayStatus,
      block_reason: row.block_reason != null ? String(row.block_reason) : null,
      window_start: row.window_start != null ? String(row.window_start) : null,
      window_end: row.window_end != null ? String(row.window_end) : null,
      net_work_hours: row.net_work_hours !== null && row.net_work_hours !== undefined ? Number(row.net_work_hours) : null,
      tasks_summary: row.tasks_summary != null ? String(row.tasks_summary) : null,
      scheduled_task_ids: row.scheduled_task_ids != null ? String(row.scheduled_task_ids) : null,
      morning_climate_snapshot: row.morning_climate_snapshot != null ? String(row.morning_climate_snapshot) : null,
      hourly_forecast: row.hourly_forecast != null ? String(row.hourly_forecast) : null,
      telegram_notified: Boolean(row.telegram_notified),
      calendar_created: Boolean(row.calendar_created),
      google_event_id: row.google_event_id != null ? String(row.google_event_id) : null,
      checkin_sent: Boolean(row.checkin_sent),
      checkin_resolved: Boolean(row.checkin_resolved),
      weather_alert_sent: Boolean(row.weather_alert_sent),
      weather_alert_acknowledged: Boolean(row.weather_alert_acknowledged),
      weather_alert_retry_count: Number(row.weather_alert_retry_count || 0),
      weather_alert_last_sent_at: row.weather_alert_last_sent_at != null ? String(row.weather_alert_last_sent_at) : null,
      weather_alert_message: row.weather_alert_message != null ? String(row.weather_alert_message) : null,
      humidity_alert_sent: Boolean(row.humidity_alert_sent),
      intraday_alert_triggered: Boolean(row.intraday_alert_triggered),
      intraday_alert_acknowledged: Boolean(row.intraday_alert_acknowledged),
      intraday_alert_last_sent_at: row.intraday_alert_last_sent_at != null ? String(row.intraday_alert_last_sent_at) : null,
      intraday_alert_burst_count: Number(row.intraday_alert_burst_count || 0),
      last_rain_alert_hour: row.last_rain_alert_hour !== null && row.last_rain_alert_hour !== undefined ? Number(row.last_rain_alert_hour) : null,
      calendar_sync_claimed_at: row.calendar_sync_claimed_at != null ? String(row.calendar_sync_claimed_at) : null,
      updated_at: String(row.updated_at)
    };
  }

  getDailyLogByDate(userId: number, evalDate: string): DailyLog | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM daily_logs WHERE eval_date = ? AND user_id = ?").get(evalDate, userId);
    if (!row) return null;
    return this.rowToDailyLog(row);
  }

  getDailyLogById(userId: number, id: number): DailyLog | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM daily_logs WHERE id = ? AND user_id = ?").get(id, userId);
    if (!row) return null;
    return this.rowToDailyLog(row);
  }

  getDailyLogsForRange(userId: number, startDate: string, endDate: string): DailyLog[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM daily_logs WHERE user_id = ? AND eval_date >= ? AND eval_date <= ? ORDER BY eval_date ASC"
    ).all(userId, startDate, endDate);
    return rows.map(r => this.rowToDailyLog(r));
  }

  getFutureDailyLogsWithEvent(userId: number, fromDate: string): DailyLog[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM daily_logs WHERE user_id = ? AND eval_date >= ? AND google_event_id IS NOT NULL ORDER BY eval_date ASC"
    ).all(userId, fromDate);
    return rows.map(r => this.rowToDailyLog(r));
  }

  getDailyLogByIdGlobal(id: number): DailyLog | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM daily_logs WHERE id = ?").get(id);
    if (!row) return null;
    return this.rowToDailyLog(row);
  }

  saveDailyLog(userId: number, logData: {
    eval_date: string;
    status: DayStatus;
    block_reason?: string | null;
    window_start?: string | null;
    window_end?: string | null;
    net_work_hours?: number | null;
    tasks_summary?: string | null;
    scheduled_task_ids?: string | null;
    morning_climate_snapshot?: string | null;
    hourly_forecast?: string | null;
    telegram_notified?: boolean;
    calendar_created?: boolean;
    google_event_id?: string | null;
    checkin_sent?: boolean;
    checkin_resolved?: boolean;
    weather_alert_sent?: boolean;
    weather_alert_acknowledged?: boolean;
    weather_alert_retry_count?: number;
    weather_alert_last_sent_at?: string | null;
    weather_alert_message?: string | null;
    humidity_alert_sent?: boolean;
    intraday_alert_triggered?: boolean;
    intraday_alert_acknowledged?: boolean;
    intraday_alert_last_sent_at?: string | null;
    intraday_alert_burst_count?: number;
    last_rain_alert_hour?: number | null;
  }): DailyLog {
    const db = getDb();
    const nowIso = new Date().toISOString();

    const pTelegramNotified = logData.telegram_notified !== undefined ? (logData.telegram_notified ? 1 : 0) : null;
    const pCalendarCreated = logData.calendar_created !== undefined ? (logData.calendar_created ? 1 : 0) : null;
    const pCheckinSent = logData.checkin_sent !== undefined ? (logData.checkin_sent ? 1 : 0) : null;
    const pCheckinResolved = logData.checkin_resolved !== undefined ? (logData.checkin_resolved ? 1 : 0) : null;
    const pWeatherAlertSent = logData.weather_alert_sent !== undefined ? (logData.weather_alert_sent ? 1 : 0) : null;
    const pWeatherAlertAck = logData.weather_alert_acknowledged !== undefined ? (logData.weather_alert_acknowledged ? 1 : 0) : null;
    const pWeatherAlertRetry = logData.weather_alert_retry_count !== undefined ? logData.weather_alert_retry_count : null;
    const pWeatherAlertLastSentAt = logData.weather_alert_last_sent_at !== undefined ? logData.weather_alert_last_sent_at : null;
    const pWeatherAlertMessage = logData.weather_alert_message !== undefined ? logData.weather_alert_message : null;
    const pHumidityAlertSent = logData.humidity_alert_sent !== undefined ? (logData.humidity_alert_sent ? 1 : 0) : null;
    const pIntradayAlertTriggered = logData.intraday_alert_triggered !== undefined ? (logData.intraday_alert_triggered ? 1 : 0) : null;
    const pIntradayAlertAck = logData.intraday_alert_acknowledged !== undefined ? (logData.intraday_alert_acknowledged ? 1 : 0) : null;
    const pIntradayAlertLastSentAt = logData.intraday_alert_last_sent_at !== undefined ? logData.intraday_alert_last_sent_at : null;
    const pIntradayBurstCount = logData.intraday_alert_burst_count !== undefined ? logData.intraday_alert_burst_count : null;
    const pLastRainAlertHour = logData.last_rain_alert_hour !== undefined ? logData.last_rain_alert_hour : null;

    db.prepare(`
      INSERT INTO daily_logs (
        user_id, eval_date, status, block_reason, window_start, window_end,
        net_work_hours, tasks_summary, scheduled_task_ids, morning_climate_snapshot, hourly_forecast,
        telegram_notified, calendar_created, google_event_id,
        checkin_sent, checkin_resolved,
        weather_alert_sent, weather_alert_acknowledged, weather_alert_retry_count,
        weather_alert_last_sent_at, weather_alert_message,
        humidity_alert_sent,
        intraday_alert_triggered, intraday_alert_acknowledged, intraday_alert_last_sent_at,
        intraday_alert_burst_count, last_rain_alert_hour,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, eval_date) DO UPDATE SET
        status = excluded.status,
        block_reason = excluded.block_reason,
        window_start = excluded.window_start,
        window_end = excluded.window_end,
        net_work_hours = excluded.net_work_hours,
        tasks_summary = excluded.tasks_summary,
        scheduled_task_ids = excluded.scheduled_task_ids,
        morning_climate_snapshot = excluded.morning_climate_snapshot,
        hourly_forecast = excluded.hourly_forecast,
        telegram_notified = CASE WHEN ? IS NOT NULL THEN excluded.telegram_notified ELSE daily_logs.telegram_notified END,
        calendar_created = CASE WHEN ? IS NOT NULL THEN excluded.calendar_created ELSE daily_logs.calendar_created END,
        google_event_id = COALESCE(excluded.google_event_id, daily_logs.google_event_id),
        checkin_sent = CASE WHEN ? IS NOT NULL THEN excluded.checkin_sent ELSE daily_logs.checkin_sent END,
        checkin_resolved = CASE WHEN ? IS NOT NULL THEN excluded.checkin_resolved ELSE daily_logs.checkin_resolved END,
        weather_alert_sent = CASE WHEN ? IS NOT NULL THEN excluded.weather_alert_sent ELSE daily_logs.weather_alert_sent END,
        weather_alert_acknowledged = CASE WHEN ? IS NOT NULL THEN excluded.weather_alert_acknowledged ELSE daily_logs.weather_alert_acknowledged END,
        weather_alert_retry_count = CASE WHEN ? IS NOT NULL THEN excluded.weather_alert_retry_count ELSE daily_logs.weather_alert_retry_count END,
        weather_alert_last_sent_at = CASE WHEN ? IS NOT NULL THEN excluded.weather_alert_last_sent_at ELSE daily_logs.weather_alert_last_sent_at END,
        weather_alert_message = CASE WHEN ? IS NOT NULL THEN excluded.weather_alert_message ELSE daily_logs.weather_alert_message END,
        humidity_alert_sent = CASE WHEN ? IS NOT NULL THEN excluded.humidity_alert_sent ELSE daily_logs.humidity_alert_sent END,
        intraday_alert_triggered = CASE WHEN ? IS NOT NULL THEN excluded.intraday_alert_triggered ELSE daily_logs.intraday_alert_triggered END,
        intraday_alert_acknowledged = CASE WHEN ? IS NOT NULL THEN excluded.intraday_alert_acknowledged ELSE daily_logs.intraday_alert_acknowledged END,
        intraday_alert_last_sent_at = CASE WHEN ? IS NOT NULL THEN excluded.intraday_alert_last_sent_at ELSE daily_logs.intraday_alert_last_sent_at END,
        intraday_alert_burst_count = CASE WHEN ? IS NOT NULL THEN excluded.intraday_alert_burst_count ELSE daily_logs.intraday_alert_burst_count END,
        last_rain_alert_hour = CASE WHEN ? IS NOT NULL THEN excluded.last_rain_alert_hour ELSE daily_logs.last_rain_alert_hour END,
        updated_at = excluded.updated_at;
    `).run(
      userId,
      logData.eval_date,
      logData.status,
      logData.block_reason || null,
      logData.window_start || null,
      logData.window_end || null,
      logData.net_work_hours ?? null,
      logData.tasks_summary || null,
      logData.scheduled_task_ids || null,
      logData.morning_climate_snapshot || null,
      logData.hourly_forecast || null,
      pTelegramNotified ?? 0,
      pCalendarCreated ?? 0,
      logData.google_event_id || null,
      pCheckinSent ?? 0,
      pCheckinResolved ?? 0,
      pWeatherAlertSent ?? 0,
      pWeatherAlertAck ?? 0,
      pWeatherAlertRetry ?? 0,
      pWeatherAlertLastSentAt || null,
      pWeatherAlertMessage || null,
      pHumidityAlertSent ?? 0,
      pIntradayAlertTriggered ?? 0,
      pIntradayAlertAck ?? 0,
      pIntradayAlertLastSentAt || null,
      pIntradayBurstCount ?? 0,
      pLastRainAlertHour ?? null,
      nowIso,
      pTelegramNotified,
      pCalendarCreated,
      pCheckinSent,
      pCheckinResolved,
      pWeatherAlertSent,
      pWeatherAlertAck,
      pWeatherAlertRetry,
      pWeatherAlertLastSentAt,
      pWeatherAlertMessage,
      pHumidityAlertSent,
      pIntradayAlertTriggered,
      pIntradayAlertAck,
      pIntradayAlertLastSentAt,
      pIntradayBurstCount,
      pLastRainAlertHour
    );

    return this.getDailyLogByDate(userId, logData.eval_date)!;
  }

  updateDailyLog(userId: number, id: number, data: Partial<DailyLog>): DailyLog | null {
    const existing = this.getDailyLogById(userId, id);
    if (!existing) return null;

    const updated = { ...existing, ...data, updated_at: new Date().toISOString() };

    getDb().prepare(
      `UPDATE daily_logs SET
        status = ?,
        block_reason = ?,
        window_start = ?,
        window_end = ?,
        net_work_hours = ?,
        tasks_summary = ?,
        scheduled_task_ids = ?,
        morning_climate_snapshot = ?,
        hourly_forecast = ?,
        telegram_notified = ?,
        calendar_created = ?,
        google_event_id = ?,
        checkin_sent = ?,
        checkin_resolved = ?,
        weather_alert_sent = ?,
        weather_alert_acknowledged = ?,
        weather_alert_retry_count = ?,
        weather_alert_last_sent_at = ?,
        weather_alert_message = ?,
        humidity_alert_sent = ?,
        intraday_alert_triggered = ?,
        intraday_alert_acknowledged = ?,
        intraday_alert_last_sent_at = ?,
        intraday_alert_burst_count = ?,
        last_rain_alert_hour = ?,
        updated_at = ?
      WHERE id = ? AND user_id = ?;`
    ).run(
      updated.status,
      updated.block_reason || null,
      updated.window_start || null,
      updated.window_end || null,
      updated.net_work_hours !== undefined ? updated.net_work_hours : null,
      updated.tasks_summary || null,
      updated.scheduled_task_ids || null,
      updated.morning_climate_snapshot || null,
      updated.hourly_forecast || null,
      updated.telegram_notified ? 1 : 0,
      updated.calendar_created ? 1 : 0,
      updated.google_event_id || null,
      updated.checkin_sent ? 1 : 0,
      updated.checkin_resolved ? 1 : 0,
      updated.weather_alert_sent ? 1 : 0,
      updated.weather_alert_acknowledged ? 1 : 0,
      updated.weather_alert_retry_count || 0,
      updated.weather_alert_last_sent_at || null,
      updated.weather_alert_message || null,
      updated.humidity_alert_sent ? 1 : 0,
      updated.intraday_alert_triggered ? 1 : 0,
      updated.intraday_alert_acknowledged ? 1 : 0,
      updated.intraday_alert_last_sent_at || null,
      updated.intraday_alert_burst_count || 0,
      updated.last_rain_alert_hour !== undefined ? updated.last_rain_alert_hour : null,
      updated.updated_at,
      id,
      userId
    );

    return this.getDailyLogById(userId, id);
  }

  claimCalendarSync(userId: number, dailyLogId: number): boolean {
    const db = getDb();
    const nowIso = new Date().toISOString();
    const staleThresholdIso = new Date(Date.now() - 60000).toISOString();

    const info = db.prepare(`
      UPDATE daily_logs
      SET calendar_sync_claimed_at = ?
      WHERE id = ? AND user_id = ? AND (
        calendar_sync_claimed_at IS NULL
        OR calendar_sync_claimed_at < ?
      )
    `).run(nowIso, dailyLogId, userId, staleThresholdIso);

    return info.changes > 0;
  }

  releaseCalendarSync(userId: number, dailyLogId: number): void {
    getDb().prepare(`
      UPDATE daily_logs
      SET calendar_sync_claimed_at = NULL
      WHERE id = ? AND user_id = ?
    `).run(dailyLogId, userId);
  }

  updateDailyLogGlobal(id: number, data: Partial<DailyLog>): DailyLog | null {
    const existing = this.getDailyLogByIdGlobal(id);
    if (!existing) return null;

    const updated = { ...existing, ...data, updated_at: new Date().toISOString() };

    getDb().prepare(
      `UPDATE daily_logs SET
        status = ?,
        block_reason = ?,
        window_start = ?,
        window_end = ?,
        net_work_hours = ?,
        tasks_summary = ?,
        scheduled_task_ids = ?,
        morning_climate_snapshot = ?,
        hourly_forecast = ?,
        telegram_notified = ?,
        calendar_created = ?,
        google_event_id = ?,
        checkin_sent = ?,
        checkin_resolved = ?,
        weather_alert_sent = ?,
        weather_alert_acknowledged = ?,
        weather_alert_retry_count = ?,
        weather_alert_last_sent_at = ?,
        weather_alert_message = ?,
        humidity_alert_sent = ?,
        intraday_alert_triggered = ?,
        intraday_alert_acknowledged = ?,
        intraday_alert_last_sent_at = ?,
        intraday_alert_burst_count = ?,
        last_rain_alert_hour = ?,
        updated_at = ?
      WHERE id = ?;`
    ).run(
      updated.status,
      updated.block_reason || null,
      updated.window_start || null,
      updated.window_end || null,
      updated.net_work_hours !== undefined ? updated.net_work_hours : null,
      updated.tasks_summary || null,
      updated.scheduled_task_ids || null,
      updated.morning_climate_snapshot || null,
      updated.hourly_forecast || null,
      updated.telegram_notified ? 1 : 0,
      updated.calendar_created ? 1 : 0,
      updated.google_event_id || null,
      updated.checkin_sent ? 1 : 0,
      updated.checkin_resolved ? 1 : 0,
      updated.weather_alert_sent ? 1 : 0,
      updated.weather_alert_acknowledged ? 1 : 0,
      updated.weather_alert_retry_count || 0,
      updated.weather_alert_last_sent_at || null,
      updated.weather_alert_message || null,
      updated.humidity_alert_sent ? 1 : 0,
      updated.intraday_alert_triggered ? 1 : 0,
      updated.intraday_alert_acknowledged ? 1 : 0,
      updated.intraday_alert_last_sent_at || null,
      updated.intraday_alert_burst_count || 0,
      updated.last_rain_alert_hour !== undefined ? updated.last_rain_alert_hour : null,
      updated.updated_at,
      id
    );

    return this.getDailyLogByIdGlobal(id);
  }
}

export const dailyLogRepo = new DailyLogRepository();
