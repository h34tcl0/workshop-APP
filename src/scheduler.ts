import { store } from "./db.js";
import { evaluateDayFeasibility, computeHourlyClimateMap, compressClimateSegments, detectNewWeatherRisk } from "./evaluator.js";
import { getHourlyForecast, MockWeatherService } from "./weatherService.js";
import { getHolidayDatesForRange } from "./holidaysService.js";
import { TelegramBotService } from "./telegramBot.js";
import { calendarService } from "./calendarService.js";
import { DayEvaluation, DayStatus, HourlyForecast, TaskStatus } from "./types.js";
import { getLocalDateIso, getLocalHoursAndMinutes, getTargetTimeZone } from "./dateUtils.js";

export { getLocalDateIso, getLocalHoursAndMinutes, getTargetTimeZone };

export async function runMorningEvaluation(userId: number, targetDateIso?: string, mockScenario?: string): Promise<DayEvaluation> {
  const appSettings = store.getAppSettings(userId);
  const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
  const todayIso = targetDateIso || getLocalDateIso(new Date(), userTz);
  console.log(`[Scheduler] Running Morning Evaluation for User #${userId} on ${todayIso} (TZ: ${userTz})...`);
  const activeProject = store.getActiveProject(userId);
  const pendingTasks = store.getPendingTasks(userId, activeProject.id);

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

  const existingLog = store.getDailyLogByDate(userId, todayIso);
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

  const savedLog = store.saveDailyLog(userId, logData);

  let telegramSent = false;
  let telegramReason = "⚠️ Telegram no configurado / omitido";
  let calendarSynced = false;
  let calendarReason = "ℹ️ Google Calendar no conectado";

  // Telegram notification handling
  let targetChatId = appSettings.telegram_chat_id ? appSettings.telegram_chat_id.trim() : "";
  if (!targetChatId && userId === 1 && process.env.TELEGRAM_CHAT_ID) {
    targetChatId = process.env.TELEGRAM_CHAT_ID.trim();
  }

  if (targetChatId) {
    const telegramBot = new TelegramBotService(
      process.env.TELEGRAM_BOT_TOKEN,
      targetChatId
    );

    const isForcedOrNew = !savedLog || !savedLog.telegram_notified || Boolean(mockScenario);
    if (isForcedOrNew) {
      if ((evalResult.status === DayStatus.DAY_VIABLE && evalResult.scheduled_tasks && evalResult.scheduled_tasks.length > 0) || evalResult.status === DayStatus.DAY_BLOCKED) {
        console.log(`[Telegram] Attempting to send morning evaluation to chatId: ${targetChatId} for User #${userId}...`);
        const tgSuccess = await telegramBot.sendMorningEvaluation(evalResult);
        if (tgSuccess) {
          if (savedLog) store.updateDailyLog(userId, savedLog.id, { telegram_notified: true });
          telegramSent = true;
          telegramReason = "✅ Mensaje enviado a Telegram";
        } else {
          telegramSent = false;
          telegramReason = "❌ Error al enviar mensaje a Telegram";
        }
      } else {
        if (savedLog) {
          store.updateDailyLog(userId, savedLog.id, { telegram_notified: true });
        }
        telegramSent = false;
        telegramReason = "ℹ️ Día viable pero sin tareas asignadas (notificación omitida)";
        console.log(`[Scheduler] Day viable but no tasks for User #${userId}. Suppressing Telegram notification for ${todayIso}.`);
      }
    } else {
      telegramSent = false;
      telegramReason = "ℹ️ Notificación de Telegram ya enviada previamente hoy";
      console.log(`[Scheduler] Telegram notification already sent previously for User #${userId} on ${todayIso}.`);
    }
  } else {
    telegramSent = false;
    telegramReason = "⚠️ Telegram no configurado / omitido";
    console.log(`[Telegram] SKIPPED: No valid chatId provided for userId ${userId}`);
  }

  // Google Calendar Event Creation
  if (evalResult.status === DayStatus.DAY_VIABLE && evalResult.window && evalResult.window.start_time && evalResult.window.end_time) {
    if (appSettings.google_calendar_enabled && appSettings.google_calendar_id) {
      const tasksForCal = (evalResult.scheduled_tasks || []).map(t => ({
        title: t.title,
        estimated_hours: t.estimated_hours
      }));
      const calCreated = await calendarService.createWorkshopEvent(
        userId,
        todayIso,
        evalResult.window.start_time,
        evalResult.window.end_time,
        tasksForCal
      );
      if (calCreated) {
        if (savedLog) store.updateDailyLog(userId, savedLog.id, { calendar_created: true });
        calendarSynced = true;
        calendarReason = "📅 Eventos agendados en Google Calendar";
      } else {
        calendarSynced = false;
        calendarReason = "⚠️ Error al agendar eventos en Google Calendar";
      }
    } else {
      calendarSynced = false;
      calendarReason = "ℹ️ Google Calendar no configurado / deshabilitado";
    }
  } else {
    calendarSynced = false;
    calendarReason = appSettings.google_calendar_enabled ? "ℹ️ Día no viable para agendar eventos" : "ℹ️ Google Calendar no conectado";
  }

  console.log(`[Scheduler] Morning Evaluation completed for User #${userId} on ${todayIso}: ${evalResult.status} - ${evalResult.reason}`);
  return {
    evalResult,
    status: evalResult.status,
    reason: evalResult.reason,
    telegramSent,
    telegramReason,
    calendarSynced,
    calendarReason
  };
}

