import { Request, Response, NextFunction } from 'express';

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
      console.warn(`[CSRF] Rejected ${req.method} ${req.path}: Origin '${originHeader}' not allowed`);
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
