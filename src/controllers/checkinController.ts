import { store } from '../db.js';
import { AuthenticatedRequest } from '../auth.js';
import { getLocalDateIso } from '../dateUtils.js';
import { TaskStatus, Task } from '../types.js';
import { TaskService } from '../services/taskService.js';
import { DayService } from '../services/dayService.js';
import { TelegramBotService } from '../telegramBot.js';
import {
  runMorningEvaluation,
  runCheckinTick,
  acquireEvaluationLock,
  releaseEvaluationLock,
  triggerSilentReevaluation
} from '../scheduler.js';

export async function handleForceRun(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  const scenario = req.body.scenario || req.query.scenario;

  const isJsonRequested = req.xhr || 
    (req.headers.accept && req.headers.accept.includes('application/json')) ||
    (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) ||
    req.path.startsWith('/api/') ||
    req.body.format === 'json';

  try {
    const evalRunResult = await runMorningEvaluation(userId, undefined, scenario || undefined);

    if (isJsonRequested) {
      return res.json({
        success: true,
        status: evalRunResult.status,
        reason: evalRunResult.reason,
        telegramSent: evalRunResult.telegramSent,
        telegramReason: evalRunResult.telegramReason,
        calendarSynced: evalRunResult.calendarSynced,
        calendarReason: evalRunResult.calendarReason,
        evalResult: evalRunResult.evalResult
      });
    }

    if (scenario) {
      res.redirect(303, `/?scenario=${encodeURIComponent(String(scenario))}`);
    } else {
      res.redirect(303, '/');
    }
  } catch (err: any) {
    if (err.message === 'EVALUATION_IN_PROGRESS') {
      console.warn(`[Server] Solicitud de evaluación rechazada por evaluación en curso para Usuario #${userId}`);
      if (isJsonRequested) {
        return res.status(429).json({
          success: false,
          error: 'Ya hay una evaluación en curso, esperá unos segundos.',
          code: 'EVALUATION_IN_PROGRESS',
          telegramSent: false,
          telegramReason: '⚠️ Evaluación en curso',
          calendarSynced: false,
          calendarReason: '⚠️ Evaluación en curso'
        });
      }
      return res.redirect(303, '/');
    }

    console.error('Error running evaluation:', err);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(500).json({
        success: false,
        error: err.message || 'Error executing evaluation',
        telegramSent: false,
        telegramReason: '❌ Error en servidor durante evaluación',
        calendarSynced: false,
        calendarReason: '❌ Error en servidor durante evaluación'
      });
    }
    res.redirect(303, '/');
  }
}

export async function handleForceCheckin(req: AuthenticatedRequest, res: any) {
  try {
    await runCheckinTick(undefined, true, req.user!.id);
  } catch (err) {
    console.error('Error running forced checkin:', err);
  }
  res.redirect(303, '/');
}

