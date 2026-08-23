import express from 'express';
import path from 'path';
import { z } from 'zod';
import { initDatabase, store, closeDatabase } from './src/db.js';
import { importPayloadSchema, reorderPayloadSchema } from './src/schemas.js';
import { evaluateDayWithOverrides, getHourlyClimateAudit } from './src/evaluator.js';
import { getHourlyForecast, getWeeklyForecast, MockWeatherService } from './src/weatherService.js';
import { getHolidayDatesForRange } from './src/holidaysService.js';
import { formatDateShortEs, getLocalDateIso, getLocalHoursAndMinutes, getWorkshopLocalTime, getTimezoneByCoords, LocalDate } from './src/dateUtils.js';
import { TaskCategory, TaskStatus, Task } from './src/types.js';
import { TaskService } from './src/services/taskService.js';
import { DayService } from './src/services/dayService.js';
import { startDaemon, stopDaemon, runMorningEvaluation, runCheckinTick, acquireEvaluationLock, releaseEvaluationLock, isEvaluationInProgress, triggerSilentReevaluation, reconcileCalendarEvents } from './src/scheduler.js';
import { TelegramBotService } from './src/telegramBot.js';
import { calendarService } from './src/calendarService.js';
import {
  requireAuth,
  verifySameOrigin,
  checkAuthRateLimit,
  recordAuthFailure,
  resetAuthRateLimit,
  getClientIp,
  hashPassword,
  verifyPasswordDetailed,
  signToken,
  createSessionCookie,
  createClearSessionCookie,
  AuthenticatedRequest
} from './src/auth.js';

const app = express();
const PORT = 3000;

// Process Error Handlers for logging stack traces to stdout/stderr and exiting process for clean container reboot
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
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
    console.error('[UNHANDLED REJECTION]', reason);
  });
}

// Setup View Engine
app.set('views', path.join(process.cwd(), 'views'));
app.set('view engine', 'ejs');

