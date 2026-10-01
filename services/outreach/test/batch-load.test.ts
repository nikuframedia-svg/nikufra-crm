import { describe, expect, it } from "vitest";
import { runConcurrentBatch } from "../src/batch.js";

describe("scheduler batch executor", () => {
  it("processes a 3× initial-volume batch exactly once with bounded concurrency", async () => {
    const jobs = Array.from({ length: 3_048 }, (_, index) => `job-${index}`);
    const seen = new Set<string>();
    let active = 0;
    let maxActive = 0;
    const results = await runConcurrentBatch(jobs, async (job) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (seen.has(job)) throw new Error("duplicate");
      seen.add(job);
      await Promise.resolve();
      active -= 1;
      return job;
    }, 12);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(seen.size).toBe(jobs.length);
    expect(maxActive).toBeLessThanOrEqual(12);
  });
});
