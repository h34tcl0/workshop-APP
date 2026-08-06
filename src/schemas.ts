import { z } from "zod";
import { TaskCategory } from "./types.js";

export const importedTaskSchema = z.object({
  title: z.string({ message: "El título de la tarea es requerido." })
    .trim()
    .min(1, "El título de la tarea no puede estar vacío."),
  description: z.string().optional().default(""),
  category: z.string().optional().transform((val) => {
    if (!val || !Object.values(TaskCategory).includes(val as TaskCategory)) {
      return TaskCategory.CARPENTRY;
    }
    return val as TaskCategory;
  }),
  estimated_hours: z.union([
    z.number().gt(0, "Las horas estimadas deben ser mayores a 0.").max(100, "Las horas estimadas superan el límite de 100 horas."),
    z.string().transform(v => parseFloat(v)).pipe(z.number().gt(0, "Las horas estimadas deben ser mayores a 0.").max(100, "Las horas estimadas superan el límite de 100 horas."))
  ]).optional().default(1.0),
  curing_hours: z.union([
    z.number().min(0, "Las horas de curado no pueden ser negativas.").max(100, "Las horas de curado superan el límite de 100 horas."),
    z.string().transform(v => parseFloat(v)).pipe(z.number().min(0, "Las horas de curado no pueden ser negativas.").max(100, "Las horas de curado superan el límite de 100 horas."))
  ]).optional().default(0.0)
});

export const importPayloadSchema = z.object({
  project_name: z.string().trim().min(1, "El nombre del proyecto no puede estar vacío.").optional().default("Proyecto Importado IA"),
  tasks: z.array(importedTaskSchema, {
    message: "El campo 'tasks' es requerido y debe ser un arreglo."
  }).min(1, "La lista tasks es requerida y debe contener al menos 1 tarea.")
});

export const reorderPayloadSchema = z.object({
  task_ids: z.array(z.number().int({ message: "Los IDs deben ser números enteros." }), {
    message: "El campo 'task_ids' es requerido y debe ser un arreglo."
  })
});
