import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase, store } from "../src/db.js";
import { TaskService, InvalidStateTransitionError } from "../src/services/taskService.js";
import { DayService } from "../src/services/dayService.js";
import { TaskStatus, DayStatus } from "../src/types.js";
import { LocalDate } from "../src/LocalDate.js";

describe("FSM Domain Services - Task & Day State Machines", () => {
  const userId = 1;

  beforeEach(async () => {
    await initDatabase();
  });

  describe("TaskService FSM", () => {
    it("creates a task in 'pending' state", () => {
      const task = TaskService.createTask(userId, {
        title: "Tarea FSM Test 1",
        estimated_hours: 2.0
      }, { triggerReeval: false });

      expect(task.status).toBe(TaskStatus.PENDING);
      expect(task.is_active).toBe(true);
      expect(task.progress_percentage).toBe(0);
      expect(task.completed_at).toBeNull();
    });

    it("starts a task transitioning to 'in_progress'", () => {
      const created = TaskService.createTask(userId, {
        title: "Tarea FSM Start",
        estimated_hours: 1.5
      }, { triggerReeval: false });

      const started = TaskService.startTask(userId, created.id, { triggerReeval: false });
      expect(started.status).toBe(TaskStatus.IN_PROGRESS);
      expect(started.progress_percentage).toBeGreaterThan(0);
      expect(started.is_active).toBe(true);
    });

    it("completes a task setting 100% progress and completed_at timestamp", () => {
      const created = TaskService.createTask(userId, {
        title: "Tarea FSM Complete",
        estimated_hours: 1.0
      }, { triggerReeval: false });

      const completed = TaskService.completeTask(userId, created.id, { triggerReeval: false });
      expect(completed.status).toBe(TaskStatus.COMPLETED);
      expect(completed.progress_percentage).toBe(100);
      expect(completed.completed_at).toBeTruthy();
    });

    it("rejects invalid transition: starting a completed task directly without reactivating", () => {
      const created = TaskService.createTask(userId, {
        title: "Tarea FSM Direct Start Error",
        estimated_hours: 1.0
      }, { triggerReeval: false });

      TaskService.completeTask(userId, created.id, { triggerReeval: false });

      expect(() => {
        TaskService.startTask(userId, created.id, { triggerReeval: false });
      }).toThrowError(InvalidStateTransitionError);
    });

    it("reactivates a completed task back to 'pending' in the backlog", () => {
      const created = TaskService.createTask(userId, {
        title: "Tarea FSM Reactivate Completed",
        estimated_hours: 2.0
      }, { triggerReeval: false });

      TaskService.completeTask(userId, created.id, { triggerReeval: false });
      const reactivated = TaskService.reactivateToBacklog(userId, created.id, { triggerReeval: false });

      expect(reactivated.status).toBe(TaskStatus.PENDING);
      expect(reactivated.is_active).toBe(true);
      expect(reactivated.progress_percentage).toBe(0);
      expect(reactivated.completed_at).toBeNull();
    });

    it("reactivates a paused/inactive task directly to 'pending' in the backlog", () => {
      const created = TaskService.createTask(userId, {
        title: "Tarea FSM Reactivate Paused",
        estimated_hours: 2.0
      }, { triggerReeval: false });

      TaskService.pauseTask(userId, created.id, { triggerReeval: false });
      const paused = store.getTask(userId, created.id);
      expect(paused?.is_active).toBe(false);

      const reactivated = TaskService.reactivateToBacklog(userId, created.id, { triggerReeval: false });
      expect(reactivated.status).toBe(TaskStatus.PENDING);
      expect(reactivated.is_active).toBe(true);
    });

    it("pauses and resumes a task in the backlog", () => {
      const created = TaskService.createTask(userId, {
        title: "Tarea FSM Pause Resume",
        estimated_hours: 1.0
      }, { triggerReeval: false });

      const paused = TaskService.pauseTask(userId, created.id, { triggerReeval: false });
      expect(paused.is_active).toBe(false);

      const resumed = TaskService.resumeTask(userId, created.id, { triggerReeval: false });
      expect(resumed.is_active).toBe(true);
    });
  });

  describe("DayService FSM", () => {
    it("concludes a day with manual reason", () => {
      const date = LocalDate.fromIso("2026-08-19");
      const manualReason = "Jornada concluida (cerrada manualmente por el operario)";

      const concluded = DayService.concludeDay(userId, date, manualReason, { triggerReeval: false });
      expect(concluded.status).toBe(DayStatus.DAY_BLOCKED);
      expect(concluded.block_reason).toBe(manualReason);
      expect(concluded.checkin_resolved).toBe(true);
    });

    it("concludes a day with operational hours exhausted reason", () => {
      const date = LocalDate.fromIso("2026-08-19");
      const autoReason = "Jornada concluida (horario operativo finalizado para hoy)";

      const concluded = DayService.concludeDay(userId, date, autoReason, { triggerReeval: false });
      expect(concluded.status).toBe(DayStatus.DAY_BLOCKED);
      expect(concluded.block_reason).toBe(autoReason);
      expect(concluded.checkin_resolved).toBe(true);
    });
  });
});
