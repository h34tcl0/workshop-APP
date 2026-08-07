import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { importPayloadSchema, reorderPayloadSchema } from "../src/schemas.js";
import { store, initDatabase } from "../src/db.js";
import { signToken } from "../src/auth.js";
import { app } from "../server.js";

describe("REST Input Validation - Zod Schemas & HTTP Multi-Tenant Rules", () => {
  describe("importPayloadSchema", () => {
    it("should succeed for a valid AI import payload", () => {
      const validPayload = {
        project_name: "Remodelación Cocina",
        tasks: [
          {
            title: "Instalación de Muebles",
            description: "Colocar muebles superiores",
            category: "carpentry",
            estimated_hours: 4.5,
            curing_hours: 0
          }
        ]
      };

      const result = importPayloadSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.project_name).toBe("Remodelación Cocina");
        expect(result.data.tasks[0].estimated_hours).toBe(4.5);
      }
    });

    it("should reject payload with empty tasks array", () => {
      const invalidPayload = {
        project_name: "Proyecto Vacío",
        tasks: []
      };

      const result = importPayloadSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("La lista tasks es requerida y debe contener al menos 1 tarea.");
      }
    });

    it("should reject payload missing required 'tasks' field", () => {
      const invalidPayload = {
        project_name: "Sin Campo Tareas"
      };

      const result = importPayloadSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("El campo 'tasks' es requerido");
      }
    });

    it("should reject task with empty or missing title", () => {
      const invalidPayload = {
        project_name: "Proyecto Test",
        tasks: [
          {
            title: "  ", // empty after trim
            estimated_hours: 2.0
          }
        ]
      };

      const result = importPayloadSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("El título de la tarea no puede estar vacío.");
      }
    });

    it("should reject task with negative estimated_hours", () => {
      const invalidPayload = {
        project_name: "Proyecto Test",
        tasks: [
          {
            title: "Lijado",
            estimated_hours: -2.0
          }
        ]
      };

      const result = importPayloadSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Las horas estimadas deben ser mayores a 0.");
      }
    });

    it("should reject task with negative curing_hours", () => {
      const invalidPayload = {
        project_name: "Proyecto Test",
        tasks: [
          {
            title: "Secado",
            curing_hours: -5.0
          }
        ]
      };

      const result = importPayloadSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Las horas de curado no pueden ser negativas.");
      }
    });
  });

  describe("reorderPayloadSchema", () => {
    it("should accept array of valid integer IDs", () => {
      const result = reorderPayloadSchema.safeParse({ task_ids: [1, 2, 3] });
      expect(result.success).toBe(true);
    });

    it("should reject non-integer IDs or non-array values", () => {
      const resultFloat = reorderPayloadSchema.safeParse({ task_ids: [1.5, 2] });
      expect(resultFloat.success).toBe(false);

      const resultString = reorderPayloadSchema.safeParse({ task_ids: "1,2,3" });
      expect(resultString.success).toBe(false);
    });
  });

  describe("Multi-Tenant project_id Validation", () => {
    beforeEach(async () => {
      await initDatabase();
    });

    it("prevents User B from validating or assigning tasks/materials to User A's project_id", () => {
      const getOrCreateUser = (email: string, pass: string) => {
        return store.getUserByEmail(email) || store.createUser(email, pass);
      };

      const userA = getOrCreateUser("usera_unit@example.com", "hashA");
      const userB = getOrCreateUser("userb_unit@example.com", "hashB");
      const userAId = userA.id;
      const userBId = userB.id;

      // User A creates a project
      const projA = store.addProject(userAId, "Proyecto Secreto User A", "Privado");
      expect(projA).toBeDefined();

      // User A can access their own project
      const fetchedByA = store.getProjectById(userAId, projA.id);
      expect(fetchedByA).not.toBeNull();
      expect(fetchedByA?.id).toBe(projA.id);

      // User B MUST NOT be able to access User A's project ID
      const fetchedByB = store.getProjectById(userBId, projA.id);
      expect(fetchedByB).toBeNull();
    });

    it("HTTP POST /tasks/add responds 404 when User A uses User B's project_id", async () => {
      const getOrCreateUser = (email: string, pass: string) => {
        return store.getUserByEmail(email) || store.createUser(email, pass);
      };

      const userA = getOrCreateUser("usera1@example.com", "hash1");
      const userB = getOrCreateUser("userb1@example.com", "hash2");

      const projB = store.addProject(userB.id, "Proyecto B", "Desc B");
      const tokenA = signToken({ userId: userA.id, email: userA.email });

      const res = await request(app)
        .post("/tasks/add")
        .set("Origin", "http://127.0.0.1")
        .set("Cookie", `workshop_session=${tokenA}`)
        .set("Accept", "application/json")
        .send({
          title: "Tarea maliciosa",
          project_id: projB.id
        });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Proyecto no encontrado" });
    });

    it("HTTP POST /materials/add responds 404 when User A uses User B's project_id", async () => {
      const getOrCreateUser = (email: string, pass: string) => {
        return store.getUserByEmail(email) || store.createUser(email, pass);
      };

      const userA = getOrCreateUser("usera2@example.com", "hash1");
      const userB = getOrCreateUser("userb2@example.com", "hash2");

      const projB = store.addProject(userB.id, "Proyecto B", "Desc B");
      const tokenA = signToken({ userId: userA.id, email: userA.email });

      const res = await request(app)
        .post("/materials/add")
        .set("Origin", "http://127.0.0.1")
        .set("Cookie", `workshop_session=${tokenA}`)
        .set("Accept", "application/json")
        .send({
          name: "Madera Roble",
          quantity: 5,
          unit: "unidades",
          project_id: projB.id
        });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Proyecto no encontrado" });
    });

    it("HTTP POST /materials/import responds 404 when User A imports to User B's project_id", async () => {
      const getOrCreateUser = (email: string, pass: string) => {
        return store.getUserByEmail(email) || store.createUser(email, pass);
      };

      const userA = getOrCreateUser("usera3@example.com", "hash1");
      const userB = getOrCreateUser("userb3@example.com", "hash2");

      const projB = store.addProject(userB.id, "Proyecto B", "Desc B");
      const tokenA = signToken({ userId: userA.id, email: userA.email });

      const res = await request(app)
        .post("/materials/import")
        .set("Origin", "http://127.0.0.1")
        .set("Cookie", `workshop_session=${tokenA}`)
        .set("Accept", "application/json")
        .send({
          materials: [{ name: "Tornillos 2 pulgadas", quantity: 100 }],
          project_id: projB.id
        });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Proyecto no encontrado" });
    });
  });
});

