// The schemathesis leg's staleness ratchet must not fire on a run that never
// happened (M-T9.21).
//
// A rule that matches nothing fails the leg — deliberately, because a fixed
// root cause has to force its waiver's deletion in the same PR. But "matched
// nothing" and "never ran" are indistinguishable from inside the attribution
// pass, and the message the ratchet prints is an INSTRUCTION:
//
//     ✗ STALE WAIVER W8 … drop this leg from the rule's `backends`
//
// Observed 2026-09-10 while re-running the legs locally: `uv sync` could not
// fetch a wheel from pythonhosted (a transient network failure, three runs in a
// row), both python cases errored before the fuzzer started — and the leg
// reported "3 problem(s)", two boot errors plus that staleness verdict against
// W8, a by-design rule that reproduces on every backend. The run was already
// failing on the boot errors; what must not happen is the register being edited
// because of them. `experience_gathered.md` §63's shape: a check that never
// reached the thing it names, reporting on it anyway.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// The leg core is plain ESM over node builtins only — importable straight from
// test/behavioral without that workspace's own deps.
// @ts-expect-error — untyped .mjs harness module
import { fuzzLeg } from "../behavioral/schemathesis-core.mjs";

/** Drive one leg with a `boot` of our choosing and capture what it printed.
 *  `fuzzLeg` owns the exit code and never returns, so `process.exit` is stubbed
 *  to throw a sentinel the caller unwinds on. */
async function runLeg(boot: (c: { name: string }) => Promise<unknown>): Promise<{
  out: string;
  code: number;
}> {
  const work = mkdtempSync(join(tmpdir(), "loom-st-ratchet-"));
  let out = "";
  let code = -1;
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  const exit = vi.spyOn(process, "exit").mockImplementation(((c: number) => {
    code = c;
    throw new Error("__exit__");
  }) as never);
  const prev = process.env.LOOM_SCHEMATHESIS;
  process.env.LOOM_SCHEMATHESIS = "1";
  try {
    await fuzzLeg({ backend: "java", cases: [{ name: "only-case" }], work, boot, argv: [] });
  } catch (err) {
    if ((err as Error).message !== "__exit__") throw err;
  } finally {
    process.env.LOOM_SCHEMATHESIS = prev;
    write.mockRestore();
    exit.mockRestore();
    rmSync(work, { recursive: true, force: true });
  }
  return { out, code };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("schemathesis leg — a case that never ran cannot make a waiver look stale", () => {
  it("a boot failure suppresses the staleness verdict and says why", async () => {
    const { out, code } = await runLeg(async () => {
      throw new Error("Command failed: uv sync");
    });
    // The run still FAILS — the boot error is a real problem.
    expect(code).toBe(1);
    expect(out).toContain("ERROR: Command failed: uv sync");
    // …but it must not tell anyone to delete a waiver.
    expect(out).not.toContain("STALE WAIVER");
    expect(out).toContain("staleness NOT judged this run");
    expect(out).toContain("only-case");
  });

  it("the java leg really does carry rules, so the check above is reachable", async () => {
    // Guards against the vacuous pass: if `loadRules("java")` returned nothing,
    // the staleness loop would be empty and the assertion above would hold for
    // the wrong reason.
    // @ts-expect-error — untyped .mjs harness module
    const { loadRules } = await import("../behavioral/schemathesis-core.mjs");
    expect(loadRules("java").length).toBeGreaterThan(0);
  });
});
