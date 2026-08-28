import {
  AppSettings,
  Task,
  TaskCategory,
  TimeWindow,
  TimelineItem
} from "../types.js";
import { formatHour, formatHourCrossDay } from "../dateUtils.js";

export interface BuiltTimelineResult {
  timeline: TimelineItem[];
  cutoffReason: string;
  maxCuringEnd: number;
}

export function buildScheduledTimeline(
  bestScheduledTasks: Task[],
  bestWindow: TimeWindow,
  cfg: AppSettings,
  pendingTasks: Task[]
): BuiltTimelineResult {
  const timeline: TimelineItem[] = [];
  let currH = bestWindow.start_hour;

  const setupEnd = currH + cfg.setup_hours;
  timeline.push({
    time_range: `${formatHour(currH)} — ${formatHour(setupEnd)}`,
    title: "Setup / Preparación de taller",
    duration: `${cfg.setup_hours.toFixed(1)}h`
  });
  currH = setupEnd;

  let maxCuringEnd = currH;
  for (let i = 0; i < bestScheduledTasks.length; i++) {
    const task = bestScheduledTasks[i];
    const tEnd = currH + task.estimated_hours;
    timeline.push({
      time_range: `${formatHour(currH)} — ${formatHour(tEnd)}`,
      title: `#${task.order || (i + 1)} ${task.title}`,
      duration: `${task.estimated_hours.toFixed(1)}h`,
      project_name: task.project_name || undefined,
      project_id: task.project_id || undefined,
      project_color: task.project_color || undefined
    });
    currH = tEnd;

    const reqCur = task.requires_curing || task.curing_hours > 0 || task.category === TaskCategory.PVA_GLUE || task.category === TaskCategory.VARNISH_PAINT || task.category === TaskCategory.EPOXY;
    const isBlocking = task.curing_is_blocking !== false;

    if (reqCur) {
      const cDur = task.curing_hours > 0 ? task.curing_hours : (task.category === TaskCategory.EPOXY ? 6.0 : 2.0);
      const cEnd = tEnd + cDur;
      if (cEnd > maxCuringEnd) maxCuringEnd = cEnd;

      if (isBlocking && i < bestScheduledTasks.length - 1) {
        timeline.push({
          time_range: `${formatHour(tEnd)} — ${formatHour(cEnd)}`,
          title: "Curado / Secado (bloquea el inicio de la siguiente tarea)",
          duration: `${cDur.toFixed(1)}h`
        });
        currH = cEnd;
      } else if (!isBlocking) {
        timeline.push({
          time_range: `${formatHour(tEnd)} — ${formatHourCrossDay(cEnd)}`,
          title: `Secado en Paralelo [${task.title}] (no bloqueante)`,
          duration: `${cDur.toFixed(1)}h`
        });
      }
    }
  }

  const teardownEnd = currH + cfg.teardown_hours;
  timeline.push({
    time_range: `${formatHour(currH)} — ${formatHour(teardownEnd)}`,
    title: "Teardown / Guardado de herramientas",
    duration: `${cfg.teardown_hours.toFixed(1)}h`
  });

  if (maxCuringEnd > teardownEnd) {
    timeline.push({
      time_range: `${formatHour(teardownEnd)} — ${formatHourCrossDay(maxCuringEnd)}`,
      title: "Curado / Secado pasivo en taller",
      duration: `${(maxCuringEnd - teardownEnd).toFixed(1)}h`
    });
  }

  const remaining = pendingTasks.filter(t => !bestScheduledTasks.includes(t));
  let cutoffReason = "";
  if (remaining.length === 0) {
    cutoffReason = "Todas las tareas pendientes fueron asignadas.";
  } else {
    const nextT = remaining[0];
    cutoffReason = `La siguiente tarea ('${nextT.title}' - ${nextT.estimated_hours.toFixed(1)}h activo) no pudo agendarse por límite de jornada o margen de tiempo.`;
  }

  return {
    timeline,
    cutoffReason,
    maxCuringEnd
  };
}
