import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth.js';
import { store } from '../db.js';
import { notFoundHandler } from './notFound.js';

/**
 * Middleware requireAdmin:
 * 1. Checks if user is authenticated. If not -> redirects to /login (or 401 for JSON).
 * 2. Queries the database directly to verify fresh role and status (never trusts cookie alone).
 * 3. If user is NOT an active admin -> responds with the exact same 404 handler (stealth).
 */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    return res.redirect(303, '/login');
  }

  const freshUser = store.getUserById(req.user.id);
  if (!freshUser || freshUser.status !== 'active' || freshUser.role !== 'admin') {
    // Stealth: delegate directly to the canonical 404 handler
    return notFoundHandler(req, res);
  }

  next();
}
