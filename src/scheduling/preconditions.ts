import {
  AppSettings,
  DayEvaluation,
  DayOverride,
  DayStatus,
  ForcedTaskWithDetails,
  HourlyForecast,
  Task,
  TaskStatus,
  WeatherCutoffInfo
} from "../types.js";
import { formatDateShortEs, getLocalDateIso, LocalDate } from "../dateUtils.js";
import { getHourlyClimateAudit, calculateWeatherCutoff } from "../climate/audit.js";
import { DEFAULT_MAX_RAIN_PROBABILITY } from "../climate/segments.js";
import { buildCommonEvaluationFields } from "./timelineAssembler.js";

export function checkPreconditions(
  evalDateInput: Date | string,
  backlogTasks: Task[],
  forecasts: HourlyForecast[],
  settings: AppSettings,
  holidayDates?: Set<string>,
  options?: { isTodayClosed?: boolean; closedReason?: string }
) {
  const localDate = typeof evalDateInput === "string" ? LocalDate.fromIso(evalDateInput) : LocalDate.fromDate(evalDateInput, settings.timezone);
  const evalDateIso = localDate.toIso();
  const dateStr = localDate.formatShortEs();
  const hourlyWeather = new Map<number, HourlyForecast>();
  for (const f of forecasts) hourlyWeather.set(f.hour, f);

  const startLimit = settings.operational_start_hour;
  const endLimit = settings.operational_end_hour;
  const pendingTasks = backlogTasks.filter(t => t.status !== TaskStatus.COMPLETED).sort((a, b) => a.order - b.order);

  const hasSmallPendingProject = pendingTasks.some(t => {
    const projTasks = pendingTasks.filter(pt => pt.project_id === t.project_id);
    const projHours = projTasks.reduce((acc, pt) => acc + (pt.estimated_hours || 0), 0);
    return projHours > 0 && projHours < settings.min_work_hours;
  });

  const validDurations = pendingTasks.map(t => t.estimated_hours || 0).filter(h => h > 0);
  const minTaskDuration = validDurations.length > 0 ? Math.min(...validDurations, settings.min_work_hours) : settings.min_work_hours;
  const effectiveMinWorkHours = hasSmallPendingProject
    ? (settings.min_work_hours_unless_final != null ? Math.min(settings.min_work_hours, settings.min_work_hours_unless_final) : Math.min(settings.min_work_hours, minTaskDuration))
    : settings.min_work_hours;

  const common = buildCommonEvaluationFields(evalDateIso, dateStr, forecasts, startLimit, endLimit, pendingTasks, settings, effectiveMinWorkHours);

  let blockedEvaluation: DayEvaluation | null = null;
  if (options?.isTodayClosed) {
    const r = options.closedReason || "Jornada concluida (cerrada por el usuario o fuera del horario operativo).";
    blockedEvaluation = { ...common, status: DayStatus.DAY_BLOCKED, reason: r, unassigned_reason: r };
  } else {
    const weekday = localDate.getDayOfWeek();
    const blockedLabels: string[] = [];
    if (settings.exclude_saturdays && weekday === 6) blockedLabels.push("sábado");
    if (settings.exclude_sundays && localDate.isSunday()) blockedLabels.push("domingo");
    if (settings.exclude_holidays && holidayDates?.has(evalDateIso)) blockedLabels.push("feriado");
    if (blockedLabels.length > 0) {
      const r = `Día no laborable (${blockedLabels.join(" / ")}, desactivado en configuración).`;
      blockedEvaluation = { ...common, status: DayStatus.DAY_BLOCKED, reason: r, unassigned_reason: r };
    } else if (pendingTasks.length === 0) {
      const r = "Sin agendamiento: No hay tareas pendientes compatibles en el backlog.";
      blockedEvaluation = { ...common, status: DayStatus.DAY_BLOCKED, reason: r, unassigned_reason: r };
    } else {
      const totalActivePending = pendingTasks.reduce((acc, t) => acc + (t.estimated_hours || 0), 0);
      if (!hasSmallPendingProject && totalActivePending < effectiveMinWorkHours) {
        const r = `Sin agendamiento: La carga de trabajo pendiente en backlog (${totalActivePending.toFixed(1)}h) es menor al tiempo mínimo de ${effectiveMinWorkHours.toFixed(1)}h general de jornada configurado.`;
        blockedEvaluation = { ...common, status: DayStatus.DAY_BLOCKED, reason: r, unassigned_reason: r };
      }
    }
  }

  return { evalDateIso, dateStr, hourlyWeather, startLimit, endLimit, pendingTasks, effectiveMinWorkHours, common, blockedEvaluation };
}

