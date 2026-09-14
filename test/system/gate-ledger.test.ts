import { describe, expect, it } from "vitest";
import {
  buildGateLedger,
  COMPILE_LEGS,
  cellId,
  renderLedger,
  skipKeys,
} from "../_helpers/gate-ledger.js";
import { BACKENDS } from "../fixtures/corpus/backends.js";

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
//    never compiled or booted — the class `docs/audits/quality-audit-2026-08.md`
//    §3 measures as found by episodic audit (~58%) rather than by a gate.  The
//    tree is at ZERO such cells, so this is zero-tolerance rather than a
//    ratchet: the first one fails here instead of waiting for the next audit.
//
// 2. THE DRAIN AUTHORITY.  `docs/audits/verification-architecture-2026-08-31.md`
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
 * exemption; M-T9.13 owns draining them.  Removing an entry is how a landed
 * `test e2e` block re-arms the cell — and the equality assertion below makes
 * that removal mandatory rather than optional.
 */
const BEHAVIOURAL_ABSENT: Record<string, string> = {
  "auth-id-claim":
    "an `X id?` user claim is a STATIC contract, and all four of its symptoms are compile-visible on the tier that already gates it: TS2503 (tsc), `cannot find symbol` (gradle), a `CustomerId??` that does not parse (dotnet build), and — the one that reads as a runtime bug — python's missing import, which `corpus-python-build` catches as ruff F821 + mypy `name-defined` before anything boots.  A behavioural block would boot a CRUD round-trip wearing an OIDC hat, which `auth-oidc` already records, and mint a wire golden with no oracle of its own.  NOT a drain candidate for M-T9.13 (docs/audits/2026-09-10-eshop-dev-experience.md §D6/P2, #2869): unlike every sibling here it is not a tier gap, so the honest move if it ever stops paying for itself is to delete the fixture, not to boot it",
  "auth-id-claim-stub":
    "the NON-optional twin of `auth-id-claim`, and compile-visible for the same reason: four of the five dev-stub principal VALUE tables wrote a raw scalar where the emitted id is a nominal type, and two of those are hard compile errors on the tier that already gates the cell — `TS2322: Type 'string' is not assignable to type 'CustomerId'` (tsc, against the `__brand`) and CS0029 (dotnet build, against `readonly record struct CustomerId(Guid)`).  java's arm compiled but carried a NULL strong id; that one IS a runtime shape — and the oracle for it is the emitted value, which the compile tier reads directly, not a booted round-trip.  A behavioural block would boot the same CRUD round-trip `auth-simple` already boots and mint a wire golden whose only new content is the /auth/me projection of a claim the harness's `x-loom-dev-claims` cannot even set (the shared `devClaimKind` classifier carries `string` and `string[]` only, so the id claim keeps its built-in stub value on every backend).  Same disposition as its sibling: NOT a drain candidate for M-T9.13",
  "projection-agg-filters":
    "aggregation × capability filters — the cross-tenant COUNT/SUM leak audit A1 minted this fixture for is a RUNTIME value; the compile tier cannot see a wrong number",
  "projection-document-aggregation":
    "count(*) over a document source — same shape as projection-agg-filters, same blindness",
  outbox: "relay delivery is asynchronous; needs a booted leg that drains the outbox",
  "channels-broker":
    "needs a broker container (the channels-e2e legs boot one; the corpus case does not)",
  "tenancy-hierarchy":
    "the deep/global/local read ladder is a runtime row-visibility question; `test:tenancy-hierarchy-*` boots it outside the corpus tier",
  extern: "the user handler is scaffold-once; a booted leg needs a supplied implementation",
  "extern-handlers": "same scaffold-once shape as `extern`",
  "handler-resource-ops": "outbound I/O inside a handler body; needs the resource's container",
  "handler-triad": "three handler-body shapes; #2652 measured them at generate/compile only",
  resources: "objectStore / queue / api / mailer clients need their containers",
  "api-call":
    "in-system api call; needs both deployables booted (the `api-call-e2e` leg does this outside the corpus tier)",
  "workflow-primitive-params":
    "the question is what a request body OMITS, and the `test e2e` vocabulary cannot pose it — a workflow call there is type-checked against the declared params, so an absent required field is not expressible; the compile tier proves every backend still builds with the boxed components, and the 422 itself is the Schemathesis legs' question",
  "collection-op-shapes":
    "collection-op VALUE semantics (empty sum, avg of none, sort stability) — the exact class a string assertion cannot see",
  "workflow-enum-state":
    'an enum-typed workflow STATE field — both defects it exists for are STATIC and land on the compile tier that already gates it: node named `<Enum>Schema` with the name bound nowhere in the tree (TS2304) and then seeded the fresh saga row with `""` for a column drizzle types as a literal union (TS2345), both caught by corpus-tsc.  The workflow is EVENT-TRIGGERED, so it has no command route to POST and its only api surface is the pair of read-only instance endpoints; reaching them at runtime needs a `ClaimFiled` emitter this fixture deliberately does not have, because the shape under test is the enum in the state row, not the dispatch that fills it — `saga` and `eventsourced-workflow` already boot that dispatch path (#2864 D4/T3)',
  "workflow-command-payload":
    "the defect (#2864 D7/T2) is on the WORKFLOW command route, and the e2e DSL has no form that calls one — a booted caller could only drive the two crudish aggregates, never the payload wire contract the fixture exists for; the five compile legs are its oracle (M-T9.13 owns the drain: POST the payload from an e2e block once the DSL can call a workflow)",
  "projection-fold-statements":
    "ledger row F2-XB-4 — the COMPILE tier is the gate that mattered here (a dropped `let` is CS0103 / 'cannot find symbol'), and `test/conformance/projection-fold-statement-parity.test.ts` sweeps every admitted statement kind on all five per-PR.  What a behavioural block would add is the ACCUMULATED VALUE: a dropped `+=` compiles and leaves the column null forever, which only a booted read can tell from a correct fold.  Blocked on a wire golden per backend, not on the fixture",
  "paged-nonrelational":
    "ledger row F2-CB-C1 — the COMPILE tier is likewise the gate that mattered (CS0535 + CS0029 on .NET), with `test/conformance/paged-nonrelational-parity.test.ts` comparing the declaration, the implementation and the caller's arity per-PR.  What a behavioural block would add is the PAGE ITSELF: an in-memory pager that slices before it sorts, or counts the page instead of the match, compiles and answers plausible JSON.  Same blocker",
  "find-bypass":
    "`find … ignoring tenantOwned` is only observable across TWO principals (does the other tenant's row appear?); the behavioural runners authenticate as one, so a caller would read the same set either way — the same two-principal harness `projection-agg-filters` waits on",
  envelope:
    'the `envelope` carrier is a COMPILE defect (java named an undeclared `Envelope<Order>`, dotnet returned a bare `Order` from `Task<Envelope<Order>>`); the five compile legs plus the byte-identity gate in `test/generator/envelope-carrier.test.ts` are its oracle, and a booted leg would mint a wire golden across the un-drained find-miss 404 `detail` split (`"not found"` on node, `"not_found"` on the other four)',
};

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
      return cs.some((c) => c.behavioural) && cs.some((c) => !c.behavioural);
    });
    expect(split).toEqual([]);
  });

  it("every e2e-declaring case that boots has a golden to compare against", () => {
    // The strong half of the behavioural tier.  `wire-golden-coverage.test.ts`
    // owns this from the runners' side; asserting it off the LEDGER's own
    // derivation is what keeps the ledger from scoring an uncompared recording
    // as `behavioural` — the "silently-off gate" failure.
    const uncompared = ledger.cells
      .filter((c) => c.boots && c.declaresE2e && !c.golden)
      .map(cellId);
    expect(uncompared).toEqual([]);
  });

  describe("the derivation itself", () => {
    // A ledger whose inputs quietly return nothing reports its BEST news
    // (everything compiles, nothing is a gap) exactly when it has gone blind.
    // These pin the two readers that could do that.

    it("skipKeys reads a POPULATED register — it can see keys at all", () => {
      // Every COMPILE_SKIP map in the tree is currently drained to empty, so a
      // parser that returned `[]` unconditionally would pass every other
      // assertion in this file while scoring the whole matrix as compiled.
      // `DAPPER_UNSUPPORTED` is the one populated register of this exact shape,
      // and it is what makes the drained readings below mean something.
      expect(skipKeys("test/e2e/corpus-dotnet-dapper-build.test.ts", "DAPPER_UNSUPPORTED")).toEqual(
        ["tenancy-hierarchy"],
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
