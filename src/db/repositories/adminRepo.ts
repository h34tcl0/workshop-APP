import { AccountLimits, SystemSettings, AdminAuditLog } from "../../types.js";
import { getDb } from "../connection.js";

export class AdminRepository {
  getSystemSettings(): SystemSettings {
    const db = getDb();
    const row = db.prepare("SELECT * FROM system_settings WHERE id = 1").get() as any;
    if (!row) {
      return {
        id: 1,
        registration_open: 1,
        default_max_projects: 10,
        default_max_tasks: 200,
        default_max_storage_mb: 100,
        default_max_model_size_mb: 25,
        absolute_max_model_size_mb: 100,
        maintenance_mode: 0,
        updated_at: new Date().toISOString()
      };
    }
    return {
      id: Number(row.id),
      registration_open: Number(row.registration_open),
      default_max_projects: Number(row.default_max_projects),
      default_max_tasks: Number(row.default_max_tasks),
      default_max_storage_mb: Number(row.default_max_storage_mb),
      default_max_model_size_mb: Number(row.default_max_model_size_mb),
      absolute_max_model_size_mb: Number(row.absolute_max_model_size_mb),
      maintenance_mode: Number(row.maintenance_mode),
      updated_at: String(row.updated_at)
    };
  }

  updateSystemSettings(settings: Partial<SystemSettings>): boolean {
    const db = getDb();
    const current = this.getSystemSettings();
    const updated = { ...current, ...settings, updated_at: new Date().toISOString() };
    const res = db.prepare(`
      UPDATE system_settings SET
        registration_open = ?,
        default_max_projects = ?,
        default_max_tasks = ?,
        default_max_storage_mb = ?,
        default_max_model_size_mb = ?,
        absolute_max_model_size_mb = ?,
        maintenance_mode = ?,
        updated_at = ?
      WHERE id = 1
    `).run(
      updated.registration_open,
      updated.default_max_projects,
      updated.default_max_tasks,
      updated.default_max_storage_mb,
      updated.default_max_model_size_mb,
      updated.absolute_max_model_size_mb,
      updated.maintenance_mode,
      updated.updated_at
    );
    return res.changes > 0;
  }

  getAccountLimits(userId: number): AccountLimits | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM account_limits WHERE user_id = ?").get(userId) as any;
    if (!row) return null;
    return {
      id: Number(row.id),
      user_id: Number(row.user_id),
      max_projects: Number(row.max_projects),
      max_tasks: Number(row.max_tasks),
      max_storage_mb: Number(row.max_storage_mb),
      max_model_size_mb: Number(row.max_model_size_mb),
      updated_by: row.updated_by ? Number(row.updated_by) : null,
      updated_at: String(row.updated_at)
    };
  }

  setAccountLimits(limits: Omit<AccountLimits, 'id'>): boolean {
    const db = getDb();
    const res = db.prepare(`
      INSERT INTO account_limits (user_id, max_projects, max_tasks, max_storage_mb, max_model_size_mb, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        max_projects = excluded.max_projects,
        max_tasks = excluded.max_tasks,
        max_storage_mb = excluded.max_storage_mb,
        max_model_size_mb = excluded.max_model_size_mb,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      limits.user_id,
      limits.max_projects,
      limits.max_tasks,
      limits.max_storage_mb,
      limits.max_model_size_mb,
      limits.updated_by || null,
      limits.updated_at || new Date().toISOString()
    );
    return res.changes > 0;
  }

  logAdminAction(log: Omit<AdminAuditLog, 'id'>): number {
    const db = getDb();
    const res = db.prepare(`
      INSERT INTO admin_audit_log (admin_user_id, action, target_user_id, details, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      log.admin_user_id,
      log.action,
      log.target_user_id || null,
      log.details || null,
      log.ip_address || null,
      log.created_at || new Date().toISOString()
    );
    return Number(res.lastInsertRowid);
  }

  getAuditLogs(limit: number = 50, offset: number = 0): AdminAuditLog[] {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM admin_audit_log ORDER BY id DESC LIMIT ? OFFSET ?").all(limit, offset) as any[];
    return rows.map(r => ({
      id: Number(r.id),
      admin_user_id: Number(r.admin_user_id),
      action: String(r.action),
      target_user_id: r.target_user_id ? Number(r.target_user_id) : null,
      details: r.details ? String(r.details) : null,
      ip_address: r.ip_address ? String(r.ip_address) : null,
      created_at: String(r.created_at)
    }));
  }
}

export const adminRepo = new AdminRepository();
