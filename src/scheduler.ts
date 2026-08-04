import { store } from "./db.js";
import { evaluateDayFeasibility, computeHourlyClimateMap, compressClimateSegments, detectNewWeatherRisk } from "./evaluator.js";
import { getHourlyForecast, MockWeatherService } from "./weatherService.js";
import { getHolidayDatesForRange } from "./holidaysService.js";
import { TelegramBotService } from "./telegramBot.js";
import { calendarService } from "./calendarService.js";
import { DayEvaluation, DayStatus, HourlyForecast, TaskStatus } from "./types.js";
import { getLocalDateIso, getLocalHoursAndMinutes, getTargetTimeZone } from "./dateUtils.js";

export { getLocalDateIso, getLocalHoursAndMinutes, getTargetTimeZone };

export async function syncMultiDayCalendar(
  userId: number,
  horizonEvaluations: Array<{ date_iso: string; evaluation: DayEvaluation }>
): Promise<{ synced: boolean; reason: string }> {
  const appSettings = store.getAppSettings(userId);

  if (!appSettings.google_calendar_enabled || !appSettings.google_calendar_id || !appSettings.google_calendar_id.trim()) {
    return { synced: false, reason: "ℹ️ Google Calendar no configurado / deshabilitado" };
  }

  let successCount = 0;
  let failCount = 0;

  for (const item of horizonEvaluations) {
    const evalDate = item.date_iso;
    const evalRes = item.evaluation;

    const dailyLog = store.getDailyLogByDate(userId, evalDate);
    const existingEventId = dailyLog?.google_event_id || null;

    const isViable = evalRes.status === DayStatus.DAY_VIABLE &&
      Boolean(evalRes.window) &&
      Boolean(evalRes.scheduled_tasks && evalRes.scheduled_tasks.length > 0);

    if (isViable && evalRes.window) {
      const tasksForCal = (evalRes.scheduled_tasks || []).map(t => ({
        title: t.title,
        estimated_hours: t.estimated_hours
      }));

      if (existingEventId) {
        // Update existing event on Google Calendar
        const updateRes = await calendarService.updateWorkshopEvent(
          userId,
          existingEventId,
          evalDate,
          evalRes.window.start_time,
          evalRes.window.end_time,
          tasksForCal
        );

        if (updateRes.notFound) {
          // Event was deleted externally (404/410). Clear reference and reconstruct!
          console.log(`[Calendar Mirror Sync] Event ${existingEventId} on ${evalDate} returned 404. Re-creating event...`);
          if (dailyLog) {
            store.updateDailyLog(userId, dailyLog.id, { google_event_id: null, calendar_created: false });
          }
          const createRes = await calendarService.createWorkshopEvent(
            userId,
            evalDate,
            evalRes.window.start_time,
            evalRes.window.end_time,
            tasksForCal
          );
          if (createRes.success && createRes.eventId) {
            if (dailyLog) {
              store.updateDailyLog(userId, dailyLog.id, { google_event_id: createRes.eventId, calendar_created: true });
            }
            successCount++;
          } else {
            failCount++;
          }
        } else if (updateRes.success) {
          if (dailyLog) {
            store.updateDailyLog(userId, dailyLog.id, { calendar_created: true });
          }
          successCount++;
        } else {
          failCount++;
        }
      } else {
        // Create new event on Google Calendar
        const createRes = await calendarService.createWorkshopEvent(
          userId,
          evalDate,
          evalRes.window.start_time,
          evalRes.window.end_time,
          tasksForCal
        );
        if (createRes.success && createRes.eventId) {
          if (dailyLog) {
            store.updateDailyLog(userId, dailyLog.id, { google_event_id: createRes.eventId, calendar_created: true });
          }
          successCount++;
        } else {
          failCount++;
        }
      }
    } else {
      // Day is inviable or has no tasks -> Delete event from Google Calendar if reference exists
      if (existingEventId) {
        console.log(`[Calendar Mirror Sync] Day ${evalDate} is no longer viable with tasks (${evalRes.status}). Deleting event ${existingEventId}...`);
        await calendarService.deleteWorkshopEvent(userId, existingEventId);
        if (dailyLog) {
          store.updateDailyLog(userId, dailyLog.id, { google_event_id: null, calendar_created: false });
        }
        successCount++;
      }
    }
  }

  if (failCount === 0) {
    return { synced: true, reason: `📅 Sincronización Espejo Multi-Día completada (${successCount} días procesados)` };
  } else {
    return { synced: false, reason: `⚠️ Sincronización Espejo parcial (${successCount} ok, ${failCount} con error)` };
  }
}

