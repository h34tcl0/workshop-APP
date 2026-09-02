import { store } from '../db.js';
import { AuthenticatedRequest } from '../auth.js';
import { TaskCategory, TaskStatus, Task } from '../types.js';
import { TaskService } from '../services/taskService.js';
import { triggerSilentReevaluation } from '../scheduler.js';
import { reorderPayloadSchema, importPayloadSchema } from '../schemas.js';
import { assertCanCreateTask, QuotaExceededError } from '../services/limitsService.js';

export function parseFlexibleFloat(val: any): number | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val === 'number') return isNaN(val) ? undefined : val;
  const str = String(val).replace(',', '.').trim();
  const parsed = parseFloat(str);
  return isNaN(parsed) ? undefined : parsed;
}

export function handleAddTask(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    assertCanCreateTask(userId);

    const { title, description, category, estimated_hours, curing_hours, order, project_id, curing_is_blocking } = req.body;
    const parsedEst = parseFlexibleFloat(estimated_hours) ?? 1.0;
    const parsedCur = parseFlexibleFloat(curing_hours) ?? 0.0;
    const parsedOrd = order ? parseInt(String(order), 10) : undefined;
    const targetProjId = project_id ? parseInt(String(project_id), 10) : undefined;
    const curingIsBlockingBool = curing_is_blocking !== undefined ? (curing_is_blocking === 'true' || curing_is_blocking === true || curing_is_blocking === 1 || curing_is_blocking === '1') : true;

    if (targetProjId) {
      const proj = store.getProjectById(userId, targetProjId);
      if (!proj) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(404).json({ error: 'Proyecto no encontrado' });
        }
        return res.status(404).send('Proyecto no encontrado');
      }
    }

    store.addTask(userId, {
      project_id: targetProjId,
      title: title ? String(title).trim() : 'Nueva Tarea',
      description: description || '',
      category: category || TaskCategory.CARPENTRY,
      estimated_hours: parsedEst,
      curing_hours: parsedCur,
      order: parsedOrd && !isNaN(parsedOrd) ? parsedOrd : undefined,
      curing_is_blocking: curingIsBlockingBool
    });
    triggerSilentReevaluation(userId).catch(err => console.error('[Scheduler] Error reevaluating after task add:', err));
    res.redirect(303, '/');
  } catch (err) {
    console.error('[Server Error] Error en POST /tasks/add:', err);
    res.redirect(303, '/');
  }
}

export function handleActivateToBacklog(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  const id = parseInt(req.params.id, 10);
  const task = store.getTask(userId, id);
  if (!task) {
    return res.status(404).json({ error: 'Tarea no encontrada' });
  }

  const updatedTask = TaskService.reactivateToBacklog(userId, id);
  if (task.project_id) {
    store.toggleProjectActive(userId, task.project_id, true);
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ 
      success: true, 
      message: `Tarea '${task.title}' agregada al backlog activo`,
      task: updatedTask
    });
  }
  res.redirect(303, '/');
}

export function handleToggleActive(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  const id = parseInt(req.params.id, 10);
  const { is_active } = req.body;
  const isActiveBool = is_active !== undefined ? (is_active === 'true' || is_active === true || is_active === 1 || is_active === '1') : undefined;
  
  let updated;
  if (isActiveBool === false) {
    updated = TaskService.pauseTask(userId, id);
  } else if (isActiveBool === true) {
    updated = TaskService.resumeTask(userId, id);
  } else {
    const current = store.getTask(userId, id);
    updated = current?.is_active === false ? TaskService.resumeTask(userId, id) : TaskService.pauseTask(userId, id);
  }

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, task: updated });
  }
  res.redirect(303, '/');
}

export function handleUpdateTask(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ error: 'ID de tarea inválido' });
      }
      return res.redirect(303, '/');
    }

    const { title, estimated_hours, curing_hours, category, project_id, is_active, curing_is_blocking } = req.body;
    const parsedEst = parseFlexibleFloat(estimated_hours);
    const parsedCur = parseFlexibleFloat(curing_hours);
    const isActiveBool = is_active !== undefined ? (is_active === 'true' || is_active === true || is_active === 1 || is_active === '1') : undefined;
    const curingIsBlockingBool = curing_is_blocking !== undefined ? (curing_is_blocking === 'true' || curing_is_blocking === true || curing_is_blocking === 1 || curing_is_blocking === '1') : undefined;
    const targetProjId = project_id ? parseInt(String(project_id), 10) : undefined;

    if (targetProjId) {
      const proj = store.getProjectById(userId, targetProjId);
      if (!proj) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(404).json({ error: 'Proyecto no encontrado' });
        }
        return res.status(404).send('Proyecto no encontrado');
      }
    }

    const updated = store.updateTask(userId, id, {
      title: title ? String(title).trim() : undefined,
      estimated_hours: parsedEst,
      curing_hours: parsedCur !== undefined ? parsedCur : (curing_hours === '' || curing_hours === '0' || curing_hours === 0 ? 0 : undefined),
      category: category || undefined,
      project_id: targetProjId,
      is_active: isActiveBool,
      curing_is_blocking: curingIsBlockingBool
    });

    if (!updated) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ error: 'Tarea no encontrada o no pertenece al usuario' });
      }
      return res.redirect(303, '/');
    }

    triggerSilentReevaluation(userId).catch(err => console.error('[Scheduler] Error reevaluating after task update:', err));

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, task: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error(`[Server Error] Error en POST /tasks/${req.params.id}/update:`, err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: 'Error interno del servidor al actualizar la tarea', details: err?.message });
    }
    res.redirect(303, '/');
  }
}