// Middleware & Static Assets
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(verifySameOrigin);
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
  const ip = getClientIp(req);
  const limitCheck = checkAuthRateLimit(ip);
  if (!limitCheck.allowed) {
    console.warn(`[RATE LIMIT] Blocked login attempt from IP ${ip}. Retry in ${limitCheck.retryAfterSec}s.`);
    return res.status(429).render('login', {
      error: `Demasiados intentos fallidos. Por favor espera ${Math.ceil(limitCheck.retryAfterSec / 60)} minutos antes de reintentar.`,
      email: req.body?.email || ''
    });
  }

  const { email, password } = req.body;

  if (!email || !password) {
    recordAuthFailure(ip);
    return res.status(400).render('login', { error: 'Por favor ingresa correo y contraseña', email });
  }

  const user = store.getUserByEmail(email);
  const authRes = user ? verifyPasswordDetailed(password, user.password_hash) : { isValid: false, needsRehash: false };

  if (!user || !authRes.isValid) {
    recordAuthFailure(ip);
    return res.status(401).render('login', { error: 'Credenciales inválidas', email });
  }

  // Successful login resets failure counter
  resetAuthRateLimit(ip);

  // Transparently upgrade hash to 210,000 PBKDF2 iterations if needed
  if (authRes.needsRehash) {
    try {
      const newHash = hashPassword(password);
      store.updateUserPassword(user.id, newHash);
      console.log(`[AUTH] Upgraded password hash for user #${user.id} (${user.email}) to 210,000 PBKDF2 iterations.`);
    } catch (err) {
      console.error(`[AUTH] Error upgrading password hash for user #${user.id}:`, err);
    }
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
  const ip = getClientIp(req);
  const limitCheck = checkAuthRateLimit(ip);
  if (!limitCheck.allowed) {
    console.warn(`[RATE LIMIT] Blocked register attempt from IP ${ip}. Retry in ${limitCheck.retryAfterSec}s.`);
    return res.status(429).render('register', {
      error: `Demasiados intentos fallidos. Por favor espera ${Math.ceil(limitCheck.retryAfterSec / 60)} minutos antes de reintentar.`,
      email: req.body?.email || ''
    });
  }

  const { email, password, password_confirm } = req.body;
  if (!email || !password) {
    recordAuthFailure(ip);
    return res.status(400).render('register', { error: 'Todos los campos son obligatorios', email });
  }
  if (password !== password_confirm) {
    recordAuthFailure(ip);
    return res.status(400).render('register', { error: 'Las contraseñas no coinciden', email });
  }
  if (password.length < 6) {
    recordAuthFailure(ip);
    return res.status(400).render('register', { error: 'La contraseña debe tener al menos 6 caracteres', email });
  }
  const existing = store.getUserByEmail(email);
  if (existing) {
    recordAuthFailure(ip);
    return res.status(400).render('register', { error: 'El correo electrónico ya está registrado', email });
  }

  resetAuthRateLimit(ip);
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

// Auth Status API Endpoint (for client session guard & back-button check)
app.get('/api/auth/status', (req: AuthenticatedRequest, res) => {
  if (req.user) {
    return res.json({ authenticated: true, user: { id: req.user.id, email: req.user.email } });
  }
  return res.json({ authenticated: false });
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
    const tasks = store.getPendingTasks(userId);
    const allTasks = store.getTasks(userId);
    let simulatedPendingTasks = [...tasks];

    const userTz = (appSettings as any)?.timezone || process.env.TIMEZONE || 'America/Santiago';
    const todayLocalDate = LocalDate.today(userTz);
    const todayStr = todayLocalDate.toIso();

    // Holidays
    let holidayDates = new Set<string>();
    if (appSettings.exclude_holidays) {
      const endDateStr = todayLocalDate.addDays(6).toIso();
      holidayDates = getHolidayDatesForRange(todayStr, endDateStr);
    }

    // Weather forecast
    let weeklyForecasts: Record<string, any[]> | null = null;
    if (!scenario) {
      weeklyForecasts = await getWeeklyForecast(todayStr, 7, appSettings.latitude, appSettings.longitude);
    }

    const forecastEvaluations = [];

    for (let d = 0; d < 7; d++) {
      const evalLocalDate = todayLocalDate.addDays(d);
      const evalDate = evalLocalDate.toIso();

      const dayOverride = store.getDayOverride(userId, evalDate);
      const forcedRows = store.getForcedTasksForDate(userId, evalDate);

      const forcedTasksWithHours = forcedRows.map(fr => ({
        task: store.getTask(userId, fr.task_id),
        forced_start_hour: fr.forced_start_hour,
        forced_id: fr.id,
        id: fr.id
      })).filter((item): item is { task: Task; forced_start_hour: number; forced_id: number; id: number } => item.task != null);

      let hourly;
      if (scenario) {
        const mockSvc = new MockWeatherService(scenario);
        hourly = mockSvc.getHourlyForecast(evalDate);
      } else if (weeklyForecasts && weeklyForecasts[evalDate]) {
        hourly = weeklyForecasts[evalDate];
      } else {
        hourly = await getHourlyForecast(evalDate, appSettings.latitude, appSettings.longitude);
      }

      let isDayClosed = false;
      let closedReason = "";

      if (evalDate === todayStr) {
        const todayLog = store.getDailyLogByDate(userId, todayStr);
        const localHm = getLocalHoursAndMinutes(new Date(), userTz);
        const currentDecHour = localHm.totalHours;
        const endLimit = (dayOverride && dayOverride.custom_end_hour != null) ? dayOverride.custom_end_hour : appSettings.operational_end_hour;
        const minWork = appSettings.min_work_hours || 2.0;

        if (todayLog && Boolean(todayLog.checkin_resolved)) {
          isDayClosed = true;
          closedReason = "Jornada concluida (cerrada manualmente por el usuario).";
        } else if (currentDecHour >= endLimit) {
          isDayClosed = true;
          closedReason = `Jornada concluida (horario operativo finalizado a las ${endLimit}:00).`;
        } else if (currentDecHour + minWork > endLimit) {
          isDayClosed = true;
          closedReason = `Jornada no asignable: tiempo restante insuficiente para la ventana mínima (${minWork.toFixed(1)}h antes de las ${endLimit}:00).`;
        }
      }

      const evalRes = evaluateDayWithOverrides(
        evalDate,
        simulatedPendingTasks,
        hourly,
        appSettings,
        holidayDates,
        dayOverride,
        forcedTasksWithHours,
        {
          isTodayClosed: isDayClosed,
          closedReason: closedReason
        }
      );

      if (evalRes.status === 'DAY_VIABLE' && evalRes.scheduled_tasks && evalRes.scheduled_tasks.length > 0) {
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

    const completedHistory = store.getRecentCompletedHistory(userId);
    const taskHistory = store.getTaskHistory(userId);
    const projectTemplates = store.getProjectTemplates(userId);
    const localTimeInfo = getWorkshopLocalTime(new Date(), appSettings.timezone);
    const materials = store.getMaterials(userId);
    const tools = store.getTools(userId);
    const calculatorOffsets = store.getCalculatorOffsets(userId);
    const allProjects = store.getProjects(userId);
    const activeCuringSessions = store.getActiveCuringSessions(userId);

    res.render('index', {
      project: activeProject,
      tasks,
      forecast_evaluations: forecastEvaluations,
      current_scenario: scenario || 'real',
      categories: Object.values(TaskCategory),
      category_labels: CATEGORY_LABELS,
      status_labels: STATUS_LABELS,
      app_settings: appSettings,
      local_time_info: localTimeInfo,
      completed_history: completedHistory,
      task_history: taskHistory,
      project_templates: projectTemplates,
      materials,
      tools,
      calculator_offsets: calculatorOffsets,
      all_projects: allProjects,
      all_tasks: allTasks,
      active_curing_sessions: activeCuringSessions,
      getHourlyClimateAudit
    });
  } catch (err) {
    console.error('Error rendering dashboard:', err);
    res.status(500).send('Internal Server Error');
  }
});

// POST /projects/add - Create a new project
app.post('/projects/add', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { name, description } = req.body;
  if (!name || !String(name).trim()) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ error: 'El nombre del proyecto es obligatorio' });
    }
    return res.redirect(303, '/');
  }
  const project = store.addProject(userId, String(name).trim(), description ? String(description).trim() : undefined);
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, project });
  }
  res.redirect(303, '/');
});

// POST /projects/:id/toggle - Toggle project active state
app.post('/projects/:id/toggle', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || !store.getProjectById(userId, id)) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
    return res.status(404).send('Proyecto no encontrado');
  }
  const { is_active } = req.body;
  const isActiveBool = is_active !== undefined ? (is_active === 'true' || is_active === true || is_active === 1 || is_active === '1') : undefined;
  const updated = store.toggleProjectActive(userId, id, isActiveBool);
  if (!updated) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
    return res.status(404).send('Proyecto no encontrado');
  }
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, project: updated });
  }
  res.redirect(303, '/');
});

