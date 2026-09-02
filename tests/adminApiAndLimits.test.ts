import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { initDatabase, closeDatabase, store } from '../src/db.js';
import { requireAuth, signToken, hashPassword } from '../src/auth.js';
import {
  assertCanCreateProject,
  assertCanCreateTask,
  assertCanUploadModel,
  getStorageUsageMb,
  getUserEffectiveLimits,
  QuotaExceededError
} from '../src/services/limitsService.js';
import adminRoutes from '../src/routes/adminRoutes.js';
import authRoutes from '../src/routes/authRoutes.js';
import projectRoutes from '../src/routes/projectRoutes.js';
import { notFoundHandler } from '../src/middleware/notFound.js';

describe('Hito 2: Límites, Cuotas & APIs Administrativas', () => {
  let app: express.Express;
  const testDataDir = path.join(process.cwd(), 'data_test_admin');

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

    // Public
    app.use(authRoutes);

    // Protected
    app.use(requireAuth);
    app.use(projectRoutes);
    app.use(adminRoutes);
    app.use(notFoundHandler);
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('1. Limits Service Unit Tests', () => {
    it('calculates effective limits correctly with system defaults and custom overrides', () => {
      const u = store.createUser('user1@test.com', 'h');
      const eff1 = getUserEffectiveLimits(u.id);
      expect(eff1.max_projects).toBe(10);
      expect(eff1.max_tasks).toBe(200);

      // Set custom override
      store.setAccountLimits({
        user_id: u.id,
        max_projects: 3,
        max_tasks: 5,
        max_storage_mb: 20,
        max_model_size_mb: 10,
        updated_at: new Date().toISOString()
      });

      const eff2 = getUserEffectiveLimits(u.id);
      expect(eff2.max_projects).toBe(3);
      expect(eff2.max_tasks).toBe(5);
    });

    it('assertCanCreateProject throws QuotaExceededError when limit reached', () => {
      const u = store.createUser('user2@test.com', 'h');
      store.setAccountLimits({
        user_id: u.id,
        max_projects: 1,
        max_tasks: 10,
        max_storage_mb: 50,
        max_model_size_mb: 10,
        updated_at: new Date().toISOString()
      });

      // 0 projects -> OK
      expect(() => assertCanCreateProject(u.id)).not.toThrow();

      // Add 1 project
      store.addProject(u.id, 'Project 1');

      // 1 project >= max_projects (1) -> Error
      expect(() => assertCanCreateProject(u.id)).toThrow(QuotaExceededError);
    });

    it('assertCanCreateTask throws QuotaExceededError when task limit reached', () => {
      const u = store.createUser('user3@test.com', 'h');
      store.setAccountLimits({
        user_id: u.id,
        max_projects: 10,
        max_tasks: 2,
        max_storage_mb: 50,
        max_model_size_mb: 10,
        updated_at: new Date().toISOString()
      });

      expect(() => assertCanCreateTask(u.id)).not.toThrow();
      store.addTask(u.id, { title: 'T1' });
      store.addTask(u.id, { title: 'T2' });

      expect(() => assertCanCreateTask(u.id)).toThrow(QuotaExceededError);
    });

    it('assertCanUploadModel checks model size and total storage accurately', () => {
      const u = store.createUser('user4@test.com', 'h');
      store.setAccountLimits({
        user_id: u.id,
        max_projects: 10,
        max_tasks: 10,
        max_storage_mb: 10, // 10 MB total
        max_model_size_mb: 5,  // 5 MB per model
        updated_at: new Date().toISOString()
      });

      // 4 MB -> OK
      expect(() => assertCanUploadModel(u.id, 4 * 1024 * 1024)).not.toThrow();

      // 6 MB -> exceeds max_model_size_mb (5 MB)
      expect(() => assertCanUploadModel(u.id, 6 * 1024 * 1024)).toThrow(QuotaExceededError);

      // Create a 7 MB file on disk
      const modelsDir = path.join(testDataDir, 'models');
      fs.writeFileSync(path.join(modelsDir, `user_${u.id}_latest.glb`), Buffer.alloc(7 * 1024 * 1024));

      expect(getStorageUsageMb(u.id)).toBe(7);

      // Uploading 4 MB now would total 11 MB > 10 MB max storage
      expect(() => assertCanUploadModel(u.id, 4 * 1024 * 1024)).toThrow(QuotaExceededError);
    });
  });

  describe('2. Endpoint Enforcement & Registration Control', () => {
    it('POST /projects/add returns 403 when project limit is reached', async () => {
      const u = store.createUser('projlimit@test.com', hashPassword('Pass123!'));
      store.setAccountLimits({
        user_id: u.id,
        max_projects: 1,
        max_tasks: 10,
        max_storage_mb: 50,
        max_model_size_mb: 10,
        updated_at: new Date().toISOString()
      });
      store.addProject(u.id, 'Existing Proj');

      const token = signToken({ userId: u.id, email: u.email });

      const res = await request(app)
        .post('/projects/add')
        .set('Cookie', [`workshop_session=${token}`])
        .set('Accept', 'application/json')
        .send({ name: 'Exceeding Proj' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('límite máximo');
    });

    it('POST /register rejects new registrations when registration_open is 0', async () => {
      store.updateSystemSettings({ registration_open: 0 });

      const res = await request(app)
        .post('/register')
        .set('Accept', 'application/json')
        .send({
          email: 'newuser@test.com',
          password: 'Password123!',
          password_confirm: 'Password123!'
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('temporalmente deshabilitado');
    });
  });

  describe('3. Admin User Management APIs', () => {
    it('GET /admin/api/users lists users with project/task counts and storage stats', async () => {
      const admin = store.createUser('admin@test.com', hashPassword('Pass123!'), 'admin');
      const u1 = store.createUser('normal@test.com', hashPassword('Pass123!'), 'user');
      store.addProject(u1.id, 'P1');
      store.addTask(u1.id, { title: 'T1' });

      const token = signToken({ userId: admin.id, email: admin.email });

      const res = await request(app)
        .get('/admin/api/users')
        .set('Cookie', [`workshop_session=${token}`]);

      expect(res.status).toBe(200);
      expect(res.body.users.length).toBeGreaterThanOrEqual(2);

      const target = res.body.users.find((u: any) => u.id === u1.id);
      expect(target).toBeDefined();
      expect(target.projects_count).toBe(1);
      expect(target.tasks_count).toBe(1);
      expect(target.effective_limits).toBeDefined();
    });

    it('POST /admin/api/users/:id/block and unblock updates user and writes audit log', async () => {
      const admin = store.createUser('admin@test.com', hashPassword('Pass123!'), 'admin');
      const target = store.createUser('target@test.com', hashPassword('Pass123!'), 'user');
      const token = signToken({ userId: admin.id, email: admin.email });

      // Block
      const blockRes = await request(app)
        .post(`/admin/api/users/${target.id}/block`)
        .set('Cookie', [`workshop_session=${token}`])
        .send({ reason: 'Spam activity' });

      expect(blockRes.status).toBe(200);
      const blockedUser = store.getUserById(target.id);
      expect(blockedUser?.status).toBe('blocked');
      expect(blockedUser?.blocked_reason).toBe('Spam activity');

      // Unblock
      const unblockRes = await request(app)
        .post(`/admin/api/users/${target.id}/unblock`)
        .set('Cookie', [`workshop_session=${token}`]);

      expect(unblockRes.status).toBe(200);
      const activeUser = store.getUserById(target.id);
      expect(activeUser?.status).toBe('active');
    });

    it('POST /admin/api/users/:id/demote applies Anti-Lockout when targeting sole admin', async () => {
      // Demote seeded admin first
      const allAdmins = store.getAllUsers().filter(u => u.role === 'admin');
      for (const a of allAdmins) {
        store.setUserRole(a.id, 'user');
      }

      // Create a single custom admin
      const soleAdmin = store.createUser('customadmin@test.com', hashPassword('CustomPass123!'), 'admin');
      const token = signToken({ userId: soleAdmin.id, email: soleAdmin.email });

      const res = await request(app)
        .post(`/admin/api/users/${soleAdmin.id}/demote`)
        .set('Cookie', [`workshop_session=${token}`])
        .send({ sudo_password: 'CustomPass123!' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('único administrador activo');
    });

    it('DELETE /admin/api/users/:id soft-deletes and archives 3D models', async () => {
      const admin = store.createUser('admin@test.com', hashPassword('Pass123!'), 'admin');
      const target = store.createUser('to_delete@test.com', hashPassword('Pass123!'), 'user');
      const token = signToken({ userId: admin.id, email: admin.email });

      // Create a test 3D model for target
      const modelsDir = path.join(testDataDir, 'models');
      const modelFile = path.join(modelsDir, `user_${target.id}_latest.glb`);
      fs.writeFileSync(modelFile, 'GLB_TEST_CONTENT');

      const res = await request(app)
        .delete(`/admin/api/users/${target.id}`)
        .set('Cookie', [`workshop_session=${token}`])
        .send({ sudo_password: 'Pass123!' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const revokedUser = store.getUserById(target.id);
      expect(revokedUser?.status).toBe('revoked');

      // Model in active dir should no longer exist
      expect(fs.existsSync(modelFile)).toBe(false);

      // Model in _archived should exist
      const archiveDir = path.join(modelsDir, '_archived');
      expect(fs.existsSync(archiveDir)).toBe(true);
      const archivedFiles = fs.readdirSync(archiveDir);
      expect(archivedFiles.some(f => f.includes(`user_${target.id}_latest.glb`))).toBe(true);
    });
  });

  describe('4. Admin Limits & System Settings APIs', () => {
    it('PUT /admin/api/users/:id/limits updates limits and rejects exceeding absolute limit', async () => {
      const admin = store.createUser('admin@test.com', hashPassword('Pass123!'), 'admin');
      const target = store.createUser('limits_target@test.com', hashPassword('Pass123!'), 'user');
      const token = signToken({ userId: admin.id, email: admin.email });

      // Valid update
      const validRes = await request(app)
        .put(`/admin/api/users/${target.id}/limits`)
        .set('Cookie', [`workshop_session=${token}`])
        .send({
          max_projects: 30,
          max_tasks: 300,
          max_storage_mb: 150,
          max_model_size_mb: 40
        });

      expect(validRes.status).toBe(200);
      expect(validRes.body.effective_limits.max_projects).toBe(30);

      // Invalid: exceeds absolute max model size (100 MB default)
      const invalidRes = await request(app)
        .put(`/admin/api/users/${target.id}/limits`)
        .set('Cookie', [`workshop_session=${token}`])
        .send({
          max_model_size_mb: 150
        });

      expect(invalidRes.status).toBe(400);
      expect(invalidRes.body.error).toContain('límite absoluto');
    });

    it('GET and PUT /admin/api/system-settings updates global platform configs', async () => {
      const admin = store.createUser('admin@test.com', hashPassword('Pass123!'), 'admin');
      const token = signToken({ userId: admin.id, email: admin.email });

      const putRes = await request(app)
        .put('/admin/api/system-settings')
        .set('Cookie', [`workshop_session=${token}`])
        .send({
          default_max_projects: 15,
          default_max_tasks: 350
        });

      expect(putRes.status).toBe(200);
      expect(putRes.body.settings.default_max_projects).toBe(15);
      expect(putRes.body.settings.default_max_tasks).toBe(350);

      const getRes = await request(app)
        .get('/admin/api/system-settings')
        .set('Cookie', [`workshop_session=${token}`]);

      expect(getRes.status).toBe(200);
      expect(getRes.body.settings.default_max_projects).toBe(15);
    });

    it('GET /admin/api/audit-log retrieves audit history with filters', async () => {
      const admin = store.createUser('admin@test.com', hashPassword('Pass123!'), 'admin');
      const token = signToken({ userId: admin.id, email: admin.email });

      const res = await request(app)
        .get('/admin/api/audit-log?limit=10')
        .set('Cookie', [`workshop_session=${token}`]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.logs)).toBe(true);
    });
  });
});
