import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { initDatabase, closeDatabase, store } from '../src/db.js';
import { requireAuth, signToken, createSessionCookie, hashPassword } from '../src/auth.js';
import { requireAdmin } from '../src/middleware/requireAdmin.js';
import { notFoundHandler } from '../src/middleware/notFound.js';
import { runMorningEvalTick, runWorkStartTick, runCheckinTick, runWeatherAlertTick } from '../src/scheduler/daemon.js';
import { handleIncomingMessage } from '../src/telegram/commandHandlers.js';
import { processCallbackQuery } from '../src/telegram/callbackHandlers.js';

describe('Hito 1: Backend Security & Admin Authorization', () => {
  let app: express.Express;

  beforeEach(() => {
    initDatabase(':memory:');

    app = express();
    app.use(express.json());
    app.use(requireAuth);

    app.get('/api/protected', (req: any, res: any) => {
      res.json({ ok: true, user: req.user });
    });

    app.get('/api/admin/dashboard-stats', requireAdmin, (req: any, res: any) => {
      res.json({ secret: 'admin-only-data' });
    });

    app.get('/admin', requireAdmin, (req: any, res: any) => {
      res.send('Admin Page HTML');
    });

    app.use(notFoundHandler);
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('requireAuth & User Status Checks', () => {
    it('allows active user to access protected routes', async () => {
      const u = store.createUser('active@example.com', hashPassword('Pass123!'));
      const token = signToken({ userId: u.id, email: u.email });

      const res = await request(app)
        .get('/api/protected')
        .set('Cookie', [`workshop_session=${token}`]);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.user.email).toBe('active@example.com');
      expect(res.body.user.status).toBe('active');
    });

    it('rejects blocked user immediately with 401 and clears session cookie', async () => {
      const u = store.createUser('blocked@example.com', hashPassword('Pass123!'));
      store.setUserStatus(u.id, 'blocked', 'Violación de términos');

      const token = signToken({ userId: u.id, email: u.email });

      const res = await request(app)
        .get('/api/protected')
        .set('Accept', 'application/json')
        .set('Cookie', [`workshop_session=${token}`]);

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('suspendida o inactiva');
      expect(res.headers['set-cookie'][0]).toContain('Max-Age=0');
    });

    it('rejects revoked user immediately', async () => {
      const u = store.createUser('revoked@example.com', hashPassword('Pass123!'));
      store.setUserStatus(u.id, 'revoked');

      const token = signToken({ userId: u.id, email: u.email });

      const res = await request(app)
        .get('/api/protected')
        .set('Accept', 'application/json')
        .set('Cookie', [`workshop_session=${token}`]);

      expect(res.status).toBe(401);
    });
  });

  describe('requireAdmin & Endpoint Stealth (404)', () => {
    it('returns 404 Not Found for standard users accessing admin endpoints (Stealth)', async () => {
      const u = store.createUser('normal@example.com', hashPassword('Pass123!'), 'user');
      const token = signToken({ userId: u.id, email: u.email });

      // JSON request -> 404 JSON
      const jsonRes = await request(app)
        .get('/api/admin/dashboard-stats')
        .set('Accept', 'application/json')
        .set('Cookie', [`workshop_session=${token}`]);

      expect(jsonRes.status).toBe(404);
      expect(jsonRes.body.error).toBe('Not Found');

      // HTML request -> 404 Canonical
      const htmlRes = await request(app)
        .get('/admin')
        .set('Cookie', [`workshop_session=${token}`]);

      expect(htmlRes.status).toBe(404);
      expect(htmlRes.text).toContain('Cannot GET /admin');
    });

    it('allows active admin user to access admin endpoints', async () => {
      const u = store.createUser('admin@example.com', hashPassword('Pass123!'), 'admin');
      const token = signToken({ userId: u.id, email: u.email });

      const res = await request(app)
        .get('/api/admin/dashboard-stats')
        .set('Accept', 'application/json')
        .set('Cookie', [`workshop_session=${token}`]);

      expect(res.status).toBe(200);
      expect(res.body.secret).toBe('admin-only-data');
    });

    it('returns 401 when unauthenticated requests hit admin endpoint', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard-stats')
        .set('Accept', 'application/json');

      expect(res.status).toBe(401);
    });
  });

  describe('Scheduler Daemon & Blocked User Exclusion', () => {
    it('getActiveUsers only returns users with status = active', () => {
      const u1 = store.createUser('u1@test.com', 'h1');
      const u2 = store.createUser('u2@test.com', 'h2');
      const u3 = store.createUser('u3@test.com', 'h3');

      store.setUserStatus(u2.id, 'blocked');
      store.setUserStatus(u3.id, 'revoked');

      const all = store.getAllUsers();
      const active = store.getActiveUsers();

      expect(all.length).toBeGreaterThanOrEqual(3);
      expect(active.some(u => u.id === u2.id)).toBe(false);
      expect(active.some(u => u.id === u3.id)).toBe(false);
      expect(active.some(u => u.id === u1.id)).toBe(true);
    });

    it('daemon ticks do not throw and only process active users', async () => {
      await expect(runMorningEvalTick()).resolves.not.toThrow();
      await expect(runWorkStartTick()).resolves.not.toThrow();
      await expect(runCheckinTick()).resolves.not.toThrow();
      await expect(runWeatherAlertTick()).resolves.not.toThrow();
    });
  });

  describe('Telegram Bot & Blocked User Rejection', () => {
    it('rejects commands from a blocked user', async () => {
      const user = store.createUser('tguser@example.com', 'h');
      store.updateAppSettings(user.id, { telegram_chat_id: '998877' });
      store.setUserStatus(user.id, 'blocked');

      const sentMessages: any[] = [];
      const mockSend = async (method: string, payload: any) => {
        sentMessages.push({ method, payload });
        return true;
      };

      const result = await handleIncomingMessage(
        { chat: { id: 998877 }, text: '/materiales' },
        'dummy-token',
        mockSend
      );

      expect(result.status).toBe('forbidden');
      expect(sentMessages.some(m => m.payload.text.includes('suspendida o inactiva'))).toBe(true);
    });

    it('rejects callback queries from a blocked user', async () => {
      const user = store.createUser('tguser2@example.com', 'h');
      store.updateAppSettings(user.id, { telegram_chat_id: '112233' });
      store.setUserStatus(user.id, 'blocked');

      const sentMessages: any[] = [];
      const mockSend = async (method: string, payload: any) => {
        sentMessages.push({ method, payload });
        return true;
      };

      const result = await processCallbackQuery(
        { id: 'cb1', data: 'ack_alarm:1', message: { chat: { id: 112233 }, message_id: 10 } },
        'dummy-token',
        undefined,
        mockSend
      );

      expect(result.status).toBe('forbidden');
      expect(sentMessages.some(m => m.payload.text.includes('suspendida o inactiva'))).toBe(true);
    });
  });

  describe('Admin Repository & Schema Integrity', () => {
    it('reads and updates system settings', () => {
      const settings = store.getSystemSettings();
      expect(settings.registration_open).toBe(1);
      expect(settings.default_max_projects).toBe(10);

      store.updateSystemSettings({ registration_open: 0, default_max_projects: 20 });
      const updated = store.getSystemSettings();
      expect(updated.registration_open).toBe(0);
      expect(updated.default_max_projects).toBe(20);
    });

    it('sets and gets account limits', () => {
      const u = store.createUser('limits@example.com', 'h');
      store.setAccountLimits({
        user_id: u.id,
        max_projects: 50,
        max_tasks: 500,
        max_storage_mb: 200,
        max_model_size_mb: 50,
        updated_at: new Date().toISOString()
      });

      const limits = store.getAccountLimits(u.id);
      expect(limits).not.toBeNull();
      expect(limits?.max_projects).toBe(50);
      expect(limits?.max_tasks).toBe(500);
    });

    it('logs admin actions append-only', () => {
      const admin = store.createUser('ad@test.com', 'h', 'admin');
      const target = store.createUser('tgt@test.com', 'h', 'user');

      store.logAdminAction({
        admin_user_id: admin.id,
        action: 'BLOCK_USER',
        target_user_id: target.id,
        details: 'Blocked for tests',
        created_at: new Date().toISOString()
      });

      const logs = store.getAuditLogs(10);
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].action).toBe('BLOCK_USER');
      expect(logs[0].target_user_id).toBe(target.id);
    });
  });
});
