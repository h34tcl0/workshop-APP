import { Task, TaskStatus, TaskCategory, CuringSession } from "../types.js";
import { store } from "../db.js";
import { triggerSilentReevaluation } from "../scheduler.js";

export class InvalidStateTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateTransitionError";
  }
}

export interface CreateTaskInput {
  project_id?: number;
  title: string;
  description?: string;
  category?: TaskCategory;
  estimated_hours?: number;
  curing_hours?: number;
  order?: number;
  curing_is_blocking?: boolean;
}

export const TaskService = {
  /**
   * Crea una nueva tarea en estado 'pending', activa en el backlog.
   */
  createTask(userId: number, input: CreateTaskInput, options: { triggerReeval?: boolean } = { triggerReeval: true }): Task {
    const task = store.addTask(userId, input);
    if (options.triggerReeval !== false) {
      triggerSilentReevaluation(userId);
    }
    return task;
  },

  /**
   * Inicia el trabajo activo de una tarea.
   * Transición permitida desde 'pending' o cuando la tarea estaba pausada/inactiva.
   */
  startTask(userId: number, taskId: number, options: { triggerReeval?: boolean } = { triggerReeval: true }): Task {
    const task = store.getTask(userId, taskId);
    if (!task) {
      throw new Error(`[TaskService] Task #${taskId} not found for user #${userId}`);
    }

    if (task.status === TaskStatus.COMPLETED) {
      throw new InvalidStateTransitionError(
        `[TaskService] Cannot start Task #${taskId} directly from 'completed'. Must reactivate to backlog first.`
      );
    }

    const updated = store.updateTask(userId, taskId, {
      status: TaskStatus.IN_PROGRESS,
      is_active: true,
      progress_percentage: task.progress_percentage > 0 ? task.progress_percentage : 25,
      completed_at: null
    });

    if (!updated) {
      throw new Error(`[TaskService] Failed to start Task #${taskId}`);
    }

    if (options.triggerReeval !== false) {
      triggerSilentReevaluation(userId);
    }
    return updated;
  },

  /**
   * Finaliza la tarea marcándola como completada al 100%.
   * Transición válida desde 'in_progress' o 'pending'.
   */
  completeTask(userId: number, taskId: number, options: { triggerReeval?: boolean } = { triggerReeval: true }): Task {
    const task = store.getTask(userId, taskId);
    if (!task) {
      throw new Error(`[TaskService] Task #${taskId} not found for user #${userId}`);
    }

    const updated = store.updateTask(userId, taskId, {
      status: TaskStatus.COMPLETED,
      progress_percentage: 100,
      completed_at: new Date().toISOString()
    });

    if (!updated) {
      throw new Error(`[TaskService] Failed to complete Task #${taskId}`);
    }

    if (options.triggerReeval !== false) {
      triggerSilentReevaluation(userId);
    }
    return updated;
  },

  /**
   * Reactiva una tarea restaurándola al backlog activo en estado 'pending'.
   * Transición válida desde:
   * 1. 'completed' (restaura el ciclo completo)
   * 2. 'paused' / is_active = false (reactiva de proyectos inactivos o pausas manuales)
   * 3. 'in_progress' (regresa a pendiente)
   */
  reactivateToBacklog(userId: number, taskId: number, options: { triggerReeval?: boolean } = { triggerReeval: true }): Task {
    const task = store.getTask(userId, taskId);
    if (!task) {
      throw new Error(`[TaskService] Task #${taskId} not found for user #${userId}`);
    }

    const updated = store.updateTask(userId, taskId, {
      status: TaskStatus.PENDING,
      is_active: true,
      progress_percentage: 0,
      completed_at: null
    });

    if (!updated) {
      throw new Error(`[TaskService] Failed to reactivate Task #${taskId}`);
    }

    if (options.triggerReeval !== false) {
      triggerSilentReevaluation(userId);
    }
    return updated;
  },

  /**
   * Pausa una tarea en el backlog (is_active = false).
   */
  pauseTask(userId: number, taskId: number, options: { triggerReeval?: boolean } = { triggerReeval: true }): Task {
    const task = store.getTask(userId, taskId);
    if (!task) {
      throw new Error(`[TaskService] Task #${taskId} not found for user #${userId}`);
    }

    if (task.status === TaskStatus.COMPLETED) {
      throw new InvalidStateTransitionError(`[TaskService] Cannot pause completed Task #${taskId}`);
    }

    const updated = store.toggleTaskActive(userId, taskId, false);
    if (!updated) {
      throw new Error(`[TaskService] Failed to pause Task #${taskId}`);
    }

    if (options.triggerReeval !== false) {
      triggerSilentReevaluation(userId);
    }
    return updated;
  },

  /**
   * Reanuda una tarea pausada en el backlog (is_active = true).
   */
  resumeTask(userId: number, taskId: number, options: { triggerReeval?: boolean } = { triggerReeval: true }): Task {
    const task = store.getTask(userId, taskId);
    if (!task) {
      throw new Error(`[TaskService] Task #${taskId} not found for user #${userId}`);
    }

    const updated = store.toggleTaskActive(userId, taskId, true);
    if (!updated) {
      throw new Error(`[TaskService] Failed to resume Task #${taskId}`);
    }

    if (options.triggerReeval !== false) {
      triggerSilentReevaluation(userId);
    }
    return updated;
  },

  /**
   * Actualiza el progreso porcentual manteniendo consistencia de estado.
   */
  updateProgress(userId: number, taskId: number, progress: number, options: { triggerReeval?: boolean } = { triggerReeval: true }): Task {
    const task = store.getTask(userId, taskId);
    if (!task) {
      throw new Error(`[TaskService] Task #${taskId} not found for user #${userId}`);
    }

    const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)));
    if (clampedProgress === 100) {
      return this.completeTask(userId, taskId, options);
    }

    const updated = store.updateTask(userId, taskId, {
      progress_percentage: clampedProgress,
      status: clampedProgress > 0 ? TaskStatus.IN_PROGRESS : TaskStatus.PENDING,
      completed_at: null
    });

    if (!updated) {
      throw new Error(`[TaskService] Failed to update progress for Task #${taskId}`);
    }

    if (options.triggerReeval !== false) {
      triggerSilentReevaluation(userId);
    }
    return updated;
  },

  /**
   * Inicia explícitamente una sesión de secado/curado para una pieza/tarea.
   * Transición del flujo de secado conectada al botón explícito "Iniciar Secado de Pieza".
   */
  startCuring(userId: number, taskId: number, options: {
    piece_label?: string;
    duration_hours?: number;
    started_at?: string;
    triggerReeval?: boolean;
  } = {}): CuringSession {
    const task = store.getTask(userId, taskId);
    if (!task) {
      throw new Error(`[TaskService] Task #${taskId} not found for user #${userId}`);
    }

    const pieceLabel = (options.piece_label && options.piece_label.trim()) || task.title;
    const curingDuration = options.duration_hours !== undefined && options.duration_hours > 0
      ? options.duration_hours
      : (task.curing_hours > 0 ? task.curing_hours : (task.category === TaskCategory.EPOXY ? 6.0 : 2.0));

    const session = store.startCuringSession(userId, {
      task_id: taskId,
      project_name: task.project_name || null,
      piece_label: pieceLabel,
      duration_hours: curingDuration,
      started_at: options.started_at
    });

    if (options.triggerReeval !== false) {
      triggerSilentReevaluation(userId);
    }
    return session;
  },

  /**
   * Finaliza explícitamente una sesión de secado/curado en curso.
   */
  completeCuring(userId: number, curingSessionId: number, options: { triggerReeval?: boolean } = {}): CuringSession {
    const session = store.completeCuringSession(userId, curingSessionId);
    if (!session) {
      throw new Error(`[TaskService] Curing session #${curingSessionId} not found or failed to complete`);
    }

    if (options.triggerReeval !== false) {
      triggerSilentReevaluation(userId);
    }
    return session;
  }
};