export async function processWorkStartNotificationsForUser(
  userId: number,
  nowDate?: Date,
  force: boolean = false
): Promise<{ sent: boolean; reason: string }> {
  const now = nowDate || new Date();
  const appSettings = store.getAppSettings(userId);
  const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
  const todayIso = getLocalDateIso(now, userTz);
  const localTime = getLocalHoursAndMinutes(now, userTz);

  const dailyLog = store.getDailyLogByDate(userId, todayIso);
  if (!dailyLog || dailyLog.status !== DayStatus.DAY_VIABLE || !dailyLog.window_start || !dailyLog.window_end) {
    return { sent: false, reason: "ℹ️ No hay jornada viable para hoy" };
  }

  if (!force && dailyLog.telegram_notified) {
    return { sent: false, reason: "ℹ️ Notificación de inicio de jornada ya enviada previamente hoy" };
  }

  const [sH, sM] = dailyLog.window_start.split(":").map(Number);
  const windowStartH = sH + sM / 60.0;
  const nowH = localTime.totalHours;

  if (!force && nowH < windowStartH) {
    return {
      sent: false,
      reason: `ℹ️ Notificación programada para el inicio del bloque de trabajo (${dailyLog.window_start} hrs)`
    };
  }

  let taskIds: number[] = [];
  try {
    taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]");
  } catch (_) {}

  const tasks = taskIds
    .map(tid => store.getTask(userId, tid))
    .filter((t): t is any => t != null && t.status !== TaskStatus.COMPLETED);

  if (tasks.length === 0) {
    store.updateDailyLog(userId, dailyLog.id, { telegram_notified: true });
    return { sent: false, reason: "ℹ️ Sin tareas agendadas hoy (notificación omitida)" };
  }

  let targetChatId = appSettings.telegram_chat_id ? appSettings.telegram_chat_id.trim() : "";
  if (!targetChatId && userId === 1 && process.env.TELEGRAM_CHAT_ID) {
    targetChatId = process.env.TELEGRAM_CHAT_ID.trim();
  }

  if (!targetChatId) {
    return { sent: false, reason: "⚠️ Chat ID de Telegram no configurado" };
  }

  const telegramSvc = new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN, targetChatId);

  let climateSegments = [];
  try {
    climateSegments = JSON.parse(dailyLog.morning_climate_snapshot || "[]");
  } catch (_) {}

  const evalResult: DayEvaluation = {
    eval_date: todayIso,
    status: DayStatus.DAY_VIABLE,
    reason: dailyLog.block_reason || "Día viable con tareas agendadas",
    window: {
      start_time: dailyLog.window_start || "09:00",
      end_time: dailyLog.window_end || "18:00",
      start_hour: 9,
      end_hour: 18,
      total_duration_hours: (dailyLog.net_work_hours || 0) + 2,
      net_work_hours: dailyLog.net_work_hours || 0,
      is_viable: true
    },
    scheduled_tasks: tasks,
    climate_segments: climateSegments
  };

  const sent = await telegramSvc.sendWorkStartNotification(evalResult);
  if (sent) {
    store.updateDailyLog(userId, dailyLog.id, { telegram_notified: true });
    console.log(`[Scheduler] Telegram Work Start Notification sent for User #${userId} on ${todayIso}.`);
    return { sent: true, reason: "🚀 Notificación de inicio de jornada enviada a Telegram" };
  } else {
    return { sent: false, reason: "❌ Error al enviar notificación a Telegram" };
  }
}

