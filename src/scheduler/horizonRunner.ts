import { store } from "../db.js";
import { DayEvaluation, DayStatus, HourlyForecast } from "../types.js";
import { getLocalDateIso, getLocalHoursAndMinutes, LocalDate } from "../dateUtils.js";
import { NotificationDispatcher } from "../notificationDispatcher.js";
import { acquireEvaluationLock, releaseEvaluationLock } from "./locks.js";
import { syncMultiDayCalendar } from "./calendarReconciler.js";
import { loadHorizonWeeklyForecast } from "./forecastLoader.js";
import { evaluateAndPersistDayStep } from "./dayEvaluatorStep.js";

function evaluateDayClosedState(
  userId: number,
  dateIso: string,
  todayIso: string,
  now: Date,
  userTz: string,
  appSettings: any,
  dayOverride: any
): { isDayClosed: boolean; closedReason: string } {
  if (dateIso !== todayIso) return { isDayClosed: false, closedReason: "" };

  const todayLog = store.getDailyLogByDate(userId, todayIso);
  if (todayLog && Boolean(todayLog.checkin_resolved)) {
    return { isDayClosed: true, closedReason: "Jornada concluida (cerrada manualmente por el usuario)." };
  }

  const realWorldToday = getLocalDateIso(now, userTz);
  if (dateIso === realWorldToday) {
    const localHm = getLocalHoursAndMinutes(now, userTz);
    const currentDecHour = localHm.totalHours;
    const endLimit = (dayOverride && dayOverride.custom_end_hour != null) ? dayOverride.custom_end_hour : appSettings.operational_end_hour;
    const minWork = appSettings.min_work_hours || 2.0;

    if (currentDecHour >= endLimit) {
      return { isDayClosed: true, closedReason: `Jornada concluida (horario operativo finalizado a las ${endLimit}:00).` };
    } else if (currentDecHour + minWork > endLimit) {
      return { isDayClosed: true, closedReason: `Jornada no asignable: tiempo restante insuficiente para la ventana mínima (${minWork.toFixed(1)}h antes de las ${endLimit}:00).` };
    }
  }

  return { isDayClosed: false, closedReason: "" };
}

export async function runMorningEvaluation(
  userId: number,
  targetDateIso?: string,
  mockScenario?: string,
  options?: { skipLock?: boolean; silent?: boolean; nowDate?: Date }
): Promise<{
  evalResult: DayEvaluation;
  status: DayStatus;
  reason: string;
  telegramSent: boolean;
  telegramReason: string;
  calendarSynced: boolean;
  calendarReason: string;
}> {
  const needsLock = !options?.skipLock;
  if (needsLock) {
    if (!acquireEvaluationLock(userId)) {
      console.warn(`[Scheduler] Se omitió la evaluación para el Usuario #${userId}: ya hay una evaluación en curso.`);
      throw new Error("EVALUATION_IN_PROGRESS");
    }
  }

  try {
    const now = options?.nowDate || new Date();
    const appSettings = store.getAppSettings(userId);
    const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
    const todayIso = targetDateIso || getLocalDateIso(now, userTz);
    console.log(`[Scheduler] Running Multi-Day Evaluation for User #${userId} starting ${todayIso} (TZ: ${userTz})...`);

    const pendingTasks = store.getPendingTasks(userId);
    const forecastDaysCount = appSettings.forecast_days || 7;
    const horizonEvaluations: Array<{ date_iso: string; evaluation: DayEvaluation }> = [];

    let simulatedPendingTasks = [...pendingTasks];
    const startLocalDate = LocalDate.fromIso(todayIso);

    const weeklyForecastMap = await loadHorizonWeeklyForecast(
      userId,
      todayIso,
      forecastDaysCount,
      appSettings.latitude,
      appSettings.longitude,
      mockScenario
    );

    for (let i = 0; i < forecastDaysCount; i++) {
      const dateIso = startLocalDate.addDays(i).toIso();
      const dayForecasts: HourlyForecast[] = weeklyForecastMap.get(dateIso) || [];
      const dayOverride = store.getDayOverride(userId, dateIso);

      const { isDayClosed, closedReason } = evaluateDayClosedState(
        userId,
        dateIso,
        todayIso,
        now,
        userTz,
        appSettings,
        dayOverride
      );

      const stepResult = evaluateAndPersistDayStep(
        userId,
        dateIso,
        simulatedPendingTasks,
        dayForecasts,
        appSettings,
        isDayClosed,
        closedReason
      );

      simulatedPendingTasks = stepResult.remainingPendingTasks;
      horizonEvaluations.push({ date_iso: dateIso, evaluation: stepResult.evaluation });
    }

    const todayItem = horizonEvaluations.find(h => h.date_iso === todayIso) || horizonEvaluations[0];
    const todayEval = todayItem.evaluation;

    // Execute Mirror Sync with Google Calendar across the horizon
    const calSync = await syncMultiDayCalendar(userId, horizonEvaluations);

    // Check Telegram Work Start notification for today
    const tgResult = options?.silent
      ? { sent: false, reason: "Evaluación silenciosa (sin notificación de Telegram)" }
      : await NotificationDispatcher.processWorkStartNotification(userId, now);

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
  } finally {
    if (needsLock) {
      releaseEvaluationLock(userId);
    }
  }
}

export async function triggerSilentReevaluation(userId: number, targetDateIso?: string): Promise<void> {
  try {
    await runMorningEvaluation(userId, targetDateIso, undefined, { silent: true });
  } catch (err: any) {
    if (err?.message === "EVALUATION_IN_PROGRESS") {
      console.log(`[Scheduler] Silent re-evaluation skipped for User #${userId}: lock active.`);
    } else {
      console.error(`[Scheduler] Error in triggerSilentReevaluation for User #${userId}:`, err);
    }
  }
}
