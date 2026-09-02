import { store } from '../db.js';
import { AuthenticatedRequest } from '../auth.js';
import { evaluateDayWithOverrides, getHourlyClimateAudit } from '../evaluator.js';
import { getHourlyForecast, getWeeklyForecast, MockWeatherService } from '../weatherService.js';
import { getHolidayDatesForRange } from '../holidaysService.js';
import { formatDateShortEs, getLocalHoursAndMinutes, getWorkshopLocalTime, LocalDate } from '../dateUtils.js';
import { TaskCategory, Task } from '../types.js';

export const CATEGORY_LABELS: Record<string, string> = {
  carpentry: 'Carpintería',
  pva_glue: 'Encolado',
  varnish_paint: 'Barnizado/Pintura',
  epoxy: 'Epoxi'
};

export const STATUS_LABELS: Record<string, string> = {
  DAY_VIABLE: 'Agendado',
  DAY_SUSPENDED: 'Suspendido',
  NO_WORK_NEEDED: 'Sin trabajo pendiente',
  WEATHER_WINDOW_CLOSED: 'Ventana cerrada por clima',
  TIME_INSUFFICIENT: 'Tiempo insuficiente',
  MANUALLY_BLOCKED: 'Bloqueado manualmente'
};

export async function renderDashboard(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const scenario = typeof req.query.scenario === 'string' ? req.query.scenario : undefined;
    const appSettings = store.getAppSettings(userId);
    const activeProject = store.getActiveProject(userId);
    const tasks = store.getPendingTasks(userId);
    const allTasks = store.getTasks(userId);
    let simulatedPendingTasks = [...tasks];

    const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || 'America/Santiago';
    const todayLocalDate = LocalDate.today(userTz);
    const todayStr = todayLocalDate.toIso();

    let holidayDates = new Set<string>();
    if (appSettings.exclude_holidays) {
      const endDateStr = todayLocalDate.addDays(6).toIso();
      holidayDates = getHolidayDatesForRange(todayStr, endDateStr);
    }

    let weeklyForecasts: Record<string, any[]> | null = null;
    if (!scenario) {
      weeklyForecasts = await getWeeklyForecast(todayStr, 7, appSettings.latitude, appSettings.longitude);
    }

    const forecastEvaluations = [];

    for (let d = 0; d < 7; d++) {
      const evalLocalDate = todayLocalDate.addDays(d);
      const evalDate = evalLocalDate.toIso();

      const dayOverride = store.getDayOverride(userId, evalDate);
      const forcedRows = store.getForcedTasksForDate(userId, evalDate);

      const forcedTasksWithHours = forcedRows.map(fr => ({
        task: store.getTask(userId, fr.task_id),
        forced_start_hour: fr.forced_start_hour,
        forced_id: fr.id,
        id: fr.id
      })).filter((item): item is { task: Task; forced_start_hour: number; forced_id: number; id: number } => item.task != null);

      let hourly;
      if (scenario) {
        const mockSvc = new MockWeatherService(scenario);
        hourly = mockSvc.getHourlyForecast(evalDate);
      } else if (weeklyForecasts && weeklyForecasts[evalDate]) {
        hourly = weeklyForecasts[evalDate];
      } else {
        hourly = await getHourlyForecast(evalDate, appSettings.latitude, appSettings.longitude);
      }

      let isDayClosed = false;
      let closedReason = "";

      if (evalDate === todayStr) {
        const todayLog = store.getDailyLogByDate(userId, todayStr);
        const localHm = getLocalHoursAndMinutes(new Date(), userTz);
        const currentDecHour = localHm.totalHours;
        const endLimit = (dayOverride && dayOverride.custom_end_hour != null) ? dayOverride.custom_end_hour : appSettings.operational_end_hour;
        const minWork = appSettings.min_work_hours || 2.0;

        if (todayLog && Boolean(todayLog.checkin_resolved)) {
          isDayClosed = true;
          closedReason = "Jornada concluida (cerrada manualmente por el usuario).";
        } else if (currentDecHour >= endLimit) {
          isDayClosed = true;
          closedReason = `Jornada concluida (horario operativo finalizado a las ${endLimit}:00).`;
        } else if (currentDecHour + minWork > endLimit) {
          isDayClosed = true;
          closedReason = `Jornada no asignable: tiempo restante insuficiente para la ventana mínima (${minWork.toFixed(1)}h antes de las ${endLimit}:00).`;
        }
      }

      const evalRes = evaluateDayWithOverrides(
        evalDate,
        simulatedPendingTasks,
        hourly,
        appSettings,
        holidayDates,
        dayOverride,
        forcedTasksWithHours,
        { isTodayClosed: isDayClosed, closedReason }
      );

      if (evalRes.status === 'DAY_VIABLE' && evalRes.scheduled_tasks && evalRes.scheduled_tasks.length > 0) {
        const scheduledIds = new Set(evalRes.scheduled_tasks.map(t => t.id));
        simulatedPendingTasks = simulatedPendingTasks.filter(t => !scheduledIds.has(t.id));
      }
      if (forcedTasksWithHours.length > 0) {
        const forcedIds = new Set(forcedTasksWithHours.map(ft => ft.task.id));
        simulatedPendingTasks = simulatedPendingTasks.filter(t => !forcedIds.has(t.id));
      }

      forecastEvaluations.push({
        date_iso: evalDate,
        date_str: formatDateShortEs(evalDate),
        evaluation: evalRes,
        day_override: dayOverride,
        status_label: STATUS_LABELS[evalRes.status] || evalRes.status
      });
    }

    const todayEval = forecastEvaluations.length > 0 ? forecastEvaluations[0].evaluation : null;
    let scheduledTaskCount = (todayEval && Array.isArray(todayEval.scheduled_tasks)) ? todayEval.scheduled_tasks.length : 0;
    if (todayEval && Array.isArray(todayEval.forced_tasks)) {
      scheduledTaskCount += todayEval.forced_tasks.length;
    }

    const todayLog = store.getDailyLogByDate(userId, todayStr);
    if (scheduledTaskCount === 0 && todayLog && todayLog.scheduled_task_ids) {
      try {
        const parsedIds = JSON.parse(todayLog.scheduled_task_ids || '[]');
        if (Array.isArray(parsedIds)) scheduledTaskCount = parsedIds.length;
      } catch (_) {}
    }

    const localHm = getLocalHoursAndMinutes(new Date(), userTz);
    const currentDecHour = localHm.totalHours;
    const todayOverride = store.getDayOverride(userId, todayStr);
    const todayEndLimit = (todayOverride && todayOverride.custom_end_hour != null) ? todayOverride.custom_end_hour : appSettings.operational_end_hour;
    const isShiftTimeEnded = currentDecHour >= todayEndLimit;
    const isCheckinResolved = Boolean(todayLog && todayLog.checkin_resolved);
    const hasTasksToResolve = scheduledTaskCount > 0;
    const isCheckinTriggered = isShiftTimeEnded || Boolean(todayLog && todayLog.checkin_sent);

    const showEndShiftPrompt = hasTasksToResolve && isCheckinTriggered && !isCheckinResolved;

    res.render('index', {
      project: activeProject,
      tasks,
      forecast_evaluations: forecastEvaluations,
      current_scenario: scenario || 'real',
      categories: Object.values(TaskCategory),
      category_labels: CATEGORY_LABELS,
      status_labels: STATUS_LABELS,
      app_settings: appSettings,
      local_time_info: getWorkshopLocalTime(new Date(), appSettings.timezone),
      completed_history: store.getRecentCompletedHistory(userId),
      task_history: store.getTaskHistory(userId),
      project_templates: store.getProjectTemplates(userId),
      materials: store.getMaterials(userId),
      tools: store.getTools(userId),
      calculator_offsets: store.getCalculatorOffsets(userId),
      all_projects: store.getProjects(userId),
      all_tasks: allTasks,
      active_curing_sessions: store.getActiveCuringSessions(userId),
      show_end_shift_prompt: showEndShiftPrompt,
      getHourlyClimateAudit
    });
  } catch (err) {
    console.error('Error rendering dashboard:', err);
    res.status(500).send('Internal Server Error');
  }
}