// POST /projects/:id/update - Update project details (e.g. rename)
app.post('/projects/:id/update', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = parseInt(req.params.id, 10);
  const { name, description } = req.body;
  if (!name || !String(name).trim()) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ error: 'El nombre del proyecto no puede estar vacío' });
    }
    return res.redirect(303, '/');
  }
  const updated = store.updateProject(userId, id, {
    name: String(name).trim(),
    description: description ? String(description).trim() : undefined
  });
  if (!updated) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
    return res.redirect(303, '/');
  }
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, project: updated });
  }
  res.redirect(303, '/');
});

// Helper for parsing float numbers flexible with commas and strings
function parseFlexibleFloat(val: any): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val === 'number') return isNaN(val) ? undefined : val;
  const str = String(val).replace(',', '.').trim();
  const parsed = parseFloat(str);
  return isNaN(parsed) ? undefined : parsed;
}

// POST /tasks/add
app.post('/tasks/add', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { title, description, category, estimated_hours, curing_hours, order, project_id, curing_is_blocking } = req.body;
    const parsedEst = parseFlexibleFloat(estimated_hours) ?? 1.0;
    const parsedCur = parseFlexibleFloat(curing_hours) ?? 0.0;
    const parsedOrd = order ? parseInt(String(order), 10) : undefined;
    const targetProjId = project_id ? parseInt(String(project_id), 10) : undefined;
    const curingIsBlockingBool = curing_is_blocking !== undefined ? (curing_is_blocking === 'true' || curing_is_blocking === true || curing_is_blocking === 1 || curing_is_blocking === '1') : true;

    if (targetProjId) {
      const proj = store.getProjectById(userId, targetProjId);
      if (!proj) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(404).json({ error: 'Proyecto no encontrado' });
        }
        return res.status(404).send('Proyecto no encontrado');
      }
    }

    store.addTask(userId, {
      project_id: targetProjId,
      title: title ? String(title).trim() : 'Nueva Tarea',
      description: description || '',
      category: category || TaskCategory.CARPENTRY,
      estimated_hours: parsedEst,
      curing_hours: parsedCur,
      order: parsedOrd && !isNaN(parsedOrd) ? parsedOrd : undefined,
      curing_is_blocking: curingIsBlockingBool
    });
    triggerSilentReevaluation(userId).catch(err => console.error('[Scheduler] Error reevaluating after task add:', err));
    res.redirect(303, '/');
  } catch (err) {
    console.error('[Server Error] Error en POST /tasks/add:', err);
    res.redirect(303, '/');
  }
});

// POST /tasks/:id/activate-to-backlog - Activar tarea y su proyecto para el agendamiento activo
app.post('/tasks/:id/activate-to-backlog', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = parseInt(req.params.id, 10);
  const task = store.getTask(userId, id);
  if (!task) {
    return res.status(404).json({ error: 'Tarea no encontrada' });
  }

  // 1. Activar tarea en base de datos y restablecer su estado a PENDING usando TaskService FSM
  const updatedTask = TaskService.reactivateToBacklog(userId, id);
  
  // 2. Asegurar que el proyecto al que pertenece esté activo para ser agendable
  if (task.project_id) {
    store.toggleProjectActive(userId, task.project_id, true);
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ 
      success: true, 
      message: `Tarea '${task.title}' agregada al backlog activo`,
      task: updatedTask
    });
  }

  res.redirect(303, '/');
});

// POST /tasks/:id/toggle-active
app.post('/tasks/:id/toggle-active', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = parseInt(req.params.id, 10);
  const { is_active } = req.body;
  const isActiveBool = is_active !== undefined ? (is_active === 'true' || is_active === true || is_active === 1 || is_active === '1') : undefined;
  
  let updated;
  if (isActiveBool === false) {
    updated = TaskService.pauseTask(userId, id);
  } else if (isActiveBool === true) {
    updated = TaskService.resumeTask(userId, id);
  } else {
    const current = store.getTask(userId, id);
    updated = current?.is_active === false ? TaskService.resumeTask(userId, id) : TaskService.pauseTask(userId, id);
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, task: updated });
  }
  res.redirect(303, '/');
});

