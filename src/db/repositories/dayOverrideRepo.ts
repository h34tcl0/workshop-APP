import { DayOverride } from "../../types.js";
import { getDb } from "../connection.js";

export class DayOverrideRepository {
  getDayOverride(userId: number, overrideDate: string): DayOverride | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM day_overrides WHERE override_date = ? AND user_id = ?").get(overrideDate, userId) as any;
    if (!row) return null;

    return {
      id: Number(row.id),
      override_date: String(row.override_date),
      force_status: row.force_status as "VIABLE" | "BLOCKED" | undefined,
      custom_start_hour: row.custom_start_hour !== null && row.custom_start_hour !== undefined ? Number(row.custom_start_hour) : undefined,
      custom_end_hour: row.custom_end_hour !== null && row.custom_end_hour !== undefined ? Number(row.custom_end_hour) : undefined,
      removed_task_ids: row.removed_task_ids ? String(row.removed_task_ids) : undefined,
      note: row.note ? String(row.note) : undefined,
      updated_at: String(row.updated_at)
    };
  }

  saveDayOverride(userId: number, overrideDate: string, data: {
    force_status?: "VIABLE" | "BLOCKED" | null;
    custom_start_hour?: number | null;
    custom_end_hour?: number | null;
    removed_task_ids?: string | number[] | null;
    note?: string | null;
  }): DayOverride {
    const db = getDb();
    const nowIso = new Date().toISOString();
    let removedStr: string | null = null;
    if (data.removed_task_ids) {
      if (Array.isArray(data.removed_task_ids)) {
        removedStr = JSON.stringify(data.removed_task_ids);
      } else {
        removedStr = String(data.removed_task_ids);
      }
    }

    db.prepare(`
      INSERT INTO day_overrides (user_id, override_date, force_status, custom_start_hour, custom_end_hour, removed_task_ids, note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, override_date) DO UPDATE SET
        force_status = excluded.force_status,
        custom_start_hour = excluded.custom_start_hour,
        custom_end_hour = excluded.custom_end_hour,
        removed_task_ids = excluded.removed_task_ids,
        note = excluded.note,
        updated_at = excluded.updated_at;
    `).run(
      userId,
      overrideDate,
      data.force_status || null,
      data.custom_start_hour !== undefined ? data.custom_start_hour : null,
      data.custom_end_hour !== undefined ? data.custom_end_hour : null,
      removedStr,
      data.note || null,
      nowIso
    );

    return this.getDayOverride(userId, overrideDate)!;
  }

  clearDayOverride(userId: number, overrideDate: string): boolean {
    const res = getDb().prepare("DELETE FROM day_overrides WHERE override_date = ? AND user_id = ?").run(overrideDate, userId);
    return res.changes > 0;
  }

  getForcedTasksForDate(userId: number, dateIso: string): Array<{ id: number; task_id: number; forced_start_hour: number }> {
    const rows = getDb().prepare(
      "SELECT id, task_id, forced_start_hour FROM forced_tasks WHERE forced_date = ? AND user_id = ? ORDER BY id ASC"
    ).all(dateIso, userId) as any[];

    return rows.map(r => ({
      id: Number(r.id),
      task_id: Number(r.task_id),
      forced_start_hour: Number(r.forced_start_hour)
    }));
  }

  addForcedTask(userId: number, dateIso: string, taskId: number, forcedStartHour: number): void {
    getDb().prepare(
      "INSERT INTO forced_tasks (user_id, forced_date, task_id, forced_start_hour) VALUES (?, ?, ?, ?);"
    ).run(userId, dateIso, taskId, forcedStartHour);
  }

  deleteForcedTask(userId: number, id: number): boolean {
    const res = getDb().prepare("DELETE FROM forced_tasks WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
  }
}

export const dayOverrideRepo = new DayOverrideRepository();
