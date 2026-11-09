import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogBatcher } from "../../web/src/util/log-batch.js";
import type { LogLine } from "../../web/src/util/log-line.js";

// The backend log stream's batching: per-RPC lines reach the Output panel's
// state once per window, every line kept, in order.

const line = (text: string): LogLine => ({ level: "info", text });

describe("createLogBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flushes every pushed line once per window, in order", () => {
    const flushes: string[][] = [];
    const b = createLogBatcher((lines) => flushes.push(lines.map((l) => l.text)), 100);
    b.push([line("a")]);
    b.push([line("b"), line("c")]);
    expect(flushes).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(flushes).toEqual([["a", "b", "c"]]);
    b.push([line("d")]);
    vi.advanceTimersByTime(100);
    expect(flushes).toEqual([["a", "b", "c"], ["d"]]);
  });

  it("does not schedule a flush for an empty push", () => {
    const flush = vi.fn();
    const b = createLogBatcher(flush, 100);
    b.push([]);
    vi.advanceTimersByTime(1000);
    expect(flush).not.toHaveBeenCalled();
  });

  it("clear drops queued lines so they never land after the stream was cleared", () => {
    const flush = vi.fn();
    const b = createLogBatcher(flush, 100);
    b.push([line("stale")]);
    b.clear();
    vi.advanceTimersByTime(1000);
    expect(flush).not.toHaveBeenCalled();
    b.push([line("fresh")]);
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledWith([line("fresh")]);
  });
});
