import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { store, initDatabase } from '../src/db.js';
import { signToken } from '../src/auth.js';
import { TaskStatus, TaskCategory } from '../src/types.js';

describe('Activate Task To Backlog Flow (Bug Fix Verification)', () => {
  let user: any;
  let token: string;

  beforeEach(async () => {
    await initDatabase();
    const email = `backlog_user_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com`;
    user = store.createUser(email, 'Password123!');
    token = signToken({ userId: user.id, email: user.email });
  });

  it('moves a completed task back to pending backlog, changing status and showing in getPendingTasks', async () => {
    // 1. Create a project
    const project = store.addProject(user.id, 'Reparación de Muebles', 'Proyecto de prueba');

    // 2. Add a task and mark it as completed
    const task = store.addTask(user.id, {
      project_id: project.id,
      title: 'Reparación de puertas',
      description: 'Ajuste de bisagras y cepillado',
      category: TaskCategory.CARPENTRY,
      estimated_hours: 2.0,
      curing_hours: 0.0,
      order: 1
    });

    // Mark as completed
    store.updateTask(user.id, task.id, {
      status: TaskStatus.COMPLETED,
      progress_percentage: 100,
      completed_at: new Date().toISOString()
    });

    // Verify task is initially NOT in pending tasks
    const pendingBefore = store.getPendingTasks(user.id);
    expect(pendingBefore.map(t => t.id)).not.toContain(task.id);

    // Verify database state before activation
    const taskBefore = store.getTask(user.id, task.id);
    expect(taskBefore?.status).toBe(TaskStatus.COMPLETED);
    expect(taskBefore?.completed_at).not.toBeNull();

    // 3. Call POST /tasks/:id/activate-to-backlog
    const res = await request(app)
      .post(`/tasks/${task.id}/activate-to-backlog`)
      .set('Origin', 'http://127.0.0.1')
      .set('Cookie', `workshop_session=${token}`)
      .set('Accept', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("Tarea 'Reparación de puertas' agregada al backlog activo");
    expect(res.body.task).toBeDefined();
    expect(res.body.task.status).toBe(TaskStatus.PENDING);
    expect(res.body.task.is_active).toBe(true);

    // 4. Verify in DB that status is now pending and completed_at is null
    const taskAfter = store.getTask(user.id, task.id);
    expect(taskAfter).not.toBeNull();
    expect(taskAfter?.status).toBe(TaskStatus.PENDING);
    expect(taskAfter?.progress_percentage).toBe(0);
    expect(taskAfter?.completed_at).toBeNull();
    expect(taskAfter?.is_active).toBe(true);

    // 5. Verify that task now appears in getPendingTasks(user.id)
    const pendingAfter = store.getPendingTasks(user.id);
    expect(pendingAfter.map(t => t.id)).toContain(task.id);
    expect(pendingAfter.find(t => t.id === task.id)?.title).toBe('Reparación de puertas');
  });

  it('activates a paused project when moving one of its tasks to the backlog', async () => {
    // 1. Create a project and pause it
    const project = store.addProject(user.id, 'Proyecto Pausado', 'Proyecto inactivo');
    store.toggleProjectActive(user.id, project.id, false);

    // Verify project is inactive
    const projBefore = store.getProjectById(user.id, project.id);
    expect(projBefore?.is_active).toBe(false);

    // 2. Add an inactive completed task to this paused project
    const task = store.addTask(user.id, {
      project_id: project.id,
      title: 'Lijado de estructura',
      category: TaskCategory.CARPENTRY,
      estimated_hours: 1.5,
      order: 1
    });

    store.updateTask(user.id, task.id, {
      status: TaskStatus.COMPLETED,
      is_active: false
    });

    // 3. Call POST /tasks/:id/activate-to-backlog
    const res = await request(app)
      .post(`/tasks/${task.id}/activate-to-backlog`)
      .set('Origin', 'http://127.0.0.1')
      .set('Cookie', `workshop_session=${token}`)
      .set('Accept', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // 4. Verify both task and project are now active and task is pending
    const projAfter = store.getProjectById(user.id, project.id);
    expect(projAfter?.is_active).toBe(true);

    const taskAfter = store.getTask(user.id, task.id);
    expect(taskAfter?.status).toBe(TaskStatus.PENDING);
    expect(taskAfter?.is_active).toBe(true);

    const pendingTasks = store.getPendingTasks(user.id);
    expect(pendingTasks.map(t => t.id)).toContain(task.id);
  });
});
