import { AppSettings, HourlyForecast, Task, TimeWindow } from "../types.js";
import { formatHour } from "../dateUtils.js";
import { isHourAcceptableForWorkshopPhase } from "../climate/rules.js";
import { isFinalTaskPackage, hasSignificantProgressOrSmallProject } from "./packageSelection.js";
import {
  getTaskCuringProfile,
  checkCuringCutoffExceeded,
  validateTaskClimateSpan
} from "./curingValidator.js";

export interface PackedWindowResult {
  bestWindow: TimeWindow | null;
  bestScheduledTasks: Task[];
  maxWorkScheduled: number;
  hadWeatherViableButTooShort: boolean;
  firstWeatherConflictDetail: string | null;
}

export function findOptimalWorkWindow(
  startLimit: number,
  endLimit: number,
  effectiveMinWorkHours: number,
  pendingTasks: Task[],
  hourlyWeather: Map<number, HourlyForecast>,
  cfg: AppSettings
): PackedWindowResult {
  let bestWindow: TimeWindow | null = null;
  let bestScheduledTasks: Task[] = [];
  let maxWorkScheduled = -1.0;
  let hadWeatherViableButTooShort = false;
  let firstWeatherConflictDetail: string | null = null;

  const minSpan = Math.max(1, Math.floor(cfg.setup_hours + (effectiveMinWorkHours > 0 ? effectiveMinWorkHours : 0.25)));

  for (let startHour = startLimit; startHour <= endLimit - minSpan; startHour++) {
    // 1. Verificación climática de SETUP
    let setupClimateConflict = false;
    for (let sh = startHour; sh < startHour + cfg.setup_hours; sh++) {
      const wf = hourlyWeather.get(sh);
      if (wf) {
        const setupCheck = isHourAcceptableForWorkshopPhase(wf, "Setup / Preparación de taller", cfg);
        if (!setupCheck.acceptable) {
          setupClimateConflict = true;
          if (!firstWeatherConflictDetail && setupCheck.reason) {
            firstWeatherConflictDetail = setupCheck.reason;
          }
          break;
        }
      }
    }
    if (setupClimateConflict) continue;

    for (let endHour = startHour + minSpan; endHour <= endLimit; endHour++) {
      const availableNetWork = endHour - startHour - cfg.setup_hours;
      if (effectiveMinWorkHours > 0 && availableNetWork < effectiveMinWorkHours) continue;

      const scheduledPackage: Task[] = [];
      let accumulatedActiveHours = 0.0;
      let accumulatedBlockingCureHours = 0.0;
      let operatorCursor = cfg.setup_hours;
      let lastActiveEndOffset = cfg.setup_hours;

      for (const task of pendingTasks) {
        if (accumulatedActiveHours + task.estimated_hours <= availableNetWork + 0.01) {
          const taskStart = startHour + operatorCursor;
          const taskActiveEnd = taskStart + task.estimated_hours;

          if (taskActiveEnd > endHour - cfg.teardown_hours + 0.01) break;

          const { requiresCuring, cureDur, isBlocking } = getTaskCuringProfile(task);

          const cutoffCheck = checkCuringCutoffExceeded(task, taskActiveEnd, cureDur, cfg);
          if (cutoffCheck.exceeded) {
            if (!firstWeatherConflictDetail && cutoffCheck.reason) {
              firstWeatherConflictDetail = cutoffCheck.reason;
            }
            break;
          }

          let nextOperatorCursor = operatorCursor + task.estimated_hours;
          if (requiresCuring && isBlocking) {
            nextOperatorCursor = operatorCursor + task.estimated_hours + cureDur;
          }

          const taskTeardownEnd = taskActiveEnd + cfg.teardown_hours;
          const taskMaxCuringEnd = requiresCuring ? taskStart + task.estimated_hours + cureDur : taskTeardownEnd;

          const climateSpanCheck = validateTaskClimateSpan(task, taskStart, taskMaxCuringEnd, hourlyWeather, cfg);
          if (!climateSpanCheck.acceptable) {
            if (!firstWeatherConflictDetail) {
              firstWeatherConflictDetail = climateSpanCheck.reason;
            }
            break;
          }

          scheduledPackage.push(task);
          accumulatedActiveHours += task.estimated_hours;
          if (requiresCuring && isBlocking) {
            accumulatedBlockingCureHours += cureDur;
          }
          lastActiveEndOffset = Math.max(lastActiveEndOffset, operatorCursor + task.estimated_hours);
          operatorCursor = nextOperatorCursor;
        } else {
          break;
        }
      }

      if (scheduledPackage.length === 0 || accumulatedActiveHours <= 0) continue;

      const actualWorkEnd = startHour + lastActiveEndOffset;
      const actualTeardownEndVal = actualWorkEnd + cfg.teardown_hours;

      // 2. Verificación climática de TEARDOWN
      let teardownClimateConflict = false;
      for (let th = Math.floor(actualWorkEnd); th < Math.ceil(actualTeardownEndVal); th++) {
        const wf = hourlyWeather.get(th);
        if (wf) {
          const teardownCheck = isHourAcceptableForWorkshopPhase(wf, "Teardown / Cierre de taller", cfg);
          if (!teardownCheck.acceptable) {
            teardownClimateConflict = true;
            if (!firstWeatherConflictDetail && teardownCheck.reason) {
              firstWeatherConflictDetail = teardownCheck.reason;
            }
            break;
          }
        }
      }
      if (teardownClimateConflict) continue;

      const packageIsFinal = isFinalTaskPackage(scheduledPackage, pendingTasks);
      const packageIsSmallOrSignificant = hasSignificantProgressOrSmallProject(scheduledPackage, pendingTasks, cfg.min_work_hours);

      let packageMinHours = cfg.min_work_hours;
      if (packageIsFinal) {
        packageMinHours = cfg.min_work_hours_unless_final != null ? cfg.min_work_hours_unless_final : 0.0;
      } else if (packageIsSmallOrSignificant) {
        const smallestTaskInPkg = Math.min(...scheduledPackage.map(t => t.estimated_hours || 0).filter(h => h > 0), cfg.min_work_hours);
        packageMinHours = Math.min(cfg.min_work_hours, smallestTaskInPkg);
      }

      const totalCommittedHours = accumulatedActiveHours + accumulatedBlockingCureHours;
      if (totalCommittedHours < packageMinHours) continue;

      if (accumulatedActiveHours > maxWorkScheduled) {
        maxWorkScheduled = accumulatedActiveHours;
        bestScheduledTasks = scheduledPackage;
        bestWindow = {
          start_time: formatHour(startHour),
          end_time: formatHour(actualTeardownEndVal),
          start_hour: startHour,
          end_hour: Math.ceil(actualTeardownEndVal),
          total_duration_hours: actualTeardownEndVal - startHour,
          net_work_hours: accumulatedActiveHours,
          is_viable: true
        };
      }
    }
  }

  return {
    bestWindow,
    bestScheduledTasks,
    maxWorkScheduled,
    hadWeatherViableButTooShort,
    firstWeatherConflictDetail
  };
}
