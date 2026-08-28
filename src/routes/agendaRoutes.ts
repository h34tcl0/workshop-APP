import { Router } from 'express';
import { renderDashboard, CATEGORY_LABELS, STATUS_LABELS } from '../controllers/agendaController.js';
import { handleForceRun, handleForceCheckin, handleEndShift, handleResolveCheckin } from '../controllers/checkinController.js';
import { handleSaveDayOverride, handleClearDayOverride, handleForceTask, handleDeleteForcedTask } from '../controllers/overrideController.js';

const router = Router();

export { CATEGORY_LABELS, STATUS_LABELS };

// Main Dashboard
router.get('/', renderDashboard);

// Evaluation triggers
router.post('/evaluation/force_run', handleForceRun);
router.post('/evaluation/force_checkin', handleForceCheckin);

// Day Overrides
router.post('/day-override/:override_date/save', handleSaveDayOverride);
router.post('/day-override/:override_date/clear', handleClearDayOverride);
router.post('/day-override/:override_date/force-task', handleForceTask);
router.post('/day-override/forced-task/:forced_id/delete', handleDeleteForcedTask);

// Shift / Checkin Endpoints
router.post('/api/checkin/end_shift', handleEndShift);
router.post('/api/checkin/resolve', handleResolveCheckin);

export default router;
