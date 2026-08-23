import { DailyLog, DayStatus, DayEvaluation } from "../types.js";
import { store } from "../db.js";
import { LocalDate } from "../LocalDate.js";
import { triggerSilentReevaluation } from "../scheduler.js";

export const DayService = {
  /**
   * Concluye la jornada para un día específico registrando el motivo explícito.
   * Cubre tanto el cierre manual (checkin_resolved) como el cierre por horario operativo agotado.
   */
  concludeDay(
    userId: number,
    date: LocalDate | string,
    reason?: string,
    options: { triggerReeval?: boolean; checkinSent?: boolean } = { triggerReeval: true, checkinSent: true }
  ): DailyLog {
    const localDate = LocalDate.from(date);
    const dateIso = localDate.toIso();

    const currentLog = store.getDailyLogByDate(userId, dateIso);
    const defaultReason = "Jornada concluida (cerrada manualmente por el usuario o fin de horario operativo)";
    const finalReason = reason && reason.trim() ? reason.trim() : (currentLog?.block_reason || defaultReason);

    const updated = store.saveDailyLog(userId, {
      eval_date: dateIso,
      status: DayStatus.DAY_BLOCKED,
      block_reason: finalReason,
      checkin_sent: options.checkinSent !== undefined ? options.checkinSent : (currentLog?.checkin_sent || false),
      checkin_resolved: true
    });

    if (options.triggerReeval !== false) {
      triggerSilentReevaluation(userId);
    }
    return updated;
  },

  /**
   * Registra o actualiza el snapshot de evaluación meteorológica y de asignación para un día.
   */
  recordEvaluation(
    userId: number,
    date: LocalDate | string,
    evaluation: DayEvaluation,
    options: {
      checkinResolved?: boolean;
      triggerReeval?: boolean;
    } = {}
  ): DailyLog {
    const localDate = LocalDate.from(date);
    const dateIso = localDate.toIso();

    const tasksSummary = evaluation.scheduled_tasks && evaluation.scheduled_tasks.length > 0
      ? JSON.stringify(evaluation.scheduled_tasks.map(t => ({
          id: t.id,
          title: t.title,
          estimated_hours: t.estimated_hours,
          curing_hours: t.curing_hours
        })))
      : null;

    const hourlyForecastJson = evaluation.hourly_forecast && evaluation.hourly_forecast.length > 0
      ? JSON.stringify(evaluation.hourly_forecast)
      : null;

    const blockReason = evaluation.status === DayStatus.DAY_BLOCKED
      ? (evaluation.cutoff_reason || evaluation.unassigned_reason || evaluation.reason || null)
      : null;

    const updated = store.saveDailyLog(userId, {
      eval_date: dateIso,
      status: evaluation.status,
      block_reason: blockReason,
      tasks_summary: tasksSummary,
      hourly_forecast: hourlyForecastJson,
      window_start: evaluation.window ? evaluation.window.start_time : null,
      window_end: evaluation.window ? evaluation.window.end_time : null,
      net_work_hours: evaluation.window ? evaluation.window.net_work_hours : null,
      checkin_resolved: options.checkinResolved
    });

    if (options.triggerReeval === true) {
      triggerSilentReevaluation(userId);
    }
    return updated;
  }
};