export async function runMorningEvaluation(
  userId: number,
  targetDateIso?: string,
  mockScenario?: string
): Promise<{
  evalResult: DayEvaluation;
  status: DayStatus;
  reason: string;
  telegramSent: boolean;
  telegramReason: string;
  calendarSynced: boolean;
  calendarReason: string;
}> {
  const appSettings = store.getAppSettings(userId);
  const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
  const todayIso = targetDateIso || getLocalDateIso(new Date(), userTz);
  console.log(`[Scheduler] Running Multi-Day Evaluation for User #${userId} starting ${todayIso} (TZ: ${userTz})...`);

  const pendingTasks = store.getPendingTasks(userId);

  const forecastDaysCount = appSettings.forecast_days || 7;
  const horizonEvaluations: Array<{ date_iso: string; evaluation: DayEvaluation }> = [];

  let simulatedPendingTasks = [...pendingTasks];
  const startDateObj = new Date(`${todayIso}T12:00:00Z`);

  for (let i = 0; i < forecastDaysCount; i++) {
    const curDate = new Date(startDateObj);
    curDate.setDate(curDate.getDate() + i);
    const dateIso = curDate.toISOString().split("T")[0];

    let dayForecasts: HourlyForecast[] = [];
    if (mockScenario) {
      const mockSvc = new MockWeatherService(mockScenario);
      dayForecasts = mockSvc.getHourlyForecast(dateIso);
    } else {
      try {
        dayForecasts = await getHourlyForecast(dateIso, appSettings.latitude, appSettings.longitude);
      } catch (err) {
        console.warn(`[Scheduler] Error fetching weather forecast for ${dateIso}, using mock:`, err);
        const mockSvc = new MockWeatherService("sunny");
        dayForecasts = mockSvc.getHourlyForecast(dateIso);
      }
    }

    let dayHolidays = new Set<string>();
    if (appSettings.exclude_holidays) {
      try {
        dayHolidays = getHolidayDatesForRange(dateIso, dateIso);
      } catch (_) {}
    }

    const evalResult = evaluateDayFeasibility(dateIso, simulatedPendingTasks, dayForecasts, appSettings, dayHolidays);

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

        const scheduledIds = new Set(evalResult.scheduled_tasks.map(t => t.id));
        simulatedPendingTasks = simulatedPendingTasks.filter(t => !scheduledIds.has(t.id));
      }
    }

    const existingLog = store.getDailyLogByDate(userId, dateIso);
    const isNewLog = !existingLog;

    const logData: any = {
      eval_date: dateIso,
      status: evalResult.status,
      block_reason: evalResult.reason,
      window_start: windowStart,
      window_end: windowEnd,
      net_work_hours: netWorkHours,
      tasks_summary: tasksSummary,
      scheduled_task_ids: scheduledTaskIds,
      morning_climate_snapshot: JSON.stringify(evalResult.climate_segments || [])
    };

    if (isNewLog) {
      logData.checkin_sent = false;
      logData.checkin_resolved = false;
      logData.weather_alert_sent = false;
      logData.weather_alert_acknowledged = false;
      logData.weather_alert_retry_count = 0;
      logData.weather_alert_last_sent_at = null;
      logData.weather_alert_message = null;
      logData.telegram_notified = false;
      logData.calendar_created = false;
      logData.google_event_id = null;
    }

    store.saveDailyLog(userId, logData);
    horizonEvaluations.push({ date_iso: dateIso, evaluation: evalResult });
  }

  const todayItem = horizonEvaluations.find(h => h.date_iso === todayIso) || horizonEvaluations[0];
  const todayEval = todayItem.evaluation;

  // Execute Mirror Sync with Google Calendar across the horizon
  const calSync = await syncMultiDayCalendar(userId, horizonEvaluations);

  // Check Telegram Work Start notification for today
  const tgResult = await processWorkStartNotificationsForUser(userId);

  console.log(`[Scheduler] Multi-Day Evaluation completed for User #${userId} starting ${todayIso}: ${todayEval.status} - ${todayEval.reason}`);
  return {
    evalResult: todayEval,
    status: todayEval.status,
    reason: todayEval.reason,
    telegramSent: tgResult.sent,
    telegramReason: tgResult.reason,
    calendarSynced: calSync.synced,
    calendarReason: calSync.reason
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
  const currentLocalHour = localTime.totalHours;

  // STRICT OPERATIONAL HOURS CHECK: Alertas sólo dentro de la jornada laboral
  if (currentLocalHour < appSettings.operational_start_hour || currentLocalHour >= appSettings.operational_end_hour) {
    return;
  }

  const dailyLog = store.getDailyLogByDate(userId, todayIso);
  if (!dailyLog) {
    return;
  }

  // Operator acknowledged -> stop retries completely
  if (dailyLog.intraday_alert_acknowledged || dailyLog.weather_alert_acknowledged) {
    return;
  }

  let targetChatId = appSettings.telegram_chat_id ? appSettings.telegram_chat_id.trim() : "";
  if (!targetChatId && userId === 1 && process.env.TELEGRAM_CHAT_ID) {
    targetChatId = process.env.TELEGRAM_CHAT_ID.trim();
  }

  if (!targetChatId) {
    return;
  }

  const telegramSvc = new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN, targetChatId);

  // If alert was ALREADY triggered and NOT acknowledged, check 5-minute retry interval
  const isTriggered = dailyLog.intraday_alert_triggered || dailyLog.weather_alert_sent;
  if (isTriggered) {
    const lastSentIso = dailyLog.intraday_alert_last_sent_at || dailyLog.weather_alert_last_sent_at;
    const lastSentMs = lastSentIso ? new Date(lastSentIso).getTime() : 0;
    const elapsedMs = Date.now() - lastSentMs;
    const FIVE_MIN_MS = 5 * 60 * 1000;

    if (elapsedMs < FIVE_MIN_MS) {
      return;
    }

    const alertMsg = dailyLog.weather_alert_message || "Cambio climático imprevisto detectado en taller.";
    const sent = await telegramSvc.sendIntradayEmergencyAlertBurst(dailyLog.id, alertMsg);
    if (sent) {
      const nowIso = new Date().toISOString();
      const burstCount = (dailyLog.intraday_alert_burst_count || dailyLog.weather_alert_retry_count || 0) + 1;
      store.updateDailyLog(userId, dailyLog.id, {
        intraday_alert_last_sent_at: nowIso,
        intraday_alert_burst_count: burstCount,
        weather_alert_last_sent_at: nowIso,
        weather_alert_retry_count: burstCount
      });
      console.log(`[Scheduler] Intraday Weather alert retry #${burstCount} sent for User #${userId} on ${todayIso}.`);
    }
    return;
  }

  // If alert was NOT triggered yet: evaluate remaining workday hours for weather risk
  try {
    const forecasts = await getHourlyForecast(todayIso, appSettings.latitude, appSettings.longitude);
    const startHourInt = Math.floor(currentLocalHour);
    const endHourInt = Math.ceil(appSettings.operational_end_hour);

    const remainingWorkForecasts = forecasts.filter(f => f.hour >= startHourInt && f.hour <= endHourInt);
    let riskFoundForecast: HourlyForecast | null = null;

    for (const f of remainingWorkForecasts) {
      const isRain = (f.precipitation_probability != null && f.precipitation_probability >= 30) ||
                     (f.precipitation_mm != null && f.precipitation_mm >= appSettings.min_rain_precipitation_mm);
      const isHumid = f.relative_humidity > appSettings.max_humidity_percent;

      if (isRain || isHumid) {
        riskFoundForecast = f;
        break;
      }
    }

    if (!riskFoundForecast) {
      // Secondary check against morning climate snapshot
      let oldSegments: any[] = [];
      try {
        oldSegments = JSON.parse(dailyLog.morning_climate_snapshot || "[]");
      } catch (_) {}

      const newMap = computeHourlyClimateMap(
        forecasts,
        startHourInt,
        endHourInt,
        appSettings.min_rain_precipitation_mm,
        appSettings.max_humidity_percent
      );
      const newSegments = compressClimateSegments(newMap);
      const riskText = detectNewWeatherRisk(oldSegments, newSegments, currentLocalHour, appSettings.operational_end_hour);

      if (!riskText) return;

      const sent = await telegramSvc.sendIntradayEmergencyAlertBurst(dailyLog.id, riskText);
      if (sent) {
        const nowIso = new Date().toISOString();
        store.updateDailyLog(userId, dailyLog.id, {
          intraday_alert_triggered: true,
          intraday_alert_last_sent_at: nowIso,
          intraday_alert_burst_count: 1,
          weather_alert_sent: true,
          weather_alert_message: riskText,
          weather_alert_last_sent_at: nowIso,
          weather_alert_retry_count: 1
        });
        console.log(`[Scheduler] Intraday Weather alert triggered for User #${userId} on ${todayIso}: ${riskText}`);
      }
      return;
    }

    const criticalTimeStr = `${String(riskFoundForecast.hour).padStart(2, "0")}:00`;
    const precipMm = riskFoundForecast.precipitation_mm || 0;
    const humidityPct = riskFoundForecast.relative_humidity || 0;
    const isRain = (riskFoundForecast.precipitation_probability != null && riskFoundForecast.precipitation_probability >= 30) ||
                   precipMm >= appSettings.min_rain_precipitation_mm;

    const detailsText = isRain
      ? `Se pronostica lluvia para las ${criticalTimeStr} hrs (Precipitación: ${precipMm.toFixed(1)} mm / Humedad: ${Math.round(humidityPct)}%).`
      : `Se pronostica humedad crítica para las ${criticalTimeStr} hrs (${Math.round(humidityPct)}%, Máx permitido: ${appSettings.max_humidity_percent}%).`;

    const sent = await telegramSvc.sendIntradayEmergencyAlertBurst(dailyLog.id, detailsText);
    if (sent) {
      const nowIso = new Date().toISOString();
      store.updateDailyLog(userId, dailyLog.id, {
        intraday_alert_triggered: true,
        intraday_alert_last_sent_at: nowIso,
        intraday_alert_burst_count: 1,
        weather_alert_sent: true,
        weather_alert_message: detailsText,
        weather_alert_last_sent_at: nowIso,
        weather_alert_retry_count: 1
      });
      console.log(`[Scheduler] Intraday Emergency Alert triggered for User #${userId} on ${todayIso}: ${detailsText}`);
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

export async function runWorkStartTick(nowDate?: Date): Promise<void> {
  const users = store.getAllUsers();
  for (const user of users) {
    try {
      await processWorkStartNotificationsForUser(user.id, nowDate);
    } catch (err) {
      console.error(`[Scheduler] Error in work start notification tick for User #${user.id}:`, err);
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
  console.log("[Daemon] WORKSHOP OS Multi-Tenant Precision Scheduler starting...");
  console.log("  • Tier 1 (Horizon Evaluation & Calendar Mirror Sync): Dynamic trigger at operational start time");
  console.log("  • Tier 2 (Work Start Telegram Notification): Triggered at the beginning of active work block");
  console.log("  • Tier 3 (Night Check-in): Fixed trigger at configured check-in hour");
  console.log("  • Tier 4 (Urgent Weather Monitor): Active work window scan with 5-min 3-message alert bursts");

  stopDaemon();

  // Initialize Telegram background polling if bot token is present
  TelegramBotService.startPolling();

  // Initial execution of tiers on startup
  runMorningEvalTick().catch(err => console.error("[Daemon Tier 1 Error]:", err));
  runWorkStartTick().catch(err => console.error("[Daemon Tier 2 Error]:", err));
  runCheckinTick().catch(err => console.error("[Daemon Tier 3 Error]:", err));
  runWeatherAlertTick().catch(err => console.error("[Daemon Tier 4 Error]:", err));

  // Tier 1: Morning & Horizon Evaluation loop (every 15 minutes)
  const t1 = setInterval(() => {
    runMorningEvalTick().catch(err => console.error("[Daemon Tier 1 Error]:", err));
  }, 15 * 60 * 1000);

  // Tier 2: Work Start Notification loop (every 5 minutes)
  const t2 = setInterval(() => {
    runWorkStartTick().catch(err => console.error("[Daemon Tier 2 Error]:", err));
  }, 5 * 60 * 1000);

  // Tier 3: Night Check-in loop (every 15 minutes)
  const t3 = setInterval(() => {
    runCheckinTick().catch(err => console.error("[Daemon Tier 3 Error]:", err));
  }, 15 * 60 * 1000);

  // Tier 4: Urgent Weather Monitor loop (every 5 minutes for intraday alerts)
  const t4 = setInterval(() => {
    runWeatherAlertTick().catch(err => console.error("[Daemon Tier 4 Error]:", err));
  }, 5 * 60 * 1000);

  daemonIntervals.push(t1, t2, t3, t4);
}

export function stopDaemon(): void {
  TelegramBotService.stopPolling();
  if (daemonIntervals.length > 0) {
    console.log("[Daemon] Stopping background scheduler daemon...");
    daemonIntervals.forEach(clearInterval);
    daemonIntervals = [];
  }
}
