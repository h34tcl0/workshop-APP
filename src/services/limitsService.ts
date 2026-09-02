import path from 'path';
import fs from 'fs';
import { store } from '../db.js';

export class QuotaExceededError extends Error {
  public code = 'QUOTA_EXCEEDED';
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export function getUserEffectiveLimits(userId: number) {
  const custom = store.getAccountLimits(userId);
  const sys = store.getSystemSettings();

  return {
    max_projects: custom?.max_projects ?? sys.default_max_projects,
    max_tasks: custom?.max_tasks ?? sys.default_max_tasks,
    max_storage_mb: custom?.max_storage_mb ?? sys.default_max_storage_mb,
    max_model_size_mb: Math.min(
      custom?.max_model_size_mb ?? sys.default_max_model_size_mb,
      sys.absolute_max_model_size_mb
    ),
    absolute_max_model_size_mb: sys.absolute_max_model_size_mb
  };
}

export function getStorageUsageMb(userId: number): number {
  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), 'data');
  const modelsDir = path.join(dataDir, 'models');
  if (!fs.existsSync(modelsDir)) return 0;

  try {
    const files = fs.readdirSync(modelsDir).filter(f => f.startsWith(`user_${userId}_`));
    let totalBytes = 0;
    for (const file of files) {
      const filePath = path.join(modelsDir, file);
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          totalBytes += stat.size;
        }
      }
    }
    return Math.round((totalBytes / (1024 * 1024)) * 100) / 100;
  } catch (err) {
    console.error(`[LIMITS] Error calculating storage usage for user #${userId}:`, err);
    return 0;
  }
}

export function assertCanCreateProject(userId: number): void {
  const limits = getUserEffectiveLimits(userId);
  const currentCount = store.getProjects(userId).length;
  if (currentCount >= limits.max_projects) {
    throw new QuotaExceededError(`Has alcanzado el límite máximo permitido de ${limits.max_projects} proyecto(s).`);
  }
}

export function assertCanCreateTask(userId: number): void {
  const limits = getUserEffectiveLimits(userId);
  const currentCount = store.getTasks(userId).length;
  if (currentCount >= limits.max_tasks) {
    throw new QuotaExceededError(`Has alcanzado el límite máximo permitido de ${limits.max_tasks} tarea(s).`);
  }
}

export function assertCanUploadModel(userId: number, fileSizeBytes: number): void {
  const limits = getUserEffectiveLimits(userId);
  const fileSizeMb = Math.round((fileSizeBytes / (1024 * 1024)) * 100) / 100;

  if (fileSizeMb > limits.absolute_max_model_size_mb) {
    throw new QuotaExceededError(
      `El modelo (${fileSizeMb} MB) supera el límite absoluto de la plataforma (${limits.absolute_max_model_size_mb} MB).`
    );
  }

  if (fileSizeMb > limits.max_model_size_mb) {
    throw new QuotaExceededError(
      `El modelo (${fileSizeMb} MB) supera tu cuota permitida de ${limits.max_model_size_mb} MB por modelo.`
    );
  }

  const currentStorageMb = getStorageUsageMb(userId);
  if (currentStorageMb + fileSizeMb > limits.max_storage_mb) {
    throw new QuotaExceededError(
      `La subida excede tu cuota total de almacenamiento (${limits.max_storage_mb} MB). Uso actual: ${currentStorageMb} MB.`
    );
  }
}
