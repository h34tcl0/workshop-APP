import { AppSettings, Task, HourlyForecast, DayEvaluation, DayOverride, ForcedTaskWithDetails } from "../types.js";
import { findOptimalWorkWindow } from "./windowPacker.js";
import { checkPreconditions, applyOverridesAndEvaluate } from "./preconditions.js";
import { buildViableEvaluation, buildBlockedDayEvaluation } from "./timelineAssembler.js";

export function evaluateDayFeasibility(
  evalDateInput: Date | string,
  backlogTasks: Task[],
  forecasts: HourlyForecast[],
  settings: AppSettings,
  holidayDates?: Set<string>,
  options?: { isTodayClosed?: boolean; closedReason?: string }
): DayEvaluation {
  const pre = checkPreconditions(evalDateInput, backlogTasks, forecasts, settings, holidayDates, options);
  if (pre.blockedEvaluation) return pre.blockedEvaluation;

  const { bestWindow, bestScheduledTasks, maxWorkScheduled, hadWeatherViableButTooShort, firstWeatherConflictDetail } =
    findOptimalWorkWindow(pre.startLimit, pre.endLimit, pre.effectiveMinWorkHours, pre.pendingTasks, pre.hourlyWeather, settings);

  if (bestWindow && bestScheduledTasks.length > 0) {
    console.log(`[EVALUATOR] Assigned ${bestScheduledTasks.length} task(s) to Date ${pre.evalDateIso} (${maxWorkScheduled.toFixed(1)}h work):`, bestScheduledTasks.map(t => `#${t.order || t.id} ${t.title}`).join(", "));
    return buildViableEvaluation(pre.common, bestWindow, bestScheduledTasks, pre.pendingTasks, forecasts, pre.startLimit, pre.endLimit, settings);
  }

  return buildBlockedDayEvaluation(pre, forecasts, settings, firstWeatherConflictDetail, hadWeatherViableButTooShort);
}

export function evaluateDayWithOverrides(
  evalDateInput: Date | string,
  backlogTasks: Task[],
  forecasts: HourlyForecast[],
  settings: AppSettings,
  holidayDates?: Set<string>,
  dayOverride?: DayOverride | null,
  forcedTasksDetails: ForcedTaskWithDetails[] = [],
  options?: { isTodayClosed?: boolean; closedReason?: string }
): DayEvaluation {
  return applyOverridesAndEvaluate(
    evalDateInput, backlogTasks, forecasts, settings, holidayDates,
    dayOverride, forcedTasksDetails, options, evaluateDayFeasibility
  );
}
