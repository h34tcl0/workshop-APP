import { store } from "../db.js";
import { evaluateDayWithOverrides } from "../evaluator.js";
import { getHolidayDatesForRange } from "../holidaysService.js";
import { DayEvaluation, DayStatus, HourlyForecast, Task } from "../types.js";

export interface DayStepResult {
  evaluation: DayEvaluation;
  remainingPendingTasks: Task[];
}

export function evaluateAndPersistDayStep(
  userId: number,
  dateIso: string,
  currentPendingTasks: Task[],
  dayForecasts: HourlyForecast[],
  appSettings: any,
  isDayClosed: boolean,
  closedReason: string
): DayStepResult {
  let dayHolidays = new Set<string>();
  if (appSettings.exclude_holidays) {
    try {
      dayHolidays = getHolidayDatesForRange(dateIso, dateIso);
    } catch (_) {}
  }

  const dayOverride = store.getDayOverride(userId, dateIso);
  const forcedRows = store.getForcedTasksForDate(userId, dateIso);

  const forcedTasksWithHours = forcedRows.map(fr => ({
    task: store.getTask(userId, fr.task_id),
    forced_start_hour: fr.forced_start_hour,
    forced_id: fr.id,
    id: fr.id
  })).filter((item): item is { task: Task; forced_start_hour: number; forced_id: number; id: number } => item.task != null);

  const evalResult = evaluateDayWithOverrides(
    dateIso,
    currentPendingTasks,
    dayForecasts,
    appSettings,
    dayHolidays,
    dayOverride,
    forcedTasksWithHours,
    { isTodayClosed: isDayClosed, closedReason }
  );

  let windowStart: string | null = null;
  let windowEnd: string | null = null;
  let netWorkHours: number | null = null;
  let tasksSummary: string | null = null;
  let scheduledTaskIds: string | null = null;
  let remainingPendingTasks = [...currentPendingTasks];

  if (evalResult.status === DayStatus.DAY_VIABLE && evalResult.window) {
    windowStart = evalResult.window.start_time;
    windowEnd = evalResult.window.end_time;
    netWorkHours = evalResult.window.net_work_hours;
    if (evalResult.scheduled_tasks) {
      tasksSummary = evalResult.scheduled_tasks.map(t => t.title).join(", ");
      scheduledTaskIds = JSON.stringify(evalResult.scheduled_tasks.map(t => t.id));
      const scheduledIds = new Set(evalResult.scheduled_tasks.map(t => t.id));
      remainingPendingTasks = remainingPendingTasks.filter(t => !scheduledIds.has(t.id));
    }
  }
  if (forcedTasksWithHours.length > 0) {
    const forcedIds = new Set(forcedTasksWithHours.map(ft => ft.task.id));
    remainingPendingTasks = remainingPendingTasks.filter(t => !forcedIds.has(t.id));
  }

  const existingLog = store.getDailyLogByDate(userId, dateIso);
  const logData: any = {
    eval_date: dateIso,
    status: evalResult.status,
    block_reason: evalResult.reason,
    window_start: windowStart,
    window_end: windowEnd,
    net_work_hours: netWorkHours,
    tasks_summary: tasksSummary,
    scheduled_task_ids: scheduledTaskIds,
    morning_climate_snapshot: JSON.stringify(evalResult.climate_segments || []),
    hourly_forecast: JSON.stringify(evalResult.hourly_forecast || [])
  };

  if (!existingLog) {
    logData.checkin_sent = false;
    logData.checkin_resolved = false;
    logData.telegram_notified = false;
    logData.calendar_created = false;
    logData.google_event_id = null;
  }

  store.saveDailyLog(userId, logData);

  return {
    evaluation: evalResult,
    remainingPendingTasks
  };
}
