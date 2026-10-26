import { describe, expect, it } from "vitest";
import {
  installPlaywrightChromium,
  PLAYWRIGHT_INSTALL_ATTEMPTS,
  PLAYWRIGHT_INSTALL_BACKOFF_MS,
  PLAYWRIGHT_INSTALL_CMD,
} from "./playwright-install.js";

function harness(failures: number) {
  const calls: { cmd: string; cwd: string; timeout: number }[] = [];
  const waits: number[] = [];
  const exec = (cmd: string, opts: { cwd: string; timeout: number }) => {
    calls.push({ cmd, ...opts });
    if (calls.length <= failures) throw new Error(`spawnSync /bin/sh ETIMEDOUT\n(stdout)`);
  };
  return {
    calls,
    waits,
    run: () =>
      installPlaywrightChromium("/tmp/e2e", { exec, wait: (ms) => waits.push(ms), log: () => {} }),
  };
}

describe("installPlaywrightChromium", () => {
  it("runs the install once when it succeeds", () => {
    const h = harness(0);
    h.run();
    expect(h.calls).toEqual([
      { cmd: PLAYWRIGHT_INSTALL_CMD, cwd: "/tmp/e2e", timeout: expect.any(Number) },
    ]);
    expect(h.waits).toEqual([]);
  });

  it("retries a stalled fetch with the backoff, then succeeds", () => {
    const h = harness(PLAYWRIGHT_INSTALL_ATTEMPTS - 1);
    h.run();
    expect(h.calls).toHaveLength(PLAYWRIGHT_INSTALL_ATTEMPTS);
    expect(h.waits).toEqual([...PLAYWRIGHT_INSTALL_BACKOFF_MS]);
  });

  it("throws after the last attempt, naming every attempt's cause", () => {
    const h = harness(PLAYWRIGHT_INSTALL_ATTEMPTS);
    expect(() => h.run()).toThrow(
      /failed 3 times:\nattempt 1: spawnSync \/bin\/sh ETIMEDOUT\nattempt 2: .*\nattempt 3: /,
    );
    expect(h.calls).toHaveLength(PLAYWRIGHT_INSTALL_ATTEMPTS);
  });
});
