import { store } from "./db.js";
import { evaluateDayFeasibility, computeHourlyClimateMap, compressClimateSegments, detectNewWeatherRisk } from "./evaluator.js";
import { getHourlyForecast, MockWeatherService } from "./weatherService.js";
import { getHolidayDatesForRange } from "./holidaysService.js";
import { TelegramBotService } from "./telegramBot.js";
import { calendarService } from "./calendarService.js";
import { DayEvaluation, DayStatus, HourlyForecast, TaskStatus } from "./types.js";

export function getLocalDateIso(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function runMorningEvaluation(targetDateIso?: string, mockScenario?: string): Promise<DayEvaluation> {
  const todayIso = targetDateIso || getLocalDateIso();
  console.log(`[Scheduler] Running Morning Evaluation for ${todayIso}...`);

  const appSettings = store.getAppSettings();
  const activeProject = store.getActiveProject();
  const pendingTasks = store.getPendingTasks(activeProject.id);

  let forecasts: HourlyForecast[] = [];
  if (mockScenario) {
    const mockSvc = new MockWeatherService(mockScenario);
    forecasts = mockSvc.getHourlyForecast(todayIso);
  } else {
    try {
      forecasts = await getHourlyForecast(todayIso, appSettings.latitude, appSettings.longitude);
    } catch (err) {
      console.warn(`[Scheduler] Error fetching weather forecast, using mock:`, err);
      const mockSvc = new MockWeatherService("sunny");
      forecasts = mockSvc.getHourlyForecast(todayIso);
    }
  }

  let holidayDates = new Set<string>();
  if (appSettings.exclude_holidays) {
    try {
      holidayDates = getHolidayDatesForRange(todayIso, todayIso);
    } catch (err) {
      console.warn(`[Scheduler] Error fetching holidays:`, err);
    }
  }

  const evalResult = evaluateDayFeasibility(todayIso, pendingTasks, forecasts, appSettings, holidayDates);

  const existingLog = store.getDailyLogByDate(todayIso);
  const isNewDay = !existingLog;

  let windowStart: string | null = null;
  let windowEnd: string | null = null;
  let netWorkHours: number | null = null;
  let tasksSummary: string | null = null;
  let scheduledTaskIds: string | null = null;

  if (evalResult.status === DayStatus.DAY_VIABLE && evalResult.window) {
    windowStart = evalResult.window.start_time;
    windowEnd = evalResult.window.end_time;
    netWorkHours = evalResult.window.net_work_hours;
    if (evalResult.scheduled_tasks) {
      tasksSummary = evalResult.scheduled_tasks.map(t => t.title).join(", ");
      scheduledTaskIds = JSON.stringify(evalResult.scheduled_tasks.map(t => t.id));
    }
  }

  const logData: any = {
    eval_date: todayIso,
    status: evalResult.status,
    block_reason: evalResult.reason,
    window_start: windowStart,
    window_end: windowEnd,
    net_work_hours: netWorkHours,
    tasks_summary: tasksSummary,
    scheduled_task_ids: scheduledTaskIds,
    morning_climate_snapshot: JSON.stringify(evalResult.climate_segments || [])
  };

  if (isNewDay) {
    logData.checkin_sent = false;
    logData.checkin_resolved = false;
    logData.weather_alert_sent = false;
    logData.weather_alert_acknowledged = false;
    logData.weather_alert_retry_count = 0;
    logData.weather_alert_last_sent_at = null;
    logData.weather_alert_message = null;
    logData.telegram_notified = false;
  }

  const savedLog = store.saveDailyLog(logData);

  // Telegram notification handling
  const telegramBot = new TelegramBotService(
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_CHAT_ID
  );

  if (!savedLog.telegram_notified) {
    if ((evalResult.status === DayStatus.DAY_VIABLE && evalResult.scheduled_tasks && evalResult.scheduled_tasks.length > 0) || evalResult.status === DayStatus.DAY_BLOCKED) {
      const tgSuccess = await telegramBot.sendMorningEvaluation(evalResult);
      if (tgSuccess) {
        store.updateDailyLog(savedLog.id, { telegram_notified: true });
      }
    } else {
      // Suppress message if day has no scheduled tasks or unhandled state
      store.updateDailyLog(savedLog.id, { telegram_notified: true });
      console.log(`[Scheduler] Day blocked or no tasks. Telegram notification suppressed for ${todayIso}.`);
    }
  }

  // Google Calendar Event Creation
  if (evalResult.status === DayStatus.DAY_VIABLE && evalResult.window && evalResult.window.start_time && evalResult.window.end_time) {
    const tasksForCal = (evalResult.scheduled_tasks || []).map(t => ({
      title: t.title,
      estimated_hours: t.estimated_hours
    }));
    const calCreated = await calendarService.createWorkshopEvent(
      todayIso,
      evalResult.window.start_time,
      evalResult.window.end_time,
      tasksForCal
    );
    if (calCreated) {
      store.updateDailyLog(savedLog.id, { calendar_created: true });
    }
  }

  console.log(`[Scheduler] Morning Evaluation completed for ${todayIso}: ${evalResult.status} - ${evalResult.reason}`);
  return evalResult;
}

export async function runCheckinTick(nowDate?: Date, force: boolean = false): Promise<void> {
  const now = nowDate || new Date();
  const todayIso = getLocalDateIso(now);
  const appSettings = store.getAppSettings();

  const dailyLog = store.getDailyLogByDate(todayIso);
  if (!dailyLog || dailyLog.status !== DayStatus.DAY_VIABLE) {
    return;
  }

  if (!force && (dailyLog.checkin_sent || dailyLog.checkin_resolved)) {
    return;
  }

  if (!force && now.getHours() < appSettings.checkin_hour) {
    return;
  }

  let taskIds: number[] = [];
  try {
    taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]");
  } catch (_) {}

  const scheduledTasks = taskIds.map(tid => store.getTask(tid)).filter((t): t is any => t != null && t.status !== TaskStatus.COMPLETED);

  if (scheduledTasks.length === 0) {
    store.updateDailyLog(dailyLog.id, { checkin_sent: true, checkin_resolved: true });
    return;
  }

  const telegramSvc = new TelegramBotService();
  const sent = await telegramSvc.sendCheckinPrompt(dailyLog.id, scheduledTasks);
  if (sent) {
    store.updateDailyLog(dailyLog.id, { checkin_sent: true });
    console.log(`[Scheduler] Sent check-in prompt for ${todayIso} (${scheduledTasks.length} tasks).`);
  }
}