// POST /tasks/:id/update
app.post('/tasks/:id/update', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ error: 'ID de tarea inválido' });
      }
      return res.redirect(303, '/');
    }

    const { title, estimated_hours, curing_hours, category, project_id, is_active, curing_is_blocking } = req.body;
    const parsedEst = parseFlexibleFloat(estimated_hours);
    const parsedCur = parseFlexibleFloat(curing_hours);
    const isActiveBool = is_active !== undefined ? (is_active === 'true' || is_active === true || is_active === 1 || is_active === '1') : undefined;
    const curingIsBlockingBool = curing_is_blocking !== undefined ? (curing_is_blocking === 'true' || curing_is_blocking === true || curing_is_blocking === 1 || curing_is_blocking === '1') : undefined;
    const targetProjId = project_id ? parseInt(String(project_id), 10) : undefined;

    if (targetProjId) {
      const proj = store.getProjectById(userId, targetProjId);
      if (!proj) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(404).json({ error: 'Proyecto no encontrado' });
        }
        return res.status(404).send('Proyecto no encontrado');
      }
    }

    const updated = store.updateTask(userId, id, {
      title: title ? String(title).trim() : undefined,
      estimated_hours: parsedEst,
      curing_hours: parsedCur !== undefined ? parsedCur : (curing_hours === '' || curing_hours === '0' || curing_hours === 0 ? 0 : undefined),
      category: category || undefined,
      project_id: targetProjId,
      is_active: isActiveBool,
      curing_is_blocking: curingIsBlockingBool
    });

    if (!updated) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ error: 'Tarea no encontrada o no pertenece al usuario' });
      }
      return res.redirect(303, '/');
    }

    triggerSilentReevaluation(userId).catch(err => console.error('[Scheduler] Error reevaluating after task update:', err));

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, task: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error(`[Server Error] Error en POST /tasks/${req.params.id}/update:`, err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: 'Error interno del servidor al actualizar la tarea', details: err?.message });
    }
    res.redirect(303, '/');
  }
});

// POST /tasks/:id/update_status
app.post('/tasks/:id/update_status', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = parseInt(req.params.id, 10);
  const { status, progress } = req.body;
  const progressNum = parseInt(progress, 10);

  try {
    let updated: Task;
    if (progress !== undefined && !isNaN(progressNum)) {
      updated = TaskService.updateProgress(userId, id, progressNum);
    } else if (status === TaskStatus.COMPLETED) {
      updated = TaskService.completeTask(userId, id);
    } else if (status === TaskStatus.IN_PROGRESS) {
      updated = TaskService.startTask(userId, id);
    } else if (status === TaskStatus.PENDING) {
      updated = TaskService.reactivateToBacklog(userId, id);
    } else {
      const existing = store.getTask(userId, id);
      if (!existing) {
        return res.status(404).json({ error: 'Tarea no encontrada o no pertenece al usuario' });
      }
      updated = existing;
    }

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, task: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error(`[Server Error] Error en POST /tasks/${id}/update_status:`, err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ error: err?.message || 'Error al actualizar el estado de la tarea' });
    }
    res.redirect(303, '/');
  }
});

// POST /tasks/:id/delete
app.post('/tasks/:id/delete', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = parseInt(req.params.id, 10);
  const task = store.getTask(userId, id);
  const title = task ? task.title : 'Tarea';
  store.deleteTask(userId, id);
  triggerSilentReevaluation(userId).catch(err => console.error('[Scheduler] Error reevaluating after task delete:', err));
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: `Tarea '${title}' eliminada` });
  }
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
  const parseResult = reorderPayloadSchema.safeParse(req.body);

  if (!parseResult.success) {
    const formattedErrors = parseResult.error.issues.map(
      issue => `${issue.path.join('.')}: ${issue.message}`
    );
    return res.status(400).json({
      status: 'error',
      detail: `Payload inválido: ${formattedErrors.join('; ')}`,
      issues: parseResult.error.format()
    });
  }

  store.reorderTasks(userId, parseResult.data.task_ids);
  res.json({ status: 'ok' });
});

// POST /tasks/import
app.post('/tasks/import', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const parseResult = importPayloadSchema.safeParse(req.body);

  if (!parseResult.success) {
    const formattedErrors = parseResult.error.issues.map(
      issue => `${issue.path.join('.')}: ${issue.message}`
    );
    return res.status(400).json({
      status: 'error',
      detail: `Payload de importación inválido: ${formattedErrors.join('; ')}`,
      issues: parseResult.error.format()
    });
  }

  const { project_name: projectName, tasks: taskList } = parseResult.data;

  let project = store.getProjects(userId).find(p => p.name === projectName);
  if (!project) {
    project = store.addProject(userId, projectName, 'Proyecto creado vía Importación IA');
  }

  taskList.forEach((tdata) => {
    store.addTask(userId, {
      project_id: project!.id,
      title: tdata.title,
      description: tdata.description,
      category: tdata.category as TaskCategory,
      estimated_hours: tdata.estimated_hours,
      curing_hours: tdata.curing_hours,
      order: store.getTasks(userId).length + 1
    });
  });

  res.json({
    status: 'success',
    message: `Se importaron ${taskList.length} tareas exitosamente en el proyecto '${projectName}'.`,
    imported_count: taskList.length
  });
});

// Task history / suggestions endpoint
app.get('/tasks/history', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const history = store.getTaskHistory(userId);
  res.json(history);
});
app.get('/tasks/suggestions', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const history = store.getTaskHistory(userId);
  res.json(history);
});

// --- CURING SESSIONS API ---
// GET /api/curing-sessions/active - Obtener sesiones de secado activas
app.get('/api/curing-sessions/active', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const sessions = store.getActiveCuringSessions(userId);
  res.json({ success: true, sessions });
});

// POST /api/curing-sessions/start - Iniciar secado de pieza (explícito)
app.post('/api/curing-sessions/start', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { task_id, piece_label, duration_hours, started_at } = req.body;
    const taskIdNum = parseInt(String(task_id), 10);
    if (isNaN(taskIdNum)) {
      return res.status(400).json({ error: 'task_id inválido' });
    }

    const durationNum = duration_hours ? parseFloat(String(duration_hours)) : undefined;
    const session = TaskService.startCuring(userId, taskIdNum, {
      piece_label: piece_label ? String(piece_label).trim() : undefined,
      duration_hours: durationNum,
      started_at: started_at ? String(started_at) : undefined
    });

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, session });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('[Curing Error] Error starting curing session:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ error: err.message || 'Error al iniciar secado' });
    }
    res.redirect(303, '/');
  }
});

