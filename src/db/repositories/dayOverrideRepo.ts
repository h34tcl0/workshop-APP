import { DayOverride } from "../../types.js";
import { getDb } from "../connection.js";
import { LocalDate } from "../../LocalDate.js";

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
      range_origin: row.range_origin ? String(row.range_origin) : undefined,
      previous_state_json: row.previous_state_json ? String(row.previous_state_json) : undefined,
      updated_at: String(row.updated_at)
    };
  }

  saveDayOverride(userId: number, overrideDate: string, data: {
    force_status?: "VIABLE" | "BLOCKED" | null;
    custom_start_hour?: number | null;
    custom_end_hour?: number | null;
    removed_task_ids?: string | number[] | null;
    note?: string | null;
    range_origin?: string | null;
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
      INSERT INTO day_overrides (user_id, override_date, force_status, custom_start_hour, custom_end_hour, removed_task_ids, note, range_origin, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, override_date) DO UPDATE SET
        force_status = excluded.force_status,
        custom_start_hour = excluded.custom_start_hour,
        custom_end_hour = excluded.custom_end_hour,
        removed_task_ids = excluded.removed_task_ids,
        note = excluded.note,
        range_origin = excluded.range_origin,
        updated_at = excluded.updated_at;
    `).run(
      userId,
      overrideDate,
      data.force_status || null,
      data.custom_start_hour !== undefined ? data.custom_start_hour : null,
      data.custom_end_hour !== undefined ? data.custom_end_hour : null,
      removedStr,
      data.note || null,
      data.range_origin || null,
      nowIso
    );

    return this.getDayOverride(userId, overrideDate)!;
  }

  saveDayOverrideRange(userId: number, startDateIso: string, endDateIso: string, note?: string | null): { affectedDates: string[] } {
    const start = LocalDate.fromIso(startDateIso);
    const end = LocalDate.fromIso(endDateIso);
    if (start.toIso() > end.toIso()) {
      throw new Error(`startDate (${startDateIso}) cannot be after endDate (${endDateIso})`);
    }

    const db = getDb();
    const nowIso = new Date().toISOString();
    const affectedDates: string[] = [];

    const tx = db.transaction(() => {
      let curr = start;
      while (curr.toIso() <= end.toIso()) {
        const dateIso = curr.toIso();
        affectedDates.push(dateIso);

        const existing = db.prepare("SELECT * FROM day_overrides WHERE override_date = ? AND user_id = ?").get(dateIso, userId) as any;

        if (existing) {
          // If already set by a vacation range, keep previous_state_json as originally saved
          const prevJson = existing.range_origin === 'vacation_range'
            ? existing.previous_state_json
            : JSON.stringify({
                force_status: existing.force_status,
                custom_start_hour: existing.custom_start_hour,
                custom_end_hour: existing.custom_end_hour,
                removed_task_ids: existing.removed_task_ids,
                note: existing.note
              });

          db.prepare(`
            UPDATE day_overrides SET
              force_status = 'BLOCKED',
              note = ?,
              range_origin = 'vacation_range',
              previous_state_json = ?,
              updated_at = ?
            WHERE override_date = ? AND user_id = ?
          `).run(note || "Vacaciones / Ausencia", prevJson, nowIso, dateIso, userId);
        } else {
          db.prepare(`
            INSERT INTO day_overrides (
              user_id, override_date, force_status, custom_start_hour, custom_end_hour,
              removed_task_ids, note, range_origin, previous_state_json, updated_at
            ) VALUES (?, ?, 'BLOCKED', NULL, NULL, NULL, ?, 'vacation_range', NULL, ?)
          `).run(userId, dateIso, note || "Vacaciones / Ausencia", nowIso);
        }

        curr = curr.addDays(1);
      }
    });

    tx();
    return { affectedDates };
  }

  clearDayOverrideRange(userId: number, startDateIso: string, endDateIso: string): { clearedDates: string[]; restoredDates: string[] } {
    const start = LocalDate.fromIso(startDateIso);
    const end = LocalDate.fromIso(endDateIso);
    if (start.toIso() > end.toIso()) {
      throw new Error(`startDate (${startDateIso}) cannot be after endDate (${endDateIso})`);
    }

    const db = getDb();
    const nowIso = new Date().toISOString();
    const clearedDates: string[] = [];
    const restoredDates: string[] = [];

    const tx = db.transaction(() => {
      let curr = start;
      while (curr.toIso() <= end.toIso()) {
        const dateIso = curr.toIso();
        const existing = db.prepare("SELECT * FROM day_overrides WHERE override_date = ? AND user_id = ?").get(dateIso, userId) as any;

        if (existing && existing.range_origin === 'vacation_range') {
          if (existing.previous_state_json) {
            try {
              const prev = JSON.parse(existing.previous_state_json);
              db.prepare(`
                UPDATE day_overrides SET
                  force_status = ?,
                  custom_start_hour = ?,
                  custom_end_hour = ?,
                  removed_task_ids = ?,
                  note = ?,
                  range_origin = NULL,
                  previous_state_json = NULL,
                  updated_at = ?
                WHERE override_date = ? AND user_id = ?
              `).run(
                prev.force_status ?? null,
                prev.custom_start_hour ?? null,
                prev.custom_end_hour ?? null,
                prev.removed_task_ids ?? null,
                prev.note ?? null,
                nowIso,
                dateIso,
                userId
              );
              restoredDates.push(dateIso);
            } catch {
              db.prepare("DELETE FROM day_overrides WHERE override_date = ? AND user_id = ?").run(dateIso, userId);
              clearedDates.push(dateIso);
            }
          } else {
            db.prepare("DELETE FROM day_overrides WHERE override_date = ? AND user_id = ?").run(dateIso, userId);
            clearedDates.push(dateIso);
          }
        }
        curr = curr.addDays(1);
      }
    });

    tx();
    return { clearedDates, restoredDates };
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
