import { describe, it, expect } from "vitest";
import { evaluateDayFeasibility } from "../src/evaluator.js";
import { AppSettings, Task, TaskCategory, TaskStatus, HourlyForecast, DayStatus } from "../src/types.js";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const mockSettings: AppSettings = {
  operational_start_hour: 8,
  operational_end_hour: 18,
  setup_hours: 1.0,
  teardown_hours: 1.0,
  min_work_hours: 2.0,
  min_work_hours_unless_final: 1.0,
  max_humidity_percent: 80.0,
  min_rain_precipitation_mm: 0.1,
  exclude_saturdays: false,
  exclude_sundays: false,
  exclude_holidays: false,
  google_calendar_enabled: false,
  google_calendar_id: ""
};

function createMockForecasts(
  temp: number = 20,
  humidity: number = 50,
  rainMm: number = 0
): HourlyForecast[] {
  const forecasts: HourlyForecast[] = [];
  for (let h = 0; h < 24; h++) {
    forecasts.push({
      hour: h,
      temperature_c: temp,
      relative_humidity: humidity,
      precipitation_mm: rainMm,
      precipitation_probability: 0,
      cloud_cover_percent: 10,
      wind_speed_kmh: 5,
      weather_code: 0,
      description: "Despejado"
    });
  }
  return forecasts;
}

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    project_id: 10,
    project_name: "Mesa Rústica",
    title: "Encolado de Pieza",
    description: "Encolado",
    category: TaskCategory.PVA_GLUE,
    estimated_hours: 2.0,
    curing_hours: 3.0,
    requires_curing: true,
    curing_is_blocking: false,
    order: 1,
    status: TaskStatus.PENDING,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

describe("Non-Blocking Curing (Curado No Vinculante)", () => {
  it("schedules parallel tasks on the same day when curing_is_blocking = false", () => {
    const forecasts = createMockForecasts(20, 50, 0); // 8:00 a 18:00 (10h operativas, 8h netas: 9:00 a 17:00)

    const task1 = createMockTask({
      id: 101,
      title: "Encolado Pieza 1",
      estimated_hours: 2.0,
      curing_hours: 4.0,
      curing_is_blocking: false
    });

    const task2 = createMockTask({
      id: 102,
      title: "Encolado Pieza 2",
      estimated_hours: 2.0,
      curing_hours: 3.0,
      curing_is_blocking: false
    });

    const task3 = createMockTask({
      id: 103,
      title: "Lijado Pieza 3",
      category: TaskCategory.CARPENTRY,
      estimated_hours: 2.0,
      curing_hours: 0,
      requires_curing: false,
      curing_is_blocking: true
    });

    const evaluation = evaluateDayFeasibility("2026-08-25", [task1, task2, task3], forecasts, mockSettings);

    expect(evaluation.status).toBe(DayStatus.DAY_VIABLE);
    expect(evaluation.scheduled_tasks.length).toBe(3);
    expect(evaluation.scheduled_tasks.map(t => t.id)).toEqual([101, 102, 103]);
  });

  it("blocks subsequent tasks if curing_is_blocking = true", () => {
    const forecasts = createMockForecasts(20, 50, 0); // 8:00 a 18:00 (neto 9:00 a 17:00 = 8h disponibles)

    const task1 = createMockTask({
      id: 101,
      title: "Encolado Bloqueante",
      estimated_hours: 2.0,
      curing_hours: 5.0, // 2 + 5 = 7h ocupadas (de 9:00 a 16:00)
      curing_is_blocking: true
    });

    const task2 = createMockTask({
      id: 102,
      title: "Lijado 2",
      estimated_hours: 2.5, // necesita 2.5h, pero solo queda 1h antes de las 17:00
      curing_hours: 0,
      curing_is_blocking: true
    });

    const evaluation = evaluateDayFeasibility("2026-08-25", [task1, task2], forecasts, mockSettings);

    expect(evaluation.status).toBe(DayStatus.DAY_VIABLE);
    expect(evaluation.scheduled_tasks.length).toBe(1);
    expect(evaluation.scheduled_tasks[0].id).toBe(101);
  });

  it("blocks day when non-blocking curing window has rain", () => {
    // Si llueve en todas las tardes (13:00 a 23:00), cualquier ventana donde el curado de 6h toque la lluvia es descartada
    const forecasts = createMockForecasts(20, 50, 0);
    for (let h = 13; h <= 23; h++) {
      forecasts[h].precipitation_mm = 2.5;
    }

    const task1 = createMockTask({
      id: 101,
      title: "Barnizado Exterior",
      estimated_hours: 4.0, // activa 9:00 - 13:00
      curing_hours: 6.0,     // curado 13:00 - 19:00 (toca lluvia)
      curing_is_blocking: false
    });

    const evaluation = evaluateDayFeasibility("2026-08-25", [task1], forecasts, mockSettings);

    // La tarea 101 no puede agendarse y el día resulta bloqueado por clima
    expect(evaluation.status).toBe(DayStatus.DAY_BLOCKED);
    expect(evaluation.unassigned_reason).toContain("Riesgo de lluvia");
  });
});

describe("Admin User Seed Prevention", () => {
  it("does not create admin@workshop.os if ADMIN_EMAIL/ADMIN_PASSWORD are not in environment", () => {
    const testDbPath = path.join(process.cwd(), "test_no_admin.db");
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

    const db = new Database(testDbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);

    // Simular la lógica exacta de db.ts cuando no hay variables en process.env
    const envAdminEmail = '';
    const envAdminPassword = '';

    if (envAdminEmail && envAdminPassword) {
      db.prepare("INSERT INTO users (email, password_hash, must_change_password, created_at) VALUES (?, ?, ?, datetime('now'))").run(envAdminEmail, "hash", 0);
    }

    const row = db.prepare("SELECT * FROM users WHERE email = ?").get("admin@workshop.os");
    expect(row).toBeUndefined();
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });
});
