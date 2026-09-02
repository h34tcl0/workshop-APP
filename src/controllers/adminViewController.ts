import { Response } from 'express';
import { AuthenticatedRequest } from '../auth.js';
import { store } from '../db.js';

export function renderAdminDashboard(req: AuthenticatedRequest, res: Response) {
  try {
    const user = req.user!;
    const systemSettings = store.getSystemSettings();
    const stats = {
      total_users: store.getAllUsers().length,
      active_users: store.getActiveUsers().length,
      blocked_users: store.getAllUsers().filter(u => u.status === 'blocked').length,
      revoked_users: store.getAllUsers().filter(u => u.status === 'revoked').length,
      admin_users: store.getAllUsers().filter(u => u.role === 'admin').length
    };

    return res.render('admin', {
      user,
      systemSettings,
      stats,
      pageTitle: 'Panel de Administración'
    });
  } catch (err: any) {
    console.error('[ADMIN] Error rendering admin dashboard:', err);
    return res.status(500).send('Error al cargar panel de administración');
  }
}
