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
  rainMm: number = 0,
  pop: number = 0,
  dewPoint?: number,
  windGusts?: number
): HourlyForecast[] {
  const forecasts: HourlyForecast[] = [];
  for (let h = 0; h < 24; h++) {
    forecasts.push({
      hour: h,
      temperature_c: temp,
      relative_humidity: humidity,
      precipitation_mm: rainMm,
      precipitation_probability: pop,
      dew_point_c: dewPoint,
      wind_gusts_kmh: windGusts,
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
  it("should evaluate humidity boundary (80.0% vs 80.1%) for varnish/paint tasks", () => {
    const task = createMockTask({
      category: TaskCategory.VARNISH_PAINT,
      title: "Barnizado de Acabado"
    });

    // 80.0% humidity -> Should be VIABLE
    const forecasts80 = createMockForecasts(20, 80.0);
    const eval80 = evaluateDayFeasibility("2026-08-10", [task], forecasts80, mockSettings);
    expect(eval80.status).toBe(DayStatus.DAY_VIABLE);

    // 80.1% humidity -> Should be BLOCKED
    const forecasts80_1 = createMockForecasts(20, 80.1);
    const eval80_1 = evaluateDayFeasibility("2026-08-10", [task], forecasts80_1, mockSettings);
    expect(eval80_1.status).toBe(DayStatus.DAY_BLOCKED);
    expect(eval80_1.unassigned_reason).toContain("Humedad alta (>80%) para Barniz/Pintura");
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

  it("should identify rain thresholds correctly (0.1mm precipitation or >=40% PoP)", () => {
    const clearForecast = createMockForecasts(20, 50, 0.05, 29)[10];
    expect(isRainyForecast(clearForecast, 0.1)).toBe(false);

    const rainMmForecast = createMockForecasts(20, 50, 0.1, 10)[10];
    expect(isRainyForecast(rainMmForecast, 0.1)).toBe(true);

    const popRainForecast = createMockForecasts(20, 50, 0.0, 40)[10];
    expect(isRainyForecast(popRainForecast, 0.1)).toBe(true);

    const popRainForecastHigh = createMockForecasts(20, 50, 0.0, 60)[10];
    expect(isRainyForecast(popRainForecastHigh, 0.1)).toBe(true);
  });
});

describe("Evaluator - Phase 2: Category Rules & Combined Rain PoP Filter", () => {
  it("Escenario 1 (Carpentry en día húmedo): 85% HR, 0.0mm lluvia (0% PoP) con tarea de carpentry (3.0h) -> DAY_VIABLE", () => {
    const carpentryTask = createMockTask({
      category: TaskCategory.CARPENTRY,
      title: "Corte y Cepillado de Tablones",
      estimated_hours: 3.0
    });
    const humidForecasts = createMockForecasts(20, 85.0, 0.0, 0);

    const result = evaluateDayFeasibility("2026-08-10", [carpentryTask], humidForecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    expect(result.scheduled_tasks.length).toBe(1);
    expect(result.scheduled_tasks[0].id).toBe(carpentryTask.id);
  });

  it("Escenario 2 (Barniz en día húmedo): 85% HR, 0.0mm lluvia (0% PoP) con tarea de varnish_paint (2.0h) -> DAY_BLOCKED por exceso de humedad", () => {
    const varnishTask = createMockTask({
      category: TaskCategory.VARNISH_PAINT,
      title: "Barnizado Poliuretano",
      estimated_hours: 2.0
    });
    const humidForecasts = createMockForecasts(20, 85.0, 0.0, 0);

    const result = evaluateDayFeasibility("2026-08-10", [varnishTask], humidForecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.unassigned_reason).toContain("Humedad alta (>80%) para Barniz/Pintura");
  });

  it("Escenario 3 (Cola PVA en frío): Día seco con 8°C de temperatura con tarea de pva_glue -> DAY_BLOCKED por baja temperatura (<10°C)", () => {
    const pvaTask = createMockTask({
      category: TaskCategory.PVA_GLUE,
      title: "Encolado de Ensamble",
      estimated_hours: 2.0,
      curing_hours: 2.0,
      requires_curing: true
    });
    const coldForecasts = createMockForecasts(8.0, 50.0, 0.0, 0);

    const result = evaluateDayFeasibility("2026-08-10", [pvaTask], coldForecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.unassigned_reason).toContain("Temperatura baja (<10°C) para Cola PVA");
  });

  it("Escenario 4 (Lluvia por Probabilidad PoP): 0.0mm precipitación pero 60% PoP con tarea de carpentry -> DAY_BLOCKED por riesgo de lluvia", () => {
    const carpentryTask = createMockTask({
      category: TaskCategory.CARPENTRY,
      title: "Corte y Ensamblado",
      estimated_hours: 3.0
    });
    const popForecasts = createMockForecasts(20, 50.0, 0.0, 60);

    const result = evaluateDayFeasibility("2026-08-10", [carpentryTask], popForecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.unassigned_reason).toContain("Riesgo de lluvia");
  });

  it("Cola PVA en día templado (15°C) con 85% humedad -> DAY_VIABLE (tolerante hasta 90%)", () => {
    const pvaTask = createMockTask({
      category: TaskCategory.PVA_GLUE,
      title: "Encolado de Caja",
      estimated_hours: 2.0,
      curing_hours: 2.0,
      requires_curing: true
    });
    const forecasts = createMockForecasts(15.0, 85.0, 0.0, 0);

    const result = evaluateDayFeasibility("2026-08-10", [pvaTask], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    expect(result.scheduled_tasks.length).toBe(1);
  });

  it("Cola PVA con humedad extrema (>90%) -> DAY_BLOCKED", () => {
    const pvaTask = createMockTask({
      category: TaskCategory.PVA_GLUE,
      title: "Encolado de Caja",
      estimated_hours: 2.0,
      curing_hours: 2.0,
      requires_curing: true
    });
    const forecasts = createMockForecasts(15.0, 91.0, 0.0, 0);

    const result = evaluateDayFeasibility("2026-08-10", [pvaTask], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.unassigned_reason).toContain("Humedad excesiva (>90%) para Cola PVA");
  });

  it("Carpentry con humedad extrema (>95%) -> DAY_BLOCKED", () => {
    const carpentryTask = createMockTask({
      category: TaskCategory.CARPENTRY,
      title: "Corte de Tableros",
      estimated_hours: 2.0
    });
    const forecasts = createMockForecasts(20.0, 96.0, 0.0, 0);

    const result = evaluateDayFeasibility("2026-08-10", [carpentryTask], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.unassigned_reason).toContain("Exceso de humedad extrema (>95%)");
  });
});

describe("Evaluator - Phase 3: Dew Point Margin & Wind Gusts Integration", () => {
  it("Test Punto de Rocío (Bloqueo de Barniz): 20°C temp, 18°C rocío (ΔT = 2.0°C < 3°C) con varnish_paint -> DAY_BLOCKED", () => {
    const varnishTask = createMockTask({
      category: TaskCategory.VARNISH_PAINT,
      title: "Laca Transparente",
      estimated_hours: 2.0
    });
    const forecasts = createMockForecasts(20.0, 70.0, 0.0, 0).map(f => ({
      ...f,
      dew_point_c: 18.0,
      wind_gusts_kmh: 10.0
    }));

    const result = evaluateDayFeasibility("2026-08-10", [varnishTask], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.unassigned_reason).toContain("punto de rocío");
    expect(result.unassigned_reason).toContain("ΔT=2.0°C < 3°C");
  });

  it("Test Punto de Rocío (Barniz Viable): 20°C temp, 14°C rocío (ΔT = 6.0°C >= 3°C) con varnish_paint -> DAY_VIABLE", () => {
    const varnishTask = createMockTask({
      category: TaskCategory.VARNISH_PAINT,
      title: "Laca Transparente",
      estimated_hours: 2.0
    });
    const forecasts = createMockForecasts(20.0, 70.0, 0.0, 0).map(f => ({
      ...f,
      dew_point_c: 14.0,
      wind_gusts_kmh: 10.0
    }));

    const result = evaluateDayFeasibility("2026-08-10", [varnishTask], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    expect(result.scheduled_tasks.length).toBe(1);
  });

  it("Test Viento para Pintura: Ráfagas de 30 km/h (>25 km/h) con varnish_paint -> DAY_BLOCKED", () => {
    const varnishTask = createMockTask({
      category: TaskCategory.VARNISH_PAINT,
      title: "Pintura Acrílica",
      estimated_hours: 2.0
    });
    const forecasts = createMockForecasts(20.0, 50.0, 0.0, 0).map(f => ({
      ...f,
      dew_point_c: 10.0,
      wind_gusts_kmh: 30.0
    }));

    const result = evaluateDayFeasibility("2026-08-10", [varnishTask], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.unassigned_reason).toContain("Ráfagas de viento excesivas (>25 km/h)");
  });

  it("Test Viento para Carpintería: Ráfagas de 48 km/h (>40 km/h) con carpentry -> DAY_BLOCKED", () => {
    const carpentryTask = createMockTask({
      category: TaskCategory.CARPENTRY,
      title: "Corte de Tablones en Exterior",
      estimated_hours: 2.0
    });
    const forecasts = createMockForecasts(20.0, 50.0, 0.0, 0).map(f => ({
      ...f,
      wind_gusts_kmh: 48.0
    }));

    const result = evaluateDayFeasibility("2026-08-10", [carpentryTask], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.unassigned_reason).toContain("Ráfagas de viento peligrosas (>40 km/h)");
  });

  it("Test Fallback Gracioso: Forecasts sintéticos sin dew_point_c ni wind_gusts_kmh se evalúan normalmente sin arrojar excepciones", () => {
    const task = createMockTask({
      category: TaskCategory.CARPENTRY,
      estimated_hours: 2.0
    });
    const minimalForecasts: HourlyForecast[] = createMockForecasts(20, 50, 0, 0).map(f => {
      const { dew_point_c, wind_gusts_kmh, ...rest } = f;
      return rest;
    });

    expect(() => {
      const result = evaluateDayFeasibility("2026-08-10", [task], minimalForecasts, mockSettings);
      expect(result.status).toBe(DayStatus.DAY_VIABLE);
    }).not.toThrow();
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

  it("schedules a single final task of 2h when min_work_hours=3 and min_work_hours_unless_final=1", () => {
    const customSettings: AppSettings = {
      ...mockSettings,
      operational_start_hour: 13,
      operational_end_hour: 21,
      setup_hours: 0.0,
      teardown_hours: 0.0,
      min_work_hours: 3.0,
      min_work_hours_unless_final: 1.0
    };

    const finalTask = createMockTask({
      id: 15,
      title: "Montaje final de herrajes, cajones zapateros y puertas",
      estimated_hours: 2.0,
      status: TaskStatus.PENDING
    });

    const forecasts = createMockForecasts(20, 50, 0, 0);

    const result = evaluateDayFeasibility("2026-08-13", [finalTask], forecasts, customSettings);

    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    expect(result.scheduled_tasks.length).toBe(1);
    expect(result.scheduled_tasks[0].id).toBe(15);
  });

  it("marks day as DAY_BLOCKED when isTodayClosed option is passed (e.g. check-in resolved or time past operational window)", () => {
    const task = createMockTask({ id: 1, estimated_hours: 2.0 });
    const forecasts = createMockForecasts(20, 50, 0, 0);

    const result = evaluateDayFeasibility(
      "2026-08-19",
      [task],
      forecasts,
      mockSettings,
      undefined,
      {
        isTodayClosed: true,
        closedReason: "Jornada concluida (cerrada manualmente por el usuario)."
      }
    );

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.reason).toContain("Jornada concluida");
    expect(result.scheduled_tasks).toBeUndefined();
  });

  it("evaluates day with overrides marking it as closed when isTodayClosed is true", () => {
    const task = createMockTask({ id: 1, estimated_hours: 2.0 });
    const forecasts = createMockForecasts(20, 50, 0, 0);

    const result = evaluateDayWithOverrides(
      "2026-08-19",
      [task],
      forecasts,
      mockSettings,
      undefined,
      undefined,
      [],
      {
        isTodayClosed: true,
        closedReason: "Jornada concluida (horario operativo finalizado a las 21:00)."
      }
    );

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.reason).toContain("horario operativo finalizado");
    expect(result.scheduled_tasks).toBeUndefined();
  });

  it("calculates climate efficiency index correctly with 80% jornada / 20% rest weighting", () => {
    // 24 forecasts: 8-18 (10h jornada), 14h rest
    const forecasts = createMockForecasts(20, 50, 0, 0);
    // Add rain to 2 hours of jornada (8/10 good = 80%)
    forecasts[9].precipitation_mm = 1.0;
    forecasts[10].precipitation_mm = 1.0;
    // Add rain to 6 hours of rest (8/14 good = 57.14%)
    forecasts[0].precipitation_mm = 1.0;
    forecasts[1].precipitation_mm = 1.0;
    forecasts[2].precipitation_mm = 1.0;
    forecasts[3].precipitation_mm = 1.0;
    forecasts[4].precipitation_mm = 1.0;
    forecasts[5].precipitation_mm = 1.0;

    const task = createMockTask({ id: 1, estimated_hours: 2.0 });
    const result = evaluateDayFeasibility("2026-08-25", [task], forecasts, mockSettings);

    expect(result.climate_efficiency).toBeDefined();
    expect(result.climate_efficiency?.jornada_total).toBe(10);
    expect(result.climate_efficiency?.jornada_good).toBe(8);
    expect(result.climate_efficiency?.jornada_pct).toBe(80);
    expect(result.climate_efficiency?.fuera_total).toBe(14);
    expect(result.climate_efficiency?.fuera_good).toBe(8);
    expect(result.climate_efficiency?.fuera_pct).toBe(57);
    // Score: round((0.80 * 0.80 + 0.5714 * 0.20) * 100) = round(64 + 11.43) = 75%
    expect(result.climate_efficiency?.score).toBe(75);
    expect(result.climate_efficiency?.ring_color).toBe("var(--w-ok)");
    expect(result.climate_efficiency?.tooltip).toContain("Jornada: 8/10h óptimas (80%)");
  });

  it("identifies weather cutoff correctly when rain interrupts the afternoon", () => {
    // Rain starting at 16:00 (operational 8:00 to 18:00)
    const forecasts = createMockForecasts(20, 50, 0, 0);
    forecasts[16].precipitation_mm = 2.4;
    forecasts[17].precipitation_mm = 3.0;

    const task1 = createMockTask({ id: 1, estimated_hours: 3.0 });
    const result = evaluateDayFeasibility("2026-08-25", [task1], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    expect(result.weather_cutoff).toBeDefined();
    expect(result.weather_cutoff?.is_cutoff_by_weather).toBe(true);
    expect(result.weather_cutoff?.cutoff_hour).toBe(16);
    expect(result.weather_cutoff?.cutoff_time_label).toBe("16:00");
    expect(result.weather_cutoff?.primary_factor).toBe("rain");
    expect(result.weather_cutoff?.factor_description).toBe("Lluvia de 2.4mm");
  });

  it("marks is_cutoff_by_weather as false when all tasks are assigned and weather is clear until close", () => {
    const forecasts = createMockForecasts(20, 50, 0, 0);
    const task1 = createMockTask({ id: 1, estimated_hours: 2.0 });
    const result = evaluateDayFeasibility("2026-08-25", [task1], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    expect(result.weather_cutoff).toBeDefined();
    expect(result.weather_cutoff?.is_cutoff_by_weather).toBe(false);
    expect(result.weather_cutoff?.primary_factor).toBe("none");
  });

  it("marks is_cutoff_by_weather as true when day is blocked due to early rain", () => {
    const forecasts = createMockForecasts(20, 50, 0, 0);
    // Rain from 8:00 to 18:00
    for (let h = 8; h < 18; h++) {
      forecasts[h].precipitation_mm = 2.0;
    }
    const task1 = createMockTask({ id: 1, estimated_hours: 2.0 });
    const result = evaluateDayFeasibility("2026-08-25", [task1], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.weather_cutoff).toBeDefined();
    expect(result.weather_cutoff?.is_cutoff_by_weather).toBe(true);
    expect(result.weather_cutoff?.cutoff_hour).toBe(8);
    expect(result.weather_cutoff?.primary_factor).toBe("rain");
  });
});

describe("Bug J - Manufacturing Causality Chain (break on unrealizable task)", () => {
  it("stops the scheduling chain at the first unrealizable task (does NOT skip #1 to schedule #2 and #3)", () => {
    // Operational hours 8:00 to 13:00 (5.0h total span).
    // setup = 1.0h, teardown = 1.0h -> Net available work = 3.0h (from 9:00 to 12:00).
    const customSettings: AppSettings = {
      ...mockSettings,
      operational_start_hour: 8,
      operational_end_hour: 13,
      setup_hours: 1.0,
      teardown_hours: 1.0,
      min_work_hours: 1.0,
      min_work_hours_unless_final: 1.0
    };

    const forecasts = createMockForecasts(20, 50, 0, 0); // Optimal sunny weather

    const task1 = createMockTask({ id: 1, order: 1, title: "Cortar tableros", estimated_hours: 5.0 });
    const task2 = createMockTask({ id: 2, order: 2, title: "Lijar", estimated_hours: 1.0 });
    const task3 = createMockTask({ id: 3, order: 3, title: "Poner bisagras", estimated_hours: 0.5 });

    const result = evaluateDayFeasibility("2026-08-25", [task1, task2, task3], forecasts, customSettings);

    // Must NOT schedule task2 or task3 by skipping task1
    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.scheduled_tasks || []).toHaveLength(0);
    expect(result.unassigned_reason).toContain("Cortar tableros");
  });
});

describe("Bug A - isFinalBacklog Self-Comparison & Min Work Hours", () => {
  it("does not treat the entire backlog as a final package by self-comparison and enforces min_work_hours for free windows and scheduling", () => {
    // Project has 3 tasks of 2.0h each = 6.0h total.
    // min_work_hours = 4.0h, min_work_hours_unless_final = 1.0h.
    // Weather allows only 2.0h of work (8:00-10:00 clear, rain after 10:00).
    const customSettings: AppSettings = {
      ...mockSettings,
      operational_start_hour: 8,
      operational_end_hour: 18,
      setup_hours: 0.0,
      teardown_hours: 0.0,
      min_work_hours: 4.0,
      min_work_hours_unless_final: 1.0
    };

    const forecasts = createMockForecasts(20, 50, 0, 0);
    for (const f of forecasts) {
      if (f.hour >= 10) {
        f.precipitation_mm = 5.0; // Rain from 10:00 onwards
      }
    }

    const task1 = createMockTask({ id: 1, project_id: 10, order: 1, title: "Corte inicial", estimated_hours: 2.0 });
    const task2 = createMockTask({ id: 2, project_id: 10, order: 2, title: "Ensamblado intermedio", estimated_hours: 2.0 });
    const task3 = createMockTask({ id: 3, project_id: 10, order: 3, title: "Acabado final", estimated_hours: 2.0 });

    const result = evaluateDayFeasibility("2026-08-25", [task1, task2, task3], forecasts, customSettings);

    // Free windows should filter based on min_work_hours (4.0h), so a 2.0h window is not a valid free window
    expect(result.free_windows).toHaveLength(0);
    expect(result.climate_only_status).toBe("blocked");
    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.scheduled_tasks).toBeUndefined();
  });
});

describe("Bug D - removed_task_ids Pre-filtering", () => {
  it("filters out removed_task_ids before evaluating window and timeline to avoid phantom hours", () => {
    const customSettings: AppSettings = {
      ...mockSettings,
      operational_start_hour: 8,
      operational_end_hour: 18,
      setup_hours: 0.0,
      teardown_hours: 0.0,
      min_work_hours: 2.0,
      min_work_hours_unless_final: 1.0
    };

    const forecasts = createMockForecasts(20, 50, 0, 0);

    const task1 = createMockTask({ id: 1, project_id: 1, order: 1, title: "Tarea Excluida", estimated_hours: 3.0 });
    const task2 = createMockTask({ id: 2, project_id: 1, order: 2, title: "Tarea Permitida", estimated_hours: 2.0 });

    const override: DayOverride = {
      date: "2026-08-25",
      force_status: "VIABLE",
      removed_task_ids: JSON.stringify([1]),
      created_at: "2026-08-25T00:00:00Z",
      updated_at: "2026-08-25T00:00:00Z"
    };

    const result = evaluateDayWithOverrides(
      "2026-08-25",
      [task1, task2],
      forecasts,
      customSettings,
      new Set(),
      override
    );

    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    expect(result.scheduled_tasks).toHaveLength(1);
    expect(result.scheduled_tasks![0].id).toBe(2);
    // Window net_work_hours must be 2.0h, NOT 5.0h
    expect(result.window?.net_work_hours).toBe(2.0);
    // Timeline must only contain task 2, not task 1
    const taskTitlesInTimeline = (result.timeline || []).map(t => t.title);
    expect(taskTitlesInTimeline.some(t => t.includes("Tarea Excluida"))).toBe(false);
    expect(taskTitlesInTimeline.some(t => t.includes("Tarea Permitida"))).toBe(true);
  });
});

describe("Bug H - require_curing_before_cutoff Protection", () => {
  it("blocks or rejects scheduling a task when require_curing_before_cutoff is true and curing extends past operational_end_hour", () => {
    const customSettings: AppSettings = {
      ...mockSettings,
      operational_start_hour: 10,
      operational_end_hour: 17, // cutoff at 17:00
      setup_hours: 1.0,
      teardown_hours: 1.0,
      min_work_hours: 2.0,
      min_work_hours_unless_final: 1.0,
      require_curing_before_cutoff: true
    };

    const forecasts = createMockForecasts(20, 50, 0, 0); // Perfect weather

    // Epoxy task: 2.0h active work + 6.0h curing
    // If work starts at 11:00 (10:00 setup -> 11:00), active ends at 13:00.
    // Curing ends at 13:00 + 6.0h = 19:00, which is > operational_end_hour (17:00).
    const epoxyTask = createMockTask({
      id: 1,
      project_id: 1,
      order: 1,
      title: "Resina Epoxi en Cubierta",
      category: TaskCategory.EPOXY,
      estimated_hours: 2.0,
      curing_hours: 6.0,
      requires_curing: true
    });

    const result = evaluateDayFeasibility("2026-08-25", [epoxyTask], forecasts, customSettings);

    // Because require_curing_before_cutoff is true, this task must NOT be scheduled and day is BLOCKED.
    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.scheduled_tasks).toBeUndefined();
  });

  it("allows passive curing to extend past operational_end_hour when require_curing_before_cutoff is false and conditions are clear", () => {
    const customSettings: AppSettings = {
      ...mockSettings,
      operational_start_hour: 10,
      operational_end_hour: 17, // cutoff at 17:00
      setup_hours: 1.0,
      teardown_hours: 1.0,
      min_work_hours: 2.0,
      min_work_hours_unless_final: 1.0,
      require_curing_before_cutoff: false
    };

    const forecasts = createMockForecasts(20, 50, 0, 0); // Perfect weather

    const epoxyTask = createMockTask({
      id: 1,
      project_id: 1,
      order: 1,
      title: "Resina Epoxi en Cubierta",
      category: TaskCategory.EPOXY,
      estimated_hours: 2.0,
      curing_hours: 6.0,
      requires_curing: true
    });

    const result = evaluateDayFeasibility("2026-08-25", [epoxyTask], forecasts, customSettings);

    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    expect(result.scheduled_tasks).toHaveLength(1);
    expect(result.scheduled_tasks![0].id).toBe(1);
  });
});

describe("Bug B - getHourlyClimateAudit Night Curing & Past Forecast Evaluation", () => {
  it("does not wrap curing hours into past early morning hours (e.g. 02:00 AM rain)", () => {
    const customSettings: AppSettings = {
      ...mockSettings,
      operational_start_hour: 14,
      operational_end_hour: 18,
      setup_hours: 0.0,
      teardown_hours: 0.0,
      require_curing_before_cutoff: false
    };

    // Forecast: heavy rain at 02:00 AM (past morning), but afternoon and evening (14:00 to 23:00) are 100% clear.
    const forecasts = createMockForecasts(20, 50, 0, 0);
    for (const f of forecasts) {
      if (f.hour === 2) {
        f.precipitation_mm = 15.0; // 02:00 AM had rain
      }
    }

    const task = createMockTask({
      id: 1,
      project_id: 1,
      order: 1,
      title: "Barnizado Tarde",
      category: TaskCategory.VARNISH_PAINT,
      estimated_hours: 2.0,
      curing_hours: 4.0, // Curing from 16:00 to 20:00
      requires_curing: true
    });

    const window: TimeWindow = {
      start_time: "14:00",
      end_time: "16:00",
      start_hour: 14,
      end_hour: 16,
      total_duration_hours: 2,
      net_work_hours: 2,
      is_viable: true
    };

    const audit = getHourlyClimateAudit(forecasts, window, [task], customSettings);

    // 02:00 AM must NOT be marked as CURING phase or have curing risk
    const audit2am = audit.find(a => a.hour === 2);
    expect(audit2am?.phase).toBe("NONE");
    expect(audit2am?.is_curing).toBe(false);

    // Hours 16 to 19 should be CURING and have NO rain risk
    const audit17pm = audit.find(a => a.hour === 17);
    expect(audit17pm?.phase).toBe("CURING");
    expect(audit17pm?.has_rain_risk).toBe(false);
  });
});

describe("Bug G - forcedTasksDetails Active Integration in Schedule & Timeline", () => {
  it("prioritizes and schedules forced tasks in scheduled_tasks and timeline", () => {
    const customSettings: AppSettings = {
      ...mockSettings,
      operational_start_hour: 8,
      operational_end_hour: 18,
      setup_hours: 1.0,
      teardown_hours: 1.0,
      min_work_hours: 2.0
    };

    const forecasts = createMockForecasts(20, 50, 0, 0);

    const normalTask = createMockTask({
      id: 10,
      project_id: 1,
      order: 1,
      title: "Tarea Normal",
      category: TaskCategory.CARPENTRY,
      estimated_hours: 2.0
    });

    const forcedTask = createMockTask({
      id: 99,
      project_id: 2,
      order: 5,
      title: "Tarea Forzada Urgente",
      category: TaskCategory.CARPENTRY,
      estimated_hours: 3.0
    });

    const forcedTasksDetails: ForcedTaskWithDetails[] = [
      {
        forced_id: 1,
        forced_start_hour: 8,
        task: forcedTask
      }
    ];

    const result = evaluateDayWithOverrides(
      "2026-08-25",
      [normalTask],
      forecasts,
      customSettings,
      new Set(),
      undefined,
      forcedTasksDetails
    );

    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    expect(result.scheduled_tasks).toBeDefined();
    // Forced task must be present and scheduled
    const scheduledIds = (result.scheduled_tasks || []).map(t => t.id);
    expect(scheduledIds).toContain(99);
    // Timeline must include the forced task
    const timelineTitles = (result.timeline || []).map(t => t.title);
    expect(timelineTitles.some(t => t.includes("Tarea Forzada Urgente"))).toBe(true);
  });
});

describe("Bug C - weather_cutoff Order and Non-Working Days / Empty Backlog", () => {
  it("does not report is_cutoff_by_weather=true on blocked non-working days (e.g. Sunday) even with rain", () => {
    const customSettings: AppSettings = {
      ...mockSettings,
      operational_start_hour: 8,
      operational_end_hour: 18,
      exclude_sundays: true
    };

    // 2026-08-09 is Sunday. Forecast has heavy rain.
    const forecasts = createMockForecasts(20, 50, 5.0, 90); // 5mm rain

    const task = createMockTask({
      id: 1,
      project_id: 1,
      order: 1,
      title: "Corte",
      category: TaskCategory.CARPENTRY,
      estimated_hours: 2.0
    });

    const result = evaluateDayFeasibility("2026-08-09", [task], forecasts, customSettings);

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.reason).toContain("domingo");
    // weather_cutoff must NOT attribute block to weather
    expect(result.weather_cutoff.is_cutoff_by_weather).toBe(false);
    expect(result.weather_cutoff.primary_factor).toBe("none");
  });

  it("does not report is_cutoff_by_weather=true when backlog is empty", () => {
    const forecasts = createMockForecasts(20, 50, 5.0, 90);
    const result = evaluateDayFeasibility("2026-08-25", [], forecasts, mockSettings);

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.reason).toContain("No hay tareas pendientes");
    expect(result.weather_cutoff.is_cutoff_by_weather).toBe(false);
    expect(result.weather_cutoff.primary_factor).toBe("none");
  });
});

describe("Bug E - Math.min and Infinity in Diagnostic Reasons", () => {
  it("does not output 'Infinity' in unassigned_reason when tasks have estimated_hours <= 0", () => {
    const customSettings: AppSettings = {
      ...mockSettings,
      operational_start_hour: 8,
      operational_end_hour: 18,
      setup_hours: 1.0,
      teardown_hours: 1.0,
      min_work_hours: 2.0
    };

    // Afternoon rain: free window is 3.0h (8 to 11), required is 1+1+2 = 4.0h -> insufficient window
    const forecasts = createMockForecasts(20, 50, 0, 0);
    for (const f of forecasts) {
      if (f.hour >= 11) f.precipitation_mm = 5.0;
    }

    const task = createMockTask({
      id: 1,
      project_id: 1,
      order: 1,
      title: "Tarea Sin Estimacion",
      category: TaskCategory.CARPENTRY,
      estimated_hours: 0
    });

    const result = evaluateDayFeasibility("2026-08-25", [task], forecasts, customSettings);

    expect(result.status).toBe(DayStatus.DAY_BLOCKED);
    expect(result.unassigned_reason).toBeDefined();
    expect(result.unassigned_reason).not.toContain("Infinity");
  });
});

describe("Phase 4 - Workshop Type and Configurable Thresholds", () => {
  it("allows work during rain when workshop_type is 'covered', but still blocks on wind gusts", () => {
    const coveredSettings: AppSettings = {
      ...mockSettings,
      workshop_type: "covered",
      operational_start_hour: 8,
      operational_end_hour: 18,
      setup_hours: 1.0,
      teardown_hours: 1.0,
      min_work_hours: 2.0
    };

    // Raining all day (2.0mm, 80% prob), but acceptable humidity (50%) and mild wind (10 km/h)
    const rainForecasts = createMockForecasts(20, 50, 2.0, 80, 10.0, 10.0);
    const task = createMockTask({
      id: 1,
      project_id: 1,
      order: 1,
      title: "Corte y Armado Bajo Techo",
      category: TaskCategory.CARPENTRY,
      estimated_hours: 3.0
    });

    const result = evaluateDayFeasibility("2026-08-25", [task], rainForecasts, coveredSettings);
    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    expect(result.scheduled_tasks.length).toBe(1);

    // But if strong wind gusts occur (>40 km/h), covered workshop is still blocked for carpentry
    const windyRainForecasts = createMockForecasts(20, 50, 2.0, 80, 10.0, 50.0);
    const resultWind = evaluateDayFeasibility("2026-08-25", [task], windyRainForecasts, coveredSettings);
    expect(resultWind.status).toBe(DayStatus.DAY_BLOCKED);
    expect(resultWind.reason).toContain("viento");
  });

  it("allows work during rain and strong wind when workshop_type is 'indoor', but blocks on cold/humidity", () => {
    const indoorSettings: AppSettings = {
      ...mockSettings,
      workshop_type: "indoor",
      operational_start_hour: 8,
      operational_end_hour: 18,
      setup_hours: 1.0,
      teardown_hours: 1.0,
      min_work_hours: 2.0
    };

    // Rain (5.0mm, 90%) and strong wind gusts (60 km/h), but warm (22°C) and normal humidity (50%)
    const harshOutdoorForecasts = createMockForecasts(22, 50, 5.0, 90, 10.0, 60.0);
    const task = createMockTask({
      id: 1,
      project_id: 1,
      order: 1,
      title: "Maquinado en Galpón Cerrado",
      category: TaskCategory.CARPENTRY,
      estimated_hours: 3.0
    });

    const result = evaluateDayFeasibility("2026-08-25", [task], harshOutdoorForecasts, indoorSettings);
    expect(result.status).toBe(DayStatus.DAY_VIABLE);
    expect(result.scheduled_tasks.length).toBe(1);

    // But if temperature is too cold for Epoxy (<15°C), indoor workshop still blocks
    const coldForecasts = createMockForecasts(12, 50, 5.0, 90, 10.0, 60.0);
    const epoxyTask = createMockTask({
      id: 2,
      project_id: 1,
      order: 2,
      title: "Vaciado de Resina",
      category: TaskCategory.EPOXY,
      estimated_hours: 2.0
    });
    const resultEpoxy = evaluateDayFeasibility("2026-08-25", [epoxyTask], coldForecasts, indoorSettings);
    expect(resultEpoxy.status).toBe(DayStatus.DAY_BLOCKED);
    expect(resultEpoxy.reason).toContain("Temperatura baja");
  });

  it("respects customized category thresholds from AppSettings", () => {
    const customSettings: AppSettings = {
      ...mockSettings,
      workshop_type: "outdoor",
      min_temp_pva_c: 12.0, // Custom stricter threshold for PVA (12°C instead of 10°C)
      max_humidity_varnish: 70.0, // Custom stricter threshold for Varnish (70% instead of 80%)
      max_wind_gust_carpentry: 30.0 // Custom stricter wind gust for Carpentry (30 km/h instead of 40 km/h)
    };

    // 1. PVA at 11°C (passes default 10°C, but fails custom 12°C)
    const pvaForecasts = createMockForecasts(11, 50, 0, 0, 8.0, 10.0);
    const pvaTask = createMockTask({
      id: 1,
      project_id: 1,
      order: 1,
      title: "Encolado",
      category: TaskCategory.PVA_GLUE,
      estimated_hours: 2.0
    });
    const resultPva = evaluateDayFeasibility("2026-08-25", [pvaTask], pvaForecasts, customSettings);
    expect(resultPva.status).toBe(DayStatus.DAY_BLOCKED);
    expect(resultPva.reason).toContain("12°C");

    // 2. Varnish at 75% humidity (passes default 80%, but fails custom 70%)
    const varnishForecasts = createMockForecasts(20, 75, 0, 0, 10.0, 15.0);
    const varnishTask = createMockTask({
      id: 2,
      project_id: 1,
      order: 2,
      title: "Barnizado fino",
      category: TaskCategory.VARNISH_PAINT,
      estimated_hours: 2.0
    });
    const resultVarnish = evaluateDayFeasibility("2026-08-25", [varnishTask], varnishForecasts, customSettings);
    expect(resultVarnish.status).toBe(DayStatus.DAY_BLOCKED);
    expect(resultVarnish.reason).toContain("70%");

    // 3. Carpentry with 35 km/h gusts (passes default 40 km/h, but fails custom 30 km/h)
    const carpForecasts = createMockForecasts(20, 50, 0, 0, 10.0, 35.0);
    const carpTask = createMockTask({
      id: 3,
      project_id: 1,
      order: 3,
      title: "Corte de tableros",
      category: TaskCategory.CARPENTRY,
      estimated_hours: 2.0
    });
    const resultCarp = evaluateDayFeasibility("2026-08-25", [carpTask], carpForecasts, customSettings);
    expect(resultCarp.status).toBe(DayStatus.DAY_BLOCKED);
    expect(resultCarp.reason).toContain("30 km/h");
  });
});




