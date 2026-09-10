import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../server.js";
import { store, initDatabase } from "../src/db.js";
import { signToken } from "../src/auth.js";
import { TaskStatus } from "../src/types.js";
import { OpenMeteoWeatherService } from "../src/weatherService.js";
import { getLocalDateIso } from "../src/dateUtils.js";

describe("Smoke & E2E Render: Planning View (views/index.ejs y components/agenda)", () => {
  let user: any;
  let token: string;

  beforeEach(async () => {
    OpenMeteoWeatherService.clearCache();
    await initDatabase();
    const email = `render_test_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com`;
    user = store.createUser(email, "Password123!");
    token = signToken({ userId: user.id, email: user.email });

    store.updateAppSettings(user.id, {
      timezone: "America/Santiago",
      operational_start_hour: 8,
      operational_end_hour: 18,
      min_work_hours: 2,
      forecast_days: 7,
      work_days: [0, 1, 2, 3, 4, 5, 6],
      exclude_saturdays: false,
      exclude_sundays: false
    });

    const project = store.addProject(user.id, "Proyecto Render Test", "Descripción");
    store.addTask(user.id, {
      project_id: project.id,
      title: "Corte y Armado de Bastidor",
      category: "carpentry",
      estimated_hours: 3,
      curing_hours: 0,
      status: TaskStatus.PENDING,
      order: 1
    });
  });

  it("renderiza views/index.ejs y components/agenda de punta a punta sin ReferenceErrors (día hoy y días futuros)", async () => {
    const res = await request(app)
      .get("/")
      .set("Cookie", `workshop_session=${token}`)
      .set("Origin", "http://127.0.0.1");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Workshop OS");
    expect(res.text).toContain("agenda-days-grid");
    // Verificar que los subcomponentes de agenda se hayan incluido e instanciado
    expect(res.text).toContain("weather-card-head");
    expect(res.text).toContain("agenda-pause-range-btn");
  });

  it("renderiza correctamente cuando show_end_shift_prompt es true (evaluando isToday y dayIndex en _card_header.ejs)", async () => {
    const todayIso = getLocalDateIso(new Date(), "America/Santiago");

    // Simulamos un daily_log con tareas agendadas y checkin_sent para activar show_end_shift_prompt
    store.saveDailyLog(user.id, {
      eval_date: todayIso,
      status: "DAY_VIABLE",
      scheduled_task_ids: JSON.stringify([1]),
      checkin_sent: true,
      checkin_resolved: false
    });

    const res = await request(app)
      .get("/?scenario=sunny")
      .set("Cookie", `workshop_session=${token}`)
      .set("Origin", "http://127.0.0.1");

    expect(res.status).toBe(200);
    expect(res.text).toContain("weather-card-head");
    // El banner flotante de check-in debe renderizarse como único punto de cierre
    expect(res.text).toContain("checkin-floating-banner");
    expect(res.text).toContain("Hacer Check-in");
    // El botón redundante de la tarjeta ya no debe existir
    expect(res.text).not.toContain("btn-end-shift-today");
  });

  it("no renderiza badge de Google Calendar si google_calendar_enabled es 0, incluso con tareas agendadas en día viable", async () => {
    store.updateAppSettings(user.id, {
      google_calendar_enabled: false
    });

    const res = await request(app)
      .get("/?scenario=sunny")
      .set("Cookie", `workshop_session=${token}`)
      .set("Origin", "http://127.0.0.1");

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("calendar-badge-synced");
    expect(res.text).not.toContain("calendar-badge-pending");
    expect(res.text).not.toContain("Sincronizado con Google Calendar");
    expect(res.text).not.toContain("pendiente de sincronizar con Google Calendar");
  });

  it("renderiza badge ámbar 'Pendiente' cuando google_calendar_enabled es 1 pero el día viable con tareas aún no está sincronizado", async () => {
    store.updateAppSettings(user.id, {
      google_calendar_enabled: true,
      google_calendar_id: "workshop_calendar_id@group.calendar.google.com"
    });

    const res = await request(app)
      .get("/?scenario=sunny")
      .set("Cookie", `workshop_session=${token}`)
      .set("Origin", "http://127.0.0.1");

    expect(res.status).toBe(200);
    expect(res.text).toContain("calendar-badge-pending");
    expect(res.text).toContain("Pendiente");
    expect(res.text).toContain("pendiente de sincronizar con Google Calendar");
    expect(res.text).not.toContain("calendar-badge-synced");
  });

  it("renderiza badge verde esmeralda 'Sync' cuando google_calendar_enabled es 1 y el día está sincronizado (calendar_created=1 y google_event_id)", async () => {
    const todayIso = getLocalDateIso(new Date(), "America/Santiago");

    store.updateAppSettings(user.id, {
      google_calendar_enabled: true,
      google_calendar_id: "workshop_calendar_id@group.calendar.google.com"
    });

    store.saveDailyLog(user.id, {
      eval_date: todayIso,
      status: "DAY_VIABLE",
      scheduled_task_ids: JSON.stringify([1]),
      calendar_created: true,
      google_event_id: "google_cal_event_mock_123"
    });

    const res = await request(app)
      .get("/?scenario=sunny")
      .set("Cookie", `workshop_session=${token}`)
      .set("Origin", "http://127.0.0.1");

    expect(res.status).toBe(200);
    expect(res.text).toContain("calendar-badge-synced");
    expect(res.text).toContain("Sync");
    expect(res.text).toContain("Sincronizado con Google Calendar");
  });
});
