import { Material, MaterialStatus, Tool, ToolStatus } from "../../types.js";
import { getDb } from "../connection.js";
import { projectRepo } from "./projectRepo.js";

export class InventoryRepository {
  // --- MATERIALS MANAGEMENT ---
  private rowToMaterial(row: any): Material {
    return {
      id: Number(row.id),
      user_id: Number(row.user_id),
      project_id: Number(row.project_id),
      name: String(row.name),
      quantity: Number(row.quantity),
      unit: String(row.unit || "unidades"),
      category: String(row.category || "General"),
      status: String(row.status || MaterialStatus.TO_BUY),
      created_at: String(row.created_at || ""),
      updated_at: String(row.updated_at || ""),
      project_name: row.project_name ? String(row.project_name) : undefined
    };
  }

  getMaterials(userId: number, projectId?: number): Material[] {
    const db = getDb();
    let sql = `
      SELECT m.*, COALESCE(p.name, 'General / Taller') as project_name
      FROM materials m
      LEFT JOIN projects p ON p.id = m.project_id
      WHERE m.user_id = ?
    `;
    const params: any[] = [userId];
    if (projectId) {
      sql += ` AND m.project_id = ?`;
      params.push(projectId);
    }
    sql += ` ORDER BY m.status DESC, m.category ASC, m.id ASC`;

    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToMaterial(r));
  }

  getMaterial(userId: number, id: number): Material | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT m.*, COALESCE(p.name, 'General / Taller') as project_name
      FROM materials m
      LEFT JOIN projects p ON p.id = m.project_id
      WHERE m.id = ? AND m.user_id = ?
    `).get(id, userId) as any;
    if (!row) return null;
    return this.rowToMaterial(row);
  }

  addMaterial(userId: number, data: {
    project_id?: number;
    name: string;
    quantity?: number;
    unit?: string;
    category?: string;
    status?: string;
  }): Material {
    const db = getDb();
    const pId = data.project_id || projectRepo.getActiveProject(userId).id;
    const nowIso = new Date().toISOString();
    let statusVal = data.status || MaterialStatus.TO_BUY;
    if (statusVal !== MaterialStatus.IN_STOCK && statusVal !== MaterialStatus.OUT_OF_STOCK) {
      statusVal = MaterialStatus.TO_BUY;
    }

    const info = db.prepare(`
      INSERT INTO materials (user_id, project_id, name, quantity, unit, category, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      pId,
      data.name.trim(),
      data.quantity !== undefined ? Number(data.quantity) : 1.0,
      (data.unit || "unidades").trim(),
      (data.category || "General").trim(),
      statusVal,
      nowIso,
      nowIso
    );

    return this.getMaterial(userId, Number(info.lastInsertRowid))!;
  }

  updateMaterial(userId: number, id: number, data: Partial<Material>): Material | null {
    const existing = this.getMaterial(userId, id);
    if (!existing) return null;

    const updated = { ...existing, ...data };
    const nowIso = new Date().toISOString();

    getDb().prepare(`
      UPDATE materials SET
        project_id = ?,
        name = ?,
        quantity = ?,
        unit = ?,
        category = ?,
        status = ?,
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      updated.project_id,
      updated.name.trim(),
      updated.quantity,
      updated.unit.trim(),
      updated.category.trim(),
      updated.status,
      nowIso,
      id,
      userId
    );

    return this.getMaterial(userId, id);
  }

  toggleMaterialStatus(userId: number, id: number): Material | null {
    const mat = this.getMaterial(userId, id);
    if (!mat) return null;
    let newStatus: string;
    if (mat.status === MaterialStatus.TO_BUY) {
      newStatus = MaterialStatus.IN_STOCK;
    } else if (mat.status === MaterialStatus.IN_STOCK) {
      newStatus = MaterialStatus.OUT_OF_STOCK;
    } else {
      newStatus = MaterialStatus.TO_BUY;
    }
    return this.updateMaterial(userId, id, { status: newStatus });
  }

  setMaterialStatus(userId: number, id: number, status: string): Material | null {
    return this.updateMaterial(userId, id, { status });
  }

  deleteMaterial(userId: number, id: number): boolean {
    const res = getDb().prepare("DELETE FROM materials WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
  }

  importMaterialsFromJson(userId: number, materialsList: any[], projectId?: number): Material[] {
    const targetProjId = projectId || projectRepo.getActiveProject(userId).id;
    const imported: Material[] = [];

    for (const item of materialsList) {
      if (!item || !item.name) continue;
      const mat = this.addMaterial(userId, {
        project_id: targetProjId,
        name: String(item.name),
        quantity: item.quantity !== undefined ? parseFloat(item.quantity) : 1.0,
        unit: item.unit ? String(item.unit) : "unidades",
        category: item.category ? String(item.category) : "General",
        status: item.status === MaterialStatus.IN_STOCK || item.status === "in_stock" || item.status === "🟢 En Taller" ? MaterialStatus.IN_STOCK : MaterialStatus.TO_BUY
      });
      imported.push(mat);
    }

    return imported;
  }

  getPendingMaterialsGroupedByProject(userId: number): { project_name: string; materials: Material[] }[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT m.*, COALESCE(p.name, 'Proyecto General') as project_name
      FROM materials m
      LEFT JOIN projects p ON p.id = m.project_id
      WHERE m.user_id = ?
        AND (m.status = 'to_buy' OR m.status = 'Por Comprar' OR m.status = 'out_of_stock')
        AND (p.id IS NULL OR p.is_active = 1)
      ORDER BY COALESCE(p.name, 'Proyecto General') ASC, m.category ASC, m.name ASC
    `).all(userId) as any[];

    const map = new Map<string, Material[]>();
    for (const r of rows) {
      const projName = r.project_name || "Proyecto General";
      const mat = this.rowToMaterial(r);
      if (!map.has(projName)) {
        map.set(projName, []);
      }
      map.get(projName)!.push(mat);
    }

    const result: { project_name: string; materials: Material[] }[] = [];
    for (const [project_name, materials] of map.entries()) {
      result.push({ project_name, materials });
    }
    return result;
  }

  // --- TOOLS MANAGEMENT ---
  private rowToTool(row: any): Tool {
    return {
      id: Number(row.id),
      user_id: Number(row.user_id),
      name: String(row.name),
      category: String(row.category || "Herramientas Manuales"),
      status: String(row.status || ToolStatus.AVAILABLE),
      notes: row.notes ? String(row.notes) : null,
      created_at: String(row.created_at || ""),
      updated_at: String(row.updated_at || "")
    };
  }

  getTools(userId: number, category?: string): Tool[] {
    const db = getDb();
    let sql = `SELECT * FROM tools WHERE user_id = ?`;
    const params: any[] = [userId];
    if (category) {
      sql += ` AND category = ?`;
      params.push(category);
    }
    sql += ` ORDER BY category ASC, name ASC`;
    const rows = db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToTool(r));
  }

  getTool(userId: number, id: number): Tool | null {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM tools WHERE id = ? AND user_id = ?`).get(id, userId) as any;
    if (!row) return null;
    return this.rowToTool(row);
  }

  addTool(userId: number, data: { name: string; category?: string; status?: string; notes?: string }): Tool {
    const db = getDb();
    const nowIso = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO tools (user_id, name, category, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      data.name.trim(),
      (data.category || "Herramientas Manuales").trim(),
      data.status || ToolStatus.AVAILABLE,
      data.notes ? data.notes.trim() : null,
      nowIso,
      nowIso
    );
    return this.getTool(userId, Number(info.lastInsertRowid))!;
  }

  updateTool(userId: number, id: number, data: Partial<Tool>): Tool | null {
    const existing = this.getTool(userId, id);
    if (!existing) return null;

    const updated = { ...existing, ...data };
    const nowIso = new Date().toISOString();

    getDb().prepare(`
      UPDATE tools SET
        name = ?,
        category = ?,
        status = ?,
        notes = ?,
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      updated.name.trim(),
      updated.category.trim(),
      updated.status,
      updated.notes ? updated.notes.trim() : null,
      nowIso,
      id,
      userId
    );

    return this.getTool(userId, id);
  }

  setToolStatus(userId: number, id: number, status: string): Tool | null {
    return this.updateTool(userId, id, { status });
  }

  deleteTool(userId: number, id: number): boolean {
    const res = getDb().prepare("DELETE FROM tools WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
  }

  getPendingTools(userId: number): Tool[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT * FROM tools
      WHERE user_id = ?
        AND (status = 'to_buy' OR status = 'Por Comprar')
      ORDER BY category ASC, name ASC
    `).all(userId) as any[];
    return rows.map(r => this.rowToTool(r));
  }
}

export const inventoryRepo = new InventoryRepository();