export function handleUpdateStatus(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  const id = parseInt(req.params.id, 10);
  const { status, progress } = req.body;
  const progressNum = parseInt(progress, 10);

  try {
    let updated: Task;
    if (progress !== undefined && !isNaN(progressNum)) {
      updated = TaskService.updateProgress(userId, id, progressNum);
    } else if (status === TaskStatus.COMPLETED) {
      updated = TaskService.completeTask(userId, id);
    } else if (status === TaskStatus.IN_PROGRESS) {
      updated = TaskService.startTask(userId, id);
    } else if (status === TaskStatus.PENDING) {
      updated = TaskService.reactivateToBacklog(userId, id);
    } else {
      const existing = store.getTask(userId, id);
      if (!existing) {
        return res.status(404).json({ error: 'Tarea no encontrada o no pertenece al usuario' });
      }
      updated = existing;
    }

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, task: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error(`[Server Error] Error en POST /tasks/${id}/update_status:`, err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ error: err?.message || 'Error al actualizar el estado de la tarea' });
    }
    res.redirect(303, '/');
  }
}

export function handleDeleteTask(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  const id = parseInt(req.params.id, 10);
  const task = store.getTask(userId, id);
  const title = task ? task.title : 'Tarea';
  store.deleteTask(userId, id);
  triggerSilentReevaluation(userId).catch(err => console.error('[Scheduler] Error reevaluating after task delete:', err));
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: `Tarea '${title}' eliminada` });
  }
  res.redirect(303, '/');
}

export function handleMoveUp(req: AuthenticatedRequest, res: any) {
  store.moveTaskUp(req.user!.id, parseInt(req.params.id, 10));
  res.redirect(303, '/');
}

export function handleMoveDown(req: AuthenticatedRequest, res: any) {
  store.moveTaskDown(req.user!.id, parseInt(req.params.id, 10));
  res.redirect(303, '/');
}

export function handleReorderTasks(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  const parseResult = reorderPayloadSchema.safeParse(req.body);

  if (!parseResult.success) {
    const formattedErrors = parseResult.error.issues.map(
      issue => `${issue.path.join('.')}: ${issue.message}`
    );
    return res.status(400).json({
      status: 'error',
      detail: `Payload inválido: ${formattedErrors.join('; ')}`,
      issues: parseResult.error.format()
    });
  }

  store.reorderTasks(userId, parseResult.data.task_ids);
  res.json({ status: 'ok' });
}

export function handleImportTasks(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  const parseResult = importPayloadSchema.safeParse(req.body);

  if (!parseResult.success) {
    const formattedErrors = parseResult.error.issues.map(
      issue => `${issue.path.join('.')}: ${issue.message}`
    );
    return res.status(400).json({
      status: 'error',
      detail: `Payload de importación inválido: ${formattedErrors.join('; ')}`,
      issues: parseResult.error.format()
    });
  }

  const { project_name: projectName, tasks: taskList } = parseResult.data;
  let project = store.getProjects(userId).find(p => p.name === projectName);
  if (!project) {
    project = store.addProject(userId, projectName, 'Proyecto creado vía Importación IA');
  }

  taskList.forEach((tdata) => {
    store.addTask(userId, {
      project_id: project!.id,
      title: tdata.title,
      description: tdata.description,
      category: tdata.category as TaskCategory,
      estimated_hours: tdata.estimated_hours,
      curing_hours: tdata.curing_hours,
      order: store.getTasks(userId).length + 1
    });
  });

  res.json({
    status: 'success',
    message: `Se importaron ${taskList.length} tareas exitosamente en el proyecto '${projectName}'.`,
    imported_count: taskList.length
  });
}

export function getTaskHistory(req: AuthenticatedRequest, res: any) {
  res.json(store.getTaskHistory(req.user!.id));
}
