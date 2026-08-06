import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { store } from './db.js';

function getSessionSecret(): string {
  return process.env.SESSION_SECRET || 'workshop-os-secure-session-key-2026';
}

export const DEFAULT_PBKDF2_ITERATIONS = 210000;

/**
 * Generates a PBKDF2 password hash with a configurable iteration count.
 * Format stored: `pbkdf2:<iterations>:<salt>:<hash>`
 */
export function hashPassword(password: string, iterations: number = DEFAULT_PBKDF2_ITERATIONS): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  return `pbkdf2:${iterations}:${salt}:${hash}`;
}

export interface VerifyPasswordResult {
  isValid: boolean;
  needsRehash: boolean;
}

/**
 * Detailed password verification supporting legacy hashes (10,000 iterations, 2-part format)
 * and new hashes (210,000 iterations, 4-part format).
 */
export function verifyPasswordDetailed(password: string, storedHash: string): VerifyPasswordResult {
  try {
    if (!storedHash) return { isValid: false, needsRehash: false };

    const parts = storedHash.split(':');
    let iterations = 10000;
    let salt = '';
    let hash = '';

    if (parts.length === 4 && parts[0] === 'pbkdf2') {
      iterations = parseInt(parts[1], 10) || DEFAULT_PBKDF2_ITERATIONS;
      salt = parts[2];
      hash = parts[3];
    } else if (parts.length === 3) {
      iterations = parseInt(parts[0], 10) || 10000;
      salt = parts[1];
      hash = parts[2];
    } else if (parts.length === 2) {
      // Legacy format: salt:hash (10,000 iterations)
      salt = parts[0];
      hash = parts[1];
      iterations = 10000;
    } else {
      return { isValid: false, needsRehash: false };
    }

    if (!salt || !hash) return { isValid: false, needsRehash: false };

    const verifyHash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
    const hashBuf = Buffer.from(hash, 'hex');
    const verifyBuf = Buffer.from(verifyHash, 'hex');

    if (hashBuf.length !== verifyBuf.length) return { isValid: false, needsRehash: false };

    const isValid = crypto.timingSafeEqual(hashBuf, verifyBuf);
    const needsRehash = isValid && iterations < DEFAULT_PBKDF2_ITERATIONS;

    return { isValid, needsRehash };
  } catch (err) {
    console.error('[AUTH] verifyPassword error:', err);
    return { isValid: false, needsRehash: false };
  }
}

/**
 * Backward-compatible boolean wrapper for verifyPassword
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  return verifyPasswordDetailed(password, storedHash).isValid;
}

/**
 * In-Memory Rate Limiting for Auth (/login & /register)
 * Max 5 failed attempts per 15-minute window per IP.
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const authRateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILED_ATTEMPTS = 5;

export function checkAuthRateLimit(ip: string): { allowed: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  const entry = authRateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    return { allowed: true, remaining: MAX_FAILED_ATTEMPTS, retryAfterSec: 0 };
  }

  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  return { allowed: true, remaining: MAX_FAILED_ATTEMPTS - entry.count, retryAfterSec: 0 };
}

export function recordAuthFailure(ip: string): void {
  const now = Date.now();
  const entry = authRateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    authRateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

export function resetAuthRateLimit(ip: string): void {
  authRateLimitMap.delete(ip);
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

/**
 * Same-Origin CSRF Protection Middleware
 * Validates Origin / Referer header on state-changing HTTP requests (POST, PUT, DELETE, PATCH).
 */
