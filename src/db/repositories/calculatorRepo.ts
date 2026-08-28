import { CalculatorOffset } from "../../types.js";
import { getDb } from "../connection.js";

export class CalculatorRepository {
  private rowToCalculatorOffset(row: any): CalculatorOffset {
    return {
      id: Number(row.id),
      user_id: Number(row.user_id),
      label: String(row.label),
      offset_value: Number(row.offset_value),
      unit: String(row.unit || "mm"),
      description: row.description || "",
      order_num: Number(row.order_num || 1),
      created_at: String(row.created_at || "")
    };
  }

  getCalculatorOffsets(userId: number): CalculatorOffset[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM calculator_offsets WHERE user_id = ? ORDER BY order_num ASC, id ASC"
    ).all(userId) as any[];

    if (rows.length === 0) {
      // Seed default offsets if empty
      const defaultOffsets = [
        { label: "-185 Riel", offset_value: -185, unit: "mm", description: "Descuento guía/riel telescópico cajón", order_num: 1 },
        { label: "+3 Disco", offset_value: 3, unit: "mm", description: "Espesor hoja de sierra de banco", order_num: 2 },
        { label: "-2 Canto", offset_value: -2, unit: "mm", description: "Descuento tapacanto PVC", order_num: 3 },
        { label: "-15 Fondo", offset_value: -15, unit: "mm", description: "Holgura trasera fondo cajón", order_num: 4 }
      ];
      const insertStmt = db.prepare(`
        INSERT INTO calculator_offsets (user_id, label, offset_value, unit, description, order_num, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `);
      defaultOffsets.forEach(o => {
        insertStmt.run(userId, o.label, o.offset_value, o.unit, o.description, o.order_num);
      });
      return this.getCalculatorOffsets(userId);
    }

    return rows.map(r => this.rowToCalculatorOffset(r));
  }

  getCalculatorOffset(userId: number, id: number): CalculatorOffset | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM calculator_offsets WHERE id = ? AND user_id = ?").get(id, userId) as any;
    if (!row) return null;
    return this.rowToCalculatorOffset(row);
  }

  addCalculatorOffset(userId: number, data: {
    label: string;
    offset_value: number;
    unit?: string;
    description?: string;
  }): CalculatorOffset {
    const offsets = this.getCalculatorOffsets(userId);
    const maxOrder = offsets.reduce((max, o) => Math.max(max, o.order_num), 0);

    const db = getDb();
    const info = db.prepare(`
      INSERT INTO calculator_offsets (user_id, label, offset_value, unit, description, order_num, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      userId,
      data.label.trim(),
      Number(data.offset_value),
      (data.unit || "mm").trim(),
      (data.description || "").trim(),
      maxOrder + 1
    );

    return this.getCalculatorOffset(userId, Number(info.lastInsertRowid))!;
  }

  updateCalculatorOffset(userId: number, id: number, data: Partial<CalculatorOffset>): CalculatorOffset | null {
    const existing = this.getCalculatorOffset(userId, id);
    if (!existing) return null;

    const updated = { ...existing, ...data };

    getDb().prepare(`
      UPDATE calculator_offsets SET
        label = ?,
        offset_value = ?,
        unit = ?,
        description = ?
      WHERE id = ? AND user_id = ?
    `).run(
      updated.label.trim(),
      updated.offset_value,
      updated.unit.trim(),
      updated.description || "",
      id,
      userId
    );

    return this.getCalculatorOffset(userId, id);
  }

  deleteCalculatorOffset(userId: number, id: number): boolean {
    const res = getDb().prepare("DELETE FROM calculator_offsets WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
  }
}

export const calculatorRepo = new CalculatorRepository();