export async function processCheckinForUser(userId: number, nowDate?: Date, force: boolean = false): Promise<void> {
  const now = nowDate || new Date();
  const appSettings = store.getAppSettings(userId);
  const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
  const todayIso = getLocalDateIso(now, userTz);
  const localTime = getLocalHoursAndMinutes(now, userTz);

  const dailyLog = store.getDailyLogByDate(userId, todayIso);
  if (!dailyLog || dailyLog.status !== DayStatus.DAY_VIABLE) {
    return;
  }

  if (!force && (dailyLog.checkin_sent || dailyLog.checkin_resolved)) {
    return;
  }

  if (!force && localTime.hours < appSettings.checkin_hour) {
    return;
  }

  let taskIds: number[] = [];
  try {
    taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]");
  } catch (_) {}

  const scheduledTasks = taskIds
    .map(tid => store.getTask(userId, tid))
    .filter((t): t is any => t != null && t.status !== TaskStatus.COMPLETED);

  if (scheduledTasks.length === 0) {
    store.updateDailyLog(userId, dailyLog.id, { checkin_sent: true, checkin_resolved: true });
    return;
  }

  let targetChatId = appSettings.telegram_chat_id ? appSettings.telegram_chat_id.trim() : "";
  if (!targetChatId && userId === 1 && process.env.TELEGRAM_CHAT_ID) {
    targetChatId = process.env.TELEGRAM_CHAT_ID.trim();
  }

  if (!targetChatId) {
    console.log(`[Telegram] SKIPPED: No valid chatId provided for userId ${userId}`);
    return;
  }

  const telegramSvc = new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN, targetChatId);
  const sent = await telegramSvc.sendCheckinPrompt(dailyLog.id, scheduledTasks);
  if (sent) {
    store.updateDailyLog(userId, dailyLog.id, { checkin_sent: true });
    console.log(`[Scheduler] Sent check-in prompt for User #${userId} on ${todayIso} (${scheduledTasks.length} tasks).`);
  }
}

export async function runCheckinTick(nowDate?: Date, force: boolean = false, targetUserId?: number): Promise<void> {
  if (targetUserId) {
    await processCheckinForUser(targetUserId, nowDate, force);
    return;
  }

  const users = store.getAllUsers();
  for (const user of users) {
    try {
      await processCheckinForUser(user.id, nowDate, force);
    } catch (err) {
      console.error(`[Scheduler] Error in checkin tick for User #${user.id}:`, err);
    }
  }
}

