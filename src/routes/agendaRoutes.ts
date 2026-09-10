import { Router } from 'express';
import { renderDashboard, CATEGORY_LABELS, STATUS_LABELS } from '../controllers/agendaController.js';
import { handleForceRun, handleForceCheckin, handleEndShift, handleResolveCheckin, handleResolveAllOverdue } from '../controllers/checkinController.js';
import { handleSaveDayOverride, handleClearDayOverride, handleForceTask, handleDeleteForcedTask, handleSaveDayOverrideRange, handleClearDayOverrideRange } from '../controllers/overrideController.js';

const router = Router();

export { CATEGORY_LABELS, STATUS_LABELS };

// Main Dashboard
router.get('/', renderDashboard);

// Evaluation triggers
router.post('/evaluation/force_run', handleForceRun);
router.post('/evaluation/force_checkin', handleForceCheckin);

// Day Overrides & Vacation Ranges
router.post('/day-overrides/range', handleSaveDayOverrideRange);
router.post('/day-overrides/clear-range', handleClearDayOverrideRange);
router.post('/day-override/:override_date/save', handleSaveDayOverride);
router.post('/day-override/:override_date/clear', handleClearDayOverride);
router.post('/day-override/:override_date/force-task', handleForceTask);
router.post('/day-override/forced-task/:forced_id/delete', handleDeleteForcedTask);

// Shift / Checkin Endpoints
router.post('/api/checkin/end_shift', handleEndShift);
router.post('/api/checkin/resolve', handleResolveCheckin);
router.post('/api/checkin/resolve-all-overdue', handleResolveAllOverdue);

export default router;
