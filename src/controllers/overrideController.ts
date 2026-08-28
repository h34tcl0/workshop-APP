import { store } from '../db.js';
import { AuthenticatedRequest } from '../auth.js';

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

  res.redirect(303, '/');
}

export function handleClearDayOverride(req: AuthenticatedRequest, res: any) {
  store.clearDayOverride(req.user!.id, req.params.override_date);
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
  }
  res.redirect(303, '/');
}

export function handleDeleteForcedTask(req: AuthenticatedRequest, res: any) {
  store.deleteForcedTask(req.user!.id, parseInt(req.params.forced_id, 10));
  res.redirect(303, '/');
}
