// The completion plan's §1 denominators must be COMPUTED, not remembered
// (experience_gathered.md §91), and the thing that computes them must not be
// allowed to drift from the files it reads.
//
// §1 of `docs/new-plan/completion-waves-2026-09.md` is the programme's
// scoreboard: ten registers that must read zero before "all done" means
// anything. It was hand-copied from the files, and it disagreed with them
// within a day — the table says 50 `gap` + 10 `scope` and ledger P2 14, while
// the files say 49 + 11 and P2 13. `scripts/completion-denominators.mjs` is the
// fix; this file is what stops the fix from becoming the next stale cache.
//
// THE SHAPE OF THE GATE — two independent derivations, one comparison. The
// script reads each register by scanning the source TEXT (it is a plain `.mjs`
// a human runs with no build step, and most of these registers live in
// TypeScript). This test re-derives every number a DIFFERENT way: by importing
// the real module where the register is exported, and by a line-shaped regex
// where it is embedded in a `.test.ts` that cannot be imported without running
// it. If the scanner is wrong — and it silently WAS twice while being written,
// once landing inside the type annotation (`readonly string[]` / `Record<…, {…}>`
// both open a bracket before the `=`, so every array read as empty) and once
// missing `KNOWN_HEEX_GAPS`'s single BARE `DataGrid:` key — this comparison is
// what says so.
//
// MUTATION PROOFS (run by hand, each reverted by file copy — never
// `git checkout --`, per experience_gathered.md §84):
//
//   1. `literalStart` reverted to `src.indexOf(bracket, decl)` — the version
//      that lands in the TYPE annotation.
//      → 2 failed / 5 passed: `expected +0 to be 13` (the three importable pin
//        registers) and `expected 2 to be 4` (the two test-embedded freezes —
//        2, not 0, because `Record<string, { reason: string; mission: … }>`
//        has two keys of its own for a type-annotation reader to find). This is
//        the exact defect the first draft shipped, and it printed a table of
//        zeroes that read like a fully drained register.
//   2. The `ident` arm dropped from `scanLiteral` (quoted keys only).
//      → 1 failed / 6: `expected +0 to be 1` — `KNOWN_HEEX_GAPS`'s single
//        `DataGrid` pin, spelled bare, vanishes.
//   3. `registerKindCounts`'s regex changed to match `kind: '…'` (single
//        quotes), so it reads the register and finds nothing.
//      → 2 failed / 5: `expected 0 to be greater than 10` (the vacuity guard
//        firing exactly as designed) and `expected +0 to be 49`.
//
// AND ONE MUTATION THAT PROVED NOTHING, recorded so nobody repeats it: retyping
// a real `kind: "gap"` row in `unsupported-register.ts` to `"scope"` leaves all
// 7 green. That is CORRECT — both derivations read the same file, so a genuine
// content change moves them in lockstep. This gate exists to catch the SCRIPT
// drifting from the register, not to freeze the register's contents; the pin on
// the contents is `MAX_OPEN_GAPS` in `unsupported-register.test.ts`. A mutation
// that passes is not a weaker proof, it is no proof — hence #3 above, which
// varies the reader instead of the data (experience_gathered.md §59/§63).
//
// The vacuity guard is `every register is non-trivial`: a scanner that returned
// 0 for everything would agree with an in-test derivation that also returned 0,
// so the suite asserts the registers are actually populated first.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script, no type declarations by design
import { computeDenominators } from "../../scripts/completion-denominators.mjs";
import { UNSUPPORTED_REGISTER } from "../../src/diagnostics/unsupported-register.js";
import { E2E_LESS_CORPUS_FIXTURES } from "../ir/api-caller-census-pins.js";
import { NON_PARSING_SOURCES } from "../ir/authz-gate-census-pins.js";
import { COMPILE_WAIVERS } from "../pairwise/waivers-compile.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), "utf8");

/** Independent derivation for a register EMBEDDED in a `.test.ts` (importing
 *  the file would run its `describe`s). Takes the declaration's block by line
 *  and counts key-shaped lines — a different method from the script's
 *  character scanner, which is the point. */
function keyLinesIn(rel: string, decl: string): number {
  const lines = read(rel).split("\n");
  const start = lines.findIndex((l) => l.startsWith(`const ${decl}`));
  expect(start, `${decl} not found in ${rel}`).toBeGreaterThan(-1);
  let count = 0;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("};")) break;
    if (/^ {2}(?:[A-Za-z_$][A-Za-z0-9_$]*|"(?:[^"\\]|\\.)*")\s*:/.test(lines[i])) count++;
  }
  return count;
}

