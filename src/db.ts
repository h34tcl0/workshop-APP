import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  User,
  AppSettings,
  Project,
  Task,
  TaskCategory,
  TaskStatus,
  FavoriteTask,
  DayOverride,
  ForcedTask,
  DailyLog,
  DayStatus,
  ProjectTemplate,
  ProjectTemplateItem,
  MaterialStatus,
  Material,
  CalculatorOffset,
  Tool,
  ToolStatus
} from "./types.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { getTimezoneByCoords } from "./dateUtils.js";

const DB_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "workshop.db");

let dbInstance: Database.Database | null = null;

function ensureDbDirExists() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
}

export function computeRequiresCuring(category: TaskCategory | string, curingHours: number): boolean {
  return (
    curingHours > 0 ||
    category === TaskCategory.PVA_GLUE ||
    category === TaskCategory.VARNISH_PAINT ||
    category === TaskCategory.EPOXY ||
    category === "pva_glue" ||
    category === "varnish_paint" ||
    category === "epoxy"
  );
}

export async function initDatabase(): Promise<Database.Database> {
  if (dbInstance) return dbInstance;

  ensureDbDirExists();
  dbInstance = new Database(DB_PATH);
  dbInstance.pragma("journal_mode = WAL");

  // Create users table first
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  try {
    dbInstance.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;");
  } catch {
    // Column already exists
  }

  // Ensure default user exists for migrations
  const userCountRow = dbInstance.prepare("SELECT COUNT(*) as count FROM users").get() as any;
  if (!userCountRow || userCountRow.count === 0) {
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@workshop.os').trim();
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';
    const adminHash = hashPassword(adminPassword);
    dbInstance.prepare(
      "INSERT INTO users (email, password_hash, must_change_password, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).run(adminEmail.toLowerCase(), adminHash, 1);
  }

  const defaultUser = dbInstance.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get() as any;
  const defaultUserId = defaultUser ? Number(defaultUser.id) : 1;

  // Ensure tables exist with user_id
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      estimated_hours REAL NOT NULL DEFAULT 1.0,
      curing_hours REAL NOT NULL DEFAULT 0.0,
      requires_curing INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      progress_percentage INTEGER NOT NULL DEFAULT 0,
      order_num INTEGER NOT NULL DEFAULT 1,
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      estimated_hours REAL NOT NULL DEFAULT 1.0,
      curing_hours REAL NOT NULL DEFAULT 0.0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      operational_start_hour INTEGER NOT NULL DEFAULT 9,
      operational_end_hour INTEGER NOT NULL DEFAULT 18,
      max_humidity_percent REAL NOT NULL DEFAULT 80.0,
      latitude REAL NOT NULL DEFAULT -32.99,
      longitude REAL NOT NULL DEFAULT -71.27,
      setup_hours REAL NOT NULL DEFAULT 1.0,
      teardown_hours REAL NOT NULL DEFAULT 1.0,
      min_work_hours REAL NOT NULL DEFAULT 1.0,
      min_work_hours_unless_final REAL NOT NULL DEFAULT 4.0,
      min_rain_precipitation_mm REAL NOT NULL DEFAULT 0.2,
      checkin_hour INTEGER NOT NULL DEFAULT 19,
      morning_eval_lead_hours INTEGER NOT NULL DEFAULT 1,
      exclude_saturdays INTEGER NOT NULL DEFAULT 1,
      exclude_sundays INTEGER NOT NULL DEFAULT 1,
      exclude_holidays INTEGER NOT NULL DEFAULT 1,
      require_curing_before_cutoff INTEGER NOT NULL DEFAULT 1,
      telegram_chat_id TEXT,
      google_calendar_id TEXT,
      google_calendar_enabled INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS day_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      override_date TEXT NOT NULL,
      force_status TEXT,
      custom_start_hour INTEGER,
      custom_end_hour INTEGER,
      removed_task_ids TEXT,
      note TEXT,
      updated_at TEXT,
      UNIQUE(user_id, override_date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS forced_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      forced_date TEXT NOT NULL,
      task_id INTEGER NOT NULL,
      forced_start_hour REAL NOT NULL DEFAULT 9.0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Códigos de un solo uso para vincular telegram_chat_id de forma segura.
    -- Reemplaza el flujo anterior (pegar el chat_id a mano en Ajustes), que permitía
    -- que cualquier usuario autenticado le robara la vinculación de Telegram a otro
    -- con solo conocer/adivinar su chat_id numérico (hallazgo de auditoría, ago 2026).
    -- Ahora hay que probar posesión real del chat mandando el código al bot.
    CREATE TABLE IF NOT EXISTS telegram_link_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_code ON telegram_link_codes(code);

    CREATE TABLE IF NOT EXISTS daily_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      eval_date TEXT NOT NULL,
      status TEXT NOT NULL,
      block_reason TEXT,
      window_start TEXT,
      window_end TEXT,
      net_work_hours REAL,
      tasks_summary TEXT,
      scheduled_task_ids TEXT,
      morning_climate_snapshot TEXT,
      telegram_notified INTEGER NOT NULL DEFAULT 0,
      calendar_created INTEGER NOT NULL DEFAULT 0,
      google_event_id TEXT,
      checkin_sent INTEGER NOT NULL DEFAULT 0,
      checkin_resolved INTEGER NOT NULL DEFAULT 0,
      weather_alert_sent INTEGER NOT NULL DEFAULT 0,
      weather_alert_acknowledged INTEGER NOT NULL DEFAULT 0,
      weather_alert_retry_count INTEGER NOT NULL DEFAULT 0,
      weather_alert_last_sent_at TEXT,
      weather_alert_message TEXT,
      intraday_alert_triggered INTEGER NOT NULL DEFAULT 0,
      intraday_alert_acknowledged INTEGER NOT NULL DEFAULT 0,
      intraday_alert_last_sent_at TEXT,
      intraday_alert_burst_count INTEGER NOT NULL DEFAULT 0,
      calendar_sync_claimed_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, eval_date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_template_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      template_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      estimated_hours REAL NOT NULL DEFAULT 1.0,
      curing_hours REAL NOT NULL DEFAULT 0.0,
      order_num INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (template_id) REFERENCES project_templates(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1.0,
      unit TEXT NOT NULL DEFAULT 'unidades',
      category TEXT NOT NULL DEFAULT 'General',
      status TEXT NOT NULL DEFAULT 'to_buy',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Herramientas Manuales',
      status TEXT NOT NULL DEFAULT 'available',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS calculator_offsets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      offset_value REAL NOT NULL,
      unit TEXT NOT NULL DEFAULT 'mm',
      description TEXT,
      order_num INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Migration logic for existing tables missing user_id
  const tablesToMigrate = [
    'projects', 'tasks', 'favorites', 'forced_tasks', 'project_templates', 'project_template_items', 'materials', 'calculator_offsets'
  ];

  for (const table of tablesToMigrate) {
    const cols = dbInstance.prepare(`PRAGMA table_info(${table})`).all() as any[];
    const hasUserId = cols.some(c => c.name === 'user_id');
    if (!hasUserId) {
      console.log(`[DB MIGRATION] Adding user_id column to ${table}...`);
      dbInstance.exec(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER DEFAULT ${defaultUserId};`);
      dbInstance.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(defaultUserId);
    }
  }

  // Special migration for app_settings (recreate to ensure per-user UNIQUE constraint and drop CHECK(id=1))
  const appSettingsCols = dbInstance.prepare("PRAGMA table_info(app_settings)").all() as any[];
  const hasUserIdInSettings = appSettingsCols.some(c => c.name === 'user_id');
  if (!hasUserIdInSettings) {
    console.log('[DB MIGRATION] Migrating app_settings table for multi-tenancy...');
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS app_settings_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        operational_start_hour INTEGER NOT NULL DEFAULT 9,
        operational_end_hour INTEGER NOT NULL DEFAULT 18,
        max_humidity_percent REAL NOT NULL DEFAULT 80.0,
        latitude REAL NOT NULL DEFAULT -32.99,
        longitude REAL NOT NULL DEFAULT -71.27,
        setup_hours REAL NOT NULL DEFAULT 1.0,
        teardown_hours REAL NOT NULL DEFAULT 1.0,
        min_work_hours REAL NOT NULL DEFAULT 1.0,
        min_work_hours_unless_final REAL NOT NULL DEFAULT 4.0,
        min_rain_precipitation_mm REAL NOT NULL DEFAULT 0.2,
        checkin_hour INTEGER NOT NULL DEFAULT 19,
        morning_eval_lead_hours INTEGER NOT NULL DEFAULT 1,
        exclude_saturdays INTEGER NOT NULL DEFAULT 1,
        exclude_sundays INTEGER NOT NULL DEFAULT 1,
        exclude_holidays INTEGER NOT NULL DEFAULT 1,
        require_curing_before_cutoff INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    dbInstance.exec(`
      INSERT OR IGNORE INTO app_settings_new (
        user_id, operational_start_hour, operational_end_hour, max_humidity_percent,
        latitude, longitude, setup_hours, teardown_hours, min_work_hours,
        min_work_hours_unless_final, min_rain_precipitation_mm, checkin_hour,
        morning_eval_lead_hours, exclude_saturdays, exclude_sundays, exclude_holidays,
        require_curing_before_cutoff
      )
      SELECT
        ${defaultUserId} as user_id, operational_start_hour, operational_end_hour, max_humidity_percent,
        latitude, longitude, setup_hours, teardown_hours, min_work_hours,
        min_work_hours_unless_final, min_rain_precipitation_mm, checkin_hour,
        morning_eval_lead_hours, exclude_saturdays, exclude_sundays, exclude_holidays,
        require_curing_before_cutoff
      FROM app_settings;
    `);
    dbInstance.exec("DROP TABLE app_settings;");
    dbInstance.exec("ALTER TABLE app_settings_new RENAME TO app_settings;");
  }

  // Ensure new columns exist on app_settings
  const currentAppSettingsCols = dbInstance.prepare("PRAGMA table_info(app_settings)").all() as any[];
  if (!currentAppSettingsCols.some(c => c.name === 'telegram_chat_id')) {
    dbInstance.exec("ALTER TABLE app_settings ADD COLUMN telegram_chat_id TEXT;");
  }
  if (!currentAppSettingsCols.some(c => c.name === 'google_calendar_id')) {
    dbInstance.exec("ALTER TABLE app_settings ADD COLUMN google_calendar_id TEXT;");
  }
  if (!currentAppSettingsCols.some(c => c.name === 'google_calendar_enabled')) {
    dbInstance.exec("ALTER TABLE app_settings ADD COLUMN google_calendar_enabled INTEGER NOT NULL DEFAULT 0;");
  }
  if (!currentAppSettingsCols.some(c => c.name === 'timezone')) {
    dbInstance.exec("ALTER TABLE app_settings ADD COLUMN timezone TEXT;");
  }

  const currentDailyLogCols = dbInstance.prepare("PRAGMA table_info(daily_logs)").all() as any[];
  if (!currentDailyLogCols.some(c => c.name === 'google_event_id')) {
    dbInstance.exec("ALTER TABLE daily_logs ADD COLUMN google_event_id TEXT;");
  }
  if (!currentDailyLogCols.some(c => c.name === 'intraday_alert_triggered')) {
    dbInstance.exec("ALTER TABLE daily_logs ADD COLUMN intraday_alert_triggered INTEGER NOT NULL DEFAULT 0;");
  }
  if (!currentDailyLogCols.some(c => c.name === 'intraday_alert_acknowledged')) {
    dbInstance.exec("ALTER TABLE daily_logs ADD COLUMN intraday_alert_acknowledged INTEGER NOT NULL DEFAULT 0;");
  }
  if (!currentDailyLogCols.some(c => c.name === 'intraday_alert_last_sent_at')) {
    dbInstance.exec("ALTER TABLE daily_logs ADD COLUMN intraday_alert_last_sent_at TEXT;");
  }
  if (!currentDailyLogCols.some(c => c.name === 'intraday_alert_burst_count')) {
    dbInstance.exec("ALTER TABLE daily_logs ADD COLUMN intraday_alert_burst_count INTEGER NOT NULL DEFAULT 0;");
  }
  // calendar_sync_claimed_at: lock optimista para evitar eventos duplicados en Google Calendar
  // si dos evaluaciones (Tier 1) llegan a solaparse en el tiempo (bug detectado en producción, ago 2026:
  // entre leer daily_logs.google_event_id y guardar el ID del evento creado hay una llamada HTTP a Google
  // de por medio; si dos corridas leen "sin evento" al mismo tiempo, ambas crean uno cada una).
  if (!currentDailyLogCols.some(c => c.name === 'calendar_sync_claimed_at')) {
    dbInstance.exec("ALTER TABLE daily_logs ADD COLUMN calendar_sync_claimed_at TEXT;");
  }

  // Special migration for day_overrides (recreate for per-user UNIQUE constraint)
  const dayOverrideCols = dbInstance.prepare("PRAGMA table_info(day_overrides)").all() as any[];
  const hasUserIdInOverrides = dayOverrideCols.some(c => c.name === 'user_id');
  if (!hasUserIdInOverrides) {
    console.log('[DB MIGRATION] Migrating day_overrides table for multi-tenancy...');
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS day_overrides_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        override_date TEXT NOT NULL,
        force_status TEXT,
        custom_start_hour INTEGER,
        custom_end_hour INTEGER,
        removed_task_ids TEXT,
        note TEXT,
        updated_at TEXT,
        UNIQUE(user_id, override_date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    dbInstance.exec(`
      INSERT OR IGNORE INTO day_overrides_new (
        user_id, override_date, force_status, custom_start_hour, custom_end_hour, removed_task_ids, note, updated_at
      )
      SELECT
        ${defaultUserId} as user_id, override_date, force_status, custom_start_hour, custom_end_hour, removed_task_ids, note, updated_at
      FROM day_overrides;
    `);
    dbInstance.exec("DROP TABLE day_overrides;");
    dbInstance.exec("ALTER TABLE day_overrides_new RENAME TO day_overrides;");
  }

  // Special migration for daily_logs (recreate for per-user UNIQUE constraint)
  const dailyLogsCols = dbInstance.prepare("PRAGMA table_info(daily_logs)").all() as any[];
  const hasUserIdInDailyLogs = dailyLogsCols.some(c => c.name === 'user_id');
  if (!hasUserIdInDailyLogs) {
    console.log('[DB MIGRATION] Migrating daily_logs table for multi-tenancy...');
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS daily_logs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        eval_date TEXT NOT NULL,
        status TEXT NOT NULL,
        block_reason TEXT,
        window_start TEXT,
        window_end TEXT,
        net_work_hours REAL,
        tasks_summary TEXT,
        scheduled_task_ids TEXT,
        morning_climate_snapshot TEXT,
        telegram_notified INTEGER NOT NULL DEFAULT 0,
        calendar_created INTEGER NOT NULL DEFAULT 0,
        checkin_sent INTEGER NOT NULL DEFAULT 0,
        checkin_resolved INTEGER NOT NULL DEFAULT 0,
        weather_alert_sent INTEGER NOT NULL DEFAULT 0,
        weather_alert_acknowledged INTEGER NOT NULL DEFAULT 0,
        weather_alert_retry_count INTEGER NOT NULL DEFAULT 0,
        weather_alert_last_sent_at TEXT,
        weather_alert_message TEXT,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, eval_date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    dbInstance.exec(`
      INSERT OR IGNORE INTO daily_logs_new (
        user_id, eval_date, status, block_reason, window_start, window_end, net_work_hours,
        tasks_summary, scheduled_task_ids, morning_climate_snapshot, telegram_notified,
        calendar_created, checkin_sent, checkin_resolved, weather_alert_sent,
        weather_alert_acknowledged, weather_alert_retry_count, weather_alert_last_sent_at,
        weather_alert_message, updated_at
      )
      SELECT
        ${defaultUserId} as user_id, eval_date, status, block_reason, window_start, window_end, net_work_hours,
        tasks_summary, scheduled_task_ids, morning_climate_snapshot, telegram_notified,
        calendar_created, checkin_sent, checkin_resolved, weather_alert_sent,
        weather_alert_acknowledged, weather_alert_retry_count, weather_alert_last_sent_at,
        weather_alert_message, updated_at
      FROM daily_logs;
    `);
    dbInstance.exec("DROP TABLE daily_logs;");
    dbInstance.exec("ALTER TABLE daily_logs_new RENAME TO daily_logs;");
  }

  // Ensure project_id column exists in tasks and materials and backfill defaults if missing
  const currentTasksCols = dbInstance.prepare("PRAGMA table_info(tasks)").all() as any[];
  if (!currentTasksCols.some(c => c.name === 'project_id')) {
    dbInstance.exec("ALTER TABLE tasks ADD COLUMN project_id INTEGER;");
  }
  if (!currentTasksCols.some(c => c.name === 'is_active')) {
    dbInstance.exec("ALTER TABLE tasks ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;");
  }

  const currentMaterialsCols = dbInstance.prepare("PRAGMA table_info(materials)").all() as any[];
  if (!currentMaterialsCols.some(c => c.name === 'project_id')) {
    dbInstance.exec("ALTER TABLE materials ADD COLUMN project_id INTEGER;");
  }

  const usersList = dbInstance.prepare("SELECT id FROM users").all() as any[];
  for (const u of usersList) {
    const uId = Number(u.id);
    let defaultProj = dbInstance.prepare("SELECT id FROM projects WHERE user_id = ? AND is_active = 1 LIMIT 1").get(uId) as any;
    if (!defaultProj) {
      defaultProj = dbInstance.prepare("SELECT id FROM projects WHERE user_id = ? LIMIT 1").get(uId) as any;
    }
    if (!defaultProj) {
      const ins = dbInstance.prepare("INSERT INTO projects (user_id, name, description, is_active) VALUES (?, 'Taller Principal', 'Proyecto por defecto', 1)").run(uId);
      defaultProj = { id: Number(ins.lastInsertRowid) };
    }
    const projId = Number(defaultProj.id);
    dbInstance.prepare("UPDATE tasks SET project_id = ? WHERE user_id = ? AND (project_id IS NULL OR project_id = 0)").run(projId, uId);
    dbInstance.prepare("UPDATE materials SET project_id = ? WHERE user_id = ? AND (project_id IS NULL OR project_id = 0)").run(projId, uId);
  }

  seedDefaultsIfEmpty(dbInstance);
  cleanupDuplicateTelegramChatIds(dbInstance);

  return dbInstance;
}

function cleanupDuplicateTelegramChatIds(db: Database.Database) {
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

export function closeDatabase(): void {
  if (dbInstance) {
    console.log("[DB] Closing SQLite database connection safely...");
    dbInstance.close();
    dbInstance = null;
  }
}

function seedDefaultsIfEmpty(db: Database.Database) {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@workshop.os').trim();
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';

  const userCountRow = db.prepare("SELECT COUNT(*) as count FROM users").get() as any;
  if (!userCountRow || userCountRow.count === 0) {
    const adminHash = hashPassword(adminPassword);
    const isDefault = adminPassword === 'Admin123!' || adminPassword === 'password123';
    db.prepare(
      "INSERT INTO users (email, password_hash, must_change_password, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).run(adminEmail.toLowerCase(), adminHash, isDefault ? 1 : 0);
    console.log(`[AUTH] Seeded initial admin user: ${adminEmail}`);
  } else {
    const userRow = db.prepare("SELECT id, password_hash FROM users WHERE LOWER(email) = LOWER(?)").get(adminEmail) as any;
    if (userRow) {
      const isCurrentValid = verifyPassword(adminPassword, userRow.password_hash as string);
      if (!isCurrentValid) {
        const newHash = hashPassword(adminPassword);
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, userRow.id);
        console.log(`[AUTH] Updated password hash for admin user: ${adminEmail}`);
      } else {
        console.log(`[AUTH] Verified admin user active: ${adminEmail}`);
      }
    }
  }

  const activeUser = db.prepare("SELECT id, password_hash FROM users WHERE LOWER(email) = LOWER(?)").get(adminEmail) as any;
  if (activeUser) {
    const isUsingDefaultCreds = verifyPassword('Admin123!', activeUser.password_hash) || verifyPassword('password123', activeUser.password_hash);
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
      ) VALUES (?, 9, 18, 80.0, -32.99, -71.27, 1.0, 1.0, 1.0, 4.0, 0.2, 19, 1, 1, 1, 1, 1);
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

export class SQLiteStore {
  private get db(): Database.Database {
    if (!dbInstance) {
      throw new Error("SQLite Database not initialized. Call initDatabase() first.");
    }
    return dbInstance;
  }

  // --- APP SETTINGS ---
  getAppSettings(userId: number): AppSettings {
    let row = this.db.prepare("SELECT * FROM app_settings WHERE user_id = ?").get(userId) as any;
    if (!row) {
      const defaultCalId = userId === 1 ? (process.env.GOOGLE_CALENDAR_ID || null) : null;
      const defaultCalEnabled = userId === 1 && Boolean(process.env.GOOGLE_CALENDAR_ID) ? 1 : 0;

      this.db.prepare(`
        INSERT INTO app_settings (
          user_id, operational_start_hour, operational_end_hour, max_humidity_percent,
          latitude, longitude, setup_hours, teardown_hours, min_work_hours,
          min_work_hours_unless_final, min_rain_precipitation_mm, checkin_hour,
          morning_eval_lead_hours, exclude_saturdays, exclude_sundays, exclude_holidays,
          require_curing_before_cutoff, telegram_chat_id, google_calendar_id, google_calendar_enabled
        ) VALUES (?, 9, 18, 80.0, -32.99, -71.27, 1.0, 1.0, 1.0, 4.0, 0.2, 19, 1, 1, 1, 1, 1, NULL, ?, ?);
      `).run(userId, defaultCalId, defaultCalEnabled);
      row = this.db.prepare("SELECT * FROM app_settings WHERE user_id = ?").get(userId) as any;
    }

    const telegramChatId = row.telegram_chat_id ? String(row.telegram_chat_id).trim() : null;

    let googleCalId = row.google_calendar_id ? String(row.google_calendar_id).trim() : null;
    if (!googleCalId && userId === 1 && process.env.GOOGLE_CALENDAR_ID) {
      googleCalId = process.env.GOOGLE_CALENDAR_ID.trim();
    }

    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    const computedTz = getTimezoneByCoords(lat, lon);
    const tz = row.timezone && String(row.timezone).trim() ? String(row.timezone).trim() : computedTz;

    if (!row.timezone || String(row.timezone).trim() !== tz) {
      try {
        this.db.prepare("UPDATE app_settings SET timezone = ? WHERE user_id = ?").run(tz, userId);
      } catch (_) {}
    }

    return {
      operational_start_hour: Number(row.operational_start_hour),
      operational_end_hour: Number(row.operational_end_hour),
      max_humidity_percent: Number(row.max_humidity_percent),
      latitude: lat,
      longitude: lon,
      setup_hours: Number(row.setup_hours),
      teardown_hours: Number(row.teardown_hours),
      min_work_hours: Number(row.min_work_hours),
      min_work_hours_unless_final: Number(row.min_work_hours_unless_final),
      min_rain_precipitation_mm: Number(row.min_rain_precipitation_mm),
      checkin_hour: Number(row.checkin_hour),
      morning_eval_lead_hours: Number(row.morning_eval_lead_hours),
      exclude_saturdays: Boolean(row.exclude_saturdays),
      exclude_sundays: Boolean(row.exclude_sundays),
      exclude_holidays: Boolean(row.exclude_holidays),
      require_curing_before_cutoff: Boolean(row.require_curing_before_cutoff),
      telegram_chat_id: telegramChatId,
      google_calendar_id: googleCalId,
      google_calendar_enabled: Boolean(row.google_calendar_enabled || (userId === 1 && process.env.GOOGLE_CALENDAR_ID)),
      timezone: tz
    };
  }

  updateAppSettings(userId: number, data: Partial<AppSettings>): AppSettings {
    const current = this.getAppSettings(userId);
    const updated = { ...current, ...data };

    const updatedLat = Number(updated.latitude);
    const updatedLon = Number(updated.longitude);
    const computedTz = getTimezoneByCoords(updatedLat, updatedLon);
    const tz = data.timezone && String(data.timezone).trim() ? String(data.timezone).trim() : computedTz;
    updated.timezone = tz;

    const newChatId = updated.telegram_chat_id ? String(updated.telegram_chat_id).trim() : null;
    if (newChatId) {
      // Unlink telegram_chat_id from any other user to guarantee single-user uniqueness
      this.db.prepare(
        "UPDATE app_settings SET telegram_chat_id = NULL WHERE CAST(telegram_chat_id AS TEXT) = ? AND user_id != ?"
      ).run(newChatId, userId);
    }

    this.db.prepare(
      `UPDATE app_settings SET
        operational_start_hour = ?,
        operational_end_hour = ?,
        max_humidity_percent = ?,
        latitude = ?,
        longitude = ?,
        setup_hours = ?,
        teardown_hours = ?,
        min_work_hours = ?,
        min_work_hours_unless_final = ?,
        min_rain_precipitation_mm = ?,
        checkin_hour = ?,
        morning_eval_lead_hours = ?,
        exclude_saturdays = ?,
        exclude_sundays = ?,
        exclude_holidays = ?,
        require_curing_before_cutoff = ?,
        telegram_chat_id = ?,
        google_calendar_id = ?,
        google_calendar_enabled = ?,
        timezone = ?
      WHERE user_id = ?;`
    ).run(
      updated.operational_start_hour,
      updated.operational_end_hour,
      updated.max_humidity_percent,
      updated.latitude,
      updated.longitude,
      updated.setup_hours,
      updated.teardown_hours,
      updated.min_work_hours,
      updated.min_work_hours_unless_final,
      updated.min_rain_precipitation_mm,
      updated.checkin_hour,
      updated.morning_eval_lead_hours,
      updated.exclude_saturdays ? 1 : 0,
      updated.exclude_sundays ? 1 : 0,
      updated.exclude_holidays ? 1 : 0,
      updated.require_curing_before_cutoff ? 1 : 0,
      newChatId,
      updated.google_calendar_id ? String(updated.google_calendar_id).trim() : null,
      updated.google_calendar_enabled ? 1 : 0,
      updated.timezone,
      userId
    );

    return updated;
  }

  getUserByTelegramChatId(telegramChatId: string | number): { id: number; email: string } | undefined {
    if (telegramChatId === undefined || telegramChatId === null || telegramChatId === "") return undefined;
    const chatStr = String(telegramChatId).trim();
    if (!chatStr) return undefined;

    const rows = this.db.prepare(`
      SELECT u.id, u.email
      FROM users u
      JOIN app_settings s ON s.user_id = u.id
      WHERE CAST(s.telegram_chat_id AS TEXT) = ?
      ORDER BY u.id DESC
    `).all(chatStr) as any[];

    if (rows.length > 0) {
      const primary = rows[0];
      if (rows.length > 1) {
        const duplicateUserIds = rows.slice(1).map(r => Number(r.id));
        for (const dupId of duplicateUserIds) {
          this.db.prepare("UPDATE app_settings SET telegram_chat_id = NULL WHERE user_id = ?").run(dupId);
        }
        console.warn(`[DB] Cleaned duplicate telegram_chat_id (${chatStr}) from duplicate user(s): ${duplicateUserIds.join(', ')}. Retained for active user #${primary.id}`);
      }
      return { id: Number(primary.id), email: String(primary.email) };
    }

    return undefined;
  }

  /**
   * Genera un código de vinculación de un solo uso para Telegram (flujo OTP).
   * Invalida cualquier código previo sin usar de ese mismo usuario, para que solo
   * el más reciente sea válido.
   */
  generateTelegramLinkCode(userId: number): { code: string; expiresAt: string } {
    // Invalidar códigos previos no usados de este usuario (borrado directo, más simple
    // que marcarlos "usados" ya que de todas formas van a expirar solos).
    this.db.prepare("DELETE FROM telegram_link_codes WHERE user_id = ? AND used_at IS NULL").run(userId);

    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 dígitos, 100000-999999
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutos

    this.db.prepare(
      "INSERT INTO telegram_link_codes (user_id, code, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).run(userId, code, expiresAt, nowIso);

    return { code, expiresAt };
  }

  /**
   * Consume un código de vinculación: si es válido y no expiró, vincula el chatId
   * al usuario dueño del código (reusando la misma lógica de unicidad de siempre)
   * y marca el código como usado para que no se pueda reintentar.
   * Devuelve success:false con mensaje genérico si el código no existe o expiró,
   * sin distinguir esos dos casos hacia afuera (para no dar pistas de fuerza bruta).
   */
  consumeTelegramLinkCode(code: string, chatId: string): { success: boolean; userId?: number; email?: string; error?: string } {
    const trimmedCode = String(code).trim();
    if (!trimmedCode) return { success: false, error: "Código inválido o expirado. Generá uno nuevo desde la app." };

    const row = this.db.prepare(
      "SELECT id, user_id, expires_at FROM telegram_link_codes WHERE code = ? AND used_at IS NULL"
    ).get(trimmedCode) as any;

    if (!row) {
      return { success: false, error: "Código inválido o expirado. Generá uno nuevo desde la app." };
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { success: false, error: "Código inválido o expirado. Generá uno nuevo desde la app." };
    }

    const userId = Number(row.user_id);
    const chatStr = String(chatId).trim();

    // Misma lógica de unicidad que ya existía: desvincula ese chat_id de cualquier
    // otro usuario antes de asignarlo, para garantizar 1 chat = 1 usuario.
    this.db.prepare(
      "UPDATE app_settings SET telegram_chat_id = NULL WHERE CAST(telegram_chat_id AS TEXT) = ? AND user_id != ?"
    ).run(chatStr, userId);

    this.db.prepare("UPDATE app_settings SET telegram_chat_id = ? WHERE user_id = ?").run(chatStr, userId);

    this.db.prepare("UPDATE telegram_link_codes SET used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);

    const userRow = this.db.prepare("SELECT email FROM users WHERE id = ?").get(userId) as any;

    return { success: true, userId, email: userRow ? String(userRow.email) : undefined };
  }

  // --- PROJECTS ---
  getProjects(userId: number): Project[] {
    const rows = this.db.prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY id ASC").all(userId) as any[];
    return rows.map(row => ({
      id: Number(row.id),
      name: String(row.name),
      description: row.description || "",
      is_active: Boolean(row.is_active)
    }));
  }

  getActiveProject(userId: number): Project {
    const projects = this.getProjects(userId);
    const active = projects.find(p => p.is_active);
    if (active) return active;
    if (projects.length > 0) return projects[0];

    const info = this.db.prepare(
      "INSERT INTO projects (user_id, name, description, is_active) VALUES (?, 'Taller Principal', 'Proyecto por defecto', 1)"
    ).run(userId);
    return { id: Number(info.lastInsertRowid), name: "Taller Principal", description: "Proyecto por defecto", is_active: true };
  }

  addProject(userId: number, name: string, description?: string): Project {
    this.db.prepare("UPDATE projects SET is_active = 0 WHERE user_id = ?").run(userId);
    const info = this.db.prepare(
      "INSERT INTO projects (user_id, name, description, is_active) VALUES (?, ?, ?, 1)"
    ).run(userId, name, description || "");
    return { id: Number(info.lastInsertRowid), name, description: description || "", is_active: true };
  }

  setActiveProject(userId: number, projectId: number): Project | null {
    const proj = this.db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId) as any;
    if (!proj) return null;
    this.db.prepare("UPDATE projects SET is_active = 0 WHERE user_id = ?").run(userId);
    this.db.prepare("UPDATE projects SET is_active = 1 WHERE id = ? AND user_id = ?").run(projectId, userId);
    return { id: Number(proj.id), name: String(proj.name), description: proj.description || "", is_active: true };
  }

  toggleProjectActive(userId: number, projectId: number, isActive?: boolean): Project | null {
    const proj = this.db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId) as any;
    if (!proj) return null;
    const newActive = isActive !== undefined ? (isActive ? 1 : 0) : (proj.is_active ? 0 : 1);
    this.db.prepare("UPDATE projects SET is_active = ? WHERE id = ? AND user_id = ?").run(newActive, projectId, userId);
    return { id: Number(proj.id), name: String(proj.name), description: proj.description || "", is_active: Boolean(newActive) };
  }

  // --- TASKS ---
  private rowToTask(row: any): Task {
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
      is_active: row.is_active !== undefined && row.is_active !== null ? Boolean(row.is_active) : true
    };
  }

  getTasks(userId: number): Task[] {
    const rows = this.db.prepare(`
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
    const rows = this.db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.user_id = ? AND p.is_active = 1 AND (t.is_active IS NULL OR t.is_active = 1) AND t.status != 'completed'
      ORDER BY t.order_num ASC, t.id ASC
    `).all(userId);
    return rows.map(row => this.rowToTask(row));
  }

  getPendingTasksForProject(userId: number, projectId: number): Task[] {
    const rows = this.db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.user_id = ? AND t.project_id = ? AND (t.is_active IS NULL OR t.is_active = 1) AND t.status != 'completed'
      ORDER BY t.order_num ASC, t.id ASC
    `).all(userId, projectId);
    return rows.map(row => this.rowToTask(row));
  }

  getTask(userId: number, id: number): Task | null {
    const row = this.db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.id = ? AND t.user_id = ?
    `).get(id, userId);
    if (!row) return null;
    return this.rowToTask(row);
  }

  getTaskGlobal(id: number): Task | null {
    const row = this.db.prepare(`
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
    this.db.prepare("UPDATE tasks SET is_active = ? WHERE id = ? AND user_id = ?").run(newActive, taskId, userId);
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
  }): Task {
    const activeProject = this.getActiveProject(userId);
    const pId = taskData.project_id || activeProject.id;
    const cat = taskData.category || TaskCategory.CARPENTRY;
    const est = taskData.estimated_hours !== undefined ? taskData.estimated_hours : 1.0;

    let defaultCuring = 0.0;
    if (cat === TaskCategory.PVA_GLUE) defaultCuring = 4.0;
    else if (cat === TaskCategory.VARNISH_PAINT) defaultCuring = 6.0;
    else if (cat === TaskCategory.EPOXY) defaultCuring = 12.0;

    const cur = taskData.curing_hours !== undefined ? taskData.curing_hours : defaultCuring;
    const reqCurInt = computeRequiresCuring(cat, cur) ? 1 : 0;

    let ord = taskData.order;
    if (ord === undefined) {
      const maxRow = this.db.prepare("SELECT MAX(order_num) as max_ord FROM tasks WHERE user_id = ? AND project_id = ?").get(userId, pId) as any;
      ord = (maxRow && maxRow.max_ord != null ? Number(maxRow.max_ord) : 0) + 1;
    }

    const info = this.db.prepare(
      `INSERT INTO tasks (user_id, project_id, title, description, category, estimated_hours, curing_hours, requires_curing, status, progress_percentage, order_num)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?);`
    ).run(userId, pId, taskData.title, taskData.description || "", cat, est, cur, reqCurInt, ord);

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

      this.db.prepare(
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
          is_active = ?
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

    this.db.prepare(
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
    const res = this.db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").run(id, userId);
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
    const stmt = this.db.prepare("UPDATE tasks SET order_num = ? WHERE id = ? AND user_id = ?");
    const transaction = this.db.transaction((ids: number[]) => {
      ids.forEach((id, index) => {
        stmt.run(index + 1, id, userId);
      });
    });
    transaction(taskIds);
    return true;
  }

  getRecentCompletedHistory(userId: number): Task[] {
    const rows = this.db.prepare(
      "SELECT * FROM tasks WHERE user_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 10"
    ).all(userId);
    return rows.map(r => this.rowToTask(r));
  }

  getCompletedRecently(userId: number): Task[] {
    return this.getRecentCompletedHistory(userId);
  }

  // --- TASK HISTORY / AUTOCOMPLETE ---
  getTaskHistory(userId: number): Array<{ title: string; category: TaskCategory; estimated_hours: number; curing_hours: number }> {
    const rows = this.db.prepare(`
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

  // --- FAVORITES (DEPRECATED / COMPAT) ---
  getFavoriteTasks(userId: number): FavoriteTask[] {
    const rows = this.db.prepare("SELECT * FROM favorites WHERE user_id = ? ORDER BY id ASC").all(userId) as any[];
    return rows.map(row => ({
      id: Number(row.id),
      title: String(row.title),
      category: row.category as TaskCategory,
      estimated_hours: Number(row.estimated_hours),
      curing_hours: Number(row.curing_hours)
    }));
  }

  addFavoriteTask(userId: number, data: Partial<FavoriteTask>): FavoriteTask {
    const title = data.title || "Favorito";
    const cat = data.category || TaskCategory.CARPENTRY;
    const est = data.estimated_hours || 1.0;
    const cur = data.curing_hours || 0.0;

    const info = this.db.prepare(
      "INSERT INTO favorites (user_id, title, category, estimated_hours, curing_hours) VALUES (?, ?, ?, ?, ?);"
    ).run(userId, title, cat, est, cur);

    const favs = this.getFavoriteTasks(userId);
    return favs.find(f => f.id === Number(info.lastInsertRowid)) || favs[favs.length - 1];
  }

  deleteFavoriteTask(userId: number, id: number): boolean {
    const res = this.db.prepare("DELETE FROM favorites WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
  }

  deleteFavorite(userId: number, id: number): boolean {
    return this.deleteFavoriteTask(userId, id);
  }

  // --- DAY OVERRIDES ---
  getDayOverride(userId: number, overrideDate: string): DayOverride | undefined {
    const row = this.db.prepare("SELECT * FROM day_overrides WHERE user_id = ? AND override_date = ?").get(userId, overrideDate) as any;
    if (!row) return undefined;

    return {
      id: Number(row.id),
      override_date: String(row.override_date),
      force_status: row.force_status || null,
      custom_start_hour: row.custom_start_hour != null ? Number(row.custom_start_hour) : null,
      custom_end_hour: row.custom_end_hour != null ? Number(row.custom_end_hour) : null,
      removed_task_ids: row.removed_task_ids || null,
      note: row.note || "",
      updated_at: row.updated_at || undefined
    };
  }

  saveDayOverride(
    userId: number,
    overrideDate: string,
    data: {
      force_status?: "VIABLE" | "BLOCKED" | null;
      custom_start_hour?: number | null;
      custom_end_hour?: number | null;
      removed_task_ids?: number[] | string | null;
      note?: string | null;
    }
  ): DayOverride {
    let removedStr: string | null = null;
    if (Array.isArray(data.removed_task_ids)) {
      removedStr = JSON.stringify(data.removed_task_ids);
    } else if (typeof data.removed_task_ids === "string") {
      removedStr = data.removed_task_ids;
    }

    const nowIso = new Date().toISOString();
    const existing = this.getDayOverride(userId, overrideDate);

    if (existing) {
      this.db.prepare(
        `UPDATE day_overrides SET
          force_status = ?,
          custom_start_hour = ?,
          custom_end_hour = ?,
          removed_task_ids = ?,
          note = ?,
          updated_at = ?
        WHERE user_id = ? AND override_date = ?;`
      ).run(
        data.force_status || null,
        data.custom_start_hour ?? null,
        data.custom_end_hour ?? null,
        removedStr,
        data.note || "",
        nowIso,
        userId,
        overrideDate
      );
    } else {
      this.db.prepare(
        `INSERT INTO day_overrides (user_id, override_date, force_status, custom_start_hour, custom_end_hour, removed_task_ids, note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`
      ).run(
        userId,
        overrideDate,
        data.force_status || null,
        data.custom_start_hour ?? null,
        data.custom_end_hour ?? null,
        removedStr,
        data.note || "",
        nowIso
      );
    }

    return this.getDayOverride(userId, overrideDate)!;
  }

  clearDayOverride(userId: number, overrideDate: string): boolean {
    const res = this.db.prepare("DELETE FROM day_overrides WHERE user_id = ? AND override_date = ?").run(userId, overrideDate);
    return res.changes > 0;
  }

  // --- FORCED TASKS ---
  getForcedTasksForDate(userId: number, dateIso: string): { id: number; forced_id: number; task_id: number; forced_start_hour: number; task: Task }[] {
    const rows = this.db.prepare("SELECT * FROM forced_tasks WHERE user_id = ? AND forced_date = ?").all(userId, dateIso) as any[];
    const output: { id: number; forced_id: number; task_id: number; forced_start_hour: number; task: Task }[] = [];

    for (const row of rows) {
      const task = this.getTask(userId, Number(row.task_id));
      if (task) {
        output.push({
          id: Number(row.id),
          forced_id: Number(row.id),
          task_id: Number(row.task_id),
          forced_start_hour: Number(row.forced_start_hour),
          task
        });
      }
    }
    return output;
  }

  addForcedTask(userId: number, dateIso: string, taskId: number, forcedStartHour: number): ForcedTask {
    const info = this.db.prepare("INSERT INTO forced_tasks (user_id, forced_date, task_id, forced_start_hour) VALUES (?, ?, ?, ?);").run(
      userId,
      dateIso,
      taskId,
      forcedStartHour
    );

    const row = this.db.prepare("SELECT * FROM forced_tasks WHERE id = ?").get(info.lastInsertRowid) as any;
    return {
      id: Number(row.id),
      forced_date: String(row.forced_date),
      task_id: Number(row.task_id),
      forced_start_hour: Number(row.forced_start_hour)
    };
  }

  deleteForcedTask(userId: number, id: number): boolean {
    const res = this.db.prepare("DELETE FROM forced_tasks WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
  }

  // --- DAILY LOGS ---
  getDailyLogByDate(userId: number, evalDate: string): DailyLog | null {
    const row = this.db.prepare("SELECT * FROM daily_logs WHERE user_id = ? AND eval_date = ?").get(userId, evalDate) as any;
    if (!row) return null;

    return {
      id: Number(row.id),
      user_id: Number(row.user_id),
      eval_date: String(row.eval_date),
      status: row.status as DayStatus,
      block_reason: row.block_reason || null,
      window_start: row.window_start || null,
      window_end: row.window_end || null,
      net_work_hours: row.net_work_hours != null ? Number(row.net_work_hours) : null,
      tasks_summary: row.tasks_summary || null,
      scheduled_task_ids: row.scheduled_task_ids || null,
      morning_climate_snapshot: row.morning_climate_snapshot || null,
      telegram_notified: Boolean(row.telegram_notified),
      calendar_created: Boolean(row.calendar_created),
      google_event_id: row.google_event_id ? String(row.google_event_id) : null,
      checkin_sent: Boolean(row.checkin_sent),
      checkin_resolved: Boolean(row.checkin_resolved),
      weather_alert_sent: Boolean(row.weather_alert_sent),
      weather_alert_acknowledged: Boolean(row.weather_alert_acknowledged),
      weather_alert_retry_count: Number(row.weather_alert_retry_count || 0),
      weather_alert_last_sent_at: row.weather_alert_last_sent_at || null,
      weather_alert_message: row.weather_alert_message || null,
      intraday_alert_triggered: Boolean(row.intraday_alert_triggered),
      intraday_alert_acknowledged: Boolean(row.intraday_alert_acknowledged),
      intraday_alert_last_sent_at: row.intraday_alert_last_sent_at || null,
      intraday_alert_burst_count: Number(row.intraday_alert_burst_count || 0),
      updated_at: String(row.updated_at)
    };
  }

  getDailyLogById(userId: number, id: number): DailyLog | null {
    const row = this.db.prepare("SELECT * FROM daily_logs WHERE id = ? AND user_id = ?").get(id, userId) as any;
    if (!row) return null;

    return {
      id: Number(row.id),
      user_id: Number(row.user_id),
      eval_date: String(row.eval_date),
      status: row.status as DayStatus,
      block_reason: row.block_reason || null,
      window_start: row.window_start || null,
      window_end: row.window_end || null,
      net_work_hours: row.net_work_hours != null ? Number(row.net_work_hours) : null,
      tasks_summary: row.tasks_summary || null,
      scheduled_task_ids: row.scheduled_task_ids || null,
      morning_climate_snapshot: row.morning_climate_snapshot || null,
      telegram_notified: Boolean(row.telegram_notified),
      calendar_created: Boolean(row.calendar_created),
      google_event_id: row.google_event_id ? String(row.google_event_id) : null,
      checkin_sent: Boolean(row.checkin_sent),
      checkin_resolved: Boolean(row.checkin_resolved),
      weather_alert_sent: Boolean(row.weather_alert_sent),
      weather_alert_acknowledged: Boolean(row.weather_alert_acknowledged),
      weather_alert_retry_count: Number(row.weather_alert_retry_count || 0),
      weather_alert_last_sent_at: row.weather_alert_last_sent_at || null,
      weather_alert_message: row.weather_alert_message || null,
      intraday_alert_triggered: Boolean(row.intraday_alert_triggered),
      intraday_alert_acknowledged: Boolean(row.intraday_alert_acknowledged),
      intraday_alert_last_sent_at: row.intraday_alert_last_sent_at || null,
      intraday_alert_burst_count: Number(row.intraday_alert_burst_count || 0),
      updated_at: String(row.updated_at)
    };
  }

  getDailyLogByIdGlobal(id: number): (DailyLog & { user_id: number }) | null {
    const row = this.db.prepare("SELECT * FROM daily_logs WHERE id = ?").get(id) as any;
    if (!row) return null;

    return {
      id: Number(row.id),
      user_id: Number(row.user_id),
      eval_date: String(row.eval_date),
      status: row.status as DayStatus,
      block_reason: row.block_reason || null,
      window_start: row.window_start || null,
      window_end: row.window_end || null,
      net_work_hours: row.net_work_hours != null ? Number(row.net_work_hours) : null,
      tasks_summary: row.tasks_summary || null,
      scheduled_task_ids: row.scheduled_task_ids || null,
      morning_climate_snapshot: row.morning_climate_snapshot || null,
      telegram_notified: Boolean(row.telegram_notified),
      calendar_created: Boolean(row.calendar_created),
      google_event_id: row.google_event_id ? String(row.google_event_id) : null,
      checkin_sent: Boolean(row.checkin_sent),
      checkin_resolved: Boolean(row.checkin_resolved),
      weather_alert_sent: Boolean(row.weather_alert_sent),
      weather_alert_acknowledged: Boolean(row.weather_alert_acknowledged),
      weather_alert_retry_count: Number(row.weather_alert_retry_count || 0),
      weather_alert_last_sent_at: row.weather_alert_last_sent_at || null,
      weather_alert_message: row.weather_alert_message || null,
      intraday_alert_triggered: Boolean(row.intraday_alert_triggered),
      intraday_alert_acknowledged: Boolean(row.intraday_alert_acknowledged),
      intraday_alert_last_sent_at: row.intraday_alert_last_sent_at || null,
      intraday_alert_burst_count: Number(row.intraday_alert_burst_count || 0),
      updated_at: String(row.updated_at)
    };
  }

  saveDailyLog(userId: number, logData: Partial<DailyLog> & { eval_date: string; status: DayStatus }): DailyLog {
    const nowIso = new Date().toISOString();
    const existing = this.getDailyLogByDate(userId, logData.eval_date);

    if (existing) {
      return this.updateDailyLog(userId, existing.id, logData)!;
    }

    this.db.prepare(
      `INSERT INTO daily_logs (
        user_id, eval_date, status, block_reason, window_start, window_end, net_work_hours,
        tasks_summary, scheduled_task_ids, morning_climate_snapshot,
        telegram_notified, calendar_created, google_event_id, checkin_sent, checkin_resolved,
        weather_alert_sent, weather_alert_acknowledged, weather_alert_retry_count,
        weather_alert_last_sent_at, weather_alert_message,
        intraday_alert_triggered, intraday_alert_acknowledged, intraday_alert_last_sent_at, intraday_alert_burst_count,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
    ).run(
      userId,
      logData.eval_date,
      logData.status,
      logData.block_reason || null,
      logData.window_start || null,
      logData.window_end || null,
      logData.net_work_hours ?? null,
      logData.tasks_summary || null,
      logData.scheduled_task_ids || null,
      logData.morning_climate_snapshot || null,
      logData.telegram_notified ? 1 : 0,
      logData.calendar_created ? 1 : 0,
      logData.google_event_id || null,
      logData.checkin_sent ? 1 : 0,
      logData.checkin_resolved ? 1 : 0,
      logData.weather_alert_sent ? 1 : 0,
      logData.weather_alert_acknowledged ? 1 : 0,
      logData.weather_alert_retry_count || 0,
      logData.weather_alert_last_sent_at || null,
      logData.weather_alert_message || null,
      logData.intraday_alert_triggered ? 1 : 0,
      logData.intraday_alert_acknowledged ? 1 : 0,
      logData.intraday_alert_last_sent_at || null,
      logData.intraday_alert_burst_count || 0,
      nowIso
    );

    return this.getDailyLogByDate(userId, logData.eval_date)!;
  }

  updateDailyLog(userId: number, id: number, data: Partial<DailyLog>): DailyLog | null {
    const existing = this.getDailyLogById(userId, id);
    if (!existing) return null;

    const updated = { ...existing, ...data, updated_at: new Date().toISOString() };

    this.db.prepare(
      `UPDATE daily_logs SET
        status = ?,
        block_reason = ?,
        window_start = ?,
        window_end = ?,
        net_work_hours = ?,
        tasks_summary = ?,
        scheduled_task_ids = ?,
        morning_climate_snapshot = ?,
        telegram_notified = ?,
        calendar_created = ?,
        google_event_id = ?,
        checkin_sent = ?,
        checkin_resolved = ?,
        weather_alert_sent = ?,
        weather_alert_acknowledged = ?,
        weather_alert_retry_count = ?,
        weather_alert_last_sent_at = ?,
        weather_alert_message = ?,
        intraday_alert_triggered = ?,
        intraday_alert_acknowledged = ?,
        intraday_alert_last_sent_at = ?,
        intraday_alert_burst_count = ?,
        updated_at = ?
      WHERE id = ? AND user_id = ?;`
    ).run(
      updated.status,
      updated.block_reason || null,
      updated.window_start || null,
      updated.window_end || null,
      updated.net_work_hours ?? null,
      updated.tasks_summary || null,
      updated.scheduled_task_ids || null,
      updated.morning_climate_snapshot || null,
      updated.telegram_notified ? 1 : 0,
      updated.calendar_created ? 1 : 0,
      updated.google_event_id || null,
      updated.checkin_sent ? 1 : 0,
      updated.checkin_resolved ? 1 : 0,
      updated.weather_alert_sent ? 1 : 0,
      updated.weather_alert_acknowledged ? 1 : 0,
      updated.weather_alert_retry_count,
      updated.weather_alert_last_sent_at || null,
      updated.weather_alert_message || null,
      updated.intraday_alert_triggered ? 1 : 0,
      updated.intraday_alert_acknowledged ? 1 : 0,
      updated.intraday_alert_last_sent_at || null,
      updated.intraday_alert_burst_count || 0,
      updated.updated_at,
      id,
      userId
    );

    return this.getDailyLogById(userId, id);
  }

  /**
   * Reserva atómica antes de crear/actualizar/borrar un evento en Google Calendar.
   * Evita eventos duplicados si dos evaluaciones (Tier 1) llegan a solaparse en el tiempo:
   * sin esto, ambas leerían "sin evento" y crearían uno cada una, porque entre leer
   * google_event_id y guardarlo hay una llamada HTTP a Google de por medio (bug detectado
   * en producción, ago 2026).
   *
   * El lock expira solo a los LOCK_TTL_MS (por si el proceso crashea justo con el lock
   * tomado y nunca llega a liberarlo) para no dejar el día bloqueado para siempre.
   *
   * Devuelve true si esta llamada ganó la reserva, false si ya estaba tomada por otra
   * corrida que sigue vigente.
   */
  claimCalendarSync(userId: number, dailyLogId: number): boolean {
    const LOCK_TTL_MS = 2 * 60 * 1000; // 2 minutos: de sobra para una llamada HTTP a Google
    const nowIso = new Date().toISOString();
    const staleThresholdIso = new Date(Date.now() - LOCK_TTL_MS).toISOString();

    const result = this.db.prepare(
      `UPDATE daily_logs SET calendar_sync_claimed_at = ?
       WHERE id = ? AND user_id = ?
         AND (calendar_sync_claimed_at IS NULL OR calendar_sync_claimed_at < ?)`
    ).run(nowIso, dailyLogId, userId, staleThresholdIso);

    return result.changes === 1;
  }

  releaseCalendarSync(userId: number, dailyLogId: number): void {
    this.db.prepare(
      "UPDATE daily_logs SET calendar_sync_claimed_at = NULL WHERE id = ? AND user_id = ?"
    ).run(dailyLogId, userId);
  }

  updateDailyLogGlobal(id: number, data: Partial<DailyLog>): DailyLog | null {
    const existing = this.getDailyLogByIdGlobal(id);
    if (!existing) return null;

    const updated = { ...existing, ...data, updated_at: new Date().toISOString() };

    this.db.prepare(
      `UPDATE daily_logs SET
        status = ?,
        block_reason = ?,
        window_start = ?,
        window_end = ?,
        net_work_hours = ?,
        tasks_summary = ?,
        scheduled_task_ids = ?,
        morning_climate_snapshot = ?,
        telegram_notified = ?,
        calendar_created = ?,
        google_event_id = ?,
        checkin_sent = ?,
        checkin_resolved = ?,
        weather_alert_sent = ?,
        weather_alert_acknowledged = ?,
        weather_alert_retry_count = ?,
        weather_alert_last_sent_at = ?,
        weather_alert_message = ?,
        intraday_alert_triggered = ?,
        intraday_alert_acknowledged = ?,
        intraday_alert_last_sent_at = ?,
        intraday_alert_burst_count = ?,
        updated_at = ?
      WHERE id = ?;`
    ).run(
      updated.status,
      updated.block_reason || null,
      updated.window_start || null,
      updated.window_end || null,
      updated.net_work_hours ?? null,
      updated.tasks_summary || null,
      updated.scheduled_task_ids || null,
      updated.morning_climate_snapshot || null,
      updated.telegram_notified ? 1 : 0,
      updated.calendar_created ? 1 : 0,
      updated.google_event_id || null,
      updated.checkin_sent ? 1 : 0,
      updated.checkin_resolved ? 1 : 0,
      updated.weather_alert_sent ? 1 : 0,
      updated.weather_alert_acknowledged ? 1 : 0,
      updated.weather_alert_retry_count,
      updated.weather_alert_last_sent_at || null,
      updated.weather_alert_message || null,
      updated.intraday_alert_triggered ? 1 : 0,
      updated.intraday_alert_acknowledged ? 1 : 0,
      updated.intraday_alert_last_sent_at || null,
      updated.intraday_alert_burst_count || 0,
      updated.updated_at,
      id
    );

    return this.getDailyLogByIdGlobal(id);
  }

  // --- PROJECT TEMPLATES ---
  getProjectTemplates(userId: number): ProjectTemplate[] {
    const rows = this.db.prepare("SELECT * FROM project_templates WHERE user_id = ? ORDER BY id DESC").all(userId) as any[];
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
    const row = this.db.prepare("SELECT * FROM project_templates WHERE id = ? AND user_id = ?").get(id, userId) as any;
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
    const rows = this.db.prepare(
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

  createProjectTemplateFromBacklog(userId: number, name: string, description?: string, projectId?: number): ProjectTemplate {
    const pId = projectId ?? this.getActiveProject(userId).id;
    const pendingTasks = this.getPendingTasksForProject(userId, pId);
    const nowIso = new Date().toISOString();

    const info = this.db.prepare("INSERT INTO project_templates (user_id, name, description, created_at) VALUES (?, ?, ?, ?);").run(
      userId,
      name,
      description || "",
      nowIso
    );
    const templateId = Number(info.lastInsertRowid);

    const itemStmt = this.db.prepare(
      `INSERT INTO project_template_items (user_id, template_id, title, description, category, estimated_hours, curing_hours, order_num)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`
    );

    pendingTasks.forEach((t, idx) => {
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

  applyProjectTemplate(userId: number, templateId: number, projectId?: number): Task[] {
    const template = this.getProjectTemplate(userId, templateId);
    if (!template || !template.items || template.items.length === 0) return [];

    const pId = projectId ?? this.getActiveProject(userId).id;
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

  deleteProjectTemplate(userId: number, id: number): boolean {
    this.db.prepare("DELETE FROM project_template_items WHERE template_id = ? AND user_id = ?").run(id, userId);
    const res = this.db.prepare("DELETE FROM project_templates WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
  }

  // Backup database using SQLite native VACUUM INTO
  backupDatabase(destinationPath?: string): string {
    ensureDbDirExists();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = destinationPath || path.join(DB_DIR, `backup-${timestamp}.db`);
    this.db.prepare("VACUUM INTO ?").run(dest);
    console.log(`[DB BACKUP] Consistent WAL database backup generated at: ${dest}`);
    return dest;
  }

  // Users Management
  getAllUsers(): User[] {
    const rows = this.db.prepare("SELECT * FROM users ORDER BY id ASC").all() as any[];
    return rows.map(row => ({
      id: Number(row.id),
      email: String(row.email),
      password_hash: String(row.password_hash),
      must_change_password: Boolean(row.must_change_password),
      created_at: String(row.created_at)
    }));
  }

  getUserByEmail(email: string): User | null {
    const row = this.db.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?)").get(email.trim()) as any;
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
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as any;
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
    this.db.prepare(
      "INSERT INTO users (email, password_hash, must_change_password, created_at) VALUES (?, ?, 0, datetime('now'));"
    ).run(email.toLowerCase().trim(), passwordHash);
    return this.getUserByEmail(email)!;
  }

  updateUserPassword(userId: number, passwordHash: string): boolean {
    const res = this.db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?;"
    ).run(passwordHash, userId);
    return res.changes > 0;
  }

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

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToMaterial(r));
  }

  getMaterial(userId: number, id: number): Material | null {
    const row = this.db.prepare(`
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
    const pId = data.project_id || this.getActiveProject(userId).id;
    const nowIso = new Date().toISOString();
    let statusVal = data.status || MaterialStatus.TO_BUY;
    if (statusVal !== MaterialStatus.IN_STOCK && statusVal !== MaterialStatus.OUT_OF_STOCK) {
      statusVal = MaterialStatus.TO_BUY;
    }

    const info = this.db.prepare(`
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

    this.db.prepare(`
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
    const res = this.db.prepare("DELETE FROM materials WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
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
    let sql = `SELECT * FROM tools WHERE user_id = ?`;
    const params: any[] = [userId];
    if (category) {
      sql += ` AND category = ?`;
      params.push(category);
    }
    sql += ` ORDER BY category ASC, name ASC`;
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToTool(r));
  }

  getTool(userId: number, id: number): Tool | null {
    const row = this.db.prepare(`SELECT * FROM tools WHERE id = ? AND user_id = ?`).get(id, userId) as any;
    if (!row) return null;
    return this.rowToTool(row);
  }

  addTool(userId: number, data: { name: string; category?: string; status?: string; notes?: string }): Tool {
    const nowIso = new Date().toISOString();
    const info = this.db.prepare(`
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

    this.db.prepare(`
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
    const res = this.db.prepare("DELETE FROM tools WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
  }

  importMaterialsFromJson(userId: number, materialsList: any[], projectId?: number): Material[] {
    const targetProjId = projectId || this.getActiveProject(userId).id;
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

  getPendingMaterialsForActiveProjects(userId: number): { project_name: string; materials: Material[] }[] {
    return this.getPendingMaterialsGroupedByProject(userId);
  }

  getPendingMaterialsGroupedByProject(userId: number): { project_name: string; materials: Material[] }[] {
    const rows = this.db.prepare(`
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

  // --- CALCULATOR OFFSETS MANAGEMENT ---
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
    const rows = this.db.prepare(
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
      const insertStmt = this.db.prepare(`
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
    const row = this.db.prepare("SELECT * FROM calculator_offsets WHERE id = ? AND user_id = ?").get(id, userId) as any;
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

    const info = this.db.prepare(`
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

    this.db.prepare(`
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
    const res = this.db.prepare("DELETE FROM calculator_offsets WHERE id = ? AND user_id = ?").run(id, userId);
    return res.changes > 0;
  }

}

export const store = new SQLiteStore();
