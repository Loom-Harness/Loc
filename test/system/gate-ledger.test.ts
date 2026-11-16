import { describe, expect, it } from "vitest";
import {
  buildGateLedger,
  COMPILE_LEGS,
  cellId,
  renderLedger,
  skipKeys,
} from "../_helpers/gate-ledger.js";
import { expectedFailure } from "../behavioral/registers.mjs";
import { BACKENDS } from "../fixtures/corpus/backends.js";
import { CORPUS } from "../fixtures/corpus/manifest.js";

// ---------------------------------------------------------------------------
// The gate ledger's own gate.
//
// `test/_helpers/gate-ledger.ts` joins four registers that each already have a
// gate — the corpus manifest, the per-leg compile skip maps, `BEHAVIOURAL_SKIP`
// + the behavioural-block predicate, and the committed wire goldens.  The join
// answers the question none of them can alone: for a given (feature × backend)
// cell, WHAT IS THE STRONGEST GATE WATCHING IT.
//
// Two things ride on that answer.
//
// 1. THE SILENT-GAP SURFACE.  A cell held up by generation alone emits and is
//    never compiled or booted — the class `https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/quality-audit-2026-08.md`
//    §3 measures as found by episodic audit (~58%) rather than by a gate.  The
//    tree is at ZERO such cells, so this is zero-tolerance rather than a
//    ratchet: the first one fails here instead of waiting for the next audit.
//
// 2. THE DRAIN AUTHORITY.  `https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/verification-architecture-2026-08-31.md`
//    drains the per-target string tier under one rule — a `toContain` test may
//    go when its cell is watched by something stronger.  `BEHAVIOURAL_ABSENT`
//    below is the exception list that rule reads: those cells are watched by a
//    COMPILE gate only, so nothing there proves runtime behaviour and their
//    string tests keep carrying claims no other gate makes.
//
// WHY THE REGISTER IS BOTH-DIRECTIONS EXACT.  A one-directional "must be
// listed" check rots the way `gated-features-inventory.md` did: entries outlive
// the gap.  Asserting set EQUALITY means a feature that gains a behavioural
// block fails here until its entry is deleted — the fix removes its own waiver,
// which is the ratchet convention the rest of the repo already runs on.
// ---------------------------------------------------------------------------

/**
 * Corpus features whose cells reach the COMPILE tier and stop — they generate
 * and their emitted project builds, but nothing boots them, so no gate
 * observes what they do at runtime.
 *
 * Each entry is a behavioural-tier gap with a reason, not a permanent
 * exemption; #4099 owns draining them.  An entry is the fixture sidecar's
 * `behaviouralAbsent` (`test/fixtures/corpus/<id>.corpus.json`), so two changes
 * signing different fixtures edit different files.  Removing it is how a landed
 * `test e2e` block re-arms the cell — and the equality assertion below makes
 * that removal mandatory rather than optional.
 */
const BEHAVIOURAL_ABSENT: Record<string, string> = Object.fromEntries(
  CORPUS.filter((f) => f.behaviouralAbsent !== undefined).map((f) => [
    f.id,
    f.behaviouralAbsent as string,
  ]),
);

