import express from 'express';
import path from 'path';
import { initDatabase, store, closeDatabase } from './src/db.js';
import { evaluateDayWithOverrides } from './src/evaluator.js';
import { getHourlyForecast, getWeeklyForecast, MockWeatherService } from './src/weatherService.js';
import { getHolidayDatesForRange } from './src/holidaysService.js';
import { formatDateShortEs } from './src/dateUtils.js';
import { TaskCategory, TaskStatus, Task } from './src/types.js';
import { startDaemon, stopDaemon, runMorningEvaluation, runCheckinTick } from './src/scheduler.js';
import { TelegramBotService } from './src/telegramBot.js';
import { requireAuth, hashPassword, verifyPassword, signToken, createSessionCookie, createClearSessionCookie, AuthenticatedRequest } from './src/auth.js';

const app = express();
const PORT = 3000;

// Process Error Handlers for logging stack traces to stdout/stderr and exiting process for clean container reboot
process.on('uncaughtException', (err) => {
  console.error('[FATAL UNCAUGHT EXCEPTION - TERMINATING PROCESS FOR CLEAN REBOOT]', err);
  try {
    stopDaemon();
    closeDatabase();
  } catch (e) {
    console.error('[SHUTDOWN ERROR]', e);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL UNHANDLED REJECTION - TERMINATING PROCESS FOR CLEAN REBOOT]', reason);
  try {
    stopDaemon();
    closeDatabase();
  } catch (e) {
    console.error('[SHUTDOWN ERROR]', e);
  }
  process.exit(1);
});

// Setup View Engine
app.set('views', path.join(process.cwd(), 'views'));
app.set('view engine', 'ejs');

// Middleware & Static Assets
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(process.cwd(), 'static')));

// Public Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// PWA Direct Routes
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(process.cwd(), 'static', 'manifest.json'));
});
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(process.cwd(), 'static', 'sw.js'));
});
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  const packageName = process.env.ANDROID_PACKAGE_NAME;
  const sha256Fingerprint = process.env.ANDROID_SHA256_FINGERPRINT;

  if (packageName && sha256Fingerprint) {
    const fingerprintsArray = sha256Fingerprint.split(',').map(f => f.trim());
    return res.json([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: packageName,
          sha256_cert_fingerprints: fingerprintsArray
        }
      }
    ]);
  }

  res.sendFile(path.join(process.cwd(), 'static', '.well-known', 'assetlinks.json'));
});

// Authentication Middleware
app.use(requireAuth);

// Auth Routes
app.get('/login', (req: AuthenticatedRequest, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { error: null, email: '' });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  console.log(`[AUTH] Login attempt for: ${email}`);

  if (!email || !password) {
    console.log(`[AUTH] User found: false`);
    console.log(`[AUTH] Password match: false`);
    return res.status(400).render('login', { error: 'Por favor ingresa correo y contraseña', email });
  }

  const user = store.getUserByEmail(email);
  console.log(`[AUTH] User found: ${!!user}`);

  const isValid = user ? verifyPassword(password, user.password_hash) : false;
  console.log(`[AUTH] Password match: ${isValid}`);

  if (!user || !isValid) {
    return res.status(401).render('login', { error: 'Credenciales inválidas', email });
  }

  const token = signToken({ userId: user.id, email: user.email });
  res.setHeader('Set-Cookie', createSessionCookie(token));
  res.redirect(303, '/');
});

app.get('/register', (req: AuthenticatedRequest, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { error: null, email: '' });
});

app.post('/register', (req, res) => {
  const { email, password, password_confirm } = req.body;
  if (!email || !password) {
    return res.status(400).render('register', { error: 'Todos los campos son obligatorios', email });
  }
  if (password !== password_confirm) {
    return res.status(400).render('register', { error: 'Las contraseñas no coinciden', email });
  }
  if (password.length < 6) {
    return res.status(400).render('register', { error: 'La contraseña debe tener al menos 6 caracteres', email });
  }
  const existing = store.getUserByEmail(email);
  if (existing) {
    return res.status(400).render('register', { error: 'El correo electrónico ya está registrado', email });
  }
  const hash = hashPassword(password);
  const user = store.createUser(email, hash);
  const token = signToken({ userId: user.id, email: user.email });
  res.setHeader('Set-Cookie', createSessionCookie(token));
  res.redirect(303, '/');
});

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', createClearSessionCookie());
  res.redirect(303, '/login');
});

