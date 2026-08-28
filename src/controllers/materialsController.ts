import { store } from '../db.js';
import { AuthenticatedRequest } from '../auth.js';
import { triggerSilentReevaluation } from '../scheduler.js';

export function getMaterials(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  let projectId: number | undefined;
  if (req.query.project_id) {
    projectId = parseInt(String(req.query.project_id), 10);
    if (isNaN(projectId) || !store.getProjectById(userId, projectId)) {
      return res.status(404).json({ error: 'Proyecto no encontrado' });
    }
  }
  res.json({ success: true, materials: store.getMaterials(userId, projectId) });
}

export function addMaterial(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const { name, quantity, unit, category, status, project_id } = req.body;
    if (!name || !String(name).trim()) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ error: 'El nombre del material es obligatorio' });
      }
      return res.redirect(303, '/');
    }

    let targetProjId: number | undefined;
    if (project_id !== undefined && project_id !== null && project_id !== '') {
      targetProjId = parseInt(String(project_id), 10);
      if (isNaN(targetProjId) || !store.getProjectById(userId, targetProjId)) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(404).json({ error: 'Proyecto no encontrado' });
        }
        return res.status(404).send('Proyecto no encontrado');
      }
    }

    const mat = store.addMaterial(userId, {
      name: String(name),
      quantity: parseFloat(quantity) || 1.0,
      unit: String(unit || 'unidades'),
      category: String(category || 'General'),
      status: String(status || 'to_buy'),
      project_id: targetProjId
    });
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, material: mat });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error adding material:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
}

export function toggleMaterial(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const updated = store.toggleMaterialStatus(userId, id);
    if (!updated) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ error: 'Material no encontrado' });
      }
      return res.status(404).send('Material no encontrado');
    }
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, material: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error toggling material:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
}

export function updateMaterial(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const { name, quantity, unit, category, status, project_id } = req.body;

    let targetProjId: number | undefined;
    if (project_id !== undefined && project_id !== null && project_id !== '') {
      targetProjId = parseInt(String(project_id), 10);
      if (isNaN(targetProjId) || !store.getProjectById(userId, targetProjId)) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(404).json({ error: 'Proyecto no encontrado' });
        }
        return res.status(404).send('Proyecto no encontrado');
      }
    }

    const updated = store.updateMaterial(userId, id, {
      name: name ? String(name) : undefined,
      quantity: quantity !== undefined ? parseFloat(quantity) : undefined,
      unit: unit ? String(unit) : undefined,
      category: category ? String(category) : undefined,
      status: status ? String(status) : undefined,
      project_id: targetProjId
    });
    if (!updated) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ error: 'Material no encontrado' });
      }
      return res.status(404).send('Material no encontrado');
    }
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, material: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error updating material:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
}

export function setMaterialStatus(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    const updated = store.setMaterialStatus(userId, id, status);
    triggerSilentReevaluation(userId).catch(err => console.error('[Scheduler] Error reevaluating after material status update:', err));
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, material: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error setting material status:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
}

export function deleteMaterial(req: AuthenticatedRequest, res: any) {
  try {
    store.deleteMaterial(req.user!.id, parseInt(req.params.id, 10));
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error deleting material:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
}

export function importMaterials(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    let materialsList: any[] = [];
    if (req.body.json_data) {
      try {
        const parsed = JSON.parse(req.body.json_data);
        materialsList = Array.isArray(parsed) ? parsed : (parsed.materials || []);
      } catch (e) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(400).json({ error: 'JSON inválido' });
        }
        return res.redirect(303, '/');
      }
    } else if (Array.isArray(req.body.materials)) {
      materialsList = req.body.materials;
    }

    let targetProjId: number | undefined;
    if (req.body.project_id !== undefined && req.body.project_id !== null && req.body.project_id !== '') {
      targetProjId = parseInt(String(req.body.project_id), 10);
      if (isNaN(targetProjId) || !store.getProjectById(userId, targetProjId)) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(404).json({ error: 'Proyecto no encontrado' });
        }
        return res.status(404).send('Proyecto no encontrado');
      }
    }
    const imported = store.importMaterialsFromJson(userId, materialsList, targetProjId);

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, imported_count: imported.length, materials: imported });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error importing materials:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
}