// POST /api/curing-sessions/:id/complete - Finalizar secado
app.post('/api/curing-sessions/:id/complete', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      return res.status(400).json({ error: 'ID de sesión inválido' });
    }

    const session = TaskService.completeCuring(userId, sessionId);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, session });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('[Curing Error] Error completing curing session:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ error: err.message || 'Error al completar secado' });
    }
    res.redirect(303, '/');
  }
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

// ==========================================
// MATERIALES (PLANNING MODE) ROUTES
// ==========================================
app.get('/api/materials', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  let projectId: number | undefined;
  if (req.query.project_id) {
    projectId = parseInt(String(req.query.project_id), 10);
    if (isNaN(projectId) || !store.getProjectById(userId, projectId)) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
  }
  const materials = store.getMaterials(userId, projectId);
  res.json({ success: true, materials });
});

app.post('/materials/add', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { name, quantity, unit, category, status, project_id } = req.body;
    if (!name || !String(name).trim()) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ error: 'El nombre del material es obligatorio' });
      }
      return res.redirect(303, '/');
    }

    let targetProjId: number | undefined;
    if (project_id !== undefined && project_id !== null && project_id !== '') {
      targetProjId = parseInt(String(project_id), 10);
      if (isNaN(targetProjId) || !store.getProjectById(userId, targetProjId)) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(404).json({ error: 'Proyecto no encontrado' });
        }
        return res.status(404).send('Proyecto no encontrado');
      }
    }

    const mat = store.addMaterial(userId, {
      name: String(name),
      quantity: parseFloat(quantity) || 1.0,
      unit: String(unit || 'unidades'),
      category: String(category || 'General'),
      status: String(status || 'to_buy'),
      project_id: targetProjId
    });
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, material: mat });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error adding material:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
});

app.post('/materials/:id/toggle', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const updated = store.toggleMaterialStatus(userId, id);
    if (!updated) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ error: 'Material no encontrado' });
      }
      return res.status(404).send('Material no encontrado');
    }
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, material: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error toggling material:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
});

app.post('/materials/:id/update', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const { name, quantity, unit, category, status, project_id } = req.body;

    let targetProjId: number | undefined;
    if (project_id !== undefined && project_id !== null && project_id !== '') {
      targetProjId = parseInt(String(project_id), 10);
      if (isNaN(targetProjId) || !store.getProjectById(userId, targetProjId)) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(404).json({ error: 'Proyecto no encontrado' });
        }
        return res.status(404).send('Proyecto no encontrado');
      }
    }

    const updated = store.updateMaterial(userId, id, {
      name: name ? String(name) : undefined,
      quantity: quantity !== undefined ? parseFloat(quantity) : undefined,
      unit: unit ? String(unit) : undefined,
      category: category ? String(category) : undefined,
      status: status ? String(status) : undefined,
      project_id: targetProjId
    });
    if (!updated) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ error: 'Material no encontrado' });
      }
      return res.status(404).send('Material no encontrado');
    }
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, material: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error updating material:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
});

app.post('/materials/:id/set-status', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    const updated = store.setMaterialStatus(userId, id, status);
    triggerSilentReevaluation(userId).catch(err => console.error('[Scheduler] Error reevaluating after material status update:', err));
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, material: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error setting material status:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
});

app.post('/materials/:id/delete', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    store.deleteMaterial(userId, id);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error deleting material:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
});

// ==========================================
// TOOLS MANAGEMENT ROUTES
// ==========================================
app.get('/api/tools', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const tools = store.getTools(userId, category);
  res.json({ success: true, tools });
});

app.post('/tools/add', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { name, category, status, notes } = req.body;
    if (!name || !String(name).trim()) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ error: 'El nombre de la herramienta es requerido' });
      }
      return res.redirect(303, '/');
    }
    const tool = store.addTool(userId, {
      name: String(name),
      category: category ? String(category) : undefined,
      status: status ? String(status) : undefined,
      notes: notes ? String(notes) : undefined
    });
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, tool });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error adding tool:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
});

app.post('/tools/:id/update', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const { name, category, status, notes } = req.body;
    const updated = store.updateTool(userId, id, {
      name: name ? String(name) : undefined,
      category: category ? String(category) : undefined,
      status: status ? String(status) : undefined,
      notes: notes !== undefined ? String(notes) : undefined
    });
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, tool: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error updating tool:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
});

app.post('/tools/:id/set-status', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    const updated = store.setToolStatus(userId, id, status);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, tool: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error setting tool status:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
});

app.post('/tools/:id/delete', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    store.deleteTool(userId, id);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error deleting tool:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
});