// Password Change API endpoint
app.post('/api/user/change-password', (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  const { new_password, new_password_confirm } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  if (new_password_confirm && new_password !== new_password_confirm) {
    return res.status(400).json({ error: 'Las contraseñas no coinciden' });
  }
  if (new_password === 'Admin123!' || new_password === 'password123') {
    return res.status(400).json({ error: 'No puede utilizar la contraseña por defecto' });
  }

  const newHash = hashPassword(new_password);
  store.updateUserPassword(req.user.id, newHash);
  console.log(`[AUTH] Password updated for user #${req.user.id} (${req.user.email}). Default password requirement cleared.`);
  return res.status(200).json({ status: 'ok', message: 'Contraseña actualizada correctamente' });
});

// Admin Online WAL Backup API Endpoint
app.post('/api/admin/backup', (req: AuthenticatedRequest, res) => {
  try {
    const backupPath = store.backupDatabase();
    res.status(200).json({
      status: 'ok',
      message: 'Copia de seguridad en caliente (WAL mode) creada con éxito',
      backup_path: backupPath
    });
  } catch (err: any) {
    console.error('[BACKUP ERROR]', err);
    res.status(500).json({ error: 'Error al generar la copia de seguridad', details: err.message });
  }
});

// Constants for labels
const CATEGORY_LABELS: Record<string, string> = {
  carpentry: 'Carpintería',
  pva_glue: 'Encolado',
  varnish_paint: 'Barnizado/Pintura',
  epoxy: 'Epoxi'
};

const STATUS_LABELS: Record<string, string> = {
  DAY_VIABLE: 'Viable',
  DAY_SUSPENDED: 'Suspendido',
  NO_WORK_NEEDED: 'Sin trabajo pendiente',
  WEATHER_WINDOW_CLOSED: 'Ventana cerrada por clima',
  TIME_INSUFFICIENT: 'Tiempo insuficiente',
  MANUALLY_BLOCKED: 'Bloqueado manualmente'
};

