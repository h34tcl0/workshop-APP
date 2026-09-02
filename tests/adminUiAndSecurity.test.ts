import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { initDatabase, closeDatabase, store } from '../src/db.js';
import { requireAuth, hashPassword, signToken } from '../src/auth.js';
import adminRoutes from '../src/routes/adminRoutes.js';
import authRoutes from '../src/routes/authRoutes.js';
import { notFoundHandler } from '../src/middleware/notFound.js';
import { verifyStepUpPassword } from '../src/services/adminSecurityService.js';

describe('Hito 3: Dashboard UI, Step-up Auth & Security', () => {
  let app: express.Express;
  const testDataDir = path.join(process.cwd(), 'data_test_admin_ui');

  beforeEach(() => {
    process.env.DATA_DIR = testDataDir;
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(testDataDir, 'models'), { recursive: true });

    initDatabase(':memory:');

    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Setup EJS views
    app.set('view engine', 'ejs');
    app.set('views', path.join(process.cwd(), 'views'));

    app.use(authRoutes);
    app.use(requireAuth);
    app.use(adminRoutes);
    app.use(notFoundHandler);
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('1. Step-up Auth Unit Service', () => {
    it('verifies valid password against admin hash correctly', () => {
      const admin = store.createUser('stepup_admin@test.com', hashPassword('Secret123!'), 'admin');

      expect(verifyStepUpPassword(admin.id, 'Secret123!')).toBe(true);
      expect(verifyStepUpPassword(admin.id, 'WrongPassword')).toBe(false);
      expect(verifyStepUpPassword(admin.id, '')).toBe(false);
      expect(verifyStepUpPassword(admin.id, undefined)).toBe(false);
    });
  });

  describe('2. Admin View Rendering (GET /admin)', () => {
    it('renders GET /admin dashboard with 200 OK for admin role', async () => {
      const admin = store.createUser('admin_view@test.com', hashPassword('AdminPass123!'), 'admin');
      const token = signToken({ userId: admin.id, email: admin.email });

      const res = await request(app)
        .get('/admin')
        .set('Cookie', [`workshop_session=${token}`]);

      expect(res.status).toBe(200);
      expect(res.text).toContain('Panel de Administración');
      expect(res.text).toContain('Gestión de Usuarios');
      expect(res.text).toContain('Cuotas & Límites');
      expect(res.text).toContain('Sistema');
      expect(res.text).toContain('Auditoría');
    });

    it('returns 404 Not Found (Stealth) for standard user or unauthenticated request', async () => {
      const user = store.createUser('standard@test.com', hashPassword('UserPass123!'), 'user');
      const token = signToken({ userId: user.id, email: user.email });

      const resUser = await request(app)
        .get('/admin')
        .set('Cookie', [`workshop_session=${token}`]);
      expect(resUser.status).toBe(404);

      const resAnon = await request(app).get('/admin');
      expect([302, 303]).toContain(resAnon.status); // requireAuth redirects to /login for anon
      expect(resAnon.header.location).toBe('/login');
    });
  });

  describe('3. Step-up Auth on Sensitive Actions', () => {
    it('rejects promote/demote/softDelete without sudo_password or with incorrect password (401)', async () => {
      const admin = store.createUser('super_admin@test.com', hashPassword('AdminSudo123!'), 'admin');
      const targetUser = store.createUser('target@test.com', hashPassword('User123!'), 'user');
      const token = signToken({ userId: admin.id, email: admin.email });

      // 1. Promote without sudo_password
      const resPromoteNoPwd = await request(app)
        .post(`/admin/api/users/${targetUser.id}/promote`)
        .set('Cookie', [`workshop_session=${token}`])
        .send({});
      expect(resPromoteNoPwd.status).toBe(401);
      expect(resPromoteNoPwd.body.step_up_required).toBe(true);

      // 2. Promote with WRONG sudo_password
      const resPromoteWrongPwd = await request(app)
        .post(`/admin/api/users/${targetUser.id}/promote`)
        .set('Cookie', [`workshop_session=${token}`])
        .send({ sudo_password: 'WrongPassword999!' });
      expect(resPromoteWrongPwd.status).toBe(401);

      // 3. Promote with CORRECT sudo_password -> 200 OK
      const resPromoteOk = await request(app)
        .post(`/admin/api/users/${targetUser.id}/promote`)
        .set('Cookie', [`workshop_session=${token}`])
        .send({ sudo_password: 'AdminSudo123!' });
      expect(resPromoteOk.status).toBe(200);
      expect(store.getUserById(targetUser.id)?.role).toBe('admin');

      // 4. Demote with CORRECT sudo_password -> 200 OK
      const resDemoteOk = await request(app)
        .post(`/admin/api/users/${targetUser.id}/demote`)
        .set('Cookie', [`workshop_session=${token}`])
        .send({ sudo_password: 'AdminSudo123!' });
      expect(resDemoteOk.status).toBe(200);
      expect(store.getUserById(targetUser.id)?.role).toBe('user');

      // 5. Soft-Delete with CORRECT sudo_password -> 200 OK
      const resSoftDeleteOk = await request(app)
        .delete(`/admin/api/users/${targetUser.id}`)
        .set('Cookie', [`workshop_session=${token}`])
        .send({ sudo_password: 'AdminSudo123!' });
      expect(resSoftDeleteOk.status).toBe(200);
      expect(store.getUserById(targetUser.id)?.status).toBe('revoked');
    });
  });
});
