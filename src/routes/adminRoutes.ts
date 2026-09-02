import { Router } from 'express';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { renderAdminDashboard } from '../controllers/adminViewController.js';
import { listUsers, getUserDetail } from '../controllers/adminUsersController.js';
import {
  blockUser,
  unblockUser,
  promoteUser,
  demoteUser,
  softDeleteUser
} from '../controllers/adminUserActionsController.js';
import { getUserLimits, updateUserLimits } from '../controllers/adminLimitsController.js';
import { getSystemSettings, updateSystemSettings } from '../controllers/adminSystemController.js';
import { getAuditLogs } from '../controllers/adminAuditController.js';

const router = Router();

// Apply requireAdmin to all /admin routes
router.use('/admin', requireAdmin);

// Admin View Dashboard
router.get('/admin', renderAdminDashboard);

// User Management Endpoints
router.get('/admin/api/users', listUsers);
router.get('/admin/api/users/:id', getUserDetail);
router.post('/admin/api/users/:id/block', blockUser);
router.post('/admin/api/users/:id/unblock', unblockUser);
router.post('/admin/api/users/:id/promote', promoteUser);
router.post('/admin/api/users/:id/demote', demoteUser);
router.delete('/admin/api/users/:id', softDeleteUser);

// User Limits Endpoints
router.get('/admin/api/users/:id/limits', getUserLimits);
router.put('/admin/api/users/:id/limits', updateUserLimits);

// System Settings Endpoints
router.get('/admin/api/system-settings', getSystemSettings);
router.put('/admin/api/system-settings', updateSystemSettings);

// Audit Log Endpoints
router.get('/admin/api/audit-log', getAuditLogs);

export default router;