describe("gate ledger", () => {
  const ledger = buildGateLedger();

  it("every backend has a corpus compile leg", () => {
    expect(ledger.backendsWithoutCompileLeg).toEqual([]);
    expect(Object.keys(COMPILE_LEGS).sort()).toEqual([...BACKENDS].sort());
  });

  it("no cell is held up by generation alone", () => {
    // A cell here emits and is never compiled or booted.  Fix the emitter or
    // the leg — do not add an exemption; `generate` is not a gate, it is the
    // floor every other tier stands on.
    expect(ledger.generateOnly.map(cellId)).toEqual([]);
  });

  it("the cells that stop at the compile tier are exactly the signed ones", () => {
    const actual = [...new Set(ledger.compileOnly.map((c) => c.feature))].sort();
    const signed = Object.keys(BEHAVIOURAL_ABSENT).sort();
    // Both directions on purpose: a NEW compile-only feature needs a reason,
    // and a feature that gained a behavioural block must lose its entry.
    expect(actual).toEqual(signed);
  });

  it("a compile-only feature is compile-only on EVERY backend it declares", () => {
    // The behavioural block lives in the shared `.ddd`, so a feature either
    // boots everywhere it is declared or nowhere.  A split would mean a
    // per-backend `BEHAVIOURAL_SKIP` entry is doing the hiding, and the
    // per-feature register above would be the wrong shape to describe it.
    const split = [...new Set(ledger.cells.map((c) => c.feature))].filter((f) => {
      const cs = ledger.cells.filter((c) => c.feature === f);
      // A tracked expected failure is booted and ratcheted by its own
      // `BEHAVIOURAL_XFAIL` entry — not hidden — so it is no split.
      return cs.some((c) => c.behavioural) && cs.some((c) => !c.behavioural && !c.expectedFailure);
    });
    expect(split).toEqual([]);
  });

  it("every e2e-declaring case that boots has a golden to compare against", () => {
    // The strong half of the behavioural tier.  `wire-golden-coverage.test.ts`
    // owns this from the runners' side; asserting it off the LEDGER's own
    // derivation is what keeps the ledger from scoring an uncompared recording
    // as `behavioural` — the "silently-off gate" failure.
    // A case the node ORACLE is expected to fail has no answer key to capture
    // yet; its `BEHAVIOURAL_XFAIL` entry fails node the day it passes.
    const uncompared = ledger.cells
      .filter((c) => c.boots && c.declaresE2e && !c.golden)
      .filter((c) => expectedFailure("node", c.feature) === null)
      .map(cellId);
    expect(uncompared).toEqual([]);
  });

  describe("the derivation itself", () => {
    // A ledger whose inputs quietly return nothing reports its BEST news
    // (everything compiles, nothing is a gap) exactly when it has gone blind.
    // These pin the two readers that could do that.

    it("skipKeys reads a POPULATED register — it can see keys at all", () => {
      // Every corpus COMPILE_SKIP / UNSUPPORTED map in the tree is now drained
      // to empty, so a parser that returned `[]` unconditionally would pass
      // every other assertion in this file while scoring the whole matrix as
      // compiled.  The subject MOVED here in wave C2 packet 2b: it used to be
      // `DAPPER_UNSUPPORTED`, whose last entry (`tenancy-hierarchy`) drained
      // when the Dapper adapter learned the hierarchical subtree predicate —
      // draining the very register that made the drained readings mean
      // something.  The subject is now a populated source table rather than a
      // register: the primitive → pack-chrome map, whose `Loader` entry is a
      // fixed fact (a spinner always carries its "Loading" name), so it cannot
      // drain out from under this guard the way a TODO register does.
      expect(skipKeys("src/generator/_walker/i18n-chrome.ts", "CHROME_BY_PRIMITIVE")).toContain(
        "Loader",
      );
    });

    it("skipKeys is not fooled by the prose a drained register leaves behind", () => {
      // The drained elixir map is comment-only, and its comments NAME feature
      // ids (``// B19 (`seed-values`) is FIXED``).  Reading those as keys would
      // mark real, compiling cells as uncompiled.
      expect(skipKeys("test/e2e/corpus-elixir-build.test.ts", "ELIXIR_COMPILE_SKIP")).toEqual([]);
    });

    it("skipKeys throws on a register it cannot find, rather than reporting none", () => {
      expect(() => skipKeys("test/e2e/corpus-tsc-build.test.ts", "NO_SUCH_SKIP")).toThrow(
        /not found/,
      );
    });

    it("the ledger covers every declared manifest cell", () => {
      // Guards the join's own arithmetic: a `.filter` that silently dropped a
      // backend would shrink the ledger and every count with it.
      const perBackend = BACKENDS.map((b) => ledger.cells.filter((c) => c.backend === b).length);
      expect(perBackend.every((n) => n > 0)).toBe(true);
      expect(ledger.cells.length).toBe(
        ledger.counts.behavioural + ledger.counts.compile + ledger.counts.generate,
      );
    });
  });

  it("renders a report on demand", () => {
    const md = renderLedger(ledger);
    expect(md).toContain("| feature |");
    if (process.env.LOOM_LEDGER_REPORT === "1") console.log(md);
  });
});
