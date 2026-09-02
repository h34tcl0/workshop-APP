import { User, UserRole, UserStatus } from "../../types.js";
import { getDb } from "../connection.js";

export class UserRepository {
  getAllUsers(): User[] {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM users ORDER BY id ASC").all() as any[];
    return rows.map(row => this.mapRowToUser(row));
  }

  getActiveUsers(): User[] {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM users WHERE status = 'active' ORDER BY id ASC").all() as any[];
    return rows.map(row => this.mapRowToUser(row));
  }

  getUserByEmail(email: string): User | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?)").get(email.trim()) as any;
    if (!row) return null;
    return this.mapRowToUser(row);
  }

  getUserById(id: number): User | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
    if (!row) return null;
    return this.mapRowToUser(row);
  }

  createUser(email: string, passwordHash: string, role: UserRole = 'user'): User {
    const db = getDb();
    db.prepare(
      "INSERT INTO users (email, password_hash, role, status, must_change_password, created_at) VALUES (?, ?, ?, 'active', 0, datetime('now'));"
    ).run(email.toLowerCase().trim(), passwordHash, role);
    return this.getUserByEmail(email)!;
  }

  setUserRole(userId: number, role: UserRole): boolean {
    const db = getDb();
    const res = db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
    return res.changes > 0;
  }

  setUserStatus(userId: number, status: UserStatus, reason?: string | null): boolean {
    const db = getDb();
    const blockedAt = status !== 'active' ? new Date().toISOString() : null;
    const res = db.prepare(
      "UPDATE users SET status = ?, blocked_at = ?, blocked_reason = ? WHERE id = ?"
    ).run(status, blockedAt, reason || null, userId);
    return res.changes > 0;
  }

  updateUserPassword(userId: number, passwordHash: string): boolean {
    const db = getDb();
    const res = db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?;"
    ).run(passwordHash, userId);
    return res.changes > 0;
  }

  private mapRowToUser(row: any): User {
    return {
      id: Number(row.id),
      email: String(row.email),
      password_hash: String(row.password_hash),
      role: (row.role as UserRole) || 'user',
      status: (row.status as UserStatus) || 'active',
      blocked_at: row.blocked_at ? String(row.blocked_at) : null,
      blocked_reason: row.blocked_reason ? String(row.blocked_reason) : null,
      must_change_password: Boolean(row.must_change_password),
      created_at: String(row.created_at)
    };
  }
}

export const userRepo = new UserRepository();