export function applyOverridesAndEvaluate(
  evalDateInput: Date | string,
  backlogTasks: Task[],
  forecasts: HourlyForecast[],
  settings: AppSettings,
  holidayDates?: Set<string>,
  dayOverride?: DayOverride | null,
  forcedTasksDetails: ForcedTaskWithDetails[] = [],
  options?: { isTodayClosed?: boolean; closedReason?: string },
  evaluatorFn?: (d: any, b: any, f: any, s: any, h: any, o: any) => DayEvaluation
): DayEvaluation {
  const evalDateIso = typeof evalDateInput === "string" ? evalDateInput : getLocalDateIso(evalDateInput, settings.timezone);
  const evalDateObj = new Date(`${evalDateIso}T12:00:00Z`);
  const dateStr = formatDateShortEs(evalDateIso);

  if (options?.isTodayClosed || (dayOverride && dayOverride.force_status === "BLOCKED")) {
    const startLimit = dayOverride?.custom_start_hour ?? settings.operational_start_hour;
    const endLimit = dayOverride?.custom_end_hour ?? settings.operational_end_hour;
    const common = buildCommonEvaluationFields(evalDateIso, dateStr, forecasts, startLimit, endLimit, [], settings, settings.min_work_hours);
    const reason = options?.closedReason || dayOverride?.note || (options?.isTodayClosed ? "Jornada concluida (cerrada por el usuario o fuera del horario operativo)." : "Bloqueado manualmente desde el editor de día.");
    const weatherCutoff = calculateWeatherCutoff(forecasts, startLimit, endLimit, settings.min_rain_precipitation_mm, settings.max_humidity_percent, false, undefined, settings.workshop_type || "outdoor", settings.max_rain_probability ?? DEFAULT_MAX_RAIN_PROBABILITY);
    return { ...common, status: DayStatus.DAY_BLOCKED, reason, unassigned_reason: reason, is_manually_blocked: !options?.isTodayClosed && !!dayOverride, forced_tasks: forcedTasksDetails, day_override: dayOverride, weather_cutoff: weatherCutoff };
  }

  let effectiveCfg = { ...settings };
  if (dayOverride) {
    if (dayOverride.force_status === "VIABLE" || dayOverride.custom_start_hour != null || dayOverride.custom_end_hour != null) {
      effectiveCfg.exclude_saturdays = false; effectiveCfg.exclude_sundays = false; effectiveCfg.exclude_holidays = false;
    }
    if (dayOverride.custom_start_hour != null) effectiveCfg.operational_start_hour = dayOverride.custom_start_hour;
    if (dayOverride.custom_end_hour != null) effectiveCfg.operational_end_hour = dayOverride.custom_end_hour;
  }

  let effectiveBacklog = backlogTasks;
  if (dayOverride?.removed_task_ids) {
    try {
      const removedIds = new Set<number>(JSON.parse(dayOverride.removed_task_ids));
      effectiveBacklog = backlogTasks.filter(t => !removedIds.has(t.id));
    } catch {}
  }

  if (forcedTasksDetails?.length > 0) {
    let forcedList = forcedTasksDetails.map(ft => ft.task).filter(Boolean);
    if (dayOverride?.removed_task_ids) {
      try {
        const removedIds = new Set<number>(JSON.parse(dayOverride.removed_task_ids));
        forcedList = forcedList.filter(t => !removedIds.has(t.id));
      } catch {}
    }
    const forcedIds = new Set(forcedList.map(t => t.id));
    effectiveBacklog = [...forcedList, ...effectiveBacklog.filter(t => !forcedIds.has(t.id))];
  }

  const result = evaluatorFn!(evalDateObj, effectiveBacklog, forecasts, effectiveCfg, holidayDates, options);
  result.forced_tasks = forcedTasksDetails;
  result.day_override = dayOverride;
  if (result.status === DayStatus.DAY_VIABLE && result.window) {
    result.hourly_audit = getHourlyClimateAudit(forecasts, result.window, result.scheduled_tasks || [], effectiveCfg);
  }
  return result;
}
