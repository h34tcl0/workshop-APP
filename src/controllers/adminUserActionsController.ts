import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AuthenticatedRequest, getClientIp } from '../auth.js';
import { store } from '../db.js';
import { verifyStepUpPassword, sendAdminSecurityAlert } from '../services/adminSecurityService.js';

export function blockUser(req: AuthenticatedRequest, res: Response) {
  try {
    const adminId = req.user!.id;
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) return res.status(400).json({ error: 'ID de usuario inválido' });

    const targetUser = store.getUserById(targetId);
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (targetUser.id === adminId) {
      return res.status(400).json({ error: 'No puedes bloquear tu propia cuenta de administrador.' });
    }

    const reason = req.body?.reason ? String(req.body.reason).trim() : 'Bloqueado por el administrador';
    store.setUserStatus(targetId, 'blocked', reason);

    store.logAdminAction({
      admin_user_id: adminId,
      action: 'BLOCK_USER',
      target_user_id: targetId,
      details: JSON.stringify({ reason, previous_status: targetUser.status }),
      ip_address: getClientIp(req),
      created_at: new Date().toISOString()
    });

    return res.json({ success: true, message: `Usuario #${targetId} bloqueado exitosamente.` });
  } catch (err: any) {
    console.error('[ADMIN USERS] Error in blockUser:', err);
    return res.status(500).json({ error: 'Error al bloquear usuario' });
  }
}

export function unblockUser(req: AuthenticatedRequest, res: Response) {
  try {
    const adminId = req.user!.id;
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) return res.status(400).json({ error: 'ID de usuario inválido' });

    const targetUser = store.getUserById(targetId);
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    store.setUserStatus(targetId, 'active');

    store.logAdminAction({
      admin_user_id: adminId,
      action: 'UNBLOCK_USER',
      target_user_id: targetId,
      details: JSON.stringify({ previous_status: targetUser.status }),
      ip_address: getClientIp(req),
      created_at: new Date().toISOString()
    });

    return res.json({ success: true, message: `Usuario #${targetId} reactivado exitosamente.` });
  } catch (err: any) {
    console.error('[ADMIN USERS] Error in unblockUser:', err);
    return res.status(500).json({ error: 'Error al desbloquear usuario' });
  }
}

export function promoteUser(req: AuthenticatedRequest, res: Response) {
  try {
    const adminId = req.user!.id;
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) return res.status(400).json({ error: 'ID de usuario inválido' });

    // Step-up Auth verification
    const sudoPassword = req.body?.sudo_password;
    if (!verifyStepUpPassword(adminId, sudoPassword)) {
      return res.status(401).json({
        error: 'Autenticación Step-up requerida o contraseña incorrecta para otorgar rol de administrador.',
        step_up_required: true
      });
    }

    const targetUser = store.getUserById(targetId);
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    store.setUserRole(targetId, 'admin');

    const clientIp = getClientIp(req);
    store.logAdminAction({
      admin_user_id: adminId,
      action: 'PROMOTE_ADMIN',
      target_user_id: targetId,
      details: JSON.stringify({ email: targetUser.email, previous_role: targetUser.role }),
      ip_address: clientIp,
      created_at: new Date().toISOString()
    });

    sendAdminSecurityAlert('PROMOTE_ADMIN', req.user!.email, targetUser.email, clientIp);

    return res.json({ success: true, message: `Usuario #${targetId} promovido a Administrador.` });
  } catch (err: any) {
    console.error('[ADMIN USERS] Error in promoteUser:', err);
    return res.status(500).json({ error: 'Error al promover usuario' });
  }
}

