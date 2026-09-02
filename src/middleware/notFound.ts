import { Request, Response, NextFunction } from 'express';

export function notFoundHandler(req: Request, res: Response) {
  if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not Found' });
  }

  // Canonical 404 response
  res.status(404).send(`Cannot ${req.method} ${req.path}`);
}
