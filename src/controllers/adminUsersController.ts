import { Response } from 'express';
import { AuthenticatedRequest } from '../auth.js';
import { store } from '../db.js';
import { getStorageUsageMb, getUserEffectiveLimits } from '../services/limitsService.js';

export function listUsers(req: AuthenticatedRequest, res: Response) {
  try {
    const { status, role, search } = req.query;
    let users = store.getAllUsers();

    if (status && typeof status === 'string') {
      users = users.filter(u => u.status === status);
    }
    if (role && typeof role === 'string') {
      users = users.filter(u => u.role === role);
    }
    if (search && typeof search === 'string') {
      const q = search.toLowerCase().trim();
      users = users.filter(u => u.email.toLowerCase().includes(q));
    }

    const payload = users.map(u => {
      const projects = store.getProjects(u.id);
      const tasks = store.getTasks(u.id);
      const storageMb = getStorageUsageMb(u.id);
      const limits = getUserEffectiveLimits(u.id);

      return {
        id: u.id,
        email: u.email,
        role: u.role,
        status: u.status,
        created_at: u.created_at,
        blocked_at: u.blocked_at,
        blocked_reason: u.blocked_reason,
        projects_count: projects.length,
        tasks_count: tasks.length,
        storage_used_mb: storageMb,
        effective_limits: limits
      };
    });

    return res.json({ users: payload });
  } catch (err: any) {
    console.error('[ADMIN USERS] Error in listUsers:', err);
    return res.status(500).json({ error: 'Error al listar usuarios' });
  }
}

export function getUserDetail(req: AuthenticatedRequest, res: Response) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'ID de usuario inválido' });

    const user = store.getUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const projects = store.getProjects(user.id);
    const tasks = store.getTasks(user.id);
    const storageMb = getStorageUsageMb(user.id);
    const limits = getUserEffectiveLimits(user.id);
    const auditLogs = store.getAuditLogs(20, user.id);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        created_at: user.created_at,
        blocked_at: user.blocked_at,
        blocked_reason: user.blocked_reason
      },
      projects,
      tasks_count: tasks.length,
      storage_used_mb: storageMb,
      effective_limits: limits,
      audit_logs: auditLogs
    });
  } catch (err: any) {
    console.error('[ADMIN USERS] Error in getUserDetail:', err);
    return res.status(500).json({ error: 'Error al obtener detalle del usuario' });
  }
}
