import { User } from "../../types.js";
import { getDb } from "../connection.js";

export class UserRepository {
  getAllUsers(): User[] {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM users ORDER BY id ASC").all() as any[];
    return rows.map(row => ({
      id: Number(row.id),
      email: String(row.email),
      password_hash: String(row.password_hash),
      must_change_password: Boolean(row.must_change_password),
      created_at: String(row.created_at)
    }));
  }

  getUserByEmail(email: string): User | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?)").get(email.trim()) as any;
    if (!row) return null;
    return {
      id: Number(row.id),
      email: String(row.email),
      password_hash: String(row.password_hash),
      must_change_password: Boolean(row.must_change_password),
      created_at: String(row.created_at)
    };
  }

  getUserById(id: number): User | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
    if (!row) return null;
    return {
      id: Number(row.id),
      email: String(row.email),
      password_hash: String(row.password_hash),
      must_change_password: Boolean(row.must_change_password),
      created_at: String(row.created_at)
    };
  }

  createUser(email: string, passwordHash: string): User {
    const db = getDb();
    db.prepare(
      "INSERT INTO users (email, password_hash, must_change_password, created_at) VALUES (?, ?, 0, datetime('now'));"
    ).run(email.toLowerCase().trim(), passwordHash);
    return this.getUserByEmail(email)!;
  }

  updateUserPassword(userId: number, passwordHash: string): boolean {
    const db = getDb();
    const res = db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?;"
    ).run(passwordHash, userId);
    return res.changes > 0;
  }
}

export const userRepo = new UserRepository();
