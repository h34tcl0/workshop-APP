import { describe, it, expect, beforeEach, vi } from "vitest";
import { store, initDatabase } from "../src/db.js";
import { handleSaveDayOverrideRange, handleClearDayOverrideRange } from "../src/controllers/overrideController.js";
import * as scheduler from "../src/scheduler.js";

describe("Day Override Vacation Range Unit & Integration Tests", () => {
  const userId = 1;

  beforeEach(async () => {
    await initDatabase();
    // Limpiar overrides de pruebas
    store.clearDayOverrideRange(userId, "2026-10-01", "2026-10-31");
    store.clearDayOverride(userId, "2026-10-15");
  });

  it("1. saveDayOverrideRange applies BLOCKED status to all dates within range", () => {
    const startIso = "2026-10-10";
    const endIso = "2026-10-14";

    const result = store.saveDayOverrideRange(userId, startIso, endIso, "Vacaciones de Primavera");
    expect(result.affectedDates).toEqual([
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14"
    ]);

    for (const d of result.affectedDates) {
      const ov = store.getDayOverride(userId, d);
      expect(ov).toBeDefined();
      expect(ov?.force_status).toBe("BLOCKED");
      expect(ov?.note).toBe("Vacaciones de Primavera");
      expect(ov?.range_origin).toBe("vacation_range");
    }
  });

  it("2. Preserves preexisting individual overrides and restores them upon clearDayOverrideRange", () => {
    // Escenario crítico: El usuario tenía previamente un horario especial configurado para el 2026-10-15
    const testDate = "2026-10-15";
    store.saveDayOverride(userId, testDate, {
      force_status: "VIABLE",
      custom_start_hour: 10,
      custom_end_hour: 15,
      note: "Atención técnica puntual"
    });

    const preOv = store.getDayOverride(userId, testDate);
    expect(preOv?.custom_start_hour).toBe(10);
    expect(preOv?.note).toBe("Atención técnica puntual");

    // Aplicar rango de vacaciones que abarca el día previo (2026-10-14 al 2026-10-16)
    store.saveDayOverrideRange(userId, "2026-10-14", "2026-10-16", "Viaje de capacitación");

    // Verificar que el día 15 está ahora bloqueado por vacaciones pero con previous_state_json respaldado
    const duringVacation = store.getDayOverride(userId, testDate);
    expect(duringVacation?.force_status).toBe("BLOCKED");
    expect(duringVacation?.note).toBe("Viaje de capacitación");
    expect(duringVacation?.range_origin).toBe("vacation_range");
    expect(duringVacation?.previous_state_json).toBeDefined();

    const backedUp = JSON.parse(duringVacation?.previous_state_json || "{}");
    expect(backedUp.custom_start_hour).toBe(10);
    expect(backedUp.custom_end_hour).toBe(15);
    expect(backedUp.note).toBe("Atención técnica puntual");

    // Ahora cancelar el rango de vacaciones
    const clearRes = store.clearDayOverrideRange(userId, "2026-10-14", "2026-10-16");
    expect(clearRes.restoredDates).toContain(testDate);
    expect(clearRes.clearedDates).toContain("2026-10-14");
    expect(clearRes.clearedDates).toContain("2026-10-16");

    // Los días sin override previo deben haber sido eliminados
    expect(store.getDayOverride(userId, "2026-10-14")).toBeNull();
    expect(store.getDayOverride(userId, "2026-10-16")).toBeNull();

    // El día con override previo debe haber recuperado exactamente su estado original
    const restoredOv = store.getDayOverride(userId, testDate);
    expect(restoredOv).toBeDefined();
    expect(restoredOv?.force_status).toBe("VIABLE");
    expect(restoredOv?.custom_start_hour).toBe(10);
    expect(restoredOv?.custom_end_hour).toBe(15);
    expect(restoredOv?.note).toBe("Atención técnica puntual");
    expect(restoredOv?.range_origin).toBeUndefined();
    expect(restoredOv?.previous_state_json).toBeUndefined();
  });

  it("3. Validates date bounds and rejects inverted ranges", () => {
    expect(() => {
      store.saveDayOverrideRange(userId, "2026-10-20", "2026-10-10");
    }).toThrow("startDate (2026-10-20) cannot be after endDate (2026-10-10)");

    expect(() => {
      store.clearDayOverrideRange(userId, "2026-10-20", "2026-10-10");
    }).toThrow("startDate (2026-10-20) cannot be after endDate (2026-10-10)");
  });

  it("4. HTTP Controller endpoints trigger silent reevaluation on save and clear", async () => {
    const triggerSpy = vi.spyOn(scheduler, "triggerSilentReevaluation").mockResolvedValue(undefined as any);

    // Test POST /day-overrides/range
    const reqSave: any = {
      user: { id: userId },
      body: {
        start_date: "2026-10-22",
        end_date: "2026-10-24",
        note: "Pausa programada"
      },
      headers: { accept: "application/json" }
    };
    let saveJsonData: any = null;
    const resSave: any = {
      json: (d: any) => { saveJsonData = d; return d; },
      redirect: vi.fn(),
      status: vi.fn().mockReturnThis()
    };

    await handleSaveDayOverrideRange(reqSave, resSave);
    expect(saveJsonData?.success).toBe(true);
    expect(triggerSpy).toHaveBeenCalledWith(userId);

    // Test POST /day-overrides/clear-range
    triggerSpy.mockClear();
    const reqClear: any = {
      user: { id: userId },
      body: {
        start_date: "2026-10-22",
        end_date: "2026-10-24"
      },
      headers: { accept: "application/json" }
    };
    let clearJsonData: any = null;
    const resClear: any = {
      json: (d: any) => { clearJsonData = d; return d; },
      redirect: vi.fn(),
      status: vi.fn().mockReturnThis()
    };

    await handleClearDayOverrideRange(reqClear, resClear);
    expect(clearJsonData?.success).toBe(true);
    expect(triggerSpy).toHaveBeenCalledWith(userId);

    triggerSpy.mockRestore();
  });
});