// GET / - Dashboard
app.get('/', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const scenario = typeof req.query.scenario === 'string' ? req.query.scenario : undefined;
    const appSettings = store.getAppSettings(userId);
    const activeProject = store.getActiveProject(userId);
    const tasks = store.getPendingTasks(userId, activeProject.id);
    let simulatedPendingTasks = [...tasks];

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Holidays
    let holidayDates = new Set<string>();
    if (appSettings.exclude_holidays) {
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + 6);
      holidayDates = getHolidayDatesForRange(todayStr, endDate.toISOString().split('T')[0]);
    }

    // Weather forecast
    let weeklyForecasts: Record<string, any[]> | null = null;
    if (!scenario) {
      weeklyForecasts = await getWeeklyForecast(todayStr, 7, appSettings.latitude, appSettings.longitude);
    }

    const forecastEvaluations = [];

    for (let d = 0; d < 7; d++) {
      const evalDateObj = new Date(today);
      evalDateObj.setDate(evalDateObj.getDate() + d);
      const evalDate = evalDateObj.toISOString().split('T')[0];

      const dayOverride = store.getDayOverride(userId, evalDate);
      const forcedRows = store.getForcedTasksForDate(userId, evalDate);

      const forcedTasksWithHours = forcedRows.map(fr => ({
        task: store.getTask(userId, fr.task_id),
        forced_start_hour: fr.forced_start_hour,
        forced_id: fr.id
      })).filter((item): item is { task: Task; forced_start_hour: number; forced_id: number } => item.task != null);

      let hourly;
      if (scenario) {
        const mockSvc = new MockWeatherService(scenario);
        hourly = mockSvc.getHourlyForecast(evalDate);
      } else if (weeklyForecasts && weeklyForecasts[evalDate]) {
        hourly = weeklyForecasts[evalDate];
      } else {
        hourly = await getHourlyForecast(evalDate, appSettings.latitude, appSettings.longitude);
      }

      const evalRes = evaluateDayWithOverrides(
        evalDate,
        simulatedPendingTasks,
        hourly,
        appSettings,
        holidayDates,
        dayOverride,
        forcedTasksWithHours
      );

      if (evalRes.status === 'DAY_VIABLE' && evalRes.scheduled_tasks.length > 0) {
        const scheduledIds = new Set(evalRes.scheduled_tasks.map(t => t.id));
        simulatedPendingTasks = simulatedPendingTasks.filter(t => !scheduledIds.has(t.id));
      }
      if (forcedTasksWithHours.length > 0) {
        const forcedIds = new Set(forcedTasksWithHours.map(ft => ft.task.id));
        simulatedPendingTasks = simulatedPendingTasks.filter(t => !forcedIds.has(t.id));
      }

      forecastEvaluations.push({
        date_iso: evalDate,
        date_str: formatDateShortEs(evalDate),
        evaluation: evalRes,
        day_override: dayOverride,
        status_label: STATUS_LABELS[evalRes.status] || evalRes.status
      });
    }

    const completedHistory = store.getCompletedRecently(userId);
    const favorites = store.getFavoriteTasks(userId);
    const projectTemplates = store.getProjectTemplates(userId);

    res.render('index', {
      project: activeProject,
      tasks,
      forecast_evaluations: forecastEvaluations,
      current_scenario: scenario || 'real',
      categories: Object.values(TaskCategory),
      category_labels: CATEGORY_LABELS,
      status_labels: STATUS_LABELS,
      app_settings: appSettings,
      completed_history: completedHistory,
      favorites,
      project_templates: projectTemplates
    });
  } catch (err) {
    console.error('Error rendering dashboard:', err);
    res.status(500).send('Internal Server Error');
  }
});

// POST /tasks/add
app.post('/tasks/add', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { title, description, category, estimated_hours, curing_hours, order } = req.body;
  store.addTask(userId, {
    title,
    description: description || '',
    category: category || TaskCategory.CARPENTRY,
    estimated_hours: parseFloat(estimated_hours) || 1.0,
    curing_hours: parseFloat(curing_hours) || 0.0,
    order: parseInt(order) || undefined
  });
  res.redirect(303, '/');
});

// POST /tasks/:id/update
app.post('/tasks/:id/update', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = parseInt(req.params.id);
  const { title, estimated_hours, curing_hours, category } = req.body;
  const updated = store.updateTask(userId, id, {
    title,
    estimated_hours: parseFloat(estimated_hours),
    curing_hours: parseFloat(curing_hours),
    category
  });
  if (!updated) {
    return res.status(404).json({ error: 'Tarea no encontrada o no pertenece al usuario' });
  }
  res.redirect(303, '/');
});

// POST /tasks/:id/update_status
app.post('/tasks/:id/update_status', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = parseInt(req.params.id);
  const { status, progress } = req.body;
  const progressNum = parseInt(progress) || 0;
  let newStatus = status;
  if (progressNum === 100) {
    newStatus = TaskStatus.COMPLETED;
  }
  const updated = store.updateTask(userId, id, {
    status: newStatus,
    progress_percentage: progressNum,
    completed_at: newStatus === TaskStatus.COMPLETED ? new Date().toISOString() : undefined
  });
  if (!updated) {
    return res.status(404).json({ error: 'Tarea no encontrada o no pertenece al usuario' });
  }
  res.redirect(303, '/');
});

// POST /tasks/:id/delete
app.post('/tasks/:id/delete', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  store.deleteTask(userId, parseInt(req.params.id));
  res.redirect(303, '/');
});

