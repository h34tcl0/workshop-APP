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
      operational_start_hour: 8,
      operational_end_hour: 22,
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

    // 1. Evaluación matutina inicial
    const initialEval = await runMorningEvaluation(user.id, todayIso, "sunny");
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

    // 3. Verificar estado en DB tras la re-evaluación silenciosa
    const task1After = store.getTask(user.id, task1.id);
    expect(task1After?.status).toBe(TaskStatus.COMPLETED);

    const logAfter = store.getDailyLogByDate(user.id, todayIso);
    expect(logAfter).not.toBeNull();
    expect(logAfter?.checkin_resolved).toBe(true);

    const updatedTaskIds: number[] = JSON.parse(logAfter!.scheduled_task_ids || "[]");
    // Task 1 (completada) ya NO debe estar en las tareas agendadas pendientes de hoy
    expect(updatedTaskIds).not.toContain(task1.id);
    expect(updatedTaskIds).toContain(task2.id);

    // tasks_summary debe reflejar el nuevo estado
    expect(logAfter?.tasks_summary).not.toContain("Corte de Planchas");
    expect(logAfter?.tasks_summary).toContain("Armado de Mueble");
  });

  it("re-evalúa silenciosamente al agregar o modificar tareas de proyecto", async () => {
    const user = getOrCreateUser("task_mutation_reeval@workshop.os");
    const token = signToken({ userId: user.id, email: user.email });

    store.updateAppSettings(user.id, {
      timezone: "America/Santiago",
      operational_start_hour: 8,
      operational_end_hour: 22,
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
});
