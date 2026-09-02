import { Router, Response } from 'express';
import { store } from '../db.js';
import {
  AuthenticatedRequest,
  getClientIp,
  checkAuthRateLimit,
  recordAuthFailure,
  resetAuthRateLimit,
  verifyPasswordDetailed,
  hashPassword,
  signToken,
  createSessionCookie,
  createClearSessionCookie
} from '../auth.js';

const router = Router();

// GET /login
router.get('/login', (req: AuthenticatedRequest, res: Response) => {
  if (req.user) return res.redirect('/');
  res.render('login', { error: null, email: '' });
});

// POST /login
router.post('/login', (req, res) => {
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

  resetAuthRateLimit(ip);

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

// GET /register
router.get('/register', (req: AuthenticatedRequest, res: Response) => {
  if (req.user) return res.redirect('/');
  res.render('register', { error: null, email: '' });
});

// POST /register
router.post('/register', (req, res) => {
  const ip = getClientIp(req);
  const limitCheck = checkAuthRateLimit(ip);
  if (!limitCheck.allowed) {
    console.warn(`[RATE LIMIT] Blocked register attempt from IP ${ip}. Retry in ${limitCheck.retryAfterSec}s.`);
    return res.status(429).render('register', {
      error: `Demasiados intentos fallidos. Por favor espera ${Math.ceil(limitCheck.retryAfterSec / 60)} minutos antes de reintentar.`,
      email: req.body?.email || ''
    });
  }

  // Check global registration_open setting
  const sys = store.getSystemSettings();
  if (sys.registration_open === 0) {
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.status(403).json({ error: 'El registro de nuevas cuentas está temporalmente deshabilitado.' });
    }
    return res.status(403).render('register', {
      error: 'El registro público de nuevas cuentas se encuentra temporalmente deshabilitado por el administrador.',
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
  const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL ? process.env.ADMIN_BOOTSTRAP_EMAIL.trim().toLowerCase() : null;
  const isBootstrapAdmin = Boolean(bootstrapEmail && email.toLowerCase().trim() === bootstrapEmail);
  const user = store.createUser(email, hash, isBootstrapAdmin ? 'admin' : 'user');
  if (isBootstrapAdmin) {
    console.log(`[AUTH REGISTER] Usuario '${email}' coincide con ADMIN_BOOTSTRAP_EMAIL y fue asignado con rol 'admin'.`);
  }
  const token = signToken({ userId: user.id, email: user.email });
  res.setHeader('Set-Cookie', createSessionCookie(token));
  res.redirect(303, '/');
});

// GET /logout
router.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', createClearSessionCookie());
  res.redirect(303, '/login');
});

// GET /api/auth/status
router.get('/api/auth/status', (req: AuthenticatedRequest, res) => {
  if (req.user) {
    return res.json({ authenticated: true, user: { id: req.user.id, email: req.user.email } });
  }
  return res.json({ authenticated: false });
});

// POST /api/user/change-password
router.post('/api/user/change-password', (req: AuthenticatedRequest, res) => {
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

// POST /api/admin/backup
router.post('/api/admin/backup', (req: AuthenticatedRequest, res) => {
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

export default router;
