import { describe, it, expect } from "vitest";
import { evaluateDayFeasibility, evaluateDayWithOverrides, computeHourlyClimateMap, isRainyForecast, getHourlyClimateAudit } from "../src/evaluator.js";
import { AppSettings, Task, TaskCategory, TaskStatus, HourlyForecast, DayStatus, DayOverride } from "../src/types.js";

const mockSettings: AppSettings = {
  operational_start_hour: 8,
  operational_end_hour: 18,
  setup_hours: 1.0,
  teardown_hours: 1.0,
  min_work_hours: 2.0,
  min_work_hours_unless_final: 1.0,
  max_humidity_percent: 80.0,
  min_rain_precipitation_mm: 0.2,
  exclude_saturdays: false,
  exclude_sundays: false,
  exclude_holidays: false,
  google_calendar_enabled: false,
  google_calendar_id: ""
};

function createMockForecasts(
  temp: number = 20,
  humidity: number = 50,
  rainMm: number = 0,
  pop: number = 0
): HourlyForecast[] {
  const forecasts: HourlyForecast[] = [];
  for (let h = 0; h < 24; h++) {
    forecasts.push({
      hour: h,
      temperature_c: temp,
      relative_humidity: humidity,
      precipitation_mm: rainMm,
      precipitation_probability: pop,
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
    title: "Lijado de Cubierta",
    description: "Lijado grano 120",
    category: TaskCategory.CARPENTRY,
    estimated_hours: 2.0,
    curing_hours: 0.0,
    requires_curing: false,
    order: 1,
    status: TaskStatus.PENDING,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

describe("Evaluator - Curing & Climate Threshold Boundaries", () => {
  it("should evaluate humidity boundary (80.0% vs 80.1%) for general tasks", () => {
    const task = createMockTask();

    // 80.0% humidity -> Should be VIABLE
    const forecasts80 = createMockForecasts(20, 80.0);
    const eval80 = evaluateDayFeasibility("2026-08-10", [task], forecasts80, mockSettings);
    expect(eval80.status).toBe(DayStatus.DAY_VIABLE);

    // 80.1% humidity -> Should be BLOCKED
    const forecasts80_1 = createMockForecasts(20, 80.1);
    const eval80_1 = evaluateDayFeasibility("2026-08-10", [task], forecasts80_1, mockSettings);
    expect(eval80_1.status).toBe(DayStatus.DAY_BLOCKED);
    expect(eval80_1.unassigned_reason).toContain("Exceso de humedad");
  });

  it("should evaluate temperature boundary for Epoxy (<15.0°C vs >=15.0°C)", () => {
    const epoxyTask = createMockTask({
      category: TaskCategory.EPOXY,
      curing_hours: 6.0,
      requires_curing: true
    });

    // 14.9°C -> Should be BLOCKED due to low temperature for epoxy
    const forecasts14_9 = createMockForecasts(14.9, 50.0);
    const eval14_9 = evaluateDayFeasibility("2026-08-10", [epoxyTask], forecasts14_9, mockSettings);
    expect(eval14_9.status).toBe(DayStatus.DAY_BLOCKED);
    expect(eval14_9.unassigned_reason).toContain("Temperatura baja (<15°C) para Epoxi");

    // 15.0°C -> Should be VIABLE
    const forecasts15_0 = createMockForecasts(15.0, 50.0);
    const eval15_0 = evaluateDayFeasibility("2026-08-10", [epoxyTask], forecasts15_0, mockSettings);
    expect(eval15_0.status).toBe(DayStatus.DAY_VIABLE);
  });

  it("should evaluate humidity boundary for Epoxy (75.0% vs 75.1%)", () => {
    const epoxyTask = createMockTask({
      category: TaskCategory.EPOXY,
      curing_hours: 6.0,
      requires_curing: true
    });

    // 75.0% -> Should be VIABLE
    const forecasts75_0 = createMockForecasts(20.0, 75.0);
    const eval75_0 = evaluateDayFeasibility("2026-08-10", [epoxyTask], forecasts75_0, mockSettings);
    expect(eval75_0.status).toBe(DayStatus.DAY_VIABLE);

    // 75.1% -> Should be BLOCKED
    const forecasts75_1 = createMockForecasts(20.0, 75.1);
    const eval75_1 = evaluateDayFeasibility("2026-08-10", [epoxyTask], forecasts75_1, mockSettings);
    expect(eval75_1.status).toBe(DayStatus.DAY_BLOCKED);
    expect(eval75_1.unassigned_reason).toContain("Humedad alta (>75%) para Epoxi");
  });

  it("should identify rain thresholds correctly (0.2mm precipitation and 30% POP)", () => {
    const clearForecast = createMockForecasts(20, 50, 0.1, 29)[10];
    expect(isRainyForecast(clearForecast, 0.2)).toBe(false);

    const rainMmForecast = createMockForecasts(20, 50, 0.2, 10)[10];
    expect(isRainyForecast(rainMmForecast, 0.2)).toBe(true);

    const rainPopForecast = createMockForecasts(20, 50, 0.0, 30)[10];
    expect(isRainyForecast(rainPopForecast, 0.2)).toBe(true);
  });
});

describe("Evaluator - Full Day Feasibility Cases", () => {
  it("returns DAY_VIABLE with complete timeline on optimal conditions", () => {
    const task = createMockTask();
    const forecasts = createMockForecasts(22, 45, 0, 0);

    const result = evaluateDayFeasibility("2026-08-10", [task], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    expect(result.scheduled_tasks.length).toBe(1);
    expect(result.window?.start_time).toBe("08:00");
    expect(result.window?.end_time).toBe("12:00"); // 1h setup + 2h task + 1h teardown = 4h total
    expect(result.timeline.length).toBeGreaterThan(0);
  });

  it("returns DAY_BLOCKED when a clear day is interrupted by rain mid-day", () => {
    const task = createMockTask({ estimated_hours: 6.0 }); // Needs 1h setup + 6h work + 1h teardown = 8h window
    const forecasts = createMockForecasts(20, 50, 0, 0);

    // Inject rain at 12:00
    for (let h = 12; h <= 18; h++) {
      forecasts[h].precipitation_mm = 2.5;
      forecasts[h].precipitation_probability = 90;
    }

    const result = evaluateDayFeasibility("2026-08-10", [task], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.unassigned_reason).toContain("Riesgo de lluvia");
  });

  it("returns DAY_BLOCKED when backlog is empty", () => {
    const forecasts = createMockForecasts(20, 50, 0, 0);

    const result = evaluateDayFeasibility("2026-08-10", [], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.unassigned_reason).toContain("No hay tareas pendientes");
  });
});

describe("Evaluator - Timeline Formatting & Project Name Separation", () => {
  it("keeps project_name as a separate field and title clean without duplication", () => {
    const task = createMockTask({
      project_name: "Biblioteca Roble",
      title: "Corte de Estantes"
    });
    const forecasts = createMockForecasts(20, 50, 0, 0);

    const result = evaluateDayFeasibility("2026-08-10", [task], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    const taskTimelineItem = result.timeline.find(t => t.title.includes("Corte de Estantes"));
    expect(taskTimelineItem).toBeDefined();
    expect(taskTimelineItem?.project_name).toBe("Biblioteca Roble");
    expect(taskTimelineItem?.title).toBe("#1 Corte de Estantes");
  });

  it("formats task title cleanly when project_name is missing or empty", () => {
    const task = createMockTask({
      project_name: "",
      title: "Barnizado General"
    });
    const forecasts = createMockForecasts(20, 50, 0, 0);

    const result = evaluateDayFeasibility("2026-08-10", [task], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    const taskTimelineItem = result.timeline.find(t => t.title.includes("Barnizado General"));
    expect(taskTimelineItem).toBeDefined();
    expect(taskTimelineItem?.project_name).toBeUndefined();
    expect(taskTimelineItem?.title).toBe("#1 Barnizado General");
  });
});

describe("Evaluator - Day Overrides Precedence", () => {
  it("overrides exclude_sundays=true when dayOverride forces Sunday as VIABLE with custom hours", () => {
    const sundaySettings: AppSettings = {
      ...mockSettings,
      exclude_sundays: true,
      exclude_saturdays: true
    };
    const task = createMockTask({
      project_name: "Zapatero",
      title: "Ensamblado de Mueble Zapatero",
      estimated_hours: 3.0
    });
    const forecasts = createMockForecasts(20, 50, 0, 0);

    const sundayDate = "2026-08-09"; // 2026-08-09 is Sunday

    const override: DayOverride = {
      user_id: 1,
      override_date: sundayDate,
      force_status: "VIABLE",
      custom_start_hour: 15,
      custom_end_hour: 21,
      note: "Trabajo especial de domingo"
    };

    const result = evaluateDayWithOverrides(
      sundayDate,
      [task],
      forecasts,
      sundaySettings,
      new Set(),
      override
    );

    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    expect(result.reason).not.toContain("Día no laborable");
    expect(result.window?.start_time).toBe("15:00");
    expect(result.window?.end_time).toBe("20:00");
    expect(result.scheduled_tasks).toHaveLength(1);
    expect(result.scheduled_tasks?.[0].title).toBe("Ensamblado de Mueble Zapatero");
    expect(result.timeline.length).toBeGreaterThan(0);
    // Check that timeline includes Setup and Task items
    const setupItem = result.timeline.find(t => t.title.includes("Setup"));
    const taskItem = result.timeline.find(t => t.title.includes("Ensamblado"));
    expect(setupItem).toBeDefined();
    expect(taskItem).toBeDefined();
  });

  it("forces a normal working day as BLOCKED when dayOverride specifies BLOCKED", () => {
    const mondayDate = "2026-08-10"; // Monday
    const task = createMockTask();
    const forecasts = createMockForecasts(20, 50, 0, 0);

    const override: DayOverride = {
      user_id: 1,
      override_date: mondayDate,
      force_status: "BLOCKED",
      note: "Mantenimiento taller"
    };

    const result = evaluateDayWithOverrides(
      mondayDate,
      [task],
      forecasts,
      mockSettings,
      new Set(),
      override
    );

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.is_manually_blocked).toBe(true);
    expect(result.reason).toBe("Mantenimiento taller");
  });

  it("respects exclude_sundays=true when NO dayOverride is present", () => {
    const sundaySettings: AppSettings = {
      ...mockSettings,
      exclude_sundays: true
    };
    const sundayDate = "2026-08-09";
    const task = createMockTask();
    const forecasts = createMockForecasts(20, 50, 0, 0);

    const result = evaluateDayWithOverrides(
      sundayDate,
      [task],
      forecasts,
      sundaySettings
    );

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.reason).toContain("Día no laborable (domingo, desactivado en configuración)");
  });

  it("flags risk when rain occurs during passive curing hours in getHourlyClimateAudit", () => {
    const varnishTask = createMockTask({
      category: TaskCategory.VARNISH_PAINT,
      estimated_hours: 3.0,
      requires_curing: true,
      curing_hours: 5.0
    });
    const forecasts = createMockForecasts(20, 50, 0, 0);

    const mockWindow = {
      start_time: "08:00",
      end_time: "13:00",
      start_hour: 8,
      end_hour: 13,
      total_duration_hours: 5,
      net_work_hours: 3,
      is_viable: true
    };

    // Passive curing runs from 12:00 to 17:00 (5 hours after work ends at 12:00).
    // Rain at 15:00 occurs during passive curing!
    forecasts[15].precipitation_mm = 1.5;
    forecasts[15].precipitation_probability = 80;

    const audit = getHourlyClimateAudit(forecasts, mockWindow, [varnishTask], mockSettings);
    expect(audit).toBeDefined();

    const hour15Audit = audit.find(item => item.hour === 15);
    expect(hour15Audit).toBeDefined();
    expect(hour15Audit?.is_curing).toBe(true);
    expect(hour15Audit?.risk_reasons.some(r => r.includes("Lluvia en curado pasivo"))).toBe(true);
  });

  it("maintains accurate work window start/end label for VIABLE day_override", () => {
    const sundaySettings: AppSettings = {
      ...mockSettings,
      exclude_sundays: true,
      operational_start_hour: 11,
      operational_end_hour: 21,
      setup_hours: 1.0,
      teardown_hours: 1.0
    };
    const sundayDate = "2026-08-09";
    const task = createMockTask({ estimated_hours: 4.0 });
    const forecasts = createMockForecasts(20, 50, 0, 0);

    const override: DayOverride = {
      id: 1,
      override_date: sundayDate,
      force_status: "VIABLE",
      custom_start_hour: 15,
      custom_end_hour: 21
    };

    const result = evaluateDayWithOverrides(
      sundayDate,
      [task],
      forecasts,
      sundaySettings,
      new Set(),
      override
    );

    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    expect(result.window?.start_time).toBe("15:00");
    expect(result.window?.end_time).toBe("21:00");
  });
});
