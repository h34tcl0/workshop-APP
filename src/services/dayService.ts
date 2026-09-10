import { DailyLog, DayStatus, DayEvaluation, TaskStatus } from "../types.js";
import { store } from "../db.js";
import { LocalDate } from "../LocalDate.js";
import { triggerSilentReevaluation } from "../scheduler.js";
import { TaskService } from "./taskService.js";
import {
  sendCheckinResolutionNotification,
  type CheckinResolutionOrigin
} from "../notifications/checkinResolutionNotifier.js";

export interface ResolveDayCheckinOptions {
  userId: number;
  dateIso?: string;
  dailyLogId?: number;
  completedTaskIds?: number[];
  origin: CheckinResolutionOrigin; // PARÁMETRO OBLIGATORIO: 'user' | 'auto_midnight' | 'auto_catchup'
  reason?: string;
  triggerReeval?: boolean;
}

export interface ResolveDayCheckinResult {
  success: boolean;
  dailyLog: DailyLog | null;
  completedCount: number;
  totalCount: number;
  telegramSent: boolean;
}

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
   * Resuelve el check-in de una jornada operativa (manual o automática).
   * 
   * REGLAS ESTRICTAS DE NOTIFICACIÓN:
   * - origin === 'user': El usuario resolvió manualmente el check-in (vía web o modal). SÍ notifica a Telegram.
   * - origin === 'auto_midnight' | 'auto_catchup': Cierre automático o catch-up de días atrasados. NUNCA notifica a Telegram.
   * - La decisión de notificar depende EXCLUSIVAMENTE del flag 'origin' obligatorio, NUNCA de la fecha.
   */
  async resolveDayCheckin(options: ResolveDayCheckinOptions): Promise<ResolveDayCheckinResult> {
    const { userId, origin } = options;
    const completedSet = new Set<number>(Array.isArray(options.completedTaskIds) ? options.completedTaskIds.map(Number) : []);

    let dailyLog = options.dailyLogId ? store.getDailyLogById(userId, Number(options.dailyLogId)) : null;
    if (!dailyLog && options.dateIso) {
      dailyLog = store.getDailyLogByDate(userId, String(options.dateIso).trim());
    }

    const evalDate = dailyLog?.eval_date || (options.dateIso ? String(options.dateIso).trim() : "");

    let taskIds: number[] = [];
    if (dailyLog && dailyLog.scheduled_task_ids) {
      try {
        taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]");
      } catch (_) {}
    }

    if (taskIds.length === 0) {
      taskIds = store.getTasks(userId).map(t => t.id);
    }

    for (const tid of taskIds) {
      const t = store.getTask(userId, tid);
      if (!t || t.user_id !== userId) continue;

      if (completedSet.has(tid)) {
        TaskService.completeTask(userId, t.id, { triggerReeval: false });
      } else {
        // Principio conservador: sin check-in = no se hizo -> reprogramar/mantener en backlog como PENDING
        if (t.status === TaskStatus.COMPLETED || t.status === TaskStatus.IN_PROGRESS || !t.is_active) {
          TaskService.reactivateToBacklog(userId, t.id, { triggerReeval: false });
        }
      }
    }

    const defaultReason = origin === 'user'
      ? "Jornada concluida (cerrada manualmente por el usuario)"
      : (origin === 'auto_midnight'
        ? "Auto-cierre a medianoche (sin check-in = reprogramación al backlog)"
        : "Auto-cierre de jornada vencida (catch-up)");
    const finalReason = options.reason && options.reason.trim() ? options.reason.trim() : defaultReason;

    if (evalDate) {
      dailyLog = DayService.concludeDay(userId, evalDate, finalReason, { triggerReeval: false, checkinSent: true });
    }

    // Despacho de notificación pasando obligatoriamente 'origin'
    let telegramSent = false;
    if (evalDate) {
      telegramSent = await sendCheckinResolutionNotification({
        userId,
        dateStr: evalDate,
        completedCount: completedSet.size,
        totalCount: taskIds.length,
        origin // OBLIGATORIO: 'user' notifica, cualquier otro origen se suprime automáticamente
      });
    }

    if (options.triggerReeval !== false) {
      await triggerSilentReevaluation(userId, evalDate || undefined);
    }

    return {
      success: true,
      dailyLog,
      completedCount: completedSet.size,
      totalCount: taskIds.length,
      telegramSent
    };
  },

  /**
   * Rutina dedicada para auto-cierre silencioso de días vencidos sin resolver (catch-up / medianoche).
   * Aplica el default conservador "sin check-in = no se hizo", devolviendo tareas no completadas al backlog
   * y marcando checkin_resolved = 1.
   * 
   * NUNCA envía notificaciones a Telegram gracias al flag explícito origin: 'auto_midnight'.
   */
  async autoCloseOverdueDays(userId: number, beforeDateIso: string): Promise<number> {
    const overdueLogs = store.getOverdueUnresolvedLogs(userId, beforeDateIso);
    for (const log of overdueLogs) {
      await DayService.resolveDayCheckin({
        userId,
        dateIso: log.eval_date,
        dailyLogId: log.id,
        completedTaskIds: [], // default conservador: sin check-in = no se hizo
        origin: 'auto_midnight', // OBLIGATORIO: suprime 100% las notificaciones
        reason: "Auto-cierre a medianoche (sin check-in = reprogramación al backlog)",
        triggerReeval: false
      });
    }

    if (overdueLogs.length > 0) {
      await triggerSilentReevaluation(userId, beforeDateIso);
    }

    return overdueLogs.length;
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