export function demoteUser(req: AuthenticatedRequest, res: Response) {
  try {
    const adminId = req.user!.id;
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) return res.status(400).json({ error: 'ID de usuario inválido' });

    // Step-up Auth verification
    const sudoPassword = req.body?.sudo_password;
    if (!verifyStepUpPassword(adminId, sudoPassword)) {
      return res.status(401).json({
        error: 'Autenticación Step-up requerida o contraseña incorrecta para degradar a un administrador.',
        step_up_required: true
      });
    }

    const targetUser = store.getUserById(targetId);
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Anti-lockout: verify we are not demoting the only active admin
    const activeAdmins = store.getActiveUsers().filter(u => u.role === 'admin');
    if (activeAdmins.length <= 1 && targetUser.role === 'admin') {
      return res.status(400).json({
        error: 'Operación denegada: no se puede degradar al único administrador activo del sistema.'
      });
    }

    store.setUserRole(targetId, 'user');

    const clientIp = getClientIp(req);
    store.logAdminAction({
      admin_user_id: adminId,
      action: 'DEMOTE_ADMIN',
      target_user_id: targetId,
      details: JSON.stringify({ email: targetUser.email, previous_role: targetUser.role }),
      ip_address: clientIp,
      created_at: new Date().toISOString()
    });

    sendAdminSecurityAlert('DEMOTE_ADMIN', req.user!.email, targetUser.email, clientIp);

    return res.json({ success: true, message: `Usuario #${targetId} degradado a rol estándar.` });
  } catch (err: any) {
    console.error('[ADMIN USERS] Error in demoteUser:', err);
    return res.status(500).json({ error: 'Error al degradar usuario' });
  }
}

export function softDeleteUser(req: AuthenticatedRequest, res: Response) {
  try {
    const adminId = req.user!.id;
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) return res.status(400).json({ error: 'ID de usuario inválido' });

    // Step-up Auth verification
    const sudoPassword = req.body?.sudo_password;
    if (!verifyStepUpPassword(adminId, sudoPassword)) {
      return res.status(401).json({
        error: 'Autenticación Step-up requerida o contraseña incorrecta para revocar una cuenta de usuario.',
        step_up_required: true
      });
    }

    const targetUser = store.getUserById(targetId);
    if (!targetUser) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (targetUser.id === adminId) {
      return res.status(400).json({ error: 'No puedes revocar tu propia cuenta de administrador.' });
    }

    // Anti-lockout
    if (targetUser.role === 'admin') {
      const activeAdmins = store.getActiveUsers().filter(u => u.role === 'admin' && u.id !== targetId);
      if (activeAdmins.length === 0) {
        return res.status(400).json({
          error: 'Operación denegada: no se puede revocar al único administrador activo.'
        });
      }
    }

    // 1. Soft-delete in database
    store.setUserStatus(targetId, 'revoked', 'Acceso revocado por administración');

    // 2. Archive 3D models to data/models/_archived/
    const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), 'data');
    const modelsDir = path.join(dataDir, 'models');
    const archiveDir = path.join(modelsDir, '_archived');

    let archivedCount = 0;
    if (fs.existsSync(modelsDir)) {
      if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }

      const files = fs.readdirSync(modelsDir).filter(f => f.startsWith(`user_${targetId}_`));
      for (const f of files) {
        const srcPath = path.join(modelsDir, f);
        const destPath = path.join(archiveDir, `${Date.now()}_${f}`);
        try {
          fs.renameSync(srcPath, destPath);
          archivedCount++;
        } catch (mErr) {
          console.error(`[ADMIN USERS] Error moving model ${f} to archive:`, mErr);
        }
      }
    }

    const clientIp = getClientIp(req);
    store.logAdminAction({
      admin_user_id: adminId,
      action: 'SOFT_DELETE_USER',
      target_user_id: targetId,
      details: JSON.stringify({ email: targetUser.email, archived_models_count: archivedCount }),
      ip_address: clientIp,
      created_at: new Date().toISOString()
    });

    sendAdminSecurityAlert('SOFT_DELETE_USER', req.user!.email, targetUser.email, clientIp, `${archivedCount} modelos archivados`);

    return res.json({
      success: true,
      message: `Usuario #${targetId} revocado y ${archivedCount} archivo(s) 3D archivado(s).`
    });
  } catch (err: any) {
    console.error('[ADMIN USERS] Error in softDeleteUser:', err);
    return res.status(500).json({ error: 'Error al revocar usuario' });
  }
}
