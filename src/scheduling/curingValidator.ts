import { AppSettings, Task, TaskCategory, HourlyForecast } from "../types.js";
import { formatHour } from "../dateUtils.js";
import { isHourAcceptableForTask } from "../climate/rules.js";

export interface TaskCuringProfile {
  requiresCuring: boolean;
  cureDur: number;
  isBlocking: boolean;
}

export function getTaskCuringProfile(task: Task): TaskCuringProfile {
  const requiresCuring =
    task.requires_curing ||
    task.curing_hours > 0 ||
    task.category === TaskCategory.PVA_GLUE ||
    task.category === TaskCategory.VARNISH_PAINT ||
    task.category === TaskCategory.EPOXY;

  const cureDur = requiresCuring
    ? task.curing_hours > 0
      ? task.curing_hours
      : task.category === TaskCategory.EPOXY
      ? 6.0
      : 2.0
    : 0.0;

  const isBlocking = task.curing_is_blocking !== false;

  return { requiresCuring, cureDur, isBlocking };
}

export function checkCuringCutoffExceeded(
  task: Task,
  taskActiveEnd: number,
  cureDur: number,
  cfg: AppSettings
): { exceeded: boolean; reason?: string } {
  const mustCompleteCuringBeforeCutoff =
    cfg.require_curing_before_cutoff === true ||
    (cfg.require_curing_before_cutoff as any) === 1;

  if (mustCompleteCuringBeforeCutoff && taskActiveEnd + cureDur > cfg.operational_end_hour + 0.01) {
    const reason = `El curado de la tarea [${task.project_name || "Tarea"}] "${task.title}" (${cureDur.toFixed(1)}h) superaría el corte operativo de las ${formatHour(cfg.operational_end_hour)} (terminaría a las ${formatHour(taskActiveEnd + cureDur)}).`;
    return { exceeded: true, reason };
  }

  return { exceeded: false };
}

export function validateTaskClimateSpan(
  task: Task,
  taskStart: number,
  taskMaxCuringEnd: number,
  hourlyWeather: Map<number, HourlyForecast>,
  cfg: AppSettings
): { acceptable: boolean; reason: string | null } {
  const checkStartH = Math.floor(taskStart);
  const checkEndH = Math.min(23, Math.floor(taskMaxCuringEnd));

  for (let h = checkStartH; h <= checkEndH; h++) {
    const wf = hourlyWeather.get(h);
    if (wf) {
      const taskCheck = isHourAcceptableForTask(wf, task, cfg);
      if (!taskCheck.acceptable) {
        return { acceptable: false, reason: taskCheck.reason || null };
      }
    }
  }

  return { acceptable: true, reason: null };
}
