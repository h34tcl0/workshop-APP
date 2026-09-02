import { Response } from 'express';
import { AuthenticatedRequest, getClientIp } from '../auth.js';
import { store } from '../db.js';

export function getSystemSettings(req: AuthenticatedRequest, res: Response) {
  try {
    const settings = store.getSystemSettings();
    return res.json({ settings });
  } catch (err: any) {
    console.error('[ADMIN SYSTEM] Error in getSystemSettings:', err);
    return res.status(500).json({ error: 'Error al consultar configuración del sistema' });
  }
}

export function updateSystemSettings(req: AuthenticatedRequest, res: Response) {
  try {
    const adminId = req.user!.id;
    const previous = store.getSystemSettings();
    const {
      registration_open,
      default_max_projects,
      default_max_tasks,
      default_max_storage_mb,
      default_max_model_size_mb,
      absolute_max_model_size_mb,
      maintenance_mode,
      maintenance_message
    } = req.body;

    const updates: any = {};
    if (registration_open !== undefined) updates.registration_open = registration_open ? 1 : 0;
    if (default_max_projects !== undefined) updates.default_max_projects = parseInt(String(default_max_projects), 10);
    if (default_max_tasks !== undefined) updates.default_max_tasks = parseInt(String(default_max_tasks), 10);
    if (default_max_storage_mb !== undefined) updates.default_max_storage_mb = parseFloat(String(default_max_storage_mb));
    if (default_max_model_size_mb !== undefined) updates.default_max_model_size_mb = parseFloat(String(default_max_model_size_mb));
    if (absolute_max_model_size_mb !== undefined) updates.absolute_max_model_size_mb = parseFloat(String(absolute_max_model_size_mb));
    if (maintenance_mode !== undefined) updates.maintenance_mode = maintenance_mode ? 1 : 0;
    if (maintenance_message !== undefined) updates.maintenance_message = String(maintenance_message).trim();

    store.updateSystemSettings(updates);
    const current = store.getSystemSettings();

    store.logAdminAction({
      admin_user_id: adminId,
      action: 'UPDATE_SYSTEM_SETTINGS',
      details: JSON.stringify({ previous, updated: updates }),
      ip_address: getClientIp(req),
      created_at: new Date().toISOString()
    });

    return res.json({
      success: true,
      message: 'Configuración del sistema actualizada',
      settings: current
    });
  } catch (err: any) {
    console.error('[ADMIN SYSTEM] Error in updateSystemSettings:', err);
    return res.status(500).json({ error: 'Error al actualizar configuración del sistema' });
  }
}
