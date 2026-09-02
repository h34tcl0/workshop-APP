import Database from "better-sqlite3";

export function runMigrations(db: Database.Database, defaultUserId: number): void {
  try {
    db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;");
  } catch {
    // Column already exists
  }

  // Migration logic for existing tables missing user_id
  const tablesToMigrate = [
    "projects",
    "tasks",
    "forced_tasks",
    "project_templates",
    "project_template_items",
    "materials",
    "calculator_offsets"
  ];

  for (const table of tablesToMigrate) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    const hasUserId = cols.some(c => c.name === "user_id");
    if (!hasUserId) {
      console.log(`[DB MIGRATION] Adding user_id column to ${table}...`);
      db.exec(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER DEFAULT ${defaultUserId};`);
      db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(defaultUserId);
    }
  }

  // Special migration for app_settings (recreate to ensure per-user UNIQUE constraint and drop CHECK(id=1))
  const appSettingsCols = db.prepare("PRAGMA table_info(app_settings)").all() as any[];
  const hasUserIdInSettings = appSettingsCols.some(c => c.name === "user_id");
  if (!hasUserIdInSettings) {
    console.log("[DB MIGRATION] Migrating app_settings table for multi-tenancy...");
    db.exec(`
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
        min_work_hours REAL NOT NULL DEFAULT 3.0,
        min_work_hours_unless_final REAL NOT NULL DEFAULT 1.0,
        min_rain_precipitation_mm REAL NOT NULL DEFAULT 0.1,
        checkin_hour INTEGER NOT NULL DEFAULT 19,
        morning_eval_lead_hours INTEGER NOT NULL DEFAULT 1,
        exclude_saturdays INTEGER NOT NULL DEFAULT 1,
        exclude_sundays INTEGER NOT NULL DEFAULT 1,
        exclude_holidays INTEGER NOT NULL DEFAULT 1,
        require_curing_before_cutoff INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    db.exec(`
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
    db.exec("DROP TABLE app_settings;");
    db.exec("ALTER TABLE app_settings_new RENAME TO app_settings;");
  }

  // Ensure new columns exist on app_settings
  const currentAppSettingsCols = db.prepare("PRAGMA table_info(app_settings)").all() as any[];
  if (!currentAppSettingsCols.some(c => c.name === "telegram_chat_id")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN telegram_chat_id TEXT;");
  }
  if (!currentAppSettingsCols.some(c => c.name === "google_calendar_id")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN google_calendar_id TEXT;");
  }
  if (!currentAppSettingsCols.some(c => c.name === "google_calendar_enabled")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN google_calendar_enabled INTEGER NOT NULL DEFAULT 0;");
  }
  if (!currentAppSettingsCols.some(c => c.name === "timezone")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN timezone TEXT;");
  }
  if (!currentAppSettingsCols.some(c => c.name === "workshop_type")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN workshop_type TEXT NOT NULL DEFAULT 'outdoor';");
  }
  if (!currentAppSettingsCols.some(c => c.name === "max_rain_probability")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN max_rain_probability INTEGER NOT NULL DEFAULT 40;");
  }
  if (!currentAppSettingsCols.some(c => c.name === "max_wind_gust_carpentry")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN max_wind_gust_carpentry REAL NOT NULL DEFAULT 40.0;");
  }
  if (!currentAppSettingsCols.some(c => c.name === "max_wind_gust_paint")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN max_wind_gust_paint REAL NOT NULL DEFAULT 25.0;");
  }
  if (!currentAppSettingsCols.some(c => c.name === "dew_point_margin_c")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN dew_point_margin_c REAL NOT NULL DEFAULT 3.0;");
  }
  if (!currentAppSettingsCols.some(c => c.name === "min_temp_pva_c")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN min_temp_pva_c REAL NOT NULL DEFAULT 10.0;");
  }
  if (!currentAppSettingsCols.some(c => c.name === "min_temp_epoxy_c")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN min_temp_epoxy_c REAL NOT NULL DEFAULT 15.0;");
  }
  if (!currentAppSettingsCols.some(c => c.name === "max_humidity_varnish")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN max_humidity_varnish REAL NOT NULL DEFAULT 80.0;");
  }
  if (!currentAppSettingsCols.some(c => c.name === "max_humidity_pva")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN max_humidity_pva REAL NOT NULL DEFAULT 90.0;");
  }

  // Update existing app_settings with old default 0.2 to new default 0.1
  db.exec("UPDATE app_settings SET min_rain_precipitation_mm = 0.1 WHERE min_rain_precipitation_mm = 0.2;");

  const currentDailyLogCols = db.prepare("PRAGMA table_info(daily_logs)").all() as any[];
  if (!currentDailyLogCols.some(c => c.name === "google_event_id")) {
    db.exec("ALTER TABLE daily_logs ADD COLUMN google_event_id TEXT;");
  }
  if (!currentDailyLogCols.some(c => c.name === "humidity_alert_sent")) {
    db.exec("ALTER TABLE daily_logs ADD COLUMN humidity_alert_sent INTEGER NOT NULL DEFAULT 0;");
  }
  if (!currentDailyLogCols.some(c => c.name === "intraday_alert_triggered")) {
    db.exec("ALTER TABLE daily_logs ADD COLUMN intraday_alert_triggered INTEGER NOT NULL DEFAULT 0;");
  }
  if (!currentDailyLogCols.some(c => c.name === "intraday_alert_acknowledged")) {
    db.exec("ALTER TABLE daily_logs ADD COLUMN intraday_alert_acknowledged INTEGER NOT NULL DEFAULT 0;");
  }
  if (!currentDailyLogCols.some(c => c.name === "intraday_alert_last_sent_at")) {
    db.exec("ALTER TABLE daily_logs ADD COLUMN intraday_alert_last_sent_at TEXT;");
  }
  if (!currentDailyLogCols.some(c => c.name === "intraday_alert_burst_count")) {
    db.exec("ALTER TABLE daily_logs ADD COLUMN intraday_alert_burst_count INTEGER NOT NULL DEFAULT 0;");
  }
  if (!currentDailyLogCols.some(c => c.name === "last_rain_alert_hour")) {
    db.exec("ALTER TABLE daily_logs ADD COLUMN last_rain_alert_hour INTEGER;");
  }
  if (!currentDailyLogCols.some(c => c.name === "calendar_sync_claimed_at")) {
    db.exec("ALTER TABLE daily_logs ADD COLUMN calendar_sync_claimed_at TEXT;");
  }
  if (!currentDailyLogCols.some(c => c.name === "hourly_forecast")) {
    db.exec("ALTER TABLE daily_logs ADD COLUMN hourly_forecast TEXT;");
  }

  // Special migration for day_overrides (recreate for per-user UNIQUE constraint)
  const dayOverrideCols = db.prepare("PRAGMA table_info(day_overrides)").all() as any[];
  const hasUserIdInOverrides = dayOverrideCols.some(c => c.name === "user_id");
  if (!hasUserIdInOverrides) {
    console.log("[DB MIGRATION] Migrating day_overrides table for multi-tenancy...");
    db.exec(`
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
    db.exec(`
      INSERT OR IGNORE INTO day_overrides_new (
        user_id, override_date, force_status, custom_start_hour, custom_end_hour, removed_task_ids, note, updated_at
      )
      SELECT
        ${defaultUserId} as user_id, override_date, force_status, custom_start_hour, custom_end_hour, removed_task_ids, note, updated_at
      FROM day_overrides;
    `);
    db.exec("DROP TABLE day_overrides;");
    db.exec("ALTER TABLE day_overrides_new RENAME TO day_overrides;");
  }

  // Special migration for daily_logs (recreate for per-user UNIQUE constraint)
  const dailyLogsCols = db.prepare("PRAGMA table_info(daily_logs)").all() as any[];
  const hasUserIdInDailyLogs = dailyLogsCols.some(c => c.name === "user_id");
  if (!hasUserIdInDailyLogs) {
    console.log("[DB MIGRATION] Migrating daily_logs table for multi-tenancy...");
    db.exec(`
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
    db.exec(`
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
    db.exec("DROP TABLE daily_logs;");
    db.exec("ALTER TABLE daily_logs_new RENAME TO daily_logs;");
  }

  // Ensure project_id column exists in tasks and materials and backfill defaults if missing
  const currentTasksCols = db.prepare("PRAGMA table_info(tasks)").all() as any[];
  if (!currentTasksCols.some(c => c.name === "project_id")) {
    db.exec("ALTER TABLE tasks ADD COLUMN project_id INTEGER;");
  }
  if (!currentTasksCols.some(c => c.name === "is_active")) {
    db.exec("ALTER TABLE tasks ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;");
  }
  if (!currentTasksCols.some(c => c.name === "curing_is_blocking")) {
    db.exec("ALTER TABLE tasks ADD COLUMN curing_is_blocking INTEGER NOT NULL DEFAULT 1;");
  }

  const currentMaterialsCols = db.prepare("PRAGMA table_info(materials)").all() as any[];
  if (!currentMaterialsCols.some(c => c.name === "project_id")) {
    db.exec("ALTER TABLE materials ADD COLUMN project_id INTEGER;");
  }

  const usersList = db.prepare("SELECT id FROM users").all() as any[];
  for (const u of usersList) {
    const uId = Number(u.id);
    let defaultProj = db.prepare("SELECT id FROM projects WHERE user_id = ? AND is_active = 1 LIMIT 1").get(uId) as any;
    if (!defaultProj) {
      defaultProj = db.prepare("SELECT id FROM projects WHERE user_id = ? LIMIT 1").get(uId) as any;
    }
    if (!defaultProj) {
      const ins = db.prepare("INSERT INTO projects (user_id, name, description, is_active) VALUES (?, 'Taller Principal', 'Proyecto por defecto', 1)").run(uId);
      defaultProj = { id: Number(ins.lastInsertRowid) };
    }
    const projId = Number(defaultProj.id);
    db.prepare("UPDATE tasks SET project_id = ? WHERE user_id = ? AND (project_id IS NULL OR project_id = 0)").run(projId, uId);
    db.prepare("UPDATE materials SET project_id = ? WHERE user_id = ? AND (project_id IS NULL OR project_id = 0)").run(projId, uId);
  }

  // Ensure Admin & User Status columns exist on users
  const currentUsersCols = db.prepare("PRAGMA table_info(users)").all() as any[];
  if (!currentUsersCols.some(c => c.name === "role")) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';");
  }
  if (!currentUsersCols.some(c => c.name === "status")) {
    db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';");
  }
  if (!currentUsersCols.some(c => c.name === "blocked_at")) {
    db.exec("ALTER TABLE users ADD COLUMN blocked_at TEXT;");
  }
  if (!currentUsersCols.some(c => c.name === "blocked_reason")) {
    db.exec("ALTER TABLE users ADD COLUMN blocked_reason TEXT;");
  }

  // Ensure system_settings table exists and has singleton row
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      registration_open INTEGER NOT NULL DEFAULT 1,
      default_max_projects INTEGER NOT NULL DEFAULT 10,
      default_max_tasks INTEGER NOT NULL DEFAULT 200,
      default_max_storage_mb INTEGER NOT NULL DEFAULT 100,
      default_max_model_size_mb INTEGER NOT NULL DEFAULT 25,
      absolute_max_model_size_mb INTEGER NOT NULL DEFAULT 100,
      maintenance_mode INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    INSERT OR IGNORE INTO system_settings (
      id, registration_open, default_max_projects, default_max_tasks,
      default_max_storage_mb, default_max_model_size_mb, absolute_max_model_size_mb,
      maintenance_mode, updated_at
    ) VALUES (1, 1, 10, 200, 100, 25, 100, 0, datetime('now'));
  `);

  // Ensure account_limits table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      max_projects INTEGER NOT NULL,
      max_tasks INTEGER NOT NULL,
      max_storage_mb INTEGER NOT NULL,
      max_model_size_mb INTEGER NOT NULL,
      updated_by INTEGER,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  // Ensure admin_audit_log table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_user_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}
