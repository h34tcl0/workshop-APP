import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { store } from './db.js';

const SESSION_SECRET = process.env.SESSION_SECRET || 'workshop-os-secure-session-key-2026';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    if (!storedHash || !storedHash.includes(':')) return false;
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) return false;
    const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    const hashBuf = Buffer.from(hash, 'hex');
    const verifyBuf = Buffer.from(verifyHash, 'hex');
    if (hashBuf.length !== verifyBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, verifyBuf);
  } catch (err) {
    console.error('[AUTH] verifyPassword error:', err);
    return false;
  }
}

export function signToken(data: { userId: number; email: string }): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyToken(token: string): { userId: number; email: string } | null {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expectedSignature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
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
  user?: { id: number; email: string };
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
        req.user = { id: user.id, email: user.email };
        res.locals.user = req.user;
        return next();
      }
    }
  }

  // Exempt public paths
  const path = req.path;
  if (
    path === '/login' ||
    path === '/register' ||
    path.startsWith('/static') ||
    path === '/manifest.json' ||
    path === '/sw.js'
  ) {
    return next();
  }

  if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  res.redirect(303, '/login');
}
