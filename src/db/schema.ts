import Database from "better-sqlite3";

export function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      blocked_at TEXT,
      blocked_reason TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

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
      is_active INTEGER NOT NULL DEFAULT 1,
      curing_is_blocking INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS curing_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      project_name TEXT,
      piece_label TEXT NOT NULL,
      started_at TEXT NOT NULL,
      duration_hours REAL NOT NULL,
      finishes_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'curing',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_curing_sessions_user_status ON curing_sessions(user_id, status);

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
      min_work_hours REAL NOT NULL DEFAULT 3.0,
      min_work_hours_unless_final REAL NOT NULL DEFAULT 1.0,
      min_rain_precipitation_mm REAL NOT NULL DEFAULT 0.1,
      checkin_hour INTEGER NOT NULL DEFAULT 19,
      morning_eval_lead_hours INTEGER NOT NULL DEFAULT 1,
      exclude_saturdays INTEGER NOT NULL DEFAULT 1,
      exclude_sundays INTEGER NOT NULL DEFAULT 1,
      exclude_holidays INTEGER NOT NULL DEFAULT 1,
      require_curing_before_cutoff INTEGER NOT NULL DEFAULT 1,
      telegram_chat_id TEXT,
      google_calendar_id TEXT,
      google_calendar_enabled INTEGER NOT NULL DEFAULT 0,
      timezone TEXT,
      workshop_type TEXT NOT NULL DEFAULT 'outdoor',
      max_rain_probability INTEGER NOT NULL DEFAULT 40,
      max_wind_gust_carpentry REAL NOT NULL DEFAULT 40.0,
      max_wind_gust_paint REAL NOT NULL DEFAULT 25.0,
      dew_point_margin_c REAL NOT NULL DEFAULT 3.0,
      min_temp_pva_c REAL NOT NULL DEFAULT 10.0,
      min_temp_epoxy_c REAL NOT NULL DEFAULT 15.0,
      max_humidity_varnish REAL NOT NULL DEFAULT 80.0,
      max_humidity_pva REAL NOT NULL DEFAULT 90.0,
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
      hourly_forecast TEXT,
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
      humidity_alert_sent INTEGER NOT NULL DEFAULT 0,
      intraday_alert_triggered INTEGER NOT NULL DEFAULT 0,
      intraday_alert_acknowledged INTEGER NOT NULL DEFAULT 0,
      intraday_alert_last_sent_at TEXT,
      intraday_alert_burst_count INTEGER NOT NULL DEFAULT 0,
      last_rain_alert_hour INTEGER,
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
}