// GET /api/inventory/export-context - Generate AI Prompt Context
app.get('/api/inventory/export-context', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const materials = store.getMaterials(userId);
    const tools = store.getTools(userId);

    const toolsAvailable = tools.filter(t => t.status === 'available');
    const toolsInUse = tools.filter(t => t.status === 'in_use');
    const toolsToBuy = tools.filter(t => t.status === 'to_buy' || t.status === 'Por Comprar');
    const toolsBroken = tools.filter(t => t.status === 'broken');

    const matsInStock = materials.filter(m => m.status === 'in_stock');
    const matsToBuy = materials.filter(m => m.status === 'to_buy');
    const matsOutOfStock = materials.filter(m => m.status === 'out_of_stock');

    let text = `### CONTEXTO DE INVENTARIO Y TALLER (WORKSHOP OS)\n\n`;

    text += `**HERRAMIENTAS EN TALLER (${tools.length} total):**\n`;
    if (toolsAvailable.length > 0) {
      text += `• Disponibles: ${toolsAvailable.map(t => `${t.name} [${t.category}]`).join(', ')}\n`;
    }
    if (toolsInUse.length > 0) {
      text += `• En Uso/Mantenimiento: ${toolsInUse.map(t => `${t.name} [${t.category}]`).join(', ')}\n`;
    }
    if (toolsToBuy.length > 0) {
      text += `• Por Comprar / Faltantes: ${toolsToBuy.map(t => `${t.name} [${t.category}]`).join(', ')}\n`;
    }
    if (toolsBroken.length > 0) {
      text += `• Requieren Reemplazo/Reparación: ${toolsBroken.map(t => `${t.name} [${t.category}]`).join(', ')}\n`;
    }
    if (tools.length === 0) {
      text += `• No hay herramientas registradas aún.\n`;
    }

    text += `\n**MATERIALES Y INSUMOS EN STOCK (EN TALLER):**\n`;
    if (matsInStock.length > 0) {
      matsInStock.forEach(m => {
        text += `• ${m.name}: ${m.quantity} ${m.unit} [${m.category}] (Proyecto: ${m.project_name || 'General'})\n`;
      });
    } else {
      text += `• No hay materiales registrados en stock.\n`;
    }

    text += `\n**MATERIALES Y HERRAMIENTAS POR COMPRAR / AGOTADOS:**\n`;
    if (matsToBuy.length > 0 || matsOutOfStock.length > 0 || toolsToBuy.length > 0) {
      matsToBuy.forEach(m => {
        text += `• [MATERIAL POR COMPRAR] ${m.name}: ${m.quantity} ${m.unit} [${m.category}]\n`;
      });
      matsOutOfStock.forEach(m => {
        text += `• [MATERIAL AGOTADO] ${m.name}: ${m.quantity} ${m.unit} [${m.category}]\n`;
      });
      toolsToBuy.forEach(t => {
        text += `• [HERRAMIENTA POR COMPRAR] ${t.name} [${t.category}]${t.notes ? ` (Notas: ${t.notes})` : ''}\n`;
      });
    } else {
      text += `• No hay lista de compras pendiente.\n`;
    }

    res.json({
      success: true,
      text,
      summary: {
        total_tools: tools.length,
        total_materials: materials.length,
        in_stock: matsInStock.length,
        to_buy: matsToBuy.length + matsOutOfStock.length + toolsToBuy.length
      }
    });
  } catch (err: any) {
    console.error('Error generating inventory export context:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/materials/import', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    let materialsList: any[] = [];
    if (req.body.json_data) {
      try {
        const parsed = JSON.parse(req.body.json_data);
        materialsList = Array.isArray(parsed) ? parsed : (parsed.materials || []);
      } catch (e) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(400).json({ error: 'JSON inválido' });
        }
        return res.redirect(303, '/');
      }
    } else if (Array.isArray(req.body.materials)) {
      materialsList = req.body.materials;
    }

    let targetProjId: number | undefined;
    if (req.body.project_id !== undefined && req.body.project_id !== null && req.body.project_id !== '') {
      targetProjId = parseInt(String(req.body.project_id), 10);
      if (isNaN(targetProjId) || !store.getProjectById(userId, targetProjId)) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(404).json({ error: 'Proyecto no encontrado' });
        }
        return res.status(404).send('Proyecto no encontrado');
      }
    }
    const imported = store.importMaterialsFromJson(userId, materialsList, targetProjId);

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, imported_count: imported.length, materials: imported });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error importing materials:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
});

// ==========================================
// CALCULATOR OFFSETS (WORKSHOP MODE) ROUTES
// ==========================================
app.get('/api/calculator/offsets', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const offsets = store.getCalculatorOffsets(userId);
  res.json({ success: true, offsets });
});