export async function runWeatherAlertTick(nowDate?: Date): Promise<void> {
  const now = nowDate || new Date();
  const todayIso = getLocalDateIso(now);
  const appSettings = store.getAppSettings();

  const dailyLog = store.getDailyLogByDate(todayIso);
  if (!dailyLog || dailyLog.status !== DayStatus.DAY_VIABLE || !dailyLog.window_start || !dailyLog.window_end) {
    return;
  }

  if (dailyLog.weather_alert_acknowledged) {
    return;
  }

  const [sH, sM] = dailyLog.window_start.split(":").map(Number);
  const [eH, eM] = dailyLog.window_end.split(":").map(Number);
  const windowStartH = sH + sM / 60.0;
  const windowEndH = eH + eM / 60.0;
  const nowH = now.getHours() + now.getMinutes() / 60.0;

  if (nowH < windowStartH || nowH > windowEndH) {
    return; // outside active work window
  }

  const telegramSvc = new TelegramBotService();

  if (dailyLog.weather_alert_sent) {
    if (dailyLog.weather_alert_retry_count >= 6) {
      return;
    }
    const lastSentAt = dailyLog.weather_alert_last_sent_at ? new Date(dailyLog.weather_alert_last_sent_at).getTime() : 0;
    if (Date.now() - lastSentAt < 10 * 60 * 1000) {
      return; // retry every 10 mins
    }

    const sent = await telegramSvc.sendWeatherAlertBurst(dailyLog.id, dailyLog.weather_alert_message || "Cambio de clima detectado.");
    if (sent) {
      store.updateDailyLog(dailyLog.id, {
        weather_alert_retry_count: dailyLog.weather_alert_retry_count + 1,
        weather_alert_last_sent_at: new Date().toISOString()
      });
      console.log(`[Scheduler] Weather alert retry ${dailyLog.weather_alert_retry_count + 1}/6 sent for ${todayIso}.`);
    }
    return;
  }

  // Calculate new weather forecast
  try {
    const forecasts = await getHourlyForecast(todayIso, appSettings.latitude, appSettings.longitude);
    const newMap = computeHourlyClimateMap(
      forecasts,
      Math.floor(windowStartH),
      Math.ceil(windowEndH),
      appSettings.min_rain_precipitation_mm,
      appSettings.max_humidity_percent
    );
    const newSegments = compressClimateSegments(newMap);

    let oldSegments = [];
    try {
      oldSegments = JSON.parse(dailyLog.morning_climate_snapshot || "[]");
    } catch (_) {}

    const risk = detectNewWeatherRisk(oldSegments, newSegments, windowStartH, windowEndH);
    if (!risk) return;

    const sent = await telegramSvc.sendWeatherAlertBurst(dailyLog.id, risk);
    if (sent) {
      store.updateDailyLog(dailyLog.id, {
        weather_alert_sent: true,
        weather_alert_message: risk,
        weather_alert_retry_count: 1,
        weather_alert_last_sent_at: new Date().toISOString()
      });
      console.log(`[Scheduler] Weather alert triggered for ${todayIso}: ${risk}`);
    }
  } catch (err) {
    console.error("[Scheduler] Error checking updated weather for alert tick:", err);
  }
}

