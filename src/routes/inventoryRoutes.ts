import { Router } from 'express';
import {
  getMaterials,
  addMaterial,
  toggleMaterial,
  updateMaterial,
  setMaterialStatus,
  deleteMaterial,
  importMaterials
} from '../controllers/materialsController.js';
import {
  getTools,
  addTool,
  updateTool,
  setToolStatus,
  deleteTool,
  exportInventoryContext
} from '../controllers/toolsController.js';

const router = Router();

// Materials Endpoints
router.get('/api/materials', getMaterials);
router.post('/materials/add', addMaterial);
router.post('/materials/:id/toggle', toggleMaterial);
router.post('/materials/:id/update', updateMaterial);
router.post('/materials/:id/set-status', setMaterialStatus);
router.post('/materials/:id/delete', deleteMaterial);
router.post('/materials/import', importMaterials);

// Tools Endpoints
router.get('/api/tools', getTools);
router.post('/tools/add', addTool);
router.post('/tools/:id/update', updateTool);
router.post('/tools/:id/set-status', setToolStatus);
router.post('/tools/:id/delete', deleteTool);

// Unified Inventory Context Export
router.get('/api/inventory/export-context', exportInventoryContext);

export default router;
