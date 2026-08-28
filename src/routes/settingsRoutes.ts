import { Router } from 'express';
import { store } from '../db.js';
import { AuthenticatedRequest } from '../auth.js';
import { getTimezoneByCoords, getWorkshopLocalTime, getLocalDateIso } from '../dateUtils.js';
import { triggerSilentReevaluation, reconcileCalendarEvents } from '../scheduler.js';
import { calendarService } from '../calendarService.js';

const router = Router();

// GET /api/timezone
router.get('/api/timezone', (req: AuthenticatedRequest, res) => {
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);
  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({ error: 'Latitud y longitud no válidos' });
  }
  const tz = getTimezoneByCoords(lat, lon);
  const timeInfo = getWorkshopLocalTime(new Date(), tz);
  res.json({
    timezone: tz,
    time_str: timeInfo.timeStr,
    date_iso: timeInfo.dateIso,
    formatted_display: `${timeInfo.timeStr} (${tz})`
  });
});

// POST /settings/update
router.post('/settings/update', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const body = req.body;
  store.updateAppSettings(userId, {
    operational_start_hour: parseInt(body.operational_start_hour, 10) || 9,
    operational_end_hour: parseInt(body.operational_end_hour, 10) || 18,
    max_humidity_percent: parseFloat(body.max_humidity_percent) || 80.0,
    latitude: parseFloat(body.latitude) || -32.99,
    longitude: parseFloat(body.longitude) || -71.27,
    timezone: body.timezone ? String(body.timezone).trim() : undefined,
    setup_hours: parseFloat(body.setup_hours) || 1.0,
    teardown_hours: parseFloat(body.teardown_hours) || 1.0,
    min_work_hours: parseFloat(body.min_work_hours) || 1.0,
    min_work_hours_unless_final: parseFloat(body.min_work_hours_unless_final) || 4.0,
    min_rain_precipitation_mm: (body.min_rain_precipitation_mm !== undefined && !isNaN(parseFloat(body.min_rain_precipitation_mm))) ? parseFloat(body.min_rain_precipitation_mm) : 0.1,
    checkin_hour: parseInt(body.checkin_hour, 10) || 19,
    morning_eval_lead_hours: parseInt(body.morning_eval_lead_hours, 10) || 1,
    exclude_saturdays: body.exclude_saturdays === 'true' || body.exclude_saturdays === 'on' || body.exclude_saturdays === true,
    exclude_sundays: body.exclude_sundays === 'true' || body.exclude_sundays === 'on' || body.exclude_sundays === true,
    exclude_holidays: body.exclude_holidays === 'true' || body.exclude_holidays === 'on' || body.exclude_holidays === true,
    require_curing_before_cutoff: body.require_curing_before_cutoff === 'true' || body.require_curing_before_cutoff === 'on' || body.require_curing_before_cutoff === true,
    google_calendar_id: body.google_calendar_id !== undefined ? String(body.google_calendar_id).trim() : undefined,
    google_calendar_enabled: body.google_calendar_enabled === 'true' || body.google_calendar_enabled === 'on' || body.google_calendar_enabled === '1' || body.google_calendar_enabled === true,
    workshop_type: body.workshop_type && ['outdoor', 'covered', 'indoor'].includes(body.workshop_type) ? body.workshop_type : 'outdoor',
    max_rain_probability: (body.max_rain_probability !== undefined && !isNaN(parseInt(body.max_rain_probability, 10))) ? parseInt(body.max_rain_probability, 10) : 40,
    max_wind_gust_carpentry: (body.max_wind_gust_carpentry !== undefined && !isNaN(parseFloat(body.max_wind_gust_carpentry))) ? parseFloat(body.max_wind_gust_carpentry) : 40.0,
    max_wind_gust_paint: (body.max_wind_gust_paint !== undefined && !isNaN(parseFloat(body.max_wind_gust_paint))) ? parseFloat(body.max_wind_gust_paint) : 25.0,
    dew_point_margin_c: (body.dew_point_margin_c !== undefined && !isNaN(parseFloat(body.dew_point_margin_c))) ? parseFloat(body.dew_point_margin_c) : 3.0,
    min_temp_pva_c: (body.min_temp_pva_c !== undefined && !isNaN(parseFloat(body.min_temp_pva_c))) ? parseFloat(body.min_temp_pva_c) : 10.0,
    min_temp_epoxy_c: (body.min_temp_epoxy_c !== undefined && !isNaN(parseFloat(body.min_temp_epoxy_c))) ? parseFloat(body.min_temp_epoxy_c) : 15.0,
    max_humidity_varnish: (body.max_humidity_varnish !== undefined && !isNaN(parseFloat(body.max_humidity_varnish))) ? parseFloat(body.max_humidity_varnish) : 80.0,
    max_humidity_pva: (body.max_humidity_pva !== undefined && !isNaN(parseFloat(body.max_humidity_pva))) ? parseFloat(body.max_humidity_pva) : 90.0
  });

  triggerSilentReevaluation(userId);

  if (req.xhr || req.headers.accept?.includes('application/json') || req.headers['x-requested-with'] === 'XMLHttpRequest') {
    return res.json({ success: true, message: 'Configuración actualizada exitosamente' });
  }

  res.redirect(303, '/');
});

