import { store } from '../db.js';
import { AuthenticatedRequest } from '../auth.js';

export function getTools(req: AuthenticatedRequest, res: any) {
  const userId = req.user!.id;
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  res.json({ success: true, tools: store.getTools(userId, category) });
}

export function addTool(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const { name, category, status, notes } = req.body;
    if (!name || !String(name).trim()) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ error: 'El nombre de la herramienta es requerido' });
      }
      return res.redirect(303, '/');
    }
    const tool = store.addTool(userId, {
      name: String(name),
      category: category ? String(category) : undefined,
      status: status ? String(status) : undefined,
      notes: notes ? String(notes) : undefined
    });
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, tool });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error adding tool:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
}

export function updateTool(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const { name, category, status, notes } = req.body;
    const updated = store.updateTool(userId, id, {
      name: name ? String(name) : undefined,
      category: category ? String(category) : undefined,
      status: status ? String(status) : undefined,
      notes: notes !== undefined ? String(notes) : undefined
    });
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, tool: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error updating tool:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
}

export function setToolStatus(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    const updated = store.setToolStatus(userId, id, status);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, tool: updated });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error setting tool status:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
}

export function deleteTool(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    store.deleteTool(userId, id);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true });
    }
    res.redirect(303, '/');
  } catch (err: any) {
    console.error('Error deleting tool:', err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ error: err.message });
    }
    res.redirect(303, '/');
  }
}

export function exportInventoryContext(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const materials = store.getMaterials(userId);
    const tools = store.getTools(userId);

    const toolsAvailable = tools.filter(t => t.status === 'available');
    const toolsInUse = tools.filter(t => t.status === 'in_use');
    const toolsToBuy = tools.filter(t => t.status === 'to_buy' || t.status === 'Por Comprar');
    const toolsBroken = tools.filter(t => t.status === 'broken');

    const matsInStock = materials.filter(m => m.status === 'in_stock');
    const matsToBuy = materials.filter(m => m.status === 'to_buy');
    const matsOutOfStock = materials.filter(m => m.status === 'out_of_stock');

    let text = `### CONTEXTO DE INVENTARIO Y TALLER (WORKSHOP OS)\n\n`;
    text += `**HERRAMIENTAS EN TALLER (${tools.length} total):**\n`;
    if (toolsAvailable.length > 0) text += `• Disponibles: ${toolsAvailable.map(t => `${t.name} [${t.category}]`).join(', ')}\n`;
    if (toolsInUse.length > 0) text += `• En Uso/Mantenimiento: ${toolsInUse.map(t => `${t.name} [${t.category}]`).join(', ')}\n`;
    if (toolsToBuy.length > 0) text += `• Por Comprar / Faltantes: ${toolsToBuy.map(t => `${t.name} [${t.category}]`).join(', ')}\n`;
    if (toolsBroken.length > 0) text += `• Requieren Reemplazo/Reparación: ${toolsBroken.map(t => `${t.name} [${t.category}]`).join(', ')}\n`;
    if (tools.length === 0) text += `• No hay herramientas registradas aún.\n`;

    text += `\n**MATERIALES Y INSUMOS EN STOCK (EN TALLER):**\n`;
    if (matsInStock.length > 0) {
      matsInStock.forEach(m => {
        text += `• ${m.name}: ${m.quantity} ${m.unit} [${m.category}] (Proyecto: ${m.project_name || 'General'})\n`;
      });
    } else {
      text += `• No hay materiales registrados en stock.\n`;
    }

    text += `\n**MATERIALES Y HERRAMIENTAS POR COMPRAR / AGOTADOS:**\n`;
    if (matsToBuy.length > 0 || matsOutOfStock.length > 0 || toolsToBuy.length > 0) {
      matsToBuy.forEach(m => {
        text += `• [MATERIAL POR COMPRAR] ${m.name}: ${m.quantity} ${m.unit} [${m.category}]\n`;
      });
      matsOutOfStock.forEach(m => {
        text += `• [MATERIAL AGOTADO] ${m.name}: ${m.quantity} ${m.unit} [${m.category}]\n`;
      });
      toolsToBuy.forEach(t => {
        text += `• [HERRAMIENTA POR COMPRAR] ${t.name} [${t.category}]${t.notes ? ` (Notas: ${t.notes})` : ''}\n`;
      });
    } else {
      text += `• No hay lista de compras pendiente.\n`;
    }

    res.json({
      success: true,
      text,
      summary: {
        total_tools: tools.length,
        total_materials: materials.length,
        in_stock: matsInStock.length,
        to_buy: matsToBuy.length + matsOutOfStock.length + toolsToBuy.length
      }
    });
  } catch (err: any) {
    console.error('Error generating inventory export context:', err);
    res.status(500).json({ error: err.message });
  }
}
