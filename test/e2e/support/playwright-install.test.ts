import { describe, expect, it } from "vitest";
import {
  boundedCommand,
  installPlaywrightChromium,
  PLAYWRIGHT_INSTALL_ATTEMPTS,
  PLAYWRIGHT_INSTALL_BACKOFF_MS,
  PLAYWRIGHT_INSTALL_CMD,
  PLAYWRIGHT_INSTALL_DEPS_CMD,
} from "./playwright-install.js";

/** An exec that fails the download `downloadFailures` times, and the deps step
 *  when `depsFails` is set. */
function harness(downloadFailures: number, depsFails = false) {
  const calls: string[] = [];
  const waits: number[] = [];
  const logs: string[] = [];
  let downloads = 0;
  const exec = (cmd: string) => {
    calls.push(cmd);
    if (cmd === PLAYWRIGHT_INSTALL_CMD && ++downloads <= downloadFailures) {
      throw new Error("spawnSync /bin/sh ETIMEDOUT\n(stdout)");
    }
    if (cmd === PLAYWRIGHT_INSTALL_DEPS_CMD && depsFails) {
      throw Object.assign(new Error("Command failed: install-deps"), {
        stderr: "E: Unable to acquire the dpkg frontend lock\n",
      });
    }
  };
  return {
    calls,
    waits,
    logs,
    run: () =>
      installPlaywrightChromium("/tmp/e2e", {
        exec,
        wait: (ms) => waits.push(ms),
        log: (l) => logs.push(l),
      }),
  };
}

describe("installPlaywrightChromium", () => {
  it("downloads the browser, then installs its OS deps, once each when both succeed", () => {
    const h = harness(0);
    h.run();
    expect(h.calls).toEqual([PLAYWRIGHT_INSTALL_CMD, PLAYWRIGHT_INSTALL_DEPS_CMD]);
    expect(h.waits).toEqual([]);
  });

  it("retries a stalled download with the backoff, then succeeds", () => {
    const h = harness(PLAYWRIGHT_INSTALL_ATTEMPTS - 1);
    h.run();
    expect(h.calls.filter((c) => c === PLAYWRIGHT_INSTALL_CMD)).toHaveLength(
      PLAYWRIGHT_INSTALL_ATTEMPTS,
    );
    expect(h.waits).toEqual([...PLAYWRIGHT_INSTALL_BACKOFF_MS]);
  });

  it("throws after the last download attempt, naming every attempt's cause", () => {
    const h = harness(PLAYWRIGHT_INSTALL_ATTEMPTS);
    expect(() => h.run()).toThrow(
      /failed 3 times:\nattempt 1: spawnSync \/bin\/sh ETIMEDOUT\nattempt 2: .*\nattempt 3: /,
    );
    expect(h.calls).not.toContain(PLAYWRIGHT_INSTALL_DEPS_CMD);
  });

  it("only warns when the OS deps step fails — the host's libraries may suffice", () => {
    const h = harness(0, true);
    expect(() => h.run()).not.toThrow();
    expect(h.calls).toEqual([PLAYWRIGHT_INSTALL_CMD, PLAYWRIGHT_INSTALL_DEPS_CMD]);
    expect(h.logs.join("\n")).toContain("Unable to acquire the dpkg frontend lock");
  });

  it("names the child's last stderr line in the cause", () => {
    const exec = () => {
      throw Object.assign(new Error("Command failed: npx playwright install"), {
        stderr: "Downloading Chromium\nError: connect ETIMEDOUT\n",
      });
    };
    expect(() =>
      installPlaywrightChromium("/tmp/e2e", { exec, wait: () => {}, log: () => {} }),
    ).toThrow(/attempt 1: Command failed: npx playwright install — Error: connect ETIMEDOUT/);
  });

  it("bounds the attempt with GNU timeout, which signals the whole process group", () => {
    expect(boundedCommand(PLAYWRIGHT_INSTALL_CMD, 240_000)).toBe(
      `if command -v timeout >/dev/null 2>&1; then timeout -k 15 240 ${PLAYWRIGHT_INSTALL_CMD}; else ${PLAYWRIGHT_INSTALL_CMD}; fi`,
    );
  });
});
