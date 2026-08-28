const activeEvaluationLocks = new Map<number, number>();
let lockTimeoutMsOverride: number | null = null;

export const LOCK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutos

export function setLockTimeoutForTest(ms: number | null): void {
  lockTimeoutMsOverride = ms;
}

export function getEffectiveLockTimeoutMs(): number {
  return lockTimeoutMsOverride ?? LOCK_TIMEOUT_MS;
}

export function isEvaluationInProgress(userId: number): boolean {
  const lockTimestamp = activeEvaluationLocks.get(userId);
  if (!lockTimestamp) {
    return false;
  }

  const now = Date.now();
  const timeoutMs = getEffectiveLockTimeoutMs();
  const elapsedMs = now - lockTimestamp;

  if (elapsedMs > timeoutMs) {
    const elapsedSec = Math.round(elapsedMs / 1000);
    console.warn(`[Scheduler] ALERTA: lock de evaluación para usuario ${userId} liberado por timeout de seguridad (${elapsedSec}s transcurridos) — investigar causa.`);
    activeEvaluationLocks.delete(userId);
    return false;
  }

  return true;
}

export function acquireEvaluationLock(userId: number): boolean {
  if (isEvaluationInProgress(userId)) {
    return false;
  }

  activeEvaluationLocks.set(userId, Date.now());
  return true;
}

export function releaseEvaluationLock(userId: number): void {
  activeEvaluationLocks.delete(userId);
}