app.post('/calculator/offsets/add', (req: AuthenticatedRequest, res) => {
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

app.post('/calculator/offsets/:id/update', (req: AuthenticatedRequest, res) => {
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

app.post('/calculator/offsets/:id/delete', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    store.deleteCalculatorOffset(userId, id);
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
const handleEvaluationRequest = async (req: AuthenticatedRequest, res: any) => {
  const userId = req.user!.id;
  const scenario = req.body.scenario || req.query.scenario;

  const isJsonRequested = req.xhr || 
    (req.headers.accept && req.headers.accept.includes('application/json')) ||
    (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) ||
    req.path.startsWith('/api/') ||
    req.body.format === 'json';

  try {
    const evalRunResult = await runMorningEvaluation(userId, undefined, scenario || undefined);

    if (isJsonRequested) {
      return res.json({
        success: true,
        status: evalRunResult.status,
        reason: evalRunResult.reason,
        telegramSent: evalRunResult.telegramSent,
        telegramReason: evalRunResult.telegramReason,
        calendarSynced: evalRunResult.calendarSynced,
        calendarReason: evalRunResult.calendarReason,
        evalResult: evalRunResult.evalResult
      });
    }

    if (scenario) {
      res.redirect(303, `/?scenario=${encodeURIComponent(String(scenario))}`);
    } else {
      res.redirect(303, '/');
    }
  } catch (err: any) {
    if (err.message === 'EVALUATION_IN_PROGRESS') {
      console.warn(`[Server] Solicitud de evaluación rechazada por evaluación en curso para Usuario #${userId}`);
      if (isJsonRequested) {
        return res.status(429).json({
          success: false,
          error: 'Ya hay una evaluación en curso, esperá unos segundos.',
          code: 'EVALUATION_IN_PROGRESS',
          telegramSent: false,
          telegramReason: '⚠️ Evaluación en curso',
          calendarSynced: false,
          calendarReason: '⚠️ Evaluación en curso'
        });
      }
      return res.redirect(303, '/');
    }

    console.error('Error running evaluation:', err);
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
      return res.status(500).json({
        success: false,
        error: err.message || 'Error executing evaluation',
        telegramSent: false,
        telegramReason: '❌ Error en servidor durante evaluación',
        calendarSynced: false,
        calendarReason: '❌ Error en servidor durante evaluación'
      });
    }
    res.redirect(303, '/');
  }
};

app.post('/evaluation/force_run', handleEvaluationRequest);

app.post('/evaluation/force_checkin', async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  try {
    await runCheckinTick(undefined, true, userId);
  } catch (err) {
    console.error('Error running forced checkin:', err);
  }
  res.redirect(303, '/');
});

// Endpoint Término de la Jornada -> Fuerza check-in inmediato
app.post('/api/checkin/end_shift', async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;

  if (!acquireEvaluationLock(userId)) {
    return res.status(429).json({
      success: false,
      error: 'Ya hay una evaluación en curso, esperá unos segundos.',
      code: 'EVALUATION_IN_PROGRESS'
    });
  }

  try {
    const appSettings = store.getAppSettings(userId);
    const userTz = appSettings?.timezone || process.env.TIMEZONE || "America/Santiago";
    const now = new Date();
    const todayIso = getLocalDateIso(now, userTz);

    // Obtener log diario de hoy o evaluar el día
    let dailyLog = store.getDailyLogByDate(userId, todayIso);
    if (!dailyLog) {
      await runMorningEvaluation(userId, todayIso, undefined, { skipLock: true });
      dailyLog = store.getDailyLogByDate(userId, todayIso);
    }

    // Obtener tareas agendadas para hoy
    let taskIds: number[] = [];
    if (dailyLog && dailyLog.scheduled_task_ids) {
      try {
        taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]");
      } catch (_) {}
    }

    let scheduledTasks = taskIds
      .map(tid => store.getTask(userId, tid))
      .filter((t): t is Task => t != null && t.user_id === userId);

    // Fallback: Si no hay tareas agendadas registradas en el log, obtener las tareas pendientes del proyecto activo o globales
    if (scheduledTasks.length === 0) {
      const activeProject = store.getActiveProject(userId);
      scheduledTasks = store.getPendingTasks(userId, activeProject?.id);

      if (dailyLog && scheduledTasks.length > 0) {
        store.updateDailyLog(userId, dailyLog.id, {
          scheduled_task_ids: JSON.stringify(scheduledTasks.map(t => t.id))
        });
      }
    }

    // Caso Re-apretar: Si el check-in de hoy ya fue completado/resuelto previamente
    if (dailyLog && dailyLog.checkin_resolved) {
      return res.json({
        success: true,
        alreadyResolved: true,
        message: "El check-in de la jornada de hoy ya fue completado previamente.",
        dailyLogId: dailyLog.id,
        dateIso: todayIso,
        tasks: scheduledTasks.map(t => ({
          id: t.id,
          title: t.title,
          project_name: t.project_name || '',
          estimated_hours: t.estimated_hours,
          status: t.status,
          completed: t.status === TaskStatus.COMPLETED
        }))
      });
    }

    // Intentar check-in vía Telegram
    let targetChatId = appSettings.telegram_chat_id ? appSettings.telegram_chat_id.trim() : "";
    if (!targetChatId && userId === 1 && process.env.TELEGRAM_CHAT_ID) {
      targetChatId = process.env.TELEGRAM_CHAT_ID.trim();
    }

    let telegramSent = false;
    let telegramError = "";

    if (targetChatId && process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const telegramSvc = new TelegramBotService(process.env.TELEGRAM_BOT_TOKEN, targetChatId);
        const uncompletedTasks = scheduledTasks.filter(t => t.status !== TaskStatus.COMPLETED);
        if (uncompletedTasks.length > 0 && dailyLog) {
          telegramSent = await telegramSvc.sendCheckinPrompt(dailyLog.id, uncompletedTasks);
          if (telegramSent) {
            store.updateDailyLog(userId, dailyLog.id, { checkin_sent: true });
          } else {
            telegramError = "El bot de Telegram no pudo entregar el mensaje (bloqueado o desvinculado).";
          }
        } else if (uncompletedTasks.length === 0) {
          if (dailyLog && dailyLog.status === 'DAY_BLOCKED') {
            telegramError = "El día estuvo marcado como NO VIABLE (DAY_BLOCKED) por condiciones climáticas u operativas. No hay tareas pendientes para finalizar.";
          } else {
            telegramError = "No hay tareas pendientes sin completar para la jornada de hoy.";
          }
        }
      } catch (err: any) {
        telegramError = err?.message || "Error al comunicarse con la API de Telegram";
      }
    } else {
      if (dailyLog && dailyLog.status === 'DAY_BLOCKED' && scheduledTasks.length === 0) {
        telegramError = "El día estuvo marcado como NO VIABLE (DAY_BLOCKED) por condiciones climáticas u operativas. No hay tareas pendientes para finalizar.";
      } else {
        telegramError = "No hay una cuenta de Telegram vinculada en la configuración.";
      }
    }

    return res.json({
      success: true,
      telegramSent,
      telegramError: telegramSent ? undefined : telegramError,
      dailyLogId: dailyLog ? dailyLog.id : null,
      dateIso: todayIso,
      tasks: scheduledTasks.map(t => ({
        id: t.id,
        title: t.title,
        project_name: t.project_name || '',
        estimated_hours: t.estimated_hours,
        status: t.status,
        completed: t.status === TaskStatus.COMPLETED
      }))
    });
  } catch (err: any) {
    console.error('Error en término de jornada / check-in:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al procesar el término de jornada' });
  } finally {
    releaseEvaluationLock(userId);
  }
});

