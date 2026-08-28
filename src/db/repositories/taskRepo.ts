import { Task, TaskCategory, TaskStatus } from "../../types.js";
import { getDb } from "../connection.js";
import { computeRequiresCuring } from "../helpers.js";
import { projectRepo } from "./projectRepo.js";

export class TaskRepository {
  rowToTask(row: any): Task {
    const cat = (row.category || TaskCategory.CARPENTRY) as TaskCategory;
    const curHours = Number(row.curing_hours || 0.0);
    const requires_curing = computeRequiresCuring(cat, curHours);

    return {
      id: Number(row.id),
      user_id: Number(row.user_id),
      project_id: Number(row.project_id),
      project_name: row.project_name ? String(row.project_name) : undefined,
      title: String(row.title),
      description: row.description || "",
      category: cat,
      estimated_hours: Number(row.estimated_hours),
      curing_hours: curHours,
      requires_curing,
      status: row.status as TaskStatus,
      progress_percentage: Number(row.progress_percentage || 0),
      order: Number(row.order_num),
      completed_at: row.completed_at || null,
      is_active: row.is_active !== undefined && row.is_active !== null ? Boolean(row.is_active) : true,
      curing_is_blocking: row.curing_is_blocking !== undefined && row.curing_is_blocking !== null ? Boolean(row.curing_is_blocking) : true
    };
  }

