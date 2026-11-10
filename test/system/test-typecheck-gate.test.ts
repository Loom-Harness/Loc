// Behavioural test of `scripts/test-typecheck.mjs`'s exit contract against a
// fake tsc: a crashed or killed tsc must fail the gate, never read as clean.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "fake-tsc-"));
function fakeTsc(name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}
function gate(tsc: string) {
  const r = spawnSync("node", ["scripts/test-typecheck.mjs"], {
    encoding: "utf8",
    env: { ...process.env, LOOM_TEST_TYPECHECK_TSC: tsc },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("test-typecheck gate", () => {
  it("fails when tsc is killed by a signal", () => {
    const r = gate(fakeTsc("killed.sh", "kill -9 $$"));
    expect(r.status).toBe(1);
    expect(r.out).toContain("typecheck did not run");
  });
  it("fails when tsc exits non-zero with no diagnostics", () => {
    const r = gate(fakeTsc("silent.sh", "exit 2"));
    expect(r.status).toBe(1);
    expect(r.out).toContain("typecheck did not run");
  });
  it("fails when the tsc binary cannot be spawned", () => {
    const r = gate(join(dir, "does-not-exist"));
    expect(r.status).toBe(1);
    expect(r.out).toContain("typecheck did not run");
  });
  it("still reports real diagnostics as type errors", () => {
    const r = gate(
      fakeTsc("errs.sh", "echo \"test/a.test.ts(1,2): error TS2322: bad\"; exit 2"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("1 error(s) under test/");
    expect(r.out).not.toContain("did not run");
  });
  it("passes on a clean tsc", () => {
    const r = gate(fakeTsc("clean.sh", "exit 0"));
    expect(r.status).toBe(0);
  });
});
