import { Response } from 'express';
import { AuthenticatedRequest } from '../auth.js';
import { store } from '../db.js';

export function getAuditLogs(req: AuthenticatedRequest, res: Response) {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const targetUserId = req.query.target_user_id ? parseInt(String(req.query.target_user_id), 10) : undefined;
    const actionFilter = req.query.action ? String(req.query.action) : undefined;

    let logs = store.getAuditLogs(isNaN(limit) ? 50 : Math.min(limit, 200), targetUserId);

    if (actionFilter) {
      logs = logs.filter(l => l.action.toLowerCase() === actionFilter.toLowerCase());
    }

    return res.json({
      logs,
      total_returned: logs.length
    });
  } catch (err: any) {
    console.error('[ADMIN AUDIT] Error in getAuditLogs:', err);
    return res.status(500).json({ error: 'Error al consultar logs de auditoría' });
  }
}