export async function runMorningEvalTick(nowDate?: Date): Promise<void> {
  const now = nowDate || new Date();
  const todayIso = getLocalDateIso(now);

  const existingLog = store.getDailyLogByDate(todayIso);
  if (existingLog) return; // already evaluated

  const appSettings = store.getAppSettings();
  const triggerHour = (appSettings.operational_start_hour - appSettings.morning_eval_lead_hours + 24) % 24;

  if (now.getHours() < triggerHour) return;

  await runMorningEvaluation(todayIso);
}

export function startDaemon(): void {
  console.log("[Daemon] AGENDAPP 3-Tier Precision Scheduler starting...");
  console.log("  • Tier 1 (Morning Evaluation): Dynamic trigger at operational start time - lead hours");
  console.log("  • Tier 2 (Night Check-in): Fixed trigger at configured check-in hour");
  console.log("  • Tier 3 (Urgent Weather Monitor): 60-min work window scan with 10-min 6-round alert bursts");

  // Initial execution of all 3 tiers on startup
  runMorningEvalTick().catch(err => console.error("[Daemon Tier 1 Error]:", err));
  runCheckinTick().catch(err => console.error("[Daemon Tier 2 Error]:", err));
  runWeatherAlertTick().catch(err => console.error("[Daemon Tier 3 Error]:", err));

  // Tier 1: Morning Evaluation loop (checks every 15 minutes)
  setInterval(() => {
    runMorningEvalTick().catch(err => console.error("[Daemon Tier 1 Error]:", err));
  }, 15 * 60 * 1000);

  // Tier 2: Night Check-in loop (checks every 15 minutes)
  setInterval(() => {
    runCheckinTick().catch(err => console.error("[Daemon Tier 2 Error]:", err));
  }, 15 * 60 * 1000);

  // Tier 3: Urgent Weather Monitor loop (checks every 10 minutes to support active alert burst retries & hourly scans)
  setInterval(() => {
    runWeatherAlertTick().catch(err => console.error("[Daemon Tier 3 Error]:", err));
  }, 10 * 60 * 1000);
}