export async function processWeatherAlertForUser(userId: number, nowDate?: Date): Promise<void> {
  const now = nowDate || new Date();
  const appSettings = store.getAppSettings(userId);
  const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
  const todayIso = getLocalDateIso(now, userTz);
  const localTime = getLocalHoursAndMinutes(now, userTz);

  const dailyLog = store.getDailyLogByDate(userId, todayIso);
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
  const nowH = localTime.totalHours;

  if (nowH < windowStartH || nowH > windowEndH) {
    return; // outside active work window
  }

  let targetChatId = appSettings.telegram_chat_id ? appSettings.telegram_chat_id.trim() : "";
  if (!targetChatId && userId === 1 && process.env.TELEGRAM_CHAT_ID) {
    targetChatId = process.env.TELEGRAM_CHAT_ID.trim();
  }

  if (!targetChatId) {
    console.log(`[Telegram] SKIPPED: No valid chatId provided for userId ${userId}`);
    return;
  }

  const telegramSvc = new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN, targetChatId);

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
      store.updateDailyLog(userId, dailyLog.id, {
        weather_alert_retry_count: dailyLog.weather_alert_retry_count + 1,
        weather_alert_last_sent_at: new Date().toISOString()
      });
      console.log(`[Scheduler] Weather alert retry ${dailyLog.weather_alert_retry_count + 1}/6 sent for User #${userId} on ${todayIso}.`);
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
      store.updateDailyLog(userId, dailyLog.id, {
        weather_alert_sent: true,
        weather_alert_message: risk,
        weather_alert_retry_count: 1,
        weather_alert_last_sent_at: new Date().toISOString()
      });
      console.log(`[Scheduler] Weather alert triggered for User #${userId} on ${todayIso}: ${risk}`);
    }
  } catch (err) {
    console.error(`[Scheduler] Error checking updated weather for alert tick (User #${userId}):`, err);
  }
}

export async function runWeatherAlertTick(nowDate?: Date): Promise<void> {
  const users = store.getAllUsers();
  for (const user of users) {
    try {
      await processWeatherAlertForUser(user.id, nowDate);
    } catch (err) {
      console.error(`[Scheduler] Error in weather alert tick for User #${user.id}:`, err);
    }
  }
}

export async function runMorningEvalTick(nowDate?: Date): Promise<void> {
  const now = nowDate || new Date();
  const users = store.getAllUsers();

  for (const user of users) {
    try {
      const appSettings = store.getAppSettings(user.id);
      const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
      const todayIso = getLocalDateIso(now, userTz);
      const localTime = getLocalHoursAndMinutes(now, userTz);

      const existingLog = store.getDailyLogByDate(user.id, todayIso);
      if (existingLog) continue; // already evaluated for this user

      const triggerHour = (appSettings.operational_start_hour - appSettings.morning_eval_lead_hours + 24) % 24;

      if (localTime.hours < triggerHour) continue;

      await runMorningEvaluation(user.id, todayIso);
    } catch (err) {
      console.error(`[Scheduler] Error in morning eval tick for User #${user.id}:`, err);
    }
  }
}

let daemonIntervals: NodeJS.Timeout[] = [];

export function startDaemon(): void {
  console.log("[Daemon] AGENDAPP Multi-Tenant 3-Tier Precision Scheduler starting...");
  console.log("  • Tier 1 (Morning Evaluation): Dynamic trigger at operational start time - lead hours per user");
  console.log("  • Tier 2 (Night Check-in): Fixed trigger at configured check-in hour per user");
  console.log("  • Tier 3 (Urgent Weather Monitor): 60-min work window scan with 10-min 6-round alert bursts per user");

  stopDaemon();

  // Initial execution of all 3 tiers on startup
  runMorningEvalTick().catch(err => console.error("[Daemon Tier 1 Error]:", err));
  runCheckinTick().catch(err => console.error("[Daemon Tier 2 Error]:", err));
  runWeatherAlertTick().catch(err => console.error("[Daemon Tier 3 Error]:", err));

  // Tier 1: Morning Evaluation loop (checks every 15 minutes)
  const t1 = setInterval(() => {
    runMorningEvalTick().catch(err => console.error("[Daemon Tier 1 Error]:", err));
  }, 15 * 60 * 1000);

  // Tier 2: Night Check-in loop (checks every 15 minutes)
  const t2 = setInterval(() => {
    runCheckinTick().catch(err => console.error("[Daemon Tier 2 Error]:", err));
  }, 15 * 60 * 1000);

  // Tier 3: Urgent Weather Monitor loop (checks every 10 minutes)
  const t3 = setInterval(() => {
    runWeatherAlertTick().catch(err => console.error("[Daemon Tier 3 Error]:", err));
  }, 10 * 60 * 1000);

  daemonIntervals.push(t1, t2, t3);
}

export function stopDaemon(): void {
  if (daemonIntervals.length > 0) {
    console.log("[Daemon] Stopping background scheduler daemon...");
    daemonIntervals.forEach(clearInterval);
    daemonIntervals = [];
  }
}
