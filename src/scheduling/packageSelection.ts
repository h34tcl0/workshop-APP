import { Task } from "../types.js";

export function isFinalTaskPackage(candidateTasks: Task[], allPendingInBacklog: Task[]): boolean {
  if (!candidateTasks || candidateTasks.length === 0) return false;
  if (!allPendingInBacklog || allPendingInBacklog.length === 0) return false;

  // 1. Candidate tasks encompass ALL remaining uncompleted tasks in the backlog
  if (candidateTasks.length === allPendingInBacklog.length) {
    return true;
  }

  // 2. Candidate tasks encompass ALL remaining uncompleted tasks for at least one project
  const candidateProjectIds = new Set(candidateTasks.map(t => t.project_id));
  for (const pid of candidateProjectIds) {
    const candidateProjectTasks = candidateTasks.filter(t => t.project_id === pid);
    const allPendingProjectTasks = allPendingInBacklog.filter(t => t.project_id === pid);
    if (candidateProjectTasks.length === allPendingProjectTasks.length && candidateProjectTasks.length > 0) {
      return true;
    }
  }

  return false;
}

export function hasSignificantProgressOrSmallProject(
  candidateTasks: Task[],
  allPendingInBacklog: Task[],
  minWorkHours: number
): boolean {
  if (!candidateTasks || candidateTasks.length === 0) return false;
  if (!allPendingInBacklog || allPendingInBacklog.length === 0) return false;

  const candidateProjectIds = new Set(candidateTasks.map(t => t.project_id));
  for (const pid of candidateProjectIds) {
    const candidateProjTasks = candidateTasks.filter(t => t.project_id === pid);
    const allPendingProjTasks = allPendingInBacklog.filter(t => t.project_id === pid);

    const pendingTotalHours = allPendingProjTasks.reduce((acc, t) => acc + (t.estimated_hours || 0), 0);
    const candidateActiveHours = candidateProjTasks.reduce((acc, t) => acc + (t.estimated_hours || 0), 0);

    // 1. Proyecto pequeño: todas las tareas pendientes del proyecto suman menos del mínimo estándar
    if (pendingTotalHours > 0 && pendingTotalHours < minWorkHours) {
      return true;
    }

    // 2. Avance significativo: el paquete cubre >= 50% de las horas pendientes del proyecto (con guard contra división por cero)
    if (pendingTotalHours > 0 && (candidateActiveHours / pendingTotalHours) >= 0.50) {
      return true;
    }
  }

  return false;
}