// POST /tasks/:id/move-up
app.post('/tasks/:id/move-up', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  store.moveTaskUp(userId, parseInt(req.params.id));
  res.redirect(303, '/');
});

// POST /tasks/:id/move-down
app.post('/tasks/:id/move-down', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  store.moveTaskDown(userId, parseInt(req.params.id));
  res.redirect(303, '/');
});

// POST /tasks/reorder
app.post('/tasks/reorder', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const taskIds: number[] = req.body.task_ids || [];
  store.reorderTasks(userId, taskIds);
  res.json({ status: 'ok' });
});

// POST /tasks/import
app.post('/tasks/import', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const payload = req.body;
  const projectName = payload.project_name || 'Proyecto Importado IA';
  const taskList = payload.tasks || [];

  if (!Array.isArray(taskList) || taskList.length === 0) {
    res.status(400).json({ detail: 'La lista tasks es requerida y no puede estar vacía.' });
    return;
  }

  let project = store.getProjects(userId).find(p => p.name === projectName);
  if (!project) {
    project = store.addProject(userId, projectName, 'Proyecto creado vía Importación IA');
  }

  taskList.forEach((tdata: any, idx: number) => {
    let cat = tdata.category;
    if (!Object.values(TaskCategory).includes(cat)) {
      cat = TaskCategory.CARPENTRY;
    }
    store.addTask(userId, {
      project_id: project!.id,
      title: tdata.title || `Tarea ${idx + 1}`,
      description: tdata.description || '',
      category: cat,
      estimated_hours: parseFloat(tdata.estimated_hours) || 1.0,
      curing_hours: parseFloat(tdata.curing_hours) || 0.0,
      order: store.getTasks(userId).length + 1
    });
  });

  res.json({
    status: 'success',
    message: `Se importaron ${taskList.length} tareas exitosamente en el proyecto '${projectName}'.`,
    imported_count: taskList.length
  });
});

// Favorite Task routes
app.post('/tasks/:id/favorite', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const task = store.getTask(userId, parseInt(req.params.id));
  if (task) {
    store.addFavoriteTask(userId, {
      title: task.title,
      category: task.category,
      estimated_hours: task.estimated_hours,
      curing_hours: task.curing_hours
    });
  }
  res.redirect(303, '/');
});

app.post('/favorites/:id/use', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const favId = parseInt(req.params.id);
  const favs = store.getFavoriteTasks(userId);
  const fav = favs.find(f => f.id === favId);
  if (fav) {
    store.addTask(userId, {
      title: fav.title,
      category: fav.category,
      estimated_hours: fav.estimated_hours,
      curing_hours: fav.curing_hours,
      order: store.getTasks(userId).length + 1
    });
  }
  res.redirect(303, '/');
});

app.post('/favorites/:id/delete', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  store.deleteFavoriteTask(userId, parseInt(req.params.id));
  res.redirect(303, '/');
});

// Project Template routes
app.post('/project-templates/save', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      if (req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ status: 'error', message: 'El nombre de la plantilla es requerido.' });
      }
      return res.redirect(303, '/');
    }
    const template = store.createProjectTemplateFromBacklog(userId, name.trim(), description ? description.trim() : '');
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'success', message: 'Plantilla de proyecto guardada.', template });
    }
    res.redirect(303, '/');
  } catch (err) {
    console.error('Error saving project template:', err);
    if (req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ status: 'error', message: 'Error guardando la plantilla.' });
    }
    res.redirect(303, '/');
  }
});

app.post('/project-templates/:id/apply', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const addedTasks = store.applyProjectTemplate(userId, id);
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'success', message: `Plantilla aplicada (${addedTasks.length} tareas agregadas).` });
    }
    res.redirect(303, '/');
  } catch (err) {
    console.error('Error applying project template:', err);
    if (req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ status: 'error', message: 'Error aplicando la plantilla.' });
    }
    res.redirect(303, '/');
  }
});

