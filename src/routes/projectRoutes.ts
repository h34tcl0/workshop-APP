import { Router } from 'express';
import { store } from '../db.js';
import { AuthenticatedRequest } from '../auth.js';

const router = Router();

// POST /projects/add - Create a new project
router.post('/projects/add', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const { name, description } = req.body;
  if (!name || !String(name).trim()) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ error: 'El nombre del proyecto es obligatorio' });
    }
    return res.redirect(303, '/');
  }
  const project = store.addProject(userId, String(name).trim(), description ? String(description).trim() : undefined);
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, project });
  }
  res.redirect(303, '/');
});

// POST /projects/:id/toggle - Toggle project active state
router.post('/projects/:id/toggle', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || !store.getProjectById(userId, id)) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
    return res.status(404).send('Proyecto no encontrado');
  }
  const { is_active } = req.body;
  const isActiveBool = is_active !== undefined ? (is_active === 'true' || is_active === true || is_active === 1 || is_active === '1') : undefined;
  const updated = store.toggleProjectActive(userId, id, isActiveBool);
  if (!updated) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
    return res.status(404).send('Proyecto no encontrado');
  }
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, project: updated });
  }
  res.redirect(303, '/');
});

// POST /projects/:id/update - Update project details (e.g. rename)
router.post('/projects/:id/update', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const id = parseInt(req.params.id, 10);
  const { name, description } = req.body;
  if (!name || !String(name).trim()) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(400).json({ error: 'El nombre del proyecto no puede estar vacío' });
    }
    return res.redirect(303, '/');
  }
  const updated = store.updateProject(userId, id, {
    name: String(name).trim(),
    description: description ? String(description).trim() : undefined
  });
  if (!updated) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
    return res.redirect(303, '/');
  }
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, project: updated });
  }
  res.redirect(303, '/');
});

// POST /project-templates/save
router.post('/project-templates/save', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      if (req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ status: 'error', message: 'El nombre de la plantilla es requerido.' });
      }
      return res.redirect(303, '/');
    }
    const template = store.createProjectTemplateFromBacklog(userId, name.trim(), description ? description.trim() : '');
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'success', message: 'Plantilla de proyecto guardada.', template });
    }
    res.redirect(303, '/');
  } catch (err) {
    console.error('Error saving project template:', err);
    if (req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ status: 'error', message: 'Error guardando la plantilla.' });
    }
    res.redirect(303, '/');
  }
});

// POST /project-templates/:id/apply
router.post('/project-templates/:id/apply', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const addedTasks = store.applyProjectTemplate(userId, id);
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'success', message: `Plantilla aplicada (${addedTasks.length} tareas agregadas).` });
    }
    res.redirect(303, '/');
  } catch (err) {
    console.error('Error applying project template:', err);
    if (req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ status: 'error', message: 'Error aplicando la plantilla.' });
    }
    res.redirect(303, '/');
  }
});

// POST /project-templates/:id/delete
router.post('/project-templates/:id/delete', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    store.deleteProjectTemplate(userId, id);
    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'success', message: 'Plantilla eliminada.' });
    }
    res.redirect(303, '/');
  } catch (err) {
    console.error('Error deleting project template:', err);
    if (req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ status: 'error', message: 'Error eliminando la plantilla.' });
    }
    res.redirect(303, '/');
  }
});

export default router;