// Endpoint para guardar resolución manual de check-in cuando falla Telegram
app.post('/api/checkin/resolve', async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { dailyLogId, completedTaskIds } = req.body;

  try {
    const completedSet = new Set<number>(Array.isArray(completedTaskIds) ? completedTaskIds.map(Number) : []);
    let dailyLog = dailyLogId ? store.getDailyLogById(userId, Number(dailyLogId)) : null;

    let taskIds: number[] = [];
    if (dailyLog && dailyLog.scheduled_task_ids) {
      try {
        taskIds = JSON.parse(dailyLog.scheduled_task_ids || "[]");
      } catch (_) {}
    }

    if (taskIds.length === 0) {
      const allTasks = store.getTasks(userId);
      taskIds = allTasks.map(t => t.id);
    }

    for (const tid of taskIds) {
      const t = store.getTask(userId, tid);
      if (!t || t.user_id !== userId) continue;

      if (completedSet.has(tid)) {
        TaskService.completeTask(userId, t.id, { triggerReeval: false });
      } else {
        if (t.status === TaskStatus.COMPLETED) {
          TaskService.reactivateToBacklog(userId, t.id, { triggerReeval: false });
        }
      }
    }

    if (dailyLog) {
      DayService.concludeDay(userId, dailyLog.eval_date, "Jornada concluida (cerrada manualmente por el usuario)", { triggerReeval: false, checkinSent: true });
    }

    await triggerSilentReevaluation(userId, dailyLog?.eval_date);

    return res.json({ success: true });
  } catch (err: any) {
    console.error('Error al resolver checkin:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al guardar check-in' });
  }
});

app.get('/api/timezone', (req: AuthenticatedRequest, res) => {
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

app.post('/settings/update', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const body = req.body;
  store.updateAppSettings(userId, {
    operational_start_hour: parseInt(body.operational_start_hour) || 9,
    operational_end_hour: parseInt(body.operational_end_hour) || 18,
    max_humidity_percent: parseFloat(body.max_humidity_percent) || 80.0,
    latitude: parseFloat(body.latitude) || -32.99,
    longitude: parseFloat(body.longitude) || -71.27,
    timezone: body.timezone ? String(body.timezone).trim() : undefined,
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
    google_calendar_id: body.google_calendar_id !== undefined ? String(body.google_calendar_id).trim() : undefined,
    google_calendar_enabled: body.google_calendar_enabled === 'true' || body.google_calendar_enabled === 'on' || body.google_calendar_enabled === '1'
  });
  res.redirect(303, '/');
});

// Endpoint para la vinculación segura de Telegram vía OTP (código de 6 dígitos)
app.post('/settings/telegram/generate-code', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { code, expiresAt } = store.generateTelegramLinkCode(userId);
    res.json({ success: true, code, expiresAt });
  } catch (err: any) {
    console.error('Error generando código de vinculación Telegram:', err);
    res.status(500).json({ error: 'Error interno al generar código' });
  }
});

app.post('/settings/telegram/unlink', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    store.unlinkTelegram(userId);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error desvinculando Telegram:', err);
    res.status(500).json({ error: 'Error interno al desvincular Telegram' });
  }
});

// Endpoint para reconciliación forzada de Google Calendar
app.post('/api/calendar/reconcile', async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const result = await reconcileCalendarEvents(userId);
    res.json({ success: result.synced, reason: result.reason, deletedOrphansCount: result.deletedOrphansCount || 0 });
  } catch (err: any) {
    console.error('[API Calendar Reconcile Error]', err);
    res.status(500).json({ success: false, error: err?.message || 'Error al reconciliar Google Calendar' });
  }
});

// Endpoint para previsualización de eventos huérfanos en Google Calendar (sin borrar)
app.get('/api/calendar/preview-orphans', async (req: AuthenticatedRequest, res) => {
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

// Endpoint para limpieza confirmada de eventos huérfanos en Google Calendar
app.post('/api/calendar/cleanup-orphans', async (req: AuthenticatedRequest, res) => {
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
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
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
}

export { app };
