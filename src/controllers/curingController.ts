import { store } from '../db.js';
import { AuthenticatedRequest } from '../auth.js';
import { TaskService } from '../services/taskService.js';

export function getActiveCuringSessions(req: AuthenticatedRequest, res: any) {
  res.json({ success: true, sessions: store.getActiveCuringSessions(req.user!.id) });
}

export function startCuringSession(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const { task_id, piece_label, duration_hours, started_at } = req.body;
    const taskIdNum = parseInt(String(task_id), 10);
    if (isNaN(taskIdNum)) {
      return res.status(400).json({ error: 'task_id inválido' });
    }

    const durationNum = duration_hours ? parseFloat(String(duration_hours)) : undefined;
    const session = TaskService.startCuring(userId, taskIdNum, {
      piece_label: piece_label ? String(piece_label).trim() : undefined,
      duration_hours: durationNum,
      started_at: started_at ? String(started_at) : undefined
    });

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, session });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('[Curing Error] Error starting curing session:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ error: err.message || 'Error al iniciar secado' });
    }
    res.redirect(303, '/');
  }
}

export function completeCuringSession(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      return res.status(400).json({ error: 'ID de sesión inválido' });
    }

    const session = TaskService.completeCuring(userId, sessionId);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, session });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('[Curing Error] Error completing curing session:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ error: err.message || 'Error al completar secado' });
    }
    res.redirect(303, '/');
  }
}
