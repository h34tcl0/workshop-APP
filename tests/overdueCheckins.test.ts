import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { store, initDatabase } from "../src/db.js";
import { signToken } from "../src/auth.js";
import { app } from "../server.js";
import { DayStatus, TaskStatus } from "../src/types.js";
import { getLocalDateIso } from "../src/dateUtils.js";
import * as scheduler from "../src/scheduler.js";

describe("Jornadas Vencidas Acumuladas & Rescate (Cambio B)", () => {
  beforeEach(async () => {
    await initDatabase();
  });

  const getOrCreateUser = (baseEmail: string) => {
    const uniqueEmail = `${baseEmail.split('@')[0]}_${Date.now()}_${Math.floor(Math.random() * 1000)}@workshop.os`;
    return store.createUser(uniqueEmail, "Password123!");
  };

  it("Detecta múltiples días vencidos acumulados, los expone en la UI y la acción masiva reprograma y dispara triggerSilentReevaluation", async () => {
    const user = getOrCreateUser("overdue_multi@workshop.os");
    const token = signToken({ userId: user.id, email: user.email });

    store.updateAppSettings(user.id, {
      timezone: "America/Santiago",
      operational_start_hour: 8,
      operational_end_hour: 18
    });

    const project = store.addProject(user.id, "Proyecto Antiguo", "Trabajos acumulados");
    const task1 = store.addTask(user.id, {
      project_id: project.id,
      title: "Corte de Tablas",
      category: "carpentry",
      estimated_hours: 2,
      status: TaskStatus.PENDING
    });
    const task2 = store.addTask(user.id, {
      project_id: project.id,
      title: "Lijado Fino",
      category: "carpentry",
      estimated_hours: 3,
      status: TaskStatus.PENDING
    });

    const now = new Date();
    const todayIso = getLocalDateIso(now, "America/Santiago");

    // Generar 3 fechas pasadas anteriores a hoy (hace 4 días, hace 3 días, hace 2 días)
    const d1 = new Date(now.getTime() - 4 * 86400000);
    const d2 = new Date(now.getTime() - 3 * 86400000);
    const d3 = new Date(now.getTime() - 2 * 86400000);

    const date1Iso = getLocalDateIso(d1, "America/Santiago");
    const date2Iso = getLocalDateIso(d2, "America/Santiago");
    const date3Iso = getLocalDateIso(d3, "America/Santiago");

    // Guardar 3 daily_logs sin resolver con tareas agendadas
    store.saveDailyLog(user.id, {
      eval_date: date1Iso,
      status: DayStatus.DAY_VIABLE,
      scheduled_task_ids: JSON.stringify([task1.id]),
      checkin_resolved: false
    });

    store.saveDailyLog(user.id, {
      eval_date: date2Iso,
      status: DayStatus.DAY_VIABLE,
      scheduled_task_ids: JSON.stringify([task2.id]),
      checkin_resolved: false
    });

    store.saveDailyLog(user.id, {
      eval_date: date3Iso,
      status: DayStatus.DAY_VIABLE,
      scheduled_task_ids: JSON.stringify([task1.id, task2.id]),
      checkin_resolved: false
    });

    // 1. Verificar repositorio: getOverdueUnresolvedLogs debe retornar los 3 días ordenados ASC
    const overdueLogs = store.getOverdueUnresolvedLogs(user.id, todayIso);
    expect(overdueLogs.length).toBe(3);
    expect(overdueLogs[0].eval_date).toBe(date1Iso);
    expect(overdueLogs[1].eval_date).toBe(date2Iso);
    expect(overdueLogs[2].eval_date).toBe(date3Iso);

    // 2. Render de la UI en GET /: debe contener el chip con el conteo de 3 jornadas
    const getRes = await request(app)
      .get("/")
      .set("Cookie", `workshop_session=${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.text).toContain("btn-overdue-checkins-alert");
    expect(getRes.text).toContain("3 jornadas pendientes");
    expect(getRes.text).toContain("overdue-checkins-modal");

    // 3. Spy sobre triggerSilentReevaluation para confirmar el Punto 3 del requerimiento
    const reevalSpy = vi.spyOn(scheduler, "triggerSilentReevaluation");

    // 4. Ejecutar la acción masiva "Reprogramar todas las tareas pendientes al backlog"
    const postRes = await request(app)
      .post("/api/checkin/resolve-all-overdue")
      .set("Origin", "http://127.0.0.1")
      .set("Cookie", `workshop_session=${token}`)
      .set("Accept", "application/json");

    expect(postRes.status).toBe(200);
    expect(postRes.body.success).toBe(true);
    expect(postRes.body.resolvedCount).toBe(3);

    // Confirmación Punto 3: Se dispara triggerSilentReevaluation
    expect(reevalSpy).toHaveBeenCalledWith(user.id, todayIso);

    // 5. Verificar que en DB los 3 días quedaron con checkin_resolved = true
    const overdueLogsAfter = store.getOverdueUnresolvedLogs(user.id, todayIso);
    expect(overdueLogsAfter.length).toBe(0);

    const log1 = store.getDailyLogByDate(user.id, date1Iso);
    const log2 = store.getDailyLogByDate(user.id, date2Iso);
    const log3 = store.getDailyLogByDate(user.id, date3Iso);
    expect(log1?.checkin_resolved).toBe(true);
    expect(log2?.checkin_resolved).toBe(true);
    expect(log3?.checkin_resolved).toBe(true);

    // 6. En el siguiente GET /, el chip de alerta ya no debe aparecer
    const getResAfter = await request(app)
      .get("/")
      .set("Cookie", `workshop_session=${token}`);

    expect(getResAfter.status).toBe(200);
    expect(getResAfter.text).not.toContain("btn-overdue-checkins-alert");
  });
});