type Denoms = Awaited<ReturnType<typeof computeDenominators>>;

describe("the completion plan's §1 denominators are computed, not remembered (§91)", () => {
  let d: Denoms;

  it("the script runs and every register is non-trivial — the vacuity guard", async () => {
    d = await computeDenominators();
    // A scanner that returned 0 everywhere would agree with an in-test
    // derivation that also returned 0, so assert a real denominator first.
    expect(d.unsupportedRegister.gap).toBeGreaterThan(10);
    expect(d.ledgerOpen).toBeGreaterThan(50);
    expect(d.missions.live).toBeGreaterThan(100);
    expect(d.testTypecheckBaseline.files).toBeGreaterThan(50);
  });

  it("unsupported-register gap/scope match the imported module", async () => {
    d ??= await computeDenominators();
    const gap = UNSUPPORTED_REGISTER.filter((e) => e.kind === "gap").length;
    const scope = UNSUPPORTED_REGISTER.filter((e) => e.kind === "scope").length;
    expect(d.unsupportedRegister.gap).toBe(gap);
    expect(d.unsupportedRegister.scope).toBe(scope);
  });

  it("the three importable pin registers match their modules", async () => {
    d ??= await computeDenominators();
    expect(d.e2eLessCorpusFixtures).toBe(E2E_LESS_CORPUS_FIXTURES.length);
    expect(d.nonParsingSources).toBe(NON_PARSING_SOURCES.length);
    expect(d.pairwiseCompileWaivers).toBe(COMPILE_WAIVERS.length);
  });

  it("the two test-embedded freezes match a line-shaped re-count", async () => {
    d ??= await computeDenominators();
    expect(d.flutterFormFieldFreeze).toBe(
      keyLinesIn("test/generator/flutter/parity-freeze.test.ts", "KNOWN_FLUTTER_GAPS"),
    );
    expect(d.heexParityPins).toBe(
      keyLinesIn("test/generator/elixir/heex-parity.test.ts", "KNOWN_HEEX_GAPS"),
    );
  });

  it("the ledger, waivers and typecheck baseline match their own JSON", async () => {
    d ??= await computeDenominators();
    const ledger = JSON.parse(read("docs/audits/targets-completeness-2026-08-30.ledger.json"));
    expect(d.ledgerOpen).toBe(ledger.open.length);
    for (let p = 0; p <= 5; p++) {
      const n = ledger.open.filter((r: { P: number }) => r.P === p).length;
      expect(d.ledgerByPriority[`P${p}`], `ledger P${p}`).toBe(n);
    }

    const waivers = JSON.parse(read("test/behavioral/schemathesis-waivers.json"));
    expect(d.schemathesisWaiverRules).toBe(waivers.waivers.length);

    const baseline: Record<string, number> = JSON.parse(read("test-typecheck-baseline.json"));
    expect(d.testTypecheckBaseline.files).toBe(Object.keys(baseline).length);
    expect(d.testTypecheckBaseline.errors).toBe(Object.values(baseline).reduce((a, b) => a + b, 0));
  });

  it("the mission counts match a direct heading count over the track files", async () => {
    d ??= await computeDenominators();
    const planDir = path.join(repoRoot, "docs/new-plan");
    const countHeadings = (file: string): number =>
      (read(path.relative(repoRoot, file)).match(/^## M-T\d+\.\d+\b/gm) ?? []).length;

    const trackFiles = fs
      .readdirSync(planDir)
      .filter((f) => /^T\d+[-.].*\.md$/.test(f))
      .map((f) => path.join(planDir, f));
    const live = trackFiles.reduce((a, f) => a + countHeadings(f), 0);
    expect(d.missions.live).toBe(live);

    const archiveDir = path.join(planDir, "archive");
    const archived = fs
      .readdirSync(archiveDir)
      .filter((f) => /^T\d+-done\.md$/.test(f))
      .reduce((a, f) => a + countHeadings(path.join(archiveDir, f)), 0);
    expect(d.missions.archived).toBe(archived);
  });

  it("the plan's §1 tells the reader to regenerate rather than trust the table", () => {
    const plan = read("docs/new-plan/completion-waves-2026-09.md");
    expect(plan).toContain("node scripts/completion-denominators.mjs");
  });
});
