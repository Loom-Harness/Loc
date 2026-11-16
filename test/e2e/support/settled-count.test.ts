import { describe, expect, it } from "vitest";
import { settledCount } from "./settled-count.js";

/** A count that grows to the given values at the given offsets (ms). */
function growing(steps: readonly [number, number][]): () => number {
  const t0 = Date.now();
  return () => {
    const at = Date.now() - t0;
    let n = 0;
    for (const [ms, v] of steps) if (at >= ms) n = v;
    return n;
  };
}

describe("settledCount", () => {
  it("waits for a line that lands after the effects are visible", async () => {
    const read = growing([
      [0, 5],
      [150, 6],
    ]);
    expect(await settledCount(read, 6, { stableMs: 100 })).toBe(6);
  });

  it("still counts a duplicate line that lands after the expected count was reached", async () => {
    const read = growing([
      [0, 6],
      [60, 7],
    ]);
    expect(await settledCount(read, 6, { stableMs: 150 })).toBe(7);
  });

  it("returns the short count when the line never comes", async () => {
    expect(await settledCount(() => 5, 6, { timeoutMs: 100, stableMs: 50 })).toBe(5);
  });
});
