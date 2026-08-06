import { describe, it, expect } from "vitest";
import { importPayloadSchema, reorderPayloadSchema } from "../src/schemas.js";

describe("REST Input Validation - Zod Schemas", () => {
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
});
