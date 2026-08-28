import { Router } from 'express';
import {
  parseFlexibleFloat,
  handleAddTask,
  handleActivateToBacklog,
  handleToggleActive,
  handleUpdateTask,
  handleUpdateStatus,
  handleDeleteTask,
  handleMoveUp,
  handleMoveDown,
  handleReorderTasks,
  handleImportTasks,
  getTaskHistory
} from '../controllers/taskController.js';
import {
  getActiveCuringSessions,
  startCuringSession,
  completeCuringSession
} from '../controllers/curingController.js';

const router = Router();

export { parseFlexibleFloat };

// Task Operations
router.post('/tasks/add', handleAddTask);
router.post('/tasks/:id/activate-to-backlog', handleActivateToBacklog);
router.post('/tasks/:id/toggle-active', handleToggleActive);
router.post('/tasks/:id/update', handleUpdateTask);
router.post('/tasks/:id/update_status', handleUpdateStatus);
router.post('/tasks/:id/delete', handleDeleteTask);
router.post('/tasks/:id/move-up', handleMoveUp);
router.post('/tasks/:id/move-down', handleMoveDown);
router.post('/tasks/reorder', handleReorderTasks);
router.post('/tasks/import', handleImportTasks);
router.get('/tasks/history', getTaskHistory);
router.get('/tasks/suggestions', getTaskHistory);

// Curing Sessions Endpoints
router.get('/api/curing-sessions/active', getActiveCuringSessions);
router.post('/api/curing-sessions/start', startCuringSession);
router.post('/api/curing-sessions/:id/complete', completeCuringSession);

export default router;
