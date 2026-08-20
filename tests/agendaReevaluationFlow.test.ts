import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { store, initDatabase } from "../src/db.js";
import { signToken } from "../src/auth.js";
import { app } from "../server.js";
import { TaskStatus } from "../src/types.js";
import { runMorningEvaluation, getLocalDateIso } from "../src/scheduler.js";

describe("Agenda Silent Re-evaluation Flow Post Check-in & Data Mutations", () => {
  beforeEach(async () => {
    await initDatabase();
  });

  const getOrCreateUser = (baseEmail: string) => {
    const uniqueEmail = `${baseEmail.split('@')[0]}_${Date.now()}_${Math.floor(Math.random() * 1000)}@workshop.os`;
    return store.createUser(uniqueEmail, "Password123!");
  };

  it("actualiza el snapshot en daily_logs y el horizonte tras resolver check-in con /api/checkin/resolve", async () => {
    const user = getOrCreateUser("checkin_reeval@workshop.os");
    const token = signToken({ userId: user.id, email: user.email });

    store.updateAppSettings(user.id, {
      timezone: "America/Santiago",
      operational_start_hour: 0,
      operational_end_hour: 24,
      min_work_hours: 1,
      min_work_hours_unless_final: 1,
      forecast_days: 7,
      work_days: [0, 1, 2, 3, 4, 5, 6],
      exclude_saturdays: false,
      exclude_sundays: false
    });

    const project = store.addProject(user.id, "Proyecto Reevaluacion", "Desc");
    const task1 = store.addTask(user.id, {
      project_id: project.id,
      title: "Corte de Planchas",
      category: "carpentry",
      estimated_hours: 2,
      curing_hours: 0,
      status: TaskStatus.PENDING,
      order: 1
    });

    const task2 = store.addTask(user.id, {
      project_id: project.id,
      title: "Armado de Mueble",
      category: "carpentry",
      estimated_hours: 2,
      curing_hours: 0,
      status: TaskStatus.PENDING,
      order: 2
    });

    const task3 = store.addTask(user.id, {
      project_id: project.id,
      title: "Barnizado Final",
      category: "carpentry",
      estimated_hours: 2,
      curing_hours: 0,
      status: TaskStatus.PENDING,
      order: 3
    });

    const todayIso = getLocalDateIso(new Date(), "America/Santiago");

    // 1. Evaluación matutina inicial (simulando 10:00 AM)
    const morningDate = new Date(`${todayIso}T14:00:00Z`); // 10:00 AM en Santiago (UTC-4)
    const initialEval = await runMorningEvaluation(user.id, todayIso, "sunny", { nowDate: morningDate });
    expect(initialEval.status).toBe("DAY_VIABLE");

    const logBefore = store.getDailyLogByDate(user.id, todayIso);
    expect(logBefore).not.toBeNull();
    const initialTaskIds: number[] = JSON.parse(logBefore!.scheduled_task_ids || "[]");
    expect(initialTaskIds).toContain(task1.id);
    expect(initialTaskIds).toContain(task2.id);
    expect(initialTaskIds).toContain(task3.id);

    // 2. Simular Check-In: Operario completa Task 1, deja Task 2 y Task 3 pendientes
    const res = await request(app)
      .post("/api/checkin/resolve")
      .set("Origin", "http://127.0.0.1")
      .set("Cookie", `workshop_session=${token}`)
      .send({
        dailyLogId: logBefore!.id,
        completedTaskIds: [task1.id]
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // 3. Verificar estado en DB tras la resolución de check-in (jornada cerrada)
    const task1After = store.getTask(user.id, task1.id);
    expect(task1After?.status).toBe(TaskStatus.COMPLETED);

    const logAfter = store.getDailyLogByDate(user.id, todayIso);
    expect(logAfter).not.toBeNull();
    expect(logAfter?.checkin_resolved).toBe(true);

    // Al estar resuelto/cerrado el checkin de hoy, hoy queda DAY_BLOCKED (concluida)
    expect(logAfter?.status).toBe("DAY_BLOCKED");
    expect(logAfter?.block_reason).toContain("Jornada concluida");

    // Y las tareas restantes (Task 2 y Task 3) se agendan para MAÑANA
    const tomorrowDate = new Date(`${todayIso}T12:00:00Z`);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowIso = tomorrowDate.toISOString().split("T")[0];

    const tomorrowLog = store.getDailyLogByDate(user.id, tomorrowIso);
    expect(tomorrowLog?.status).toBe("DAY_VIABLE");
    expect(tomorrowLog?.tasks_summary).toContain("Armado de Mueble");
    expect(tomorrowLog?.tasks_summary).toContain("Barnizado Final");
  });

  it("re-evalúa silenciosamente al agregar o modificar tareas de proyecto", async () => {
    const user = getOrCreateUser("task_mutation_reeval@workshop.os");
    const token = signToken({ userId: user.id, email: user.email });

    store.updateAppSettings(user.id, {
      timezone: "America/Santiago",
      operational_start_hour: 0,
      operational_end_hour: 25,
      min_work_hours: 1,
      min_work_hours_unless_final: 1,
      forecast_days: 7,
      work_days: [0, 1, 2, 3, 4, 5, 6],
      exclude_saturdays: false,
      exclude_sundays: false
    });

    const project = store.addProject(user.id, "Proyecto Mutacion", "Desc");
    const task1 = store.addTask(user.id, {
      project_id: project.id,
      title: "Lijado Inicial",
      category: "carpentry",
      estimated_hours: 2,
      curing_hours: 0,
      status: TaskStatus.PENDING
    });

    const todayIso = getLocalDateIso(new Date(), "America/Santiago");
    await runMorningEvaluation(user.id, todayIso, "sunny");

    const logBefore = store.getDailyLogByDate(user.id, todayIso);
    expect(logBefore?.tasks_summary).toContain("Lijado Inicial");

    // Mutación: Modificar la tarea existente para verificar re-evaluación silenciosa
    const updateRes = await request(app)
      .post(`/tasks/${task1.id}/update`)
      .set("Origin", "http://127.0.0.1")
      .set("Cookie", `workshop_session=${token}`)
      .type("form")
      .send({
        title: "Lijado Avanzado y Pulido",
        category: "carpentry",
        estimated_hours: "2",
        project_id: project.id
      });

    expect(updateRes.status).toBe(303);

    // Aguardamos que la re-evaluación silenciosa en background finalice
    await new Promise(resolve => setTimeout(resolve, 800));

    const logAfter = store.getDailyLogByDate(user.id, todayIso);
    expect(logAfter?.tasks_summary).toContain("Lijado Avanzado y Pulido");
  });

  it("excluye el día actual si checkin_resolved=true o la hora actual está fuera del horario operativo, asignando las tareas a mañana", async () => {
    const user = getOrCreateUser("closed_day_test@workshop.os");
    const token = signToken({ userId: user.id, email: user.email });

    store.updateAppSettings(user.id, {
      timezone: "America/Santiago",
      operational_start_hour: 8,
      operational_end_hour: 21,
      min_work_hours: 2,
      min_work_hours_unless_final: 1,
      forecast_days: 7,
      work_days: [0, 1, 2, 3, 4, 5, 6],
      exclude_saturdays: false,
      exclude_sundays: false
    });

    const project = store.addProject(user.id, "Proyecto Tarde Noche", "Desc");
    const task15 = store.addTask(user.id, {
      project_id: project.id,
      title: "Montaje final de herrajes",
      category: "carpentry",
      estimated_hours: 2,
      curing_hours: 0,
      status: TaskStatus.PENDING,
      order: 1
    });

    const todayIso = getLocalDateIso(new Date(), "America/Santiago");
    const startDateObj = new Date(`${todayIso}T12:00:00Z`);
    const tomorrowDate = new Date(startDateObj);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowIso = tomorrowDate.toISOString().split("T")[0];

    // Simular que el usuario ya cerró la jornada de hoy (checkin_resolved = true)
    store.saveDailyLog(user.id, {
      eval_date: todayIso,
      status: "DAY_BLOCKED",
      block_reason: "Jornada cerrada",
      checkin_sent: true,
      checkin_resolved: true
    });

    // Ejecutar evaluación matutina / manual con escenario soleado
    await runMorningEvaluation(user.id, todayIso, "sunny");

    const todayLog = store.getDailyLogByDate(user.id, todayIso);
    const tomorrowLog = store.getDailyLogByDate(user.id, tomorrowIso);

    // Hoy debe estar concluido y sin tareas asignadas
    expect(todayLog?.status).toBe("DAY_BLOCKED");
    expect(todayLog?.block_reason).toContain("Jornada concluida");
    expect(todayLog?.tasks_summary).toBeNull();

    // Mañana debe recibir la tarea #15
    expect(tomorrowLog?.status).toBe("DAY_VIABLE");
    expect(tomorrowLog?.tasks_summary).toContain("Montaje final de herrajes");
  });

  it("permite agendamiento normal para hoy a media mañana (sin check-in resuelto y con tiempo suficiente)", async () => {
    const user = getOrCreateUser("morning_active_test@workshop.os");

    store.updateAppSettings(user.id, {
      timezone: "America/Santiago",
      operational_start_hour: 0,
      operational_end_hour: 24, // ventana completa 24h para simular disponibilidad
      min_work_hours: 1,
      min_work_hours_unless_final: 1,
      forecast_days: 7,
      work_days: [0, 1, 2, 3, 4, 5, 6],
      exclude_saturdays: false,
      exclude_sundays: false
    });

    const project = store.addProject(user.id, "Proyecto Matutino", "Desc");
    const task = store.addTask(user.id, {
      project_id: project.id,
      title: "Lijado Matutino",
      category: "carpentry",
      estimated_hours: 2,
      curing_hours: 0,
      status: TaskStatus.PENDING,
      order: 1
    });

    const todayIso = getLocalDateIso(new Date(), "America/Santiago");
    const morningDate = new Date(`${todayIso}T14:00:00Z`); // 10:00 AM en Santiago (UTC-4)

    // Ejecutar evaluación con tiempo operativo suficiente y sin checkin resuelto
    await runMorningEvaluation(user.id, todayIso, "sunny", { nowDate: morningDate });

    const todayLog = store.getDailyLogByDate(user.id, todayIso);
    expect(todayLog?.status).toBe("DAY_VIABLE");
    expect(todayLog?.tasks_summary).toContain("Lijado Matutino");
  });
});