app.post('/project-templates/:id/delete', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    store.deleteProjectTemplate(userId, id);
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'success', message: 'Plantilla eliminada.' });
    }
    res.redirect(303, '/');
  } catch (err) {
    console.error('Error deleting project template:', err);
    if (req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ status: 'error', message: 'Error eliminando la plantilla.' });
    }
    res.redirect(303, '/');
  }
});

// Day Overrides routes
app.post('/day-override/:override_date/save', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const override_date = req.params.override_date;
  const { force_status, custom_start_hour, custom_end_hour, removed_task_ids, note } = req.body;

  let removedIds: number[] = [];
  if (Array.isArray(removed_task_ids)) {
    removedIds = removed_task_ids.map(id => parseInt(id)).filter(id => !isNaN(id));
  } else if (removed_task_ids) {
    const parsed = parseInt(removed_task_ids);
    if (!isNaN(parsed)) removedIds.push(parsed);
  }

  store.saveDayOverride(userId, override_date, {
    force_status: force_status === 'VIABLE' || force_status === 'BLOCKED' ? force_status : null,
    custom_start_hour: custom_start_hour ? parseInt(custom_start_hour) : null,
    custom_end_hour: custom_end_hour ? parseInt(custom_end_hour) : null,
    removed_task_ids: removedIds,
    note: note || ''
  });

  res.redirect(303, '/');
});

app.post('/day-override/:override_date/clear', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  store.clearDayOverride(userId, req.params.override_date);
  res.redirect(303, '/');
});

app.post('/day-override/:override_date/force-task', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const override_date = req.params.override_date;
  const { task_id, forced_start_hour } = req.body;
  const parsedTaskId = parseInt(task_id);
  const task = store.getTask(userId, parsedTaskId);
  if (task) {
    store.addForcedTask(userId, override_date, parsedTaskId, parseFloat(forced_start_hour) || 9.0);
  }
  res.redirect(303, '/');
});

app.post('/day-override/forced-task/:forced_id/delete', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  store.deleteForcedTask(userId, parseInt(req.params.forced_id));
  res.redirect(303, '/');
});

// Settings & Evaluation routes
app.post('/evaluation/force_run', async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const scenario = req.body.scenario;
  try {
    await runMorningEvaluation(userId, undefined, scenario || undefined);
  } catch (err) {
    console.error('Error running morning evaluation:', err);
  }
  if (scenario) {
    res.redirect(303, `/?scenario=${encodeURIComponent(scenario)}`);
  } else {
    res.redirect(303, '/');
  }
});

app.post('/evaluation/run', async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const scenario = req.body.scenario;
  try {
    await runMorningEvaluation(userId, undefined, scenario || undefined);
  } catch (err) {
    console.error('Error running morning evaluation:', err);
  }
  if (scenario) {
    res.redirect(303, `/?scenario=${encodeURIComponent(scenario)}`);
  } else {
    res.redirect(303, '/');
  }
});

app.post('/evaluation/force_checkin', async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  try {
    await runCheckinTick(undefined, true, userId);
  } catch (err) {
    console.error('Error running forced checkin:', err);
  }
  res.redirect(303, '/');
});