  getTasks(userId: number): Task[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.user_id = ?
      ORDER BY t.order_num ASC, t.id ASC
    `).all(userId);
    return rows.map(row => this.rowToTask(row));
  }

  getPendingTasks(userId: number, projectId?: number): Task[] {
    if (projectId) {
      return this.getPendingTasksForProject(userId, projectId);
    }
    return this.getPendingTasksForActiveProjects(userId);
  }

  getPendingTasksForActiveProjects(userId: number): Task[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.user_id = ? AND p.is_active = 1 AND (t.is_active IS NULL OR t.is_active = 1) AND t.status != 'completed'
      ORDER BY t.order_num ASC, t.id ASC
    `).all(userId);
    return rows.map(row => this.rowToTask(row));
  }

  getPendingTasksForProject(userId: number, projectId: number): Task[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.user_id = ? AND t.project_id = ? AND (t.is_active IS NULL OR t.is_active = 1) AND t.status != 'completed'
      ORDER BY t.order_num ASC, t.id ASC
    `).all(userId, projectId);
    return rows.map(row => this.rowToTask(row));
  }

  getTask(userId: number, id: number): Task | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.id = ? AND t.user_id = ?
    `).get(id, userId);
    if (!row) return null;
    return this.rowToTask(row);
  }

  getTaskGlobal(id: number): Task | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.id = ?
    `).get(id);
    if (!row) return null;
    return this.rowToTask(row);
  }

  toggleTaskActive(userId: number, taskId: number, isActive?: boolean): Task | null {
    const task = this.getTask(userId, taskId);
    if (!task) return null;
    const newActive = isActive !== undefined ? (isActive ? 1 : 0) : (task.is_active ? 0 : 1);
    getDb().prepare("UPDATE tasks SET is_active = ? WHERE id = ? AND user_id = ?").run(newActive, taskId, userId);
    return this.getTask(userId, taskId);
  }

  addTask(userId: number, taskData: {
    project_id?: number;
    title: string;
    description?: string;
    category?: TaskCategory;
    estimated_hours?: number;
    curing_hours?: number;
    order?: number;
    curing_is_blocking?: boolean;
  }): Task {
    const db = getDb();
    const activeProject = projectRepo.getActiveProject(userId);
    const pId = taskData.project_id || activeProject.id;
    const cat = taskData.category || TaskCategory.CARPENTRY;
    const est = taskData.estimated_hours !== undefined ? taskData.estimated_hours : 1.0;

    let defaultCuring = 0.0;
    if (cat === TaskCategory.PVA_GLUE) defaultCuring = 4.0;
    else if (cat === TaskCategory.VARNISH_PAINT) defaultCuring = 6.0;
    else if (cat === TaskCategory.EPOXY) defaultCuring = 12.0;

    const cur = taskData.curing_hours !== undefined ? taskData.curing_hours : defaultCuring;
    const reqCurInt = computeRequiresCuring(cat, cur) ? 1 : 0;
    const curingIsBlockingInt = taskData.curing_is_blocking !== undefined ? (taskData.curing_is_blocking ? 1 : 0) : 1;

    let ord = taskData.order;
    if (ord === undefined) {
      const maxRow = db.prepare("SELECT MAX(order_num) as max_ord FROM tasks WHERE user_id = ? AND project_id = ?").get(userId, pId) as any;
      ord = (maxRow && maxRow.max_ord != null ? Number(maxRow.max_ord) : 0) + 1;
    }

    const info = db.prepare(
      `INSERT INTO tasks (user_id, project_id, title, description, category, estimated_hours, curing_hours, requires_curing, status, progress_percentage, order_num, curing_is_blocking)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?);`
    ).run(userId, pId, taskData.title, taskData.description || "", cat, est, cur, reqCurInt, ord, curingIsBlockingInt);

    const createdId = Number(info.lastInsertRowid);
    return this.getTask(userId, createdId)!;
  }

  updateTask(userId: number, id: number, data: Partial<Task>): Task | null {
    try {
      const existing = this.getTask(userId, id);
      if (!existing) return null;

      const title = data.title !== undefined ? String(data.title).trim() : existing.title;
      const description = data.description !== undefined ? String(data.description) : (existing.description || "");
      const category = data.category !== undefined ? data.category : existing.category;

      const estHours = data.estimated_hours !== undefined && !isNaN(Number(data.estimated_hours))
        ? Number(data.estimated_hours)
        : (existing.estimated_hours || 1.0);

      const curHours = data.curing_hours !== undefined && !isNaN(Number(data.curing_hours))
        ? Number(data.curing_hours)
        : (existing.curing_hours || 0.0);

      const reqCurInt = computeRequiresCuring(category, curHours) ? 1 : 0;
      const status = data.status !== undefined ? data.status : existing.status;

      const progressPercentage = data.progress_percentage !== undefined && !isNaN(Number(data.progress_percentage))
        ? Number(data.progress_percentage)
        : (existing.progress_percentage || 0);

      const orderNum = data.order !== undefined && !isNaN(Number(data.order))
        ? Number(data.order)
        : (existing.order || 1);

      const completedAt = data.completed_at !== undefined
        ? (data.completed_at ? String(data.completed_at) : null)
        : (existing.completed_at ? String(existing.completed_at) : null);

      const projectId = data.project_id !== undefined && !isNaN(Number(data.project_id))
        ? Number(data.project_id)
        : (existing.project_id || 1);

      const isActiveInt = data.is_active !== undefined
        ? (data.is_active ? 1 : 0)
        : (existing.is_active !== false ? 1 : 0);

      const curingIsBlockingInt = data.curing_is_blocking !== undefined
        ? (data.curing_is_blocking ? 1 : 0)
        : (existing.curing_is_blocking !== false ? 1 : 0);

      getDb().prepare(
        `UPDATE tasks SET
          title = ?,
          description = ?,
          category = ?,
          estimated_hours = ?,
          curing_hours = ?,
          requires_curing = ?,
          status = ?,
          progress_percentage = ?,
          order_num = ?,
          completed_at = ?,
          project_id = ?,
          is_active = ?,
          curing_is_blocking = ?
        WHERE id = ? AND user_id = ?;`
      ).run(
        title,
        description,
        category,
        estHours,
        curHours,
        reqCurInt,
        status,
        progressPercentage,
        orderNum,
        completedAt,
        projectId,
        isActiveInt,
        curingIsBlockingInt,
        id,
        userId
      );

      return this.getTask(userId, id);
    } catch (err) {
      console.error(`[DB Error] updateTask failed for task ${id}, user ${userId}:`, err);
      return null;
    }
  }

  updateTaskGlobal(id: number, data: Partial<Task>): Task | null {
    const existing = this.getTaskGlobal(id);
    if (!existing) return null;

    const updated = { ...existing, ...data };
    const reqCurInt = computeRequiresCuring(updated.category, updated.curing_hours) ? 1 : 0;

    getDb().prepare(
      `UPDATE tasks SET
        title = ?,
        description = ?,
        category = ?,
        estimated_hours = ?,
        curing_hours = ?,
        requires_curing = ?,
        status = ?,
        progress_percentage = ?,
        order_num = ?,
        completed_at = ?
      WHERE id = ?;`
    ).run(
      updated.title,
      updated.description || "",
      updated.category,
      updated.estimated_hours,
      updated.curing_hours,
      reqCurInt,
      updated.status,
      updated.progress_percentage,
      updated.order,
      updated.completed_at ? String(updated.completed_at) : null,
      id
    );

    return this.getTaskGlobal(id);
  }

  deleteTask(userId: number, id: number): boolean {
    const res = getDb().prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
  }

  moveTaskUp(userId: number, id: number): boolean {
    const task = this.getTask(userId, id);
    if (!task) return false;

    const pending = this.getPendingTasksForProject(userId, task.project_id);
    const idx = pending.findIndex(t => t.id === id);
    if (idx <= 0) return false;

    const prevTask = pending[idx - 1];
    const tempOrder = task.order;
    this.updateTask(userId, task.id, { order: prevTask.order });
    this.updateTask(userId, prevTask.id, { order: tempOrder });
    return true;
  }

  moveTaskDown(userId: number, id: number): boolean {
    const task = this.getTask(userId, id);
    if (!task) return false;

    const pending = this.getPendingTasksForProject(userId, task.project_id);
    const idx = pending.findIndex(t => t.id === id);
    if (idx < 0 || idx >= pending.length - 1) return false;

    const nextTask = pending[idx + 1];
    const tempOrder = task.order;
    this.updateTask(userId, task.id, { order: nextTask.order });
    this.updateTask(userId, nextTask.id, { order: tempOrder });
    return true;
  }

  reorderTasks(userId: number, taskIds: number[]): boolean {
    const db = getDb();
    const stmt = db.prepare("UPDATE tasks SET order_num = ? WHERE id = ? AND user_id = ?");
    const transaction = db.transaction((ids: number[]) => {
      ids.forEach((id, index) => {
        stmt.run(index + 1, id, userId);
      });
    });
    transaction(taskIds);
    return true;
  }

  getRecentCompletedHistory(userId: number): Task[] {
    const rows = getDb().prepare(
      "SELECT * FROM tasks WHERE user_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 10"
    ).all(userId);
    return rows.map(r => this.rowToTask(r));
  }

  getTaskHistory(userId: number): Array<{ title: string; category: TaskCategory; estimated_hours: number; curing_hours: number }> {
    const rows = getDb().prepare(`
      SELECT title, category, estimated_hours, curing_hours, MAX(id) as max_id
      FROM tasks
      WHERE user_id = ? AND title IS NOT NULL AND TRIM(title) != ''
      GROUP BY LOWER(TRIM(title))
      ORDER BY max_id DESC
      LIMIT 50
    `).all(userId) as any[];

    return rows.map(row => ({
      title: String(row.title),
      category: row.category as TaskCategory,
      estimated_hours: Number(row.estimated_hours),
      curing_hours: Number(row.curing_hours)
    }));
  }

  applyProjectTemplate(userId: number, templateId: number, projectId?: number): Task[] {
    const template = projectRepo.getProjectTemplate(userId, templateId);
    if (!template || !template.items || template.items.length === 0) return [];

    const pId = projectId ?? projectRepo.getActiveProject(userId).id;
    const currentTasks = this.getPendingTasksForProject(userId, pId);
    const maxOrder = currentTasks.reduce((max, t) => Math.max(max, t.order), 0);

    const addedTasks: Task[] = [];
    template.items.forEach((item, idx) => {
      const newTask = this.addTask(userId, {
        project_id: pId,
        title: item.title,
        description: item.description,
        category: item.category,
        estimated_hours: item.estimated_hours,
        curing_hours: item.curing_hours,
        order: maxOrder + idx + 1
      });
      addedTasks.push(newTask);
    });

    return addedTasks;
  }
}

export const taskRepo = new TaskRepository();
