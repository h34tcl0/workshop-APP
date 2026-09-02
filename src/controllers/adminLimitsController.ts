import { Response } from 'express';
import { AuthenticatedRequest, getClientIp } from '../auth.js';
import { store } from '../db.js';
import { getUserEffectiveLimits } from '../services/limitsService.js';

export function getUserLimits(req: AuthenticatedRequest, res: Response) {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) return res.status(400).json({ error: 'ID de usuario inválido' });

    const user = store.getUserById(targetId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const customLimits = store.getAccountLimits(targetId);
    const effectiveLimits = getUserEffectiveLimits(targetId);

    return res.json({
      user_id: targetId,
      custom_limits: customLimits,
      effective_limits: effectiveLimits
    });
  } catch (err: any) {
    console.error('[ADMIN LIMITS] Error in getUserLimits:', err);
    return res.status(500).json({ error: 'Error al consultar límites' });
  }
}

export function updateUserLimits(req: AuthenticatedRequest, res: Response) {
  try {
    const adminId = req.user!.id;
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) return res.status(400).json({ error: 'ID de usuario inválido' });

    const user = store.getUserById(targetId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { max_projects, max_tasks, max_storage_mb, max_model_size_mb } = req.body;
    const sys = store.getSystemSettings();

    // Validate inputs
    const parsedProjects = max_projects !== undefined ? parseInt(String(max_projects), 10) : undefined;
    const parsedTasks = max_tasks !== undefined ? parseInt(String(max_tasks), 10) : undefined;
    const parsedStorage = max_storage_mb !== undefined ? parseFloat(String(max_storage_mb)) : undefined;
    const parsedModelSize = max_model_size_mb !== undefined ? parseFloat(String(max_model_size_mb)) : undefined;

    if (parsedModelSize !== undefined && parsedModelSize > sys.absolute_max_model_size_mb) {
      return res.status(400).json({
        error: `max_model_size_mb (${parsedModelSize} MB) no puede superar el límite absoluto del sistema (${sys.absolute_max_model_size_mb} MB).`
      });
    }

    const previousLimits = store.getAccountLimits(targetId);

    store.setAccountLimits({
      user_id: targetId,
      max_projects: parsedProjects !== undefined && !isNaN(parsedProjects) ? parsedProjects : (previousLimits?.max_projects ?? sys.default_max_projects),
      max_tasks: parsedTasks !== undefined && !isNaN(parsedTasks) ? parsedTasks : (previousLimits?.max_tasks ?? sys.default_max_tasks),
      max_storage_mb: parsedStorage !== undefined && !isNaN(parsedStorage) ? parsedStorage : (previousLimits?.max_storage_mb ?? sys.default_max_storage_mb),
      max_model_size_mb: parsedModelSize !== undefined && !isNaN(parsedModelSize) ? parsedModelSize : (previousLimits?.max_model_size_mb ?? sys.default_max_model_size_mb),
      updated_at: new Date().toISOString()
    });

    store.logAdminAction({
      admin_user_id: adminId,
      action: 'UPDATE_LIMITS',
      target_user_id: targetId,
      details: JSON.stringify({
        previous: previousLimits,
        updated: { max_projects: parsedProjects, max_tasks: parsedTasks, max_storage_mb: parsedStorage, max_model_size_mb: parsedModelSize }
      }),
      ip_address: getClientIp(req),
      created_at: new Date().toISOString()
    });

    return res.json({
      success: true,
      message: `Límites actualizados para usuario #${targetId}`,
      effective_limits: getUserEffectiveLimits(targetId)
    });
  } catch (err: any) {
    console.error('[ADMIN LIMITS] Error in updateUserLimits:', err);
    return res.status(500).json({ error: 'Error al actualizar límites' });
  }
}
