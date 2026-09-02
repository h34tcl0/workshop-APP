import Database from "better-sqlite3";
import { TaskCategory, MaterialStatus } from "../types.js";
import { hashPassword, verifyPassword } from "../auth.js";
import { computeRequiresCuring } from "./helpers.js";

export function seedDefaultsIfEmpty(db: Database.Database): void {
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@workshop.os").trim();
  const adminPassword = process.env.ADMIN_PASSWORD || "Admin123!";

  const userCountRow = db.prepare("SELECT COUNT(*) as count FROM users").get() as any;
  if (!userCountRow || userCountRow.count === 0) {
    const adminHash = hashPassword(adminPassword);
    const isDefault = adminPassword === "Admin123!" || adminPassword === "password123";
    db.prepare(
      "INSERT INTO users (email, password_hash, role, status, must_change_password, created_at) VALUES (?, ?, 'admin', 'active', ?, datetime('now'))"
    ).run(adminEmail.toLowerCase(), adminHash, isDefault ? 1 : 0);
    console.log(`[AUTH] Seeded initial admin user: ${adminEmail}`);
  } else {
    const userRow = db.prepare("SELECT id, password_hash, role FROM users WHERE LOWER(email) = LOWER(?)").get(adminEmail) as any;
    if (userRow) {
      const isCurrentValid = verifyPassword(adminPassword, userRow.password_hash as string);
      if (!isCurrentValid) {
        const newHash = hashPassword(adminPassword);
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, userRow.id);
        console.log(`[AUTH] Updated password hash for admin user: ${adminEmail}`);
      } else {
        console.log(`[AUTH] Verified admin user active: ${adminEmail}`);
      }
      if (userRow.role !== 'admin') {
        db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(userRow.id);
        console.log(`[AUTH] Ensured admin role for: ${adminEmail}`);
      }
    }
  }

  // Handle ADMIN_BOOTSTRAP_EMAIL if defined
  bootstrapAdmin(db);

  const activeUser = db.prepare("SELECT id, password_hash FROM users WHERE LOWER(email) = LOWER(?)").get(adminEmail) as any;
  if (activeUser) {
    const isUsingDefaultCreds = verifyPassword("Admin123!", activeUser.password_hash) || verifyPassword("password123", activeUser.password_hash);
    if (isUsingDefaultCreds) {
      db.prepare("UPDATE users SET must_change_password = 1 WHERE id = ?").run(activeUser.id);
      console.warn(`
===================================================================
[SECURITY WARNING] DEFAULT ADMIN CREDENTIALS ACTIVE!
Account: ${adminEmail}
Default password ('Admin123!' or 'password123') is in use!
For production safety, you MUST change this password immediately.
Standard API access is restricted until password is updated.
===================================================================
`);
    }
  }

  const defaultUser = db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get() as any;
  const adminUserId = defaultUser ? Number(defaultUser.id) : 1;

  // Check settings for admin user
  const settingsRow = db.prepare("SELECT COUNT(*) as count FROM app_settings WHERE user_id = ?").get(adminUserId) as any;
  if (!settingsRow || settingsRow.count === 0) {
    db.prepare(`
      INSERT INTO app_settings (
        user_id, operational_start_hour, operational_end_hour, max_humidity_percent,
        latitude, longitude, setup_hours, teardown_hours, min_work_hours,
        min_work_hours_unless_final, min_rain_precipitation_mm, checkin_hour,
        morning_eval_lead_hours, exclude_saturdays, exclude_sundays, exclude_holidays,
        require_curing_before_cutoff
      ) VALUES (?, 9, 18, 80.0, -32.99, -71.27, 1.0, 1.0, 1.0, 4.0, 0.1, 19, 1, 1, 1, 1, 1);
    `).run(adminUserId);
  }

  // Check projects for admin user
  const projRow = db.prepare("SELECT COUNT(*) as count FROM projects WHERE user_id = ?").get(adminUserId) as any;
  if (!projRow || projRow.count === 0) {
    db.prepare("INSERT INTO projects (user_id, name, description, is_active) VALUES (?, 'Taller Principal', 'Proyecto por defecto', 1)").run(adminUserId);
  }

  const adminProj = db.prepare("SELECT id FROM projects WHERE user_id = ? AND is_active = 1").get(adminUserId) as any;
  const adminProjId = adminProj ? Number(adminProj.id) : 1;

  // Check tasks for admin user
  const tasksRow = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE user_id = ?").get(adminUserId) as any;
  if (!tasksRow || tasksRow.count === 0) {
    const defaultTasks = [
      {
        title: "Corte y Cepillado de Vigas de Roble",
        description: "Preparar vigas principales para ensamble de estructura.",
        category: TaskCategory.CARPENTRY,
        estimated_hours: 3.5,
        curing_hours: 0,
        order_num: 1
      },
      {
        title: "Encolado de Cubierta de Mesa",
        description: "Encolar listones de roble con adhesivo PVA alta resistencia.",
        category: TaskCategory.PVA_GLUE,
        estimated_hours: 1.5,
        curing_hours: 4.0,
        order_num: 2
      },
      {
        title: "Primera Capa de Barniz Marino",
        description: "Aplicación a soplete en cabina de pintado.",
        category: TaskCategory.VARNISH_PAINT,
        estimated_hours: 2.0,
        curing_hours: 6.0,
        order_num: 3
      },
      {
        title: "Vierte de Resina Epoxi en Grietas",
        description: "Relleno y nivelado de vetas profundas con epoxi cristal.",
        category: TaskCategory.EPOXY,
        estimated_hours: 1.5,
        curing_hours: 12.0,
        order_num: 4
      }
    ];

    const insertStmt = db.prepare(`
      INSERT INTO tasks (user_id, project_id, title, description, category, estimated_hours, curing_hours, requires_curing, status, progress_percentage, order_num)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)
    `);

    defaultTasks.forEach(t => {
      const reqCur = computeRequiresCuring(t.category, t.curing_hours) ? 1 : 0;
      insertStmt.run(
        adminUserId,
        adminProjId,
        t.title,
        t.description,
        t.category,
        t.estimated_hours,
        t.curing_hours,
        reqCur,
        t.order_num
      );
    });
  }

  // Check calculator_offsets for admin user
  const offsetsRow = db.prepare("SELECT COUNT(*) as count FROM calculator_offsets WHERE user_id = ?").get(adminUserId) as any;
  if (!offsetsRow || offsetsRow.count === 0) {
    const defaultOffsets = [
      { label: "-185 Riel", offset_value: -185, unit: "mm", description: "Descuento guía/riel telescópico cajón", order_num: 1 },
      { label: "+3 Disco", offset_value: 3, unit: "mm", description: "Espesor hoja de sierra de banco", order_num: 2 },
      { label: "-2 Canto", offset_value: -2, unit: "mm", description: "Descuento tapacanto PVC", order_num: 3 },
      { label: "-15 Fondo", offset_value: -15, unit: "mm", description: "Holgura trasera fondo cajón", order_num: 4 }
    ];
    const insertOffset = db.prepare(`
      INSERT INTO calculator_offsets (user_id, label, offset_value, unit, description, order_num, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    defaultOffsets.forEach(o => {
      insertOffset.run(adminUserId, o.label, o.offset_value, o.unit, o.description, o.order_num);
    });
  }

  // Check materials for admin user
  const materialsRow = db.prepare("SELECT COUNT(*) as count FROM materials WHERE user_id = ?").get(adminUserId) as any;
  if (!materialsRow || materialsRow.count === 0) {
    const defaultMaterials = [
      { name: "Listones de Roble 2x4x3.2m", quantity: 6, unit: "piezas", category: "Madera", status: MaterialStatus.TO_BUY },
      { name: "Cola Fría Titebond III 500ml", quantity: 1, unit: "botella", category: "Adhesivos/Barniz", status: MaterialStatus.IN_STOCK },
      { name: "Tornillos T2 Cincados 2 pulgadas", quantity: 100, unit: "unidades", category: "Tornillería", status: MaterialStatus.TO_BUY },
      { name: "Resina Epoxi Cristal (Kit 1kg)", quantity: 2, unit: "kits", category: "Adhesivos/Barniz", status: MaterialStatus.TO_BUY },
      { name: "Guías Telescópicas 45cm", quantity: 4, unit: "pares", category: "Herrajes", status: MaterialStatus.IN_STOCK }
    ];
    const insertMaterial = db.prepare(`
      INSERT INTO materials (user_id, project_id, name, quantity, unit, category, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    defaultMaterials.forEach(m => {
      insertMaterial.run(adminUserId, adminProjId, m.name, m.quantity, m.unit, m.category, m.status);
    });
  }
}

export function bootstrapAdmin(db: Database.Database): void {
  const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ? process.env.ADMIN_BOOTSTRAP_EMAIL.trim().toLowerCase() : null;
  if (!bootstrapEmail) return;

  try {
    const userRow = db.prepare("SELECT id, role FROM users WHERE LOWER(email) = LOWER(?)").get(bootstrapEmail) as any;
    if (userRow) {
      if (userRow.role !== 'admin') {
        db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(userRow.id);
        console.log(`[BOOTSTRAP ADMIN] Usuario '${bootstrapEmail}' promovido automáticamente al rol 'admin'.`);
      } else {
        console.log(`[BOOTSTRAP ADMIN] Usuario '${bootstrapEmail}' ya posee el rol 'admin'.`);
      }
    } else {
      console.warn(`[BOOTSTRAP WARNING] Usuario con email '${bootstrapEmail}' configurado en ADMIN_BOOTSTRAP_EMAIL no existe en la base de datos. Se promoverá cuando la cuenta sea creada o mediante scripts/make-admin.js.`);
    }
  } catch (err) {
    console.error("[BOOTSTRAP ERROR] Error al verificar ADMIN_BOOTSTRAP_EMAIL:", err);
  }
}

export function cleanupDuplicateTelegramChatIds(db: Database.Database): void {
  try {
    const duplicates = db.prepare(`
      SELECT CAST(telegram_chat_id AS TEXT) as chat_id, COUNT(*) as c
      FROM app_settings
      WHERE telegram_chat_id IS NOT NULL AND TRIM(CAST(telegram_chat_id AS TEXT)) != ''
      GROUP BY CAST(telegram_chat_id AS TEXT)
      HAVING c > 1
    `).all() as any[];

    for (const dup of duplicates) {
      const chatId = String(dup.chat_id).trim();
      const userRows = db.prepare(`
        SELECT user_id FROM app_settings
        WHERE CAST(telegram_chat_id AS TEXT) = ?
        ORDER BY user_id DESC
      `).all(chatId) as any[];

      if (userRows.length > 1) {
        const keepUserId = Number(userRows[0].user_id);
        const removeUserIds = userRows.slice(1).map(r => Number(r.user_id));
        for (const rId of removeUserIds) {
          db.prepare("UPDATE app_settings SET telegram_chat_id = NULL WHERE user_id = ?").run(rId);
        }
        console.log(`[DB Startup Cleanup] Resolved duplicate Telegram Chat ID ${chatId}. Retained for user #${keepUserId}, unlinked from user(s) [${removeUserIds.join(', ')}].`);
      }
    }
  } catch (err) {
    console.error("[DB Startup Cleanup Error]:", err);
  }
}
