import express from 'express';
import path from 'path';
import { initDatabase, closeDatabase } from './src/db.js';
import { startDaemon, stopDaemon } from './src/scheduler.js';
import { requireAuth, verifySameOrigin } from './src/auth.js';
import publicRoutes from './src/routes/publicRoutes.js';
import authRoutes from './src/routes/authRoutes.js';
import projectRoutes from './src/routes/projectRoutes.js';
import taskRoutes from './src/routes/taskRoutes.js';
import inventoryRoutes from './src/routes/inventoryRoutes.js';
import agendaRoutes from './src/routes/agendaRoutes.js';
import settingsRoutes from './src/routes/settingsRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';
import { notFoundHandler } from './src/middleware/notFound.js';

const app = express();
const PORT = 3000;

// Setup View Engine & Global Middlewares
app.set('views', path.join(process.cwd(), 'views'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(verifySameOrigin);
app.use('/static', express.static(path.join(process.cwd(), 'static')));

// Public & Authentication Routes (no auth required)
app.use(publicRoutes);
app.use(authRoutes);

// Protected Routes (require authenticated session)
app.use(requireAuth);
app.use(projectRoutes);
app.use(taskRoutes);
app.use(inventoryRoutes);
app.use(agendaRoutes);
app.use(settingsRoutes);
app.use(adminRoutes);

// Catch-all 404 handler
app.use(notFoundHandler);

// Process Error Handlers & Graceful Shutdown
let serverInstance: any = null;

function gracefulShutdown(signal: string) {
  console.log(`\n[SHUTDOWN] Received ${signal}. Shutting down gracefully...`);
  stopDaemon();
  if (serverInstance) {
    serverInstance.close(() => {
      console.log('[SHUTDOWN] HTTP server closed.');
      closeDatabase();
      process.exit(0);
    });
    setTimeout(() => {
      closeDatabase();
      process.exit(1);
    }, 5000);
  } else {
    closeDatabase();
    process.exit(0);
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  process.on('uncaughtException', (err) => {
    console.error('[FATAL UNCAUGHT EXCEPTION]', err);
    try { stopDaemon(); closeDatabase(); } catch {}
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => console.error('[UNHANDLED REJECTION]', reason));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  try {
    initDatabase();
    console.log('SQLite Database initialized successfully.');
    startDaemon();
    serverInstance = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Workshop OS server listening on http://0.0.0.0:${PORT}`);
    });

    serverInstance.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.warn('[SERVER] Puerto 3000 en uso (EADDRINUSE). Esperando 1.5s para reintentar vinculación...');
        setTimeout(() => {
          serverInstance.close();
          serverInstance.listen(PORT, '0.0.0.0', () => {
            console.log(`[SERVER] Workshop OS conectado exitosamente en http://0.0.0.0:${PORT}`);
          });
        }, 1500);
      } else {
        console.error('[SERVER ERROR]', err);
      }
    });
  } catch (err) {
    console.error('Failed to initialize SQLite Database:', err);
    process.exit(1);
  }
}

export { app };