// Telegram Link / Unlink
router.post('/settings/telegram/generate-code', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { code, expiresAt } = store.generateTelegramLinkCode(userId);
    res.json({ success: true, code, expiresAt });
  } catch (err: any) {
    console.error('Error generando código de vinculación Telegram:', err);
    res.status(500).json({ error: 'Error interno al generar código' });
  }
});

router.post('/settings/telegram/unlink', (req: AuthenticatedRequest, res) => {
  try {
    store.unlinkTelegram(req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error desvinculando Telegram:', err);
    res.status(500).json({ error: 'Error interno al desvincular Telegram' });
  }
});

// Calculator Offsets
router.get('/api/calculator/offsets', (req: AuthenticatedRequest, res) => {
  res.json({ success: true, offsets: store.getCalculatorOffsets(req.user!.id) });
});

router.post('/calculator/offsets/add', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { label, offset_value, unit, description } = req.body;
    if (!label || offset_value === undefined) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ error: 'La etiqueta y el valor de offset son obligatorios' });
      }
      return res.redirect(303, '/');
    }
    const newOffset = store.addCalculatorOffset(userId, {
      label: String(label),
      offset_value: parseFloat(offset_value) || 0,
      unit: String(unit || 'mm'),
      description: description ? String(description) : undefined
    });
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, offset: newOffset });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error adding calculator offset:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
});

router.post('/calculator/offsets/:id/update', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const { label, offset_value, unit, description } = req.body;
    const updated = store.updateCalculatorOffset(userId, id, {
      label: label ? String(label) : undefined,
      offset_value: offset_value !== undefined ? parseFloat(offset_value) : undefined,
      unit: unit ? String(unit) : undefined,
      description: description !== undefined ? String(description) : undefined
    });
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, offset: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error updating calculator offset:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
});

router.post('/calculator/offsets/:id/delete', (req: AuthenticatedRequest, res) => {
  try {
    store.deleteCalculatorOffset(req.user!.id, parseInt(req.params.id, 10));
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error deleting calculator offset:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
});

// Google Calendar Reconcile & Orphan Cleanup
router.post('/api/calendar/reconcile', async (req: AuthenticatedRequest, res) => {
  try {
    const result = await reconcileCalendarEvents(req.user!.id);
    res.json({ success: result.synced, reason: result.reason, deletedOrphansCount: result.deletedOrphansCount || 0 });
  } catch (err: any) {
    console.error('[API Calendar Reconcile Error]', err);
    res.status(500).json({ success: false, error: err?.message || 'Error al reconciliar Google Calendar' });
  }
});

router.get('/api/calendar/preview-orphans', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const appSettings = store.getAppSettings(userId);
    const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
    const todayIso = getLocalDateIso(new Date(), userTz);

    const result = await calendarService.previewOrphanCalendarEvents(userId, todayIso);
    res.json({
      success: result.success,
      orphanEvents: result.orphanEvents,
      totalEventsChecked: result.totalEventsChecked,
      error: result.error
    });
  } catch (err: any) {
    console.error('[API Calendar Preview Orphans Error]', err);
    res.status(500).json({ success: false, error: err?.message || 'Error al previsualizar eventos huérfanos' });
  }
});

router.post('/api/calendar/cleanup-orphans', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const appSettings = store.getAppSettings(userId);
    const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || "America/Santiago";
    const todayIso = getLocalDateIso(new Date(), userTz);
    const targetEventIds = Array.isArray(req.body?.targetEventIds) ? req.body.targetEventIds : undefined;

    const result = await calendarService.cleanupOrphanCalendarEvents(userId, todayIso, targetEventIds);
    res.json({
      success: result.success,
      deletedCount: result.deletedCount,
      deletedEventIds: result.deletedEventIds,
      error: result.error
    });
  } catch (err: any) {
    console.error('[API Calendar Cleanup Orphans Error]', err);
    res.status(500).json({ success: false, error: err?.message || 'Error al limpiar eventos huérfanos' });
  }
});

export default router;