export async function handleEndShift(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  if (!acquireEvaluationLock(userId)) {
    return res.status(429).json({
      success: false,
      error: 'Ya hay una evaluación en curso, esperá unos segundos.',
      code: 'EVALUATION_IN_PROGRESS'
    });
  }

  try {
    const appSettings = store.getAppSettings(userId);
    const userTz = appSettings?.timezone || process.env.TIMEZONE || "America/Santiago";
    const now = new Date();
    const todayIso = getLocalDateIso(now, userTz);

    let dailyLog = store.getDailyLogByDate(userId, todayIso);
    if (!dailyLog) {
      await runMorningEvaluation(userId, todayIso, undefined, { skipLock: true });
      dailyLog = store.getDailyLogByDate(userId, todayIso);
    }

    let taskIds: number[] = [];
    if (dailyLog && dailyLog.scheduled_task_ids) {
      try { taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]"); } catch (_) {}
    }

    let scheduledTasks = taskIds
      .map(tid => store.getTask(userId, tid))
      .filter((t): t is Task => t != null && t.user_id === userId);

    if (scheduledTasks.length === 0) {
      const activeProject = store.getActiveProject(userId);
      scheduledTasks = store.getPendingTasks(userId, activeProject?.id);

      if (dailyLog && scheduledTasks.length > 0) {
        store.updateDailyLog(userId, dailyLog.id, {
          scheduled_task_ids: JSON.stringify(scheduledTasks.map(t => t.id))
        });
      }
    }

    if (dailyLog && dailyLog.checkin_resolved) {
      return res.json({
        success: true,
        alreadyResolved: true,
        message: "El check-in de la jornada de hoy ya fue completado previamente.",
        dailyLogId: dailyLog.id,
        dateIso: todayIso,
        tasks: scheduledTasks.map(t => ({
          id: t.id,
          title: t.title,
          project_name: t.project_name || '',
          estimated_hours: t.estimated_hours,
          status: t.status,
          completed: t.status === TaskStatus.COMPLETED
        }))
      });
    }

    let targetChatId = appSettings.telegram_chat_id ? appSettings.telegram_chat_id.trim() : "";
    if (!targetChatId && userId === 1 && process.env.TELEGRAM_CHAT_ID) {
      targetChatId = process.env.TELEGRAM_CHAT_ID.trim();
    }

    let telegramSent = false;
    let telegramError = "";

    if (targetChatId && process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const telegramSvc = new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN, targetChatId);
        const uncompletedTasks = scheduledTasks.filter(t => t.status !== TaskStatus.COMPLETED);
        if (uncompletedTasks.length > 0 && dailyLog) {
          telegramSent = await telegramSvc.sendCheckinPrompt(dailyLog.id, uncompletedTasks);
          if (telegramSent) {
            store.updateDailyLog(userId, dailyLog.id, { checkin_sent: true });
          } else {
            telegramError = "El bot de Telegram no pudo entregar el mensaje (bloqueado o desvinculado).";
          }
        } else if (uncompletedTasks.length === 0) {
          telegramError = (dailyLog && dailyLog.status === 'DAY_BLOCKED')
            ? "El día estuvo marcado como NO VIABLE (DAY_BLOCKED). No hay tareas pendientes."
            : "No hay tareas pendientes sin completar para la jornada de hoy.";
        }
      } catch (err: any) {
        telegramError = err?.message || "Error al comunicarse con la API de Telegram";
      }
    } else {
      telegramError = (dailyLog && dailyLog.status === 'DAY_BLOCKED' && scheduledTasks.length === 0)
        ? "El día estuvo marcado como NO VIABLE (DAY_BLOCKED). No hay tareas pendientes."
        : "No hay una cuenta de Telegram vinculada en la configuración.";
    }

    return res.json({
      success: true,
      telegramSent,
      telegramError: telegramSent ? undefined : telegramError,
      dailyLogId: dailyLog ? dailyLog.id : null,
      dateIso: todayIso,
      tasks: scheduledTasks.map(t => ({
        id: t.id,
        title: t.title,
        project_name: t.project_name || '',
        estimated_hours: t.estimated_hours,
        status: t.status,
        completed: t.status === TaskStatus.COMPLETED
      }))
    });
  } catch (err: any) {
    console.error('Error en término de jornada / check-in:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al procesar el término de jornada' });
  } finally {
    releaseEvaluationLock(userId);
  }
}

export async function handleResolveCheckin(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  const { dailyLogId, completedTaskIds } = req.body;

  try {
    const completedSet = new Set<number>(Array.isArray(completedTaskIds) ? completedTaskIds.map(Number) : []);
    let dailyLog = dailyLogId ? store.getDailyLogById(userId, Number(dailyLogId)) : null;

    let taskIds: number[] = [];
    if (dailyLog && dailyLog.scheduled_task_ids) {
      try { taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]"); } catch (_) {}
    }

    if (taskIds.length === 0) {
      taskIds = store.getTasks(userId).map(t => t.id);
    }

    for (const tid of taskIds) {
      const t = store.getTask(userId, tid);
      if (!t || t.user_id !== userId) continue;

      if (completedSet.has(tid)) {
        TaskService.completeTask(userId, t.id, { triggerReeval: false });
      } else if (t.status === TaskStatus.COMPLETED) {
        TaskService.reactivateToBacklog(userId, t.id, { triggerReeval: false });
      }
    }

    if (dailyLog) {
      DayService.concludeDay(userId, dailyLog.eval_date, "Jornada concluida (cerrada manualmente por el usuario)", { triggerReeval: false, checkinSent: true });
    }

    await triggerSilentReevaluation(userId, dailyLog?.eval_date);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('Error al resolver checkin:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al guardar check-in' });
  }
}
