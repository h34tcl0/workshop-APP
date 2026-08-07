import { describe, it, expect, beforeEach, vi } from "vitest";
import { store, initDatabase } from "../src/db.js";
import {
  acquireEvaluationLock,
  releaseEvaluationLock,
  isEvaluationInProgress,
  runMorningEvaluation
} from "../src/scheduler.js";

describe("Evaluation Concurrency & Locking Unit Tests", () => {
  const userId = 1;

  beforeEach(async () => {
    await initDatabase();
    // Ensure lock is clean
    releaseEvaluationLock(userId);
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
});
