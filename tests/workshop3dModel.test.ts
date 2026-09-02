import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { store, initDatabase } from '../src/db.js';
import { signToken } from '../src/auth.js';
import fs from 'fs';
import path from 'path';

describe('Workshop 3D Model API & Persistence', () => {
  let user: any;
  let token: string;

  beforeEach(async () => {
    await initDatabase();
    const email = `v3d_user_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com`;
    user = store.createUser(email, 'Password123!');
    token = signToken({ userId: user.id, email: user.email });

    // Limpiar modelos previos del usuario de prueba
    const modelsDir = path.join(process.cwd(), 'data', 'models');
    if (fs.existsSync(modelsDir)) {
      const files = fs.readdirSync(modelsDir);
      for (const f of files) {
        if (f.startsWith(`user_${user.id}_`)) {
          try { fs.unlinkSync(path.join(modelsDir, f)); } catch (_) {}
        }
      }
    }
  });

  it('retorna hasModel: false cuando el usuario no tiene modelo subido', async () => {
    const res = await request(app)
      .get('/api/workshop/model3d/status')
      .set('Cookie', `workshop_session=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.hasModel).toBe(false);
  });

  it('permite subir un modelo binario .glb, lo persiste y actualiza el status', async () => {
    const fakeGlbBuffer = Buffer.from('glTF-TEST-BINARY-DATA-WORKSHOP-OS');

    const uploadRes = await request(app)
      .post('/api/workshop/model3d')
      .set('Origin', 'http://127.0.0.1')
      .set('Cookie', `workshop_session=${token}`)
      .set('Content-Type', 'application/octet-stream')
      .set('x-filename', 'mesa_taller.glb')
      .send(fakeGlbBuffer);

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.success).toBe(true);
    expect(uploadRes.body.filename).toContain(`user_${user.id}_latest.glb`);

    // Verificar status
    const statusRes = await request(app)
      .get('/api/workshop/model3d/status')
      .set('Cookie', `workshop_session=${token}`);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.hasModel).toBe(true);
    expect(statusRes.body.filename).toContain(`user_${user.id}_latest.glb`);

    // Obtener latest model
    const latestRes = await request(app)
      .get('/api/workshop/model3d/latest')
      .set('Cookie', `workshop_session=${token}`)
      .responseType('blob');

    expect(latestRes.status).toBe(200);
    expect(latestRes.headers['content-type']).toBe('model/gltf-binary');
    expect(latestRes.body.toString()).toBe(fakeGlbBuffer.toString());
  });

  it('sobreescribe el modelo anterior cuando se sube uno nuevo (.obj)', async () => {
    const fakeObjBuffer = Buffer.from('v 0.0 0.0 0.0\nv 1.0 1.0 1.0\nf 1 2 3');

    const uploadRes = await request(app)
      .post('/api/workshop/model3d')
      .set('Origin', 'http://127.0.0.1')
      .set('Cookie', `workshop_session=${token}`)
      .set('Content-Type', 'text/plain')
      .set('x-filename', 'estructura.obj')
      .send(fakeObjBuffer);

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.filename).toContain(`user_${user.id}_latest.obj`);

    // Comprobar que solo existe 1 archivo para este usuario en el disco
    const modelsDir = path.join(process.cwd(), 'data', 'models');
    const files = fs.readdirSync(modelsDir).filter(f => f.startsWith(`user_${user.id}_`));
    expect(files.length).toBe(1);
    expect(files[0]).toContain(`user_${user.id}_latest.obj`);
  });

  it('permite eliminar el modelo 3D con DELETE /api/workshop/model3d', async () => {
    // Primero subir uno
    await request(app)
      .post('/api/workshop/model3d')
      .set('Origin', 'http://127.0.0.1')
      .set('Cookie', `workshop_session=${token}`)
      .set('Content-Type', 'application/octet-stream')
      .set('x-filename', 'temp.glb')
      .send(Buffer.from('binary-temp'));

    const delRes = await request(app)
      .delete('/api/workshop/model3d')
      .set('Origin', 'http://127.0.0.1')
      .set('Cookie', `workshop_session=${token}`);

    expect(delRes.status).toBe(200);
    expect(delRes.body.success).toBe(true);

    const statusRes = await request(app)
      .get('/api/workshop/model3d/status')
      .set('Cookie', `workshop_session=${token}`);

    expect(statusRes.body.hasModel).toBe(false);
  });

  it('retorna error 400 cuando se envía un archivo vacío', async () => {
    const res = await request(app)
      .post('/api/workshop/model3d')
      .set('Origin', 'http://127.0.0.1')
      .set('Cookie', `workshop_session=${token}`)
      .set('Content-Type', 'application/octet-stream')
      .set('x-filename', 'empty.glb')
      .send(Buffer.alloc(0));

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('vacío');
  });
});