app.post('/settings/update', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const body = req.body;
  store.updateAppSettings(userId, {
    operational_start_hour: parseInt(body.operational_start_hour) || 9,
    operational_end_hour: parseInt(body.operational_end_hour) || 18,
    max_humidity_percent: parseFloat(body.max_humidity_percent) || 80.0,
    latitude: parseFloat(body.latitude) || -32.99,
    longitude: parseFloat(body.longitude) || -71.27,
    setup_hours: parseFloat(body.setup_hours) || 1.0,
    teardown_hours: parseFloat(body.teardown_hours) || 1.0,
    min_work_hours: parseFloat(body.min_work_hours) || 1.0,
    min_work_hours_unless_final: parseFloat(body.min_work_hours_unless_final) || 4.0,
    min_rain_precipitation_mm: parseFloat(body.min_rain_precipitation_mm) || 0.2,
    checkin_hour: parseInt(body.checkin_hour) || 19,
    morning_eval_lead_hours: parseInt(body.morning_eval_lead_hours) || 1,
    exclude_saturdays: body.exclude_saturdays === 'true' || body.exclude_saturdays === 'on',
    exclude_sundays: body.exclude_sundays === 'true' || body.exclude_sundays === 'on',
    exclude_holidays: body.exclude_holidays === 'true' || body.exclude_holidays === 'on',
    require_curing_before_cutoff: body.require_curing_before_cutoff === 'true' || body.require_curing_before_cutoff === 'on',
    telegram_chat_id: body.telegram_chat_id !== undefined ? String(body.telegram_chat_id).trim() : undefined,
    google_calendar_id: body.google_calendar_id !== undefined ? String(body.google_calendar_id).trim() : undefined,
    google_calendar_enabled: body.google_calendar_enabled === 'true' || body.google_calendar_enabled === 'on' || body.google_calendar_enabled === '1'
  });
  res.redirect(303, '/');
});

// Google Calendar Sync route
app.post('/calendar/create', async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { eval_date, start_time, end_time } = req.body;
  const settings = store.getAppSettings(userId);

  if (!settings.google_calendar_enabled || !settings.google_calendar_id || !settings.google_calendar_id.trim()) {
    return res.status(400).json({
      status: 'error',
      message: 'Google Calendar not connected for this user account'
    });
  }

  const dateIso = eval_date || new Date().toISOString().split('T')[0];
  const dailyLog = store.getDailyLogByDate(userId, dateIso);
  let taskIds: number[] = [];
  if (dailyLog && dailyLog.scheduled_task_ids) {
    try { taskIds = JSON.parse(dailyLog.scheduled_task_ids); } catch (_) {}
  }
  const tasks = taskIds.map(tid => store.getTask(userId, tid)).filter((t): t is Task => t != null);

  const success = await calendarService.createWorkshopEvent(
    userId,
    dateIso,
    start_time || '09:00',
    end_time || '18:00',
    tasks.map(t => ({ title: t.title, estimated_hours: t.estimated_hours }))
  );

  if (success) {
    return res.json({ status: 'success', message: 'Evento de Google Calendar creado con éxito.' });
  } else {
    return res.status(500).json({ status: 'error', message: 'Google Calendar not connected for this user account' });
  }
});

// Telegram Webhook endpoint
app.post('/webhook/telegram', async (req, res) => {
  try {
    const telegramSvc = new TelegramBotService();
    if (req.body && req.body.callback_query) {
      const result = await telegramSvc.processCallbackQuery(req.body.callback_query);
      res.json(result);
    } else if (req.body && req.body.message) {
      const result = await telegramSvc.handleIncomingMessage(req.body.message);
      res.json(result);
    } else {
      res.json({ status: 'ok', message: 'No action taken' });
    }
  } catch (err) {
    console.error('Error processing Telegram webhook:', err);
    res.status(500).json({ status: 'error', error: String(err) });
  }
});

// Graceful Shutdown Handler
let serverInstance: any = null;

function gracefulShutdown(signal: string) {
  console.log(`\n[SHUTDOWN] Received ${signal}. Shutting down gracefully...`);
  stopDaemon();

  if (serverInstance) {
    serverInstance.close(() => {
      console.log('[SHUTDOWN] HTTP server closed.');
      closeDatabase();
      console.log('[SHUTDOWN] Clean exit finished.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[SHUTDOWN] Forced shutdown due to timeout.');
      closeDatabase();
      process.exit(1);
    }, 5000);
  } else {
    closeDatabase();
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Initialize Database & Start Server
initDatabase().then(() => {
  console.log('SQLite Database initialized successfully.');
  startDaemon();

  serverInstance = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Workshop OS server listening on http://0.0.0.0:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize SQLite Database:', err);
  process.exit(1);
});
