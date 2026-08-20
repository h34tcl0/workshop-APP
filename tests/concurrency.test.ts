import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { store, initDatabase } from "../src/db.js";
import {
  acquireEvaluationLock,
  releaseEvaluationLock,
  isEvaluationInProgress,
  runMorningEvaluation,
  processCheckinForUser,
  setLockTimeoutForTest
} from "../src/scheduler.js";

describe("Evaluation Concurrency & Locking Unit Tests", () => {
  const userId = 1;

  beforeEach(async () => {
    await initDatabase();
    store.updateAppSettings(userId, {
      mock_weather_scenario: "sunny",
      telegram_enabled: false,
      google_calendar_enabled: false
    });
    // Ensure lock is clean
    releaseEvaluationLock(userId);
    setLockTimeoutForTest(null);
  });

  afterEach(() => {
    setLockTimeoutForTest(null);
  });

  it("1. Lock helper functions acquire and release properly per user", () => {
    expect(isEvaluationInProgress(userId)).toBe(false);

    // Acquire lock
    const acquired = acquireEvaluationLock(userId);
    expect(acquired).toBe(true);
    expect(isEvaluationInProgress(userId)).toBe(true);

    // Attempt second acquisition while locked
    const secondAttempt = acquireEvaluationLock(userId);
    expect(secondAttempt).toBe(false);

    // Release lock
    releaseEvaluationLock(userId);
    expect(isEvaluationInProgress(userId)).toBe(false);

    // Acquire again after release
    const reacquired = acquireEvaluationLock(userId);
    expect(reacquired).toBe(true);
    releaseEvaluationLock(userId);
  });

  it("2. Rejects concurrent runMorningEvaluation execution for same user", async () => {
    // Manually lock user
    acquireEvaluationLock(userId);

    // Attempting runMorningEvaluation should throw EVALUATION_IN_PROGRESS
    await expect(
      runMorningEvaluation(userId, "2026-08-10", "sunny")
    ).rejects.toThrow("EVALUATION_IN_PROGRESS");

    // Release lock
    releaseEvaluationLock(userId);

    // Now it should succeed without throwing
    const result = await runMorningEvaluation(userId, "2026-08-10", "sunny");
    expect(result).toBeDefined();
    expect(result.status).toBeDefined();
  });

  it("3. Releases lock automatically in finally block after runMorningEvaluation completes", async () => {
    expect(isEvaluationInProgress(userId)).toBe(false);

    const evalPromise = runMorningEvaluation(userId, "2026-08-10", "sunny");
    
    // While running, lock should be held
    expect(isEvaluationInProgress(userId)).toBe(true);

    await evalPromise;

    // After resolution, lock MUST be released
    expect(isEvaluationInProgress(userId)).toBe(false);
  });

  it("4. Two simultaneous concurrent promises: exactly one completes and one is rejected", async () => {
    expect(isEvaluationInProgress(userId)).toBe(false);

    const promise1 = runMorningEvaluation(userId, "2026-08-10", "sunny");
    const promise2 = runMorningEvaluation(userId, "2026-08-10", "sunny");

    const results = await Promise.allSettled([promise1, promise2]);

    const fulfilledCount = results.filter(r => r.status === "fulfilled").length;
    const rejectedCount = results.filter(r => r.status === "rejected").length;

    expect(fulfilledCount).toBe(1);
    expect(rejectedCount).toBe(1);

    const rejectedReason = (results.find(r => r.status === "rejected") as PromiseRejectedResult)?.reason;
    expect(rejectedReason?.message).toBe("EVALUATION_IN_PROGRESS");

    // Lock is clean after both settle
    expect(isEvaluationInProgress(userId)).toBe(false);
  });

  it("5. Exact tonight scenario: Tier 1 Morning Evaluation followed by Tier 3 Night Check-in in same process session", async () => {
    expect(isEvaluationInProgress(userId)).toBe(false);

    // Step A: Run Tier 1 Morning Evaluation
    const morningResult = await runMorningEvaluation(userId, "2026-08-10", "sunny");
    expect(morningResult).toBeDefined();
    expect(isEvaluationInProgress(userId)).toBe(false);

    // Step B: Run Tier 3 Night Check-in for same user in same session
    // Must NOT be blocked by morning evaluation lock
    const warnSpy = vi.spyOn(console, "warn");
    await processCheckinForUser(userId, new Date("2026-08-10T22:00:00Z"), true);

    const wasBlocked = warnSpy.mock.calls.some(call =>
      call[0] && typeof call[0] === "string" && call[0].includes("Se omitió el check-in")
    );
    expect(wasBlocked).toBe(false);
    expect(isEvaluationInProgress(userId)).toBe(false);
    warnSpy.mockRestore();
  });

  it("6. Safety Lock Timeout: Automatically releases lock if held past timeout limit and logs clear alert", async () => {
    expect(isEvaluationInProgress(userId)).toBe(false);

    // Set test timeout to 100 milliseconds
    setLockTimeoutForTest(100);

    // Acquire lock
    const acquired = acquireEvaluationLock(userId);
    expect(acquired).toBe(true);
    expect(isEvaluationInProgress(userId)).toBe(true);

    // Wait 150ms to exceed 100ms safety timeout
    await new Promise(r => setTimeout(r, 150));

    const warnSpy = vi.spyOn(console, "warn");

    // Lock check or re-acquisition should trigger safety release, log alert, and allow acquisition
    const reacquiredAfterTimeout = acquireEvaluationLock(userId);

    expect(reacquiredAfterTimeout).toBe(true);

    const loggedAlert = warnSpy.mock.calls.some(call =>
      call[0] && typeof call[0] === "string" && call[0].includes("ALERTA: lock de evaluación para usuario 1 liberado por timeout de seguridad")
    );
    expect(loggedAlert).toBe(true);

    releaseEvaluationLock(userId);
    expect(isEvaluationInProgress(userId)).toBe(false);
    warnSpy.mockRestore();
  });
});
