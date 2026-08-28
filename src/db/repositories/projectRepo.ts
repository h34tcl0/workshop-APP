import { Project, ProjectTemplate, ProjectTemplateItem, Task, TaskCategory } from "../../types.js";
import { getDb } from "../connection.js";

export class ProjectRepository {
  getProjects(userId: number): Project[] {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY id ASC").all(userId) as any[];
    return rows.map(row => ({
      id: Number(row.id),
      name: String(row.name),
      description: row.description || "",
      is_active: Boolean(row.is_active)
    }));
  }

  getProjectById(userId: number, projectId: number): Project | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId) as any;
    if (!row) return null;
    return {
      id: Number(row.id),
      name: String(row.name),
      description: row.description || "",
      is_active: Boolean(row.is_active)
    };
  }

  getActiveProject(userId: number): Project {
    const projects = this.getProjects(userId);
    const active = projects.find(p => p.is_active);
    if (active) return active;
    if (projects.length > 0) return projects[0];

    const db = getDb();
    const info = db.prepare(
      "INSERT INTO projects (user_id, name, description, is_active) VALUES (?, 'Taller Principal', 'Proyecto por defecto', 1)"
    ).run(userId);
    return { id: Number(info.lastInsertRowid), name: "Taller Principal", description: "Proyecto por defecto", is_active: true };
  }

  addProject(userId: number, name: string, description?: string): Project {
    const db = getDb();
    db.prepare("UPDATE projects SET is_active = 0 WHERE user_id = ?").run(userId);
    const info = db.prepare(
      "INSERT INTO projects (user_id, name, description, is_active) VALUES (?, ?, ?, 1)"
    ).run(userId, name, description || "");
    return { id: Number(info.lastInsertRowid), name, description: description || "", is_active: true };
  }

  setActiveProject(userId: number, projectId: number): Project | null {
    const db = getDb();
    const proj = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId) as any;
    if (!proj) return null;
    db.prepare("UPDATE projects SET is_active = 0 WHERE user_id = ?").run(userId);
    db.prepare("UPDATE projects SET is_active = 1 WHERE id = ? AND user_id = ?").run(projectId, userId);
    return { id: Number(proj.id), name: String(proj.name), description: proj.description || "", is_active: true };
  }

  toggleProjectActive(userId: number, projectId: number, isActive?: boolean): Project | null {
    const db = getDb();
    const proj = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId) as any;
    if (!proj) return null;
    const newActive = isActive !== undefined ? (isActive ? 1 : 0) : (proj.is_active ? 0 : 1);
    db.prepare("UPDATE projects SET is_active = ? WHERE id = ? AND user_id = ?").run(newActive, projectId, userId);
    return { id: Number(proj.id), name: String(proj.name), description: proj.description || "", is_active: Boolean(newActive) };
  }

  updateProject(userId: number, projectId: number, data: { name?: string; description?: string }): Project | null {
    const db = getDb();
    const proj = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId) as any;
    if (!proj) return null;

    const newName = data.name !== undefined && data.name.trim() ? data.name.trim() : String(proj.name);
    const newDescription = data.description !== undefined ? data.description : (proj.description || "");

    db.prepare("UPDATE projects SET name = ?, description = ? WHERE id = ? AND user_id = ?")
      .run(newName, newDescription, projectId, userId);

    return { id: Number(proj.id), name: newName, description: newDescription, is_active: Boolean(proj.is_active) };
  }

  // --- PROJECT TEMPLATES ---
  getProjectTemplates(userId: number): ProjectTemplate[] {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM project_templates WHERE user_id = ? ORDER BY id DESC").all(userId) as any[];
    const templates: ProjectTemplate[] = rows.map(row => ({
      id: Number(row.id),
      name: String(row.name),
      description: row.description || "",
      created_at: String(row.created_at),
      items: []
    }));

    templates.forEach(t => {
      t.items = this.getProjectTemplateItems(userId, t.id);
    });

    return templates;
  }

  getProjectTemplate(userId: number, id: number): ProjectTemplate | null {
    const db = getDb();
    const row = db.prepare("SELECT * FROM project_templates WHERE id = ? AND user_id = ?").get(id, userId) as any;
    if (!row) return null;

    return {
      id: Number(row.id),
      name: String(row.name),
      description: row.description || "",
      created_at: String(row.created_at),
      items: this.getProjectTemplateItems(userId, Number(row.id))
    };
  }

  getProjectTemplateItems(userId: number, templateId: number): ProjectTemplateItem[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT * FROM project_template_items WHERE template_id = ? AND user_id = ? ORDER BY order_num ASC"
    ).all(templateId, userId) as any[];
    return rows.map(row => ({
      id: Number(row.id),
      template_id: Number(row.template_id),
      title: String(row.title),
      description: row.description || "",
      category: row.category as TaskCategory,
      estimated_hours: Number(row.estimated_hours),
      curing_hours: Number(row.curing_hours),
      order: Number(row.order_num)
    }));
  }

  createProjectTemplateFromBacklog(
    userId: number,
    name: string,
    description?: string,
    projectId?: number,
    pendingTasksGetter?: (userId: number, projectId: number) => Task[]
  ): ProjectTemplate {
    const db = getDb();
    const pId = projectId ?? this.getActiveProject(userId).id;
    const pendingTasks = pendingTasksGetter
      ? pendingTasksGetter(userId, pId)
      : (db.prepare(`
          SELECT t.*, p.name as project_name
          FROM tasks t
          JOIN projects p ON p.id = t.project_id
          WHERE t.user_id = ? AND t.project_id = ? AND (t.is_active IS NULL OR t.is_active = 1) AND t.status != 'completed'
          ORDER BY t.order_num ASC, t.id ASC
        `).all(userId, pId) as any[]);

    const nowIso = new Date().toISOString();

    const info = db.prepare("INSERT INTO project_templates (user_id, name, description, created_at) VALUES (?, ?, ?, ?);").run(
      userId,
      name,
      description || "",
      nowIso
    );
    const templateId = Number(info.lastInsertRowid);

    const itemStmt = db.prepare(
      `INSERT INTO project_template_items (user_id, template_id, title, description, category, estimated_hours, curing_hours, order_num)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`
    );

    pendingTasks.forEach((t: any, idx: number) => {
      itemStmt.run(
        userId,
        templateId,
        t.title,
        t.description || "",
        t.category,
        t.estimated_hours,
        t.curing_hours,
        idx + 1
      );
    });

    return this.getProjectTemplate(userId, templateId)!;
  }

  deleteProjectTemplate(userId: number, id: number): boolean {
    const db = getDb();
    db.prepare("DELETE FROM project_template_items WHERE template_id = ? AND user_id = ?").run(id, userId);
    const res = db.prepare("DELETE FROM project_templates WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
  }
}

export const projectRepo = new ProjectRepository();
