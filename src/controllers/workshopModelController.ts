import { AuthenticatedRequest } from '../auth.js';
import fs from 'fs';
import path from 'path';
import { assertCanUploadModel, getUserEffectiveLimits, QuotaExceededError } from '../services/limitsService.js';

const MODELS_DIR = path.join(process.cwd(), 'data', 'models');

function ensureModelsDir() {
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }
}

function findExistingUserFiles(userId: number): string[] {
  ensureModelsDir();
  const files = fs.readdirSync(MODELS_DIR);
  return files.filter(file => file.startsWith(`user_${userId}_`));
}

export function getModelStatus(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const existing = findExistingUserFiles(userId);
    if (existing.length === 0) {
      return res.json({ hasModel: false });
    }
    const filename = existing[0];
    const filePath = path.join(MODELS_DIR, filename);
    const stat = fs.statSync(filePath);
    return res.json({
      hasModel: true,
      filename,
      updatedAt: stat.mtime.toISOString(),
      size: stat.size
    });
  } catch (err: any) {
    console.error('[3D Model] Error checking status:', err);
    return res.status(500).json({ error: 'Error al consultar estado del modelo 3D' });
  }
}

export function getLatestModel(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const existing = findExistingUserFiles(userId);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'No existe un modelo 3D guardado' });
    }
    const filename = existing[0];
    const filePath = path.join(MODELS_DIR, filename);
    const ext = path.extname(filename).toLowerCase();

    let contentType = 'application/octet-stream';
    if (ext === '.glb') contentType = 'model/gltf-binary';
    else if (ext === '.gltf') contentType = 'model/gltf+json';
    else if (ext === '.obj') contentType = 'text/plain';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    return res.sendFile(filePath);
  } catch (err: any) {
    console.error('[3D Model] Error fetching latest model:', err);
    return res.status(500).json({ error: 'Error al obtener el archivo 3D' });
  }
}

export function deleteModel(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    const existing = findExistingUserFiles(userId);
    for (const file of existing) {
      try {
        fs.unlinkSync(path.join(MODELS_DIR, file));
      } catch (_) {}
    }
    return res.json({ success: true, message: 'Modelo 3D eliminado' });
  } catch (err: any) {
    console.error('[3D Model] Error deleting model:', err);
    return res.status(500).json({ error: 'Error al eliminar modelo 3D' });
  }
}

export function uploadModel(req: AuthenticatedRequest, res: any) {
  try {
    const userId = req.user!.id;
    ensureModelsDir();

    const rawFilename = (req.headers['x-filename'] as string) || (req.query.filename as string) || 'model.glb';
    const originalExt = path.extname(rawFilename).toLowerCase();

    const allowedExts = ['.glb', '.gltf', '.obj'];
    const finalExt = allowedExts.includes(originalExt) ? originalExt : '.glb';

    const limits = getUserEffectiveLimits(userId);
    const maxSizeBytes = limits.max_model_size_mb * 1024 * 1024;

    const chunks: Buffer[] = [];
    let totalLength = 0;

    req.on('data', (chunk: Buffer) => {
      totalLength += chunk.length;
      if (totalLength > maxSizeBytes) {
        req.destroy(new Error('LIMIT_EXCEEDED'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const fileBuffer = Buffer.concat(chunks);
      if (fileBuffer.length === 0) {
        return res.status(400).json({ error: 'El archivo enviado está vacío' });
      }

      try {
        assertCanUploadModel(userId, fileBuffer.length);
      } catch (quotaErr: any) {
        return res.status(413).json({ error: quotaErr.message });
      }

      // Eliminar modelos anteriores del usuario (estricta sobreescritura 1 solo modelo)
      const existing = findExistingUserFiles(userId);
      for (const file of existing) {
        try {
          fs.unlinkSync(path.join(MODELS_DIR, file));
        } catch (_) {}
      }

      const targetFilename = `user_${userId}_latest${finalExt}`;
      const targetPath = path.join(MODELS_DIR, targetFilename);
      fs.writeFileSync(targetPath, fileBuffer);

      return res.json({
        success: true,
        filename: targetFilename,
        size: fileBuffer.length,
        message: 'Modelo 3D guardado exitosamente'
      });
    });

    req.on('error', (err: any) => {
      if (err.message === 'LIMIT_EXCEEDED') {
        return res.status(413).json({ error: `El archivo excede el límite permitido de ${limits.max_model_size_mb} MB` });
      }
      console.error('[3D Model] Upload stream error:', err);
      return res.status(500).json({ error: 'Error durante la subida del modelo' });
    });
  } catch (err: any) {
    console.error('[3D Model] Upload error:', err);
    return res.status(500).json({ error: err.message || 'Error en servidor' });
  }
}
