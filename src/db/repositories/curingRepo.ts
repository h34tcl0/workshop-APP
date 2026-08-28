import { CuringSession } from "../../types.js";
import { getDb } from "../connection.js";

export class CuringRepository {
  private rowToCuringSession(row: any): CuringSession {
    return {
      id: Number(row.id),
      user_id: Number(row.user_id),
      task_id: Number(row.task_id),
      project_name: row.project_name ? String(row.project_name) : null,
      piece_label: String(row.piece_label),
      started_at: String(row.started_at),
      duration_hours: Number(row.duration_hours),
      finishes_at: String(row.finishes_at),
      status: row.status as 'curing' | 'completed' | 'interrupted',
      created_at: row.created_at ? String(row.created_at) : undefined
    };
  }

  getActiveCuringSessions(userId: number): CuringSession[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM curing_sessions WHERE user_id = ? AND status = 'curing' ORDER BY finishes_at ASC"
    ).all(userId);
    return rows.map(r => this.rowToCuringSession(r));
  }

  getCuringSessionsByTask(userId: number, taskId: number): CuringSession[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM curing_sessions WHERE user_id = ? AND task_id = ? ORDER BY id DESC"
    ).all(userId, taskId);
    return rows.map(r => this.rowToCuringSession(r));
  }

  startCuringSession(userId: number, data: {
    task_id: number;
    project_name?: string | null;
    piece_label: string;
    duration_hours: number;
    started_at?: string;
  }): CuringSession {
    const db = getDb();
    const started = data.started_at ? new Date(data.started_at) : new Date();
    const durationHours = Number(data.duration_hours) > 0 ? Number(data.duration_hours) : 1.0;
    const finishes = new Date(started.getTime() + durationHours * 3600 * 1000);

    const startedIso = started.toISOString();
    const finishesIso = finishes.toISOString();

    const info = db.prepare(`
      INSERT INTO curing_sessions (user_id, task_id, project_name, piece_label, started_at, duration_hours, finishes_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'curing', datetime('now'))
    `).run(
      userId,
      data.task_id,
      data.project_name || null,
      data.piece_label.trim(),
      startedIso,
      durationHours,
      finishesIso
    );

    const createdId = Number(info.lastInsertRowid);
    const row = db.prepare("SELECT * FROM curing_sessions WHERE id = ?").get(createdId);
    return this.rowToCuringSession(row);
  }

  completeCuringSession(userId: number, id: number): CuringSession | null {
    const db = getDb();
    db.prepare("UPDATE curing_sessions SET status = 'completed' WHERE id = ? AND user_id = ?").run(id, userId);
    const row = db.prepare("SELECT * FROM curing_sessions WHERE id = ? AND user_id = ?").get(id, userId);
    if (!row) return null;
    return this.rowToCuringSession(row);
  }

  interruptCuringSession(userId: number, id: number): CuringSession | null {
    const db = getDb();
    db.prepare("UPDATE curing_sessions SET status = 'interrupted' WHERE id = ? AND user_id = ?").run(id, userId);
    const row = db.prepare("SELECT * FROM curing_sessions WHERE id = ? AND user_id = ?").get(id, userId);
    if (!row) return null;
    return this.rowToCuringSession(row);
  }
}

export const curingRepo = new CuringRepository();
