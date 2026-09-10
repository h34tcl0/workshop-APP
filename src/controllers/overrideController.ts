import { store } from '../db.js';
import { AuthenticatedRequest } from '../auth.js';
import { triggerSilentReevaluation } from '../scheduler.js';

export function handleSaveDayOverride(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  const override_date = req.params.override_date;
  const { force_status, custom_start_hour, custom_end_hour, removed_task_ids, note } = req.body;

  let removedIds: number[] = [];
  if (Array.isArray(removed_task_ids)) {
    removedIds = removed_task_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
  } else if (removed_task_ids) {
    const parsed = parseInt(removed_task_ids, 10);
    if (!isNaN(parsed)) removedIds.push(parsed);
  }

  store.saveDayOverride(userId, override_date, {
    force_status: force_status === 'VIABLE' || force_status === 'BLOCKED' ? force_status : null,
    custom_start_hour: custom_start_hour ? parseInt(custom_start_hour, 10) : null,
    custom_end_hour: custom_end_hour ? parseInt(custom_end_hour, 10) : null,
    removed_task_ids: removedIds,
    note: note || ''
  });

  triggerSilentReevaluation(userId).catch(err => console.error('[Scheduler] Error in silent reevaluation after saveDayOverride:', err));

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true });
  }
  res.redirect(303, '/');
}

export function handleClearDayOverride(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  store.clearDayOverride(userId, req.params.override_date);

  triggerSilentReevaluation(userId).catch(err => console.error('[Scheduler] Error in silent reevaluation after clearDayOverride:', err));

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true });
  }
  res.redirect(303, '/');
}

export function handleForceTask(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  const override_date = req.params.override_date;
  const { task_id, forced_start_hour } = req.body;
  const parsedTaskId = parseInt(task_id, 10);
  const task = store.getTask(userId, parsedTaskId);
  if (task) {
    store.addForcedTask(userId, override_date, parsedTaskId, parseFloat(forced_start_hour) || 9.0);
    triggerSilentReevaluation(userId).catch(err => console.error('[Scheduler] Error in silent reevaluation after forceTask:', err));
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true });
  }
  res.redirect(303, '/');
}

export function handleDeleteForcedTask(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  store.deleteForcedTask(userId, parseInt(req.params.forced_id, 10));

  triggerSilentReevaluation(userId).catch(err => console.error('[Scheduler] Error in silent reevaluation after deleteForcedTask:', err));

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true });
  }
  res.redirect(303, '/');
}

export function handleSaveDayOverrideRange(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  const { start_date, end_date, note } = req.body;

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!start_date || !end_date || !dateRegex.test(start_date) || !dateRegex.test(end_date)) {
    return res.status(400).json({ success: false, error: 'Formato de fecha inválido. Se espera YYYY-MM-DD.' });
  }

  if (start_date > end_date) {
    return res.status(400).json({ success: false, error: 'La fecha de inicio no puede ser posterior a la fecha de término.' });
  }

  try {
    const result = store.saveDayOverrideRange(userId, start_date, end_date, note);
    triggerSilentReevaluation(userId).catch(err => console.error('[Scheduler] Error in silent reevaluation after saveDayOverrideRange:', err));

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, affectedDates: result.affectedDates });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('[OverrideController] Error saving range:', err);
    res.status(500).json({ success: false, error: err.message || 'Error al guardar el rango de pausa.' });
  }
}

export function handleClearDayOverrideRange(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  const { start_date, end_date } = req.body;

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!start_date || !end_date || !dateRegex.test(start_date) || !dateRegex.test(end_date)) {
    return res.status(400).json({ success: false, error: 'Formato de fecha inválido. Se espera YYYY-MM-DD.' });
  }

  if (start_date > end_date) {
    return res.status(400).json({ success: false, error: 'La fecha de inicio no puede ser posterior a la fecha de término.' });
  }

  try {
    const result = store.clearDayOverrideRange(userId, start_date, end_date);
    triggerSilentReevaluation(userId).catch(err => console.error('[Scheduler] Error in silent reevaluation after clearDayOverrideRange:', err));

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, ...result });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('[OverrideController] Error clearing range:', err);
    res.status(500).json({ success: false, error: err.message || 'Error al limpiar el rango de pausa.' });
  }
}
