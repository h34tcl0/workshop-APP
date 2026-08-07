import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../server.js';
import { store, initDatabase } from '../src/db.js';
import { signToken } from '../src/auth.js';

describe('Materials Flow & Sequential Additions (Fix Bug Verification)', () => {
  let user: any;
  let token: string;

  beforeEach(async () => {
    await initDatabase();
    const email = `mats_user_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com`;
    user = store.createUser(email, 'Password123!');
    token = signToken({ userId: user.id, email: user.email });
  });

  it('allows adding 3 materials sequentially without errors or state corruption', async () => {
    const materialsToAdd = [
      { name: 'Pino Oregón 2x4 3.2m', quantity: 10, unit: 'piezas', category: 'Madera', status: 'to_buy' },
      { name: 'Barniz Marino Transparente 1L', quantity: 2, unit: 'litros', category: 'Adhesivos/Barniz', status: 'in_stock' },
      { name: 'Tornillos Autoperforantes 2"', quantity: 150, unit: 'unidades', category: 'Tornillería', status: 'to_buy' }
    ];

    for (const matData of materialsToAdd) {
      const res = await request(app)
        .post('/materials/add')
        .set('Origin', 'http://127.0.0.1')
        .set('Cookie', `workshop_session=${token}`)
        .set('Accept', 'application/json')
        .send(matData);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.material).toBeDefined();
      expect(res.body.material.name).toBe(matData.name);
      expect(res.body.material.quantity).toBe(matData.quantity);
    }

    // Verify all 3 items exist in store and via GET /api/materials
    const listRes = await request(app)
      .get('/api/materials')
      .set('Cookie', `workshop_session=${token}`)
      .set('Accept', 'application/json');

    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.materials).toHaveLength(3);

    const names = listRes.body.materials.map((m: any) => m.name);
    expect(names).toContain('Pino Oregón 2x4 3.2m');
    expect(names).toContain('Barniz Marino Transparente 1L');
    expect(names).toContain('Tornillos Autoperforantes 2"');
  });

  it('handles validation error gracefully and allows adding valid materials afterwards', async () => {
    // Attempt invalid material with empty name
    const badRes = await request(app)
      .post('/materials/add')
      .set('Origin', 'http://127.0.0.1')
      .set('Cookie', `workshop_session=${token}`)
      .set('Accept', 'application/json')
      .send({ name: '   ', quantity: 1 });

    expect(badRes.status).toBe(400);
    expect(badRes.body.error).toBeDefined();

    // Subsequent valid material addition must succeed
    const goodRes = await request(app)
      .post('/materials/add')
      .set('Origin', 'http://127.0.0.1')
      .set('Cookie', `workshop_session=${token}`)
      .set('Accept', 'application/json')
      .send({ name: 'Lija de Agua 220', quantity: 5, unit: 'piezas', category: 'Insumos', status: 'in_stock' });

    expect(goodRes.status).toBe(200);
    expect(goodRes.body.success).toBe(true);
    expect(goodRes.body.material.name).toBe('Lija de Agua 220');
  });
});
