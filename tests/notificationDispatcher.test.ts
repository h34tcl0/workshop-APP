import { describe, it, expect, beforeEach, vi } from "vitest";
import { store, initDatabase } from "../src/db.js";
import { NotificationDispatcher } from "../src/notificationDispatcher.js";
import { TelegramBotService } from "../src/telegramBot.js";
import * as weatherSvc from "../src/weatherService.js";
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

describe("NotificationDispatcher Direct Tier Unit Tests", () => {
  const userId = 1;
  const todayIso = "2026-08-10";

  beforeEach(async () => {
    await initDatabase();
    store.updateAppSettings(userId, {
      operational_start_hour: 8,
      operational_end_hour: 19,
      checkin_hour: 19,
      max_humidity_percent: 80.0,
      min_rain_precipitation_mm: 0.1,
      latitude: -32.99,
      longitude: -71.27,
      telegram_chat_id: "987654321"
    });
    vi.restoreAllMocks();
  });

  describe("Tier 2: Work Start Notifications (processWorkStartNotification)", () => {
    it("envía la notificación de inicio y marca telegram_notified=true cuando la hora actual está dentro de la ventana de trabajo", async () => {
      const task = store.addTask(userId, {
        project_id: 1,
        title: "Calibración y fresado",
        estimated_hours: 2.0,
        order: 1
      });

      store.saveDailyLog(userId, {
        eval_date: todayIso,
        status: DayStatus.DAY_VIABLE,
        window_start: "09:00",
        window_end: "17:00",
        scheduled_task_ids: JSON.stringify([task.id]),
        telegram_notified: false
      });

      const spy = vi.spyOn(TelegramBotService.prototype, "sendWorkStartNotification").mockResolvedValue(true);

      const withinWindow = new Date("2026-08-10T09:15:00-04:00");
      const result = await NotificationDispatcher.processWorkStartNotification(userId, withinWindow);

      expect(result.sent).toBe(true);
      expect(result.reason).toContain("enviada a Telegram");
      expect(spy).toHaveBeenCalledTimes(1);

      const log = store.getDailyLogByDate(userId, todayIso);
      expect(log?.telegram_notified).toBe(true);
    });

    it("NO envía notificación si la hora actual es previa a window_start", async () => {
      const task = store.addTask(userId, {
        project_id: 1,
        title: "Calibración previa",
        estimated_hours: 2.0,
        order: 1
      });

      store.saveDailyLog(userId, {
        eval_date: todayIso,
        status: DayStatus.DAY_VIABLE,
        window_start: "14:00",
        window_end: "18:00",
        scheduled_task_ids: JSON.stringify([task.id]),
        telegram_notified: false
      });

      const spy = vi.spyOn(TelegramBotService.prototype, "sendWorkStartNotification").mockResolvedValue(true);

      const earlyMorning = new Date("2026-08-10T10:00:00-04:00");
      const result = await NotificationDispatcher.processWorkStartNotification(userId, earlyMorning);

      expect(result.sent).toBe(false);
      expect(result.reason).toContain("Notificación programada para el inicio del bloque");
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("Tier 3: Check-in Prompt (processCheckinNotification)", () => {
    it("envía el prompt de check-in y marca checkin_sent=true al llegar la checkin_hour", async () => {
      const task = store.addTask(userId, {
        project_id: 1,
        title: "Armado de estructura",
        estimated_hours: 3.0,
        order: 1
      });

      store.saveDailyLog(userId, {
        eval_date: todayIso,
        status: DayStatus.DAY_VIABLE,
        window_start: "09:00",
        window_end: "18:00",
        scheduled_task_ids: JSON.stringify([task.id]),
        checkin_sent: false,
        checkin_resolved: false
      });

      const spy = vi.spyOn(TelegramBotService.prototype, "sendCheckinPrompt").mockResolvedValue(true);

      const checkinTime = new Date("2026-08-10T19:05:00-04:00"); // 19:05 hrs >= checkin_hour 19
      const sent = await NotificationDispatcher.processCheckinNotification(userId, checkinTime);

      expect(sent).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);

      const log = store.getDailyLogByDate(userId, todayIso);
      expect(log?.checkin_sent).toBe(true);
    });

    it("NO envía check-in si aún no se alcanza la checkin_hour configurada", async () => {
      const task = store.addTask(userId, {
        project_id: 1,
        title: "Armado de estructura",
        estimated_hours: 3.0,
        order: 1
      });

      store.saveDailyLog(userId, {
        eval_date: todayIso,
        status: DayStatus.DAY_VIABLE,
        window_start: "09:00",
        window_end: "18:00",
        scheduled_task_ids: JSON.stringify([task.id]),
        checkin_sent: false,
        checkin_resolved: false
      });

      const spy = vi.spyOn(TelegramBotService.prototype, "sendCheckinPrompt").mockResolvedValue(true);

      const afternoonTime = new Date("2026-08-10T16:00:00-04:00"); // 16:00 < checkin_hour 19
      const sent = await NotificationDispatcher.processCheckinNotification(userId, afternoonTime);

      expect(sent).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("Tier 4: Intraday Weather & Rain Alerts (processWeatherAlert)", () => {
    it("dispara ráfaga de emergencia de lluvia y guarda last_rain_alert_hour", async () => {
      store.saveDailyLog(userId, {
        eval_date: todayIso,
        status: DayStatus.DAY_VIABLE,
        window_start: "08:00",
        window_end: "19:00",
        intraday_alert_triggered: false,
        intraday_alert_acknowledged: false,
        last_rain_alert_hour: null
      });

      // Lluvia a las 16:00 hrs
      vi.spyOn(weatherSvc, "getHourlyForecast").mockResolvedValue(buildMockForecasts(16, null));
      const burstSpy = vi.spyOn(TelegramBotService.prototype, "sendIntradayEmergencyAlertBurst").mockResolvedValue(true);

      const now = new Date("2026-08-10T12:00:00-04:00");
      await NotificationDispatcher.processWeatherAlert(userId, now);

      expect(burstSpy).toHaveBeenCalledTimes(1);
      const log = store.getDailyLogByDate(userId, todayIso);
      expect(log?.intraday_alert_triggered).toBe(true);
      expect(log?.last_rain_alert_hour).toBe(16);
      expect(log?.intraday_alert_burst_count).toBe(1);
    });

    it("reconoce avance de lluvia (re-alerta) cuando la hora prevista se adelanta respecto a last_rain_alert_hour", async () => {
      // Estado previo: lluvia alertada para las 17:00 y confirmada por el operario
      store.saveDailyLog(userId, {
        eval_date: todayIso,
        status: DayStatus.DAY_VIABLE,
        window_start: "08:00",
        window_end: "19:00",
        intraday_alert_triggered: true,
        intraday_alert_acknowledged: true,
        last_rain_alert_hour: 17,
        intraday_alert_burst_count: 1
      });

      // Ahora el pronóstico se ADELANTA a las 15:00 hrs (< 17)
      vi.spyOn(weatherSvc, "getHourlyForecast").mockResolvedValue(buildMockForecasts(15, null));
      const burstSpy = vi.spyOn(TelegramBotService.prototype, "sendIntradayEmergencyAlertBurst").mockResolvedValue(true);

      const now = new Date("2026-08-10T13:00:00-04:00");
      await NotificationDispatcher.processWeatherAlert(userId, now);

      expect(burstSpy).toHaveBeenCalledTimes(1);
      const callArgs = burstSpy.mock.calls[0];
      expect(callArgs[1]).toContain("ALERTA URGENTE DE LLUVIA ADELANTADA");

      const log = store.getDailyLogByDate(userId, todayIso);
      expect(log?.last_rain_alert_hour).toBe(15);
      expect(log?.intraday_alert_acknowledged).toBe(false); // Resetea ack para forzar confirmación
    });

    it("despacha aviso informativo de humedad de forma independiente sin ráfaga de emergencia", async () => {
      store.saveDailyLog(userId, {
        eval_date: todayIso,
        status: DayStatus.DAY_VIABLE,
        window_start: "08:00",
        window_end: "19:00",
        humidity_alert_sent: false,
        intraday_alert_triggered: false
      });

      // Humedad alta a las 14:00, sin lluvia
      vi.spyOn(weatherSvc, "getHourlyForecast").mockResolvedValue(buildMockForecasts(null, 14));
      const burstSpy = vi.spyOn(TelegramBotService.prototype, "sendIntradayEmergencyAlertBurst").mockResolvedValue(true);
      const msgSpy = vi.spyOn(TelegramBotService.prototype, "sendTelegramMessage").mockResolvedValue(true);

      const now = new Date("2026-08-10T12:00:00-04:00");
      await NotificationDispatcher.processWeatherAlert(userId, now);

      expect(burstSpy).not.toHaveBeenCalled();
      expect(msgSpy).toHaveBeenCalledTimes(1);
      expect(msgSpy.mock.calls[0][1]).toContain("Aviso Informativo de Humedad");

      const log = store.getDailyLogByDate(userId, todayIso);
      expect(log?.humidity_alert_sent).toBe(true);
    });
  });
});