export function verifySameOrigin(req: Request, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return next();
  }

  const originHeader = (req.headers.origin as string) || (req.headers.referer as string);
  if (!originHeader) {
    console.warn(`[CSRF] Rejected ${req.method} ${req.path}: Missing Origin/Referer header`);
    if (req.xhr || req.path.startsWith('/api/') || (req.headers.accept && req.headers.accept.includes('json'))) {
      return res.status(403).json({ error: 'Acceso denegado: cabecera de origen no proporcionada (protección CSRF)' });
    }
    return res.status(403).send('Acceso denegado: protección CSRF activa (cabecera de origen no proporcionada)');
  }

  try {
    const originUrl = new URL(originHeader);
    const originHost = originUrl.host.toLowerCase();
    const originHostname = originUrl.hostname.toLowerCase();

    const rawReqHost = (req.headers.host as string) || '';
    const rawForwardedHost = (req.headers['x-forwarded-host'] as string) || '';

    const allowedHosts = new Set<string>();
    if (rawReqHost) {
      allowedHosts.add(rawReqHost.toLowerCase());
      allowedHosts.add(rawReqHost.split(':')[0].toLowerCase());
    }
    if (rawForwardedHost) {
      const fHosts = rawForwardedHost.split(',').map(h => h.trim().toLowerCase());
      for (const fh of fHosts) {
        allowedHosts.add(fh);
        allowedHosts.add(fh.split(':')[0]);
      }
    }
    if (req.hostname) {
      allowedHosts.add(req.hostname.toLowerCase());
    }
    allowedHosts.add('localhost');
    allowedHosts.add('127.0.0.1');

    const isAllowed = allowedHosts.has(originHost) || allowedHosts.has(originHostname);

    if (!isAllowed) {
      console.warn(`[CSRF] Rejected ${req.method} ${req.path}: Origin '${originHeader}' (host: ${originHost}) not in allowed set [${Array.from(allowedHosts).join(', ')}]`);
      if (req.xhr || req.path.startsWith('/api/') || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(403).json({ error: 'Acceso denegado: origen no permitido (protección CSRF)' });
      }
      return res.status(403).send('Acceso denegado: origen no permitido');
    }
  } catch (err) {
    console.warn(`[CSRF] Invalid origin URL '${originHeader}':`, err);
    return res.status(403).send('Acceso denegado: origen inválido');
  }

  next();
}

export function signToken(data: { userId: number; email: string }): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyToken(token: string): { userId: number; email: string } | null {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expectedSignature = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
    if (signature !== expectedSignature) return null;
    const jsonStr = Buffer.from(payload, 'base64url').toString('utf-8');
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

export function createSessionCookie(token: string, maxAgeSeconds: number = 2592000): string {
  return `workshop_session=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAgeSeconds}`;
}

export function createClearSessionCookie(): string {
  return `workshop_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

export interface AuthenticatedRequest extends Request {
  user?: { id: number; email: string; must_change_password?: boolean };
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;

  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const name = parts.shift()?.trim();
    if (name) {
      list[name] = decodeURIComponent(parts.join('='));
    }
  });

  return list;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const path = req.path;

  // Exempt public paths
  if (
    path === '/health' ||
    path === '/login' ||
    path === '/register' ||
    path.startsWith('/static') ||
    path === '/manifest.json' ||
    path === '/sw.js'
  ) {
    return next();
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.workshop_session ||
    (typeof req.query.token === 'string' ? req.query.token : undefined) ||
    (typeof req.query.session === 'string' ? req.query.session : undefined) ||
    (req.headers['x-session-token'] as string);

  if (token) {
    const session = verifyToken(token);
    if (session) {
      const user = store.getUserById(session.userId);
      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          must_change_password: Boolean(user.must_change_password)
        };
        res.locals.user = req.user;

        // Requirement 1: Enforce password change if must_change_password is true
        if (req.user.must_change_password) {
          const allowedPasswordChangePaths = [
            '/api/user/change-password',
            '/change-password',
            '/logout'
          ];
          if (!allowedPasswordChangePaths.includes(path)) {
            if (req.xhr || path.startsWith('/api/') || (req.headers.accept && req.headers.accept.includes('json'))) {
              return res.status(403).json({
                error: 'Acceso denegado: debe cambiar la contraseña por defecto antes de continuar',
                must_change_password: true
              });
            }
            return res.status(403).send(`
              <html>
                <body style="font-family:sans-serif; text-align:center; padding:50px;">
                  <h2>⚠️ Cambio de Contraseña Requerido</h2>
                  <p>Por razones de seguridad, debe cambiar la contraseña por defecto del usuario administrador antes de acceder al sistema.</p>
                  <a href="/logout" style="color:red; font-weight:bold;">Cerrar Sesión</a>
                </body>
              </html>
            `);
          }
        }

        return next();
      }
    }
  }

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  res.redirect(303, '/login');
}
