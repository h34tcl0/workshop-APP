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

  it("Auto-cierre silencioso (autoCloseOverdueDays y catch-up) NO envía ninguna notificación de Telegram", async () => {
    const user = getOrCreateUser("silent_autoclose@workshop.os");
    const targetChatId = "987654321";

    store.updateAppSettings(user.id, {
      timezone: "America/Santiago",
      telegram_chat_id: targetChatId,
      operational_start_hour: 8,
      operational_end_hour: 18
    });

    const origBotToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";

    try {
      const project = store.addProject(user.id, "Backlog Pasado", "Días vencidos");
      const task1 = store.addTask(user.id, {
        project_id: project.id,
        title: "Tarea Atrasada 1",
        estimated_hours: 2,
        status: TaskStatus.IN_PROGRESS
      });
      const task2 = store.addTask(user.id, {
        project_id: project.id,
        title: "Tarea Atrasada 2",
        estimated_hours: 1,
        status: TaskStatus.PENDING
      });

      const now = new Date();
      const todayIso = getLocalDateIso(now, "America/Santiago");
      const pastDate1 = getLocalDateIso(new Date(now.getTime() - 5 * 86400000), "America/Santiago");
      const pastDate2 = getLocalDateIso(new Date(now.getTime() - 2 * 86400000), "America/Santiago");

      store.saveDailyLog(user.id, {
        eval_date: pastDate1,
        status: DayStatus.DAY_VIABLE,
        scheduled_task_ids: JSON.stringify([task1.id]),
        checkin_resolved: false
      });

      store.saveDailyLog(user.id, {
        eval_date: pastDate2,
        status: DayStatus.DAY_VIABLE,
        scheduled_task_ids: JSON.stringify([task2.id]),
        checkin_resolved: false
      });

      // Espiar todos los métodos de envío en TelegramBotService
      const { TelegramBotService } = await import("../src/telegramBot.js");
      const sendMsgSpy = vi.spyOn(TelegramBotService.prototype, "sendTelegramMessage").mockResolvedValue(true);
      const sendPromptSpy = vi.spyOn(TelegramBotService.prototype, "sendCheckinPrompt").mockResolvedValue(true);

      const { DayService } = await import("../src/services/dayService.js");
      const { runCatchupOverdueDaysTick } = await import("../src/scheduler.js");

      // Ejecutar catch-up y autoCloseOverdueDays
      const count = await DayService.autoCloseOverdueDays(user.id, todayIso);
      expect(count).toBe(2);

      // Ejecutar el tick de catch-up
      await runCatchupOverdueDaysTick(now);

      // Verificar que ambos días están marcados como resueltos
      const log1 = store.getDailyLogByDate(user.id, pastDate1);
      const log2 = store.getDailyLogByDate(user.id, pastDate2);
      expect(log1?.checkin_resolved).toBe(true);
      expect(log2?.checkin_resolved).toBe(true);
      expect(log1?.block_reason).toContain("Auto-cierre a medianoche");

      // Verificar que las tareas volvieron al backlog como PENDING
      const t1After = store.getTask(user.id, task1.id);
      expect(t1After?.status).toBe(TaskStatus.PENDING);

      // VERIFICACIÓN CLAVE: Ningún método de Telegram debe haber sido invocado
      expect(sendMsgSpy).toHaveBeenCalledTimes(0);
      expect(sendPromptSpy).toHaveBeenCalledTimes(0);
    } finally {
      process.env.TELEGRAM_BOT_TOKEN = origBotToken;
      vi.restoreAllMocks();
    }
  });

  it("Resolución MANUAL de un día vencido desde la web/modal SÍ envía notificación a Telegram con origin: 'user'", async () => {
    const user = getOrCreateUser("manual_overdue_user@workshop.os");
    const token = signToken({ userId: user.id, email: user.email });
    const targetChatId = "555123456";

    store.updateAppSettings(user.id, {
      timezone: "America/Santiago",
      telegram_chat_id: targetChatId,
      operational_start_hour: 8,
      operational_end_hour: 18
    });

    const origBotToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";

    try {
      const project = store.addProject(user.id, "Proyecto Manual", "Cierre manual");
      const task = store.addTask(user.id, {
        project_id: project.id,
        title: "Tarea Manual Vencida",
        estimated_hours: 3,
        status: TaskStatus.PENDING
      });

      const now = new Date();
      // Fecha pasada vencida (hace 10 días)
      const overdueDateIso = getLocalDateIso(new Date(now.getTime() - 10 * 86400000), "America/Santiago");

      store.saveDailyLog(user.id, {
        eval_date: overdueDateIso,
        status: DayStatus.DAY_VIABLE,
        scheduled_task_ids: JSON.stringify([task.id]),
        checkin_resolved: false
      });

      const { TelegramBotService } = await import("../src/telegramBot.js");
      const sendMsgSpy = vi.spyOn(TelegramBotService.prototype, "sendTelegramMessage").mockResolvedValue(true);

      // El usuario resuelve manualmente la jornada vencida vía POST /api/checkin/resolve (desde el modal de vencidos)
      const res = await request(app)
        .post("/api/checkin/resolve")
        .set("Origin", "http://127.0.0.1")
        .set("Cookie", `workshop_session=${token}`)
        .set("Accept", "application/json")
        .send({
          dateIso: overdueDateIso,
          completedTaskIds: [task.id]
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verificamos que se actualizó el estado en DB
      const log = store.getDailyLogByDate(user.id, overdueDateIso);
      expect(log?.checkin_resolved).toBe(true);
      const updatedTask = store.getTask(user.id, task.id);
      expect(updatedTask?.status).toBe(TaskStatus.COMPLETED);

      // VERIFICACIÓN CLAVE: La acción manual SI notifica a Telegram aunque la fecha sea del pasado
      expect(sendMsgSpy).toHaveBeenCalledTimes(1);
      const [calledChatId, calledMessage] = sendMsgSpy.mock.calls[0];
      expect(calledChatId).toBe(targetChatId);
      expect(calledMessage).toContain("Cierre de Jornada Registrado (Vía Web)");
      expect(calledMessage).toContain(overdueDateIso);
      expect(calledMessage).toContain("Tareas marcadas como completadas: <b>1 / 1</b>");
    } finally {
      process.env.TELEGRAM_BOT_TOKEN = origBotToken;
      vi.restoreAllMocks();
    }
  });

  it("La supresión de notificación se rige exclusivamente por 'origin' y NUNCA por 'fecha < today'", async () => {
    const user = getOrCreateUser("flag_origin_test@workshop.os");
    const targetChatId = "777888999";

    store.updateAppSettings(user.id, {
      timezone: "America/Santiago",
      telegram_chat_id: targetChatId
    });

    const origBotToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";

    try {
      const { TelegramBotService } = await import("../src/telegramBot.js");
      const sendMsgSpy = vi.spyOn(TelegramBotService.prototype, "sendTelegramMessage").mockResolvedValue(true);
      const { DayService } = await import("../src/services/dayService.js");

      const now = new Date();
      const todayIso = getLocalDateIso(now, "America/Santiago");
      const pastIso = getLocalDateIso(new Date(now.getTime() - 30 * 86400000), "America/Santiago");

      // Caso 1: Fecha de HOY resuelta con origin: 'auto_midnight' -> NO debe notificar
      const autoTodayResult = await DayService.resolveDayCheckin({
        userId: user.id,
        dateIso: todayIso,
        origin: 'auto_midnight',
        triggerReeval: false
      });
      expect(autoTodayResult.telegramSent).toBe(false);
      expect(sendMsgSpy).toHaveBeenCalledTimes(0);

      // Caso 2: Fecha de HACE 30 DÍAS resuelta con origin: 'user' -> SÍ debe notificar
      const userPastResult = await DayService.resolveDayCheckin({
        userId: user.id,
        dateIso: pastIso,
        origin: 'user',
        triggerReeval: false
      });
      expect(userPastResult.telegramSent).toBe(true);
      expect(sendMsgSpy).toHaveBeenCalledTimes(1);
    } finally {
      process.env.TELEGRAM_BOT_TOKEN = origBotToken;
      vi.restoreAllMocks();
    }
  });
});

