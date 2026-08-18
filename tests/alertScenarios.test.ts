import { describe, it, expect, beforeEach, vi } from "vitest";
import { store, initDatabase } from "../src/db.js";
import * as weatherSvc from "../src/weatherService.js";
import { TelegramBotService } from "../src/telegramBot.js";
import { processWeatherAlertForUser, processWorkStartNotificationsForUser, runMorningEvaluation } from "../src/scheduler.js";
import { DayStatus, HourlyForecast } from "../src/types.js";

function buildMockForecasts(rainHour: number | null, humidHour: number | null): HourlyForecast[] {
  const forecasts: HourlyForecast[] = [];
  for (let h = 0; h < 24; h++) {
    const isRain = rainHour === h;
    const isHumid = humidHour === h;
    forecasts.push({
      hour: h,
      temperature_c: 20,
      relative_humidity: isHumid ? 85 : 50,
      precipitation_mm: isRain ? 2.5 : 0,
      precipitation_probability: isRain ? 80 : 0,
      cloud_cover_percent: 10
    });
  }
  return forecasts;
}

describe("Weather Alert Scenarios (Humidity vs. Rain)", () => {
  const userId = 1;
  const todayIso = "2026-08-10";
  const mockNow = new Date("2026-08-10T12:00:00-04:00"); // 12:00 hrs midday

  beforeEach(async () => {
    await initDatabase();
    // Prepare settings
    store.updateAppSettings(userId, {
      operational_start_hour: 8,
      operational_end_hour: 19,
      max_humidity_percent: 80.0,
      min_rain_precipitation_mm: 0.1,
      latitude: -32.99,
      longitude: -71.27,
      telegram_chat_id: "12345678"
    });

    // Reset daily log for today
    store.saveDailyLog(userId, {
      eval_date: todayIso,
      status: DayStatus.DAY_VIABLE,
      window_start: "08:00",
      window_end: "19:00",
      humidity_alert_sent: false,
      intraday_alert_triggered: false,
      intraday_alert_acknowledged: false,
      intraday_alert_burst_count: 0,
      weather_alert_message: null
    });

    // Mock telegram burst and message
    vi.spyOn(TelegramBotService.prototype, "sendIntradayEmergencyAlertBurst").mockResolvedValue(true);
    vi.spyOn(TelegramBotService.prototype, "sendTelegramMessage").mockResolvedValue(true);
  });

  it("Scenario a: Solo alerta de humedad -> envía 1 vez, marca humidity_alert_sent=true y NO repite ni activa ráfaga", async () => {
    const forecasts = buildMockForecasts(null, 18); // Humedad a las 18:00
    vi.spyOn(weatherSvc, "getHourlyForecast").mockResolvedValue(forecasts);

    // 1st tick
    await processWeatherAlertForUser(userId, mockNow);

    let log = store.getDailyLogByDate(userId, todayIso)!;
    expect(log.humidity_alert_sent).toBe(true);
    expect(log.intraday_alert_triggered).toBe(false); // NO activa emergencia
    expect(log.intraday_alert_burst_count).toBe(0);

    const telegramMsgSpy = vi.spyOn(TelegramBotService.prototype, "sendTelegramMessage");

    // 2nd tick (5 mins later)
    const mockNow2 = new Date("2026-08-10T12:05:00-04:00");
    await processWeatherAlertForUser(userId, mockNow2);

    log = store.getDailyLogByDate(userId, todayIso)!;
    // No se volvió a enviar la notificación de humedad
    expect(log.humidity_alert_sent).toBe(true);
    expect(log.intraday_alert_burst_count).toBe(0);
  });

  it("Scenario b: Solo alerta de lluvia -> se dispara ráfaga cada 5 min hasta que se confirme", async () => {
    const forecasts = buildMockForecasts(17, null); // Lluvia a las 17:00
    vi.spyOn(weatherSvc, "getHourlyForecast").mockResolvedValue(forecasts);

    // 1st tick
    await processWeatherAlertForUser(userId, mockNow);

    let log = store.getDailyLogByDate(userId, todayIso)!;
    expect(log.intraday_alert_triggered).toBe(true);
    expect(log.intraday_alert_acknowledged).toBe(false);
    expect(log.intraday_alert_burst_count).toBe(1);

    // 2nd tick (5 min later, no acknowledged)
    const mockNow2 = new Date("2026-08-10T12:05:00-04:00");
    await processWeatherAlertForUser(userId, mockNow2);

    log = store.getDailyLogByDate(userId, todayIso)!;
    expect(log.intraday_alert_burst_count).toBe(2); // Ráfaga incrementada
  });

  it("Scenario c: Humedad ya enviada + luego llega lluvia -> la lluvia SÍ se dispara con emergencia", async () => {
    // Paso 1: Primero solo humedad
    let forecasts = buildMockForecasts(null, 18);
    vi.spyOn(weatherSvc, "getHourlyForecast").mockResolvedValue(forecasts);

    await processWeatherAlertForUser(userId, mockNow);

    let log = store.getDailyLogByDate(userId, todayIso)!;
    expect(log.humidity_alert_sent).toBe(true);
    expect(log.intraday_alert_triggered).toBe(false);

    // Paso 2: Llega pronóstico de lluvia a las 17:00
    forecasts = buildMockForecasts(17, 18);
    vi.spyOn(weatherSvc, "getHourlyForecast").mockResolvedValue(forecasts);

    const mockNow2 = new Date("2026-08-10T12:05:00-04:00");
    await processWeatherAlertForUser(userId, mockNow2);

    log = store.getDailyLogByDate(userId, todayIso)!;
    expect(log.intraday_alert_triggered).toBe(true); // Se disparó la emergencia por lluvia
    expect(log.intraday_alert_burst_count).toBe(1);
  });

  it("Scenario d (CRÍTICO): Lluvia a las 18:00 ya CONFIRMADA por operario -> Pronóstico se ADELANTA a las 17:00 -> Relanza ráfaga de emergencia", async () => {
    // Estado inicial: Lluvia a las 18:00 alertada y CONFIRMADA por el operario
    store.updateDailyLog(userId, store.getDailyLogByDate(userId, todayIso)!.id, {
      intraday_alert_triggered: true,
      intraday_alert_acknowledged: true, // Operario dio confirmación previa
      last_rain_alert_hour: 18,
      weather_alert_message: "Alerta previa de lluvia a las 18:00 hrs"
    });

    let log = store.getDailyLogByDate(userId, todayIso)!;
    expect(log.intraday_alert_acknowledged).toBe(true);

    // Llega actualización meteorológica: Lluvia se ADELANTÓ a las 17:00 hrs
    const forecasts = buildMockForecasts(17, null);
    vi.spyOn(weatherSvc, "getHourlyForecast").mockResolvedValue(forecasts);

    const burstSpy = vi.spyOn(TelegramBotService.prototype, "sendIntradayEmergencyAlertBurst");
    await processWeatherAlertForUser(userId, mockNow);

    log = store.getDailyLogByDate(userId, todayIso)!;
    expect(log.intraday_alert_triggered).toBe(true);
    expect(log.intraday_alert_acknowledged).toBe(false); // RE-ACTIVÓ LA CONFIRMACIÓN
    expect(burstSpy).toHaveBeenCalledWith(log.id, expect.stringContaining("¡ALERTA URGENTE DE LLUVIA ADELANTADA!"));
    expect(log.last_rain_alert_hour).toBe(17);
    expect(log.intraday_alert_burst_count).toBe(1);
  });

  describe("Tier 2 Work Start Notifications - Expiration & Timing Rules", () => {
    it("Scenario: does NOT send Telegram notification if current time is after window_end (e.g. window 14:00-19:30, evaluated at 21:26)", async () => {
      // Setup day log with viable window 14:00 - 19:30
      const task = store.addTask(userId, {
        project_id: 1,
        title: "Montaje final de herrajes",
        estimated_hours: 2.0,
        order: 1
      });

      store.saveDailyLog(userId, {
        eval_date: todayIso,
        status: DayStatus.DAY_VIABLE,
        window_start: "14:00",
        window_end: "19:30",
        scheduled_task_ids: JSON.stringify([task.id]),
        telegram_notified: false
      });

      const telegramSpy = vi.spyOn(TelegramBotService.prototype, "sendWorkStartNotification").mockResolvedValue(true);
      telegramSpy.mockClear();

      // Current time is 21:26 (nighttime, after window_end)
      const lateNight = new Date("2026-08-10T21:26:00-04:00");
      const result = await processWorkStartNotificationsForUser(userId, lateNight);

      expect(result.sent).toBe(false);
      expect(result.reason).toContain("ya finalizó");
      expect(telegramSpy).not.toHaveBeenCalled();

      // Verify dailyLog was NOT marked as notified
      const log = store.getDailyLogByDate(userId, todayIso)!;
      expect(log.telegram_notified).toBe(false);
    });

    it("Scenario: does NOT send Telegram notification if current time is before window_start (e.g. window 14:00-19:30, evaluated at 10:00)", async () => {
      const task = store.addTask(userId, {
        project_id: 1,
        title: "Montaje final de herrajes",
        estimated_hours: 2.0,
        order: 1
      });

      store.saveDailyLog(userId, {
        eval_date: todayIso,
        status: DayStatus.DAY_VIABLE,
        window_start: "14:00",
        window_end: "19:30",
        scheduled_task_ids: JSON.stringify([task.id]),
        telegram_notified: false
      });

      const telegramSpy = vi.spyOn(TelegramBotService.prototype, "sendWorkStartNotification").mockResolvedValue(true);
      telegramSpy.mockClear();

      // Current time is 10:00 (morning, before window_start)
      const earlyMorning = new Date("2026-08-10T10:00:00-04:00");
      const result = await processWorkStartNotificationsForUser(userId, earlyMorning);

      expect(result.sent).toBe(false);
      expect(result.reason).toContain("Notificación programada para el inicio");
      expect(telegramSpy).not.toHaveBeenCalled();
    });

    it("Scenario: sends Telegram notification when current time is at or within window_start and window_end (e.g. 14:05)", async () => {
      const task = store.addTask(userId, {
        project_id: 1,
        title: "Montaje final de herrajes",
        estimated_hours: 2.0,
        order: 1
      });

      store.saveDailyLog(userId, {
        eval_date: todayIso,
        status: DayStatus.DAY_VIABLE,
        window_start: "14:00",
        window_end: "19:30",
        scheduled_task_ids: JSON.stringify([task.id]),
        telegram_notified: false
      });

      const telegramSpy = vi.spyOn(TelegramBotService.prototype, "sendWorkStartNotification").mockResolvedValue(true);
      telegramSpy.mockClear();

      // Current time is 14:05 (start of work window)
      const workStart = new Date("2026-08-10T14:05:00-04:00");
      const result = await processWorkStartNotificationsForUser(userId, workStart);

      expect(result.sent).toBe(true);
      expect(telegramSpy).toHaveBeenCalledTimes(1);

      const log = store.getDailyLogByDate(userId, todayIso)!;
      expect(log.telegram_notified).toBe(true);
    });
  });
});
