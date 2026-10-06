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
  "dotnet-bcl-type-collision":
    "the defect IS the compile tier — a domain type named after a BCL type (`aggregate Task` vs `System.Threading.Tasks.Task`) made the emitted .NET project fail its own build with 17 errors (CS0104 wherever the domain namespace is wildcard-imported, CS0535/CS0738 where the repository interface DECLARES it), while `generate system` reported `0 error(s), 0 warning(s)`.  `corpus-dotnet-build` is therefore the oracle, and it reads the thing under test directly: either `dotnet build /warnaserror` accepts the aliased tree or it does not.  A behavioural block would boot the CRUD round-trip `core-domain` already boots and mint a wire golden with no new content — the fix is a compile-time `using` alias plus a qualified non-generic return, neither of which is observable on the wire (an alias cannot change the runtime type).  The other four backends have no such ambiguity and the row is `ALL` precisely to pin that nothing else moves.  NOT a drain candidate for M-T9.13: like `auth-id-claim`, it is not a tier gap",
  "auth-id-claim":
    "an `X id?` user claim is a STATIC contract, and all four of its symptoms are compile-visible on the tier that already gates it: TS2503 (tsc), `cannot find symbol` (gradle), a `CustomerId??` that does not parse (dotnet build), and — the one that reads as a runtime bug — python's missing import, which `corpus-python-build` catches as ruff F821 + mypy `name-defined` before anything boots.  A behavioural block would boot a CRUD round-trip wearing an OIDC hat, which `auth-oidc` already records, and mint a wire golden with no oracle of its own.  NOT a drain candidate for M-T9.13 (docs/audits/2026-09-10-eshop-dev-experience.md §D6/P2, #2869): unlike every sibling here it is not a tier gap, so the honest move if it ever stops paying for itself is to delete the fixture, not to boot it",
  "auth-id-claim-stub":
    "the NON-optional twin of `auth-id-claim`, and compile-visible for the same reason: four of the five dev-stub principal VALUE tables wrote a raw scalar where the emitted id is a nominal type, and two of those are hard compile errors on the tier that already gates the cell — `TS2322: Type 'string' is not assignable to type 'CustomerId'` (tsc, against the `__brand`) and CS0029 (dotnet build, against `readonly record struct CustomerId(Guid)`).  java's arm compiled but carried a NULL strong id; that one IS a runtime shape — and the oracle for it is the emitted value, which the compile tier reads directly, not a booted round-trip.  A behavioural block would boot the same CRUD round-trip `auth-simple` already boots and mint a wire golden whose only new content is the /auth/me projection of a claim the harness's `x-loom-dev-claims` cannot even set (the shared `devClaimKind` classifier carries `string` and `string[]` only, so the id claim keeps its built-in stub value on every backend).  Same disposition as its sibling: NOT a drain candidate for M-T9.13",
  "org-context":
    "the subject is a REQUEST HEADER (`x-org-context`) the auth middleware validates before routing, and the `test e2e` vocabulary cannot set one — a behavioural block could only drive the no-switch default, which is indistinguishable from `tenancy-hierarchy`.  The runtime half (in-scope switch stamps the sub-scope `dataKey` and the row is deep-visible from the parent and hidden from a sibling; an out-of-subtree switch and a forged one on an orgPath-less token are 403 with NO write) is the booted `tenancy-org-context*` leg of tenancy-e2e on all five backends; the compile legs prove every backend builds the gate",
  // `principal-read-filter`, `extern` and `workflow-primitive-params` LEFT this
  // list in wave C3 packet 3a (each gained a `test e2e` block and a golden,
  // green on all seven legs); `numeric-operands` gained its api block too but
  // was never here (its domain `test` block already scored it `behavioural`).
  // Their old reasons — "the harness cannot seed a row the principal owns",
  // "needs a supplied implementation", "the vocabulary cannot pose it" — were
  // each narrower than the drain: the dev-stub principal's id is the zero guid
  // on all five, the PRECONDITIONS are generator-owned, and the present-value
  // half of a workflow call was expressible the whole time.
  //
  // `projection-agg-filters` LEFT this list in wave-3 row 3.3.  Its signature
  // said the leak "is a RUNTIME value; the compile tier cannot see a wrong
  // number" — true, and it argued for a behavioural block rather than against
  // one.  What actually blocked it was narrower and undocumented: `softDeletable`
  // is a pure mixin with no operation, so nothing could set `isDeleted` through
  // the api and the conjunct was unobservable whatever the tier.  Composing the
  // `softDelete` macro made it assertable with ONE principal, and the fixture
  // now runs `OrderVolume` vs `AllTimeVolume` at the behavioural tier.  The
  // TENANT conjunct still needs two principals and stays with the generator
  // tests — a narrower claim than the one this entry used to make.
  outbox:
    "relay delivery is asynchronous; needs a booted leg that drains the outbox — the node leg never starts the relay, the other four run it on its own poll interval, and the `test e2e` vocabulary has no `eventually` form (re-checked wave C3 3a)",
  "channels-broker":
    "needs a broker container (the channels-e2e legs boot one; the corpus case does not) — and not only for delivery: the four real-process legs cannot BOOT without the broker URL (e.g. python's `init_channel_transports()` raises at startup; re-checked wave C3 3a)",
  "channels-broker-workflow":
    "same broker-container reason as `channels-broker`, and the defect it was minted for is a " +
    "HARD compile error in the emitted project (TS2304 for `createOutboxDispatcher` plus three " +
    "TS2305 for the missing exports), so the compile tier IS its oracle — a booted leg would " +
    "re-run `channels-broker`'s delivery with a workflow in the tree and assert nothing new",
  "projection-split-deployables":
    "the defect is a hard compile error in the emitted project (`TS2306: File " +
    "'domain/value-objects.ts' is not a module`), so the compile tier is the oracle.  A " +
    "behavioural block would also need TWO booted services to mean anything, and what it would " +
    "assert — a projection count — `projection-agg-filters` already boots on one",
  "tenancy-hierarchy":
    "the deep/global/local read ladder is a runtime row-visibility question; `test:tenancy-hierarchy-*` boots it outside the corpus tier",
  "extern-handlers":
    "the scaffold-once shape `extern` had, WITHOUT `extern`'s way out: the two routed handlers carry no precondition, so every call reaches the unimplemented user hook and a golden would pin the scaffold's fail-fast; the mount-path agreement for routed handlers is #3024 (re-checked wave C3 3a, when `extern` drained on its preconditions)",
  "handler-resource-ops": "outbound I/O inside a handler body; needs the resource's container",
  resources: "objectStore / queue / api / mailer clients need their containers",
  "api-call":
    "in-system api call; needs both deployables booted (the `api-call-e2e` leg does this outside the corpus tier)",
  "projection-fold-statements":
    "ledger row F2-XB-4 — the COMPILE tier is the gate that mattered here (a dropped `let` is CS0103 / 'cannot find symbol'), and `test/conformance/projection-fold-statement-parity.test.ts` sweeps every admitted statement kind on all five per-PR.  What a behavioural block would add is the ACCUMULATED VALUE: a dropped `+=` compiles and leaves the column null forever, which only a booted read can tell from a correct fold.  Blocked on a wire golden per backend, not on the fixture",
  "paged-nonrelational":
    "ledger row F2-CB-C1 — the COMPILE tier is likewise the gate that mattered (CS0535 + CS0029 on .NET), with `test/conformance/paged-nonrelational-parity.test.ts` comparing the declaration, the implementation and the caller's arity per-PR.  What a behavioural block would add is the PAGE ITSELF: an in-memory pager that slices before it sorts, or counts the page instead of the match, compiles and answers plausible JSON.  Same blocker",
  "find-bypass":
    "`find … ignoring tenantOwned` is only observable across TWO principals (does the other tenant's row appear?); the behavioural runners authenticate as one, so a caller would read the same set either way — the same two-principal harness `projection-agg-filters` waits on, now claimed by #2976 (re-checked wave C3 3a)",
  envelope:
    'the `envelope` carrier is a COMPILE defect (java named an undeclared `Envelope<Order>`, dotnet returned a bare `Order` from `Task<Envelope<Order>>`); the five compile legs plus the byte-identity gate in `test/generator/envelope-carrier.test.ts` are its oracle, and a booted leg would mint a wire golden across the un-drained find-miss 404 `detail` split (`"not found"` on node, `"not_found"` on the other four)',
  "vo-cross-context":
    "minted by the fixture-shape audit (docs/audits/2026-09-29-fixture-shape-coverage.md) for the evaluation's F-008: a value object declared in one context and used as a field in another.  Compile-only because one of its five backends cannot boot it: python resolves the VO through the context's own list, so `db/schema.py` and the migration create `ship_to_line1`/`ship_to_geo_lat`/`ship_to_geo_lng` while `receipt_repository.py` binds and reads `ship_to` — a column in NEITHER artifact, so every read and write of the consuming aggregate fails, and a golden captured now would enshrine the defect.  The compile tier sees only the hydrate site (`mypy --strict`); the two bind sites are untyped dict literals.  elixir resolves its wire serializers through `valueObjectPool` and compiles the row under `--warnings-as-errors`.  python is excluded from this row's `backends:` via the named `SIBLING_VO_RESOLUTION` set in the corpus manifest — an honest, reasoned exclusion rather than a compile-skip, because a cell that only GENERATES is refused by this very file.  What a behavioural block would add is the ROUND TRIP through the sibling-pool lookup; it belongs with the python fix, and this entry falls with it",
  "vo-root-kernel":
    "minted by the fixture-shape audit (docs/audits/2026-09-29-fixture-shape-coverage.md) for the evaluation's F-007: a root-level (shared-kernel) value object nested in a context-local one.  The defect is an EMISSION-ORDER one — node declared `OuterSchema` before the `UnLocodeSchema` it initialises from (TS2448/TS2454, a temporal-dead-zone read that throws at module load) and python emitted `class Outer` before `class UnLocode` (ruff F821) — and both halves are now fixed (node's four schema-emitting builders and python's two class emitters route through `orderValueObjectsByDependency`), with all five backends back in the row.  The compile tier is the decisive gate for this class: an out-of-order declaration is a type-check error on node and a lint error on python, so the cell is watched where the defect lives.  What a behavioural block would add is the round trip of a nested shared-kernel value through the wire — genuine, and M-T9.13's to add with its golden; until then the cell stops at compile",
  "vo-regex-invariant":
    "minted by the same audit.  The bug class is a MISSING IMPORT in a second emitted file — the regex a `.matches(<regex>)` value-object invariant puts in the wire/request validator beside the domain class that already had one — and a missing import is exactly what a type-checker sees and a wire assertion cannot.  That is the evaluation's F-013: .NET emitted `using System.Text.RegularExpressions;` in `Domain/ValueObjects/*.cs` and omitted it from the FluentValidation request validator, failing `dotnet build` on ordinary modelling (now FIXED, verified under `/warnaserror` on sdk:10.0).  PYTHON still has the same class: `app/http/wire_models.py` emits `re.search(...)` with no `import re` (ruff F821) while the domain half imports it, so python cannot boot and a golden cannot be captured.  What a behavioural block would add is genuine and is written down in the fixture header — the wire boundary must answer 422 on a bad value rather than 500 or silently storing it — so add it, with its golden, in the same PR that adds the import.  python is excluded from this row's `backends:` via the named `WIRE_REGEX_IMPORT` set in the corpus manifest — not a compile-skip, because a generate-only cell is refused by this very file",
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
      // Every corpus COMPILE_SKIP / UNSUPPORTED map in the tree is now drained
      // to empty, so a parser that returned `[]` unconditionally would pass
      // every other assertion in this file while scoring the whole matrix as
      // compiled.  The subject MOVED here in wave C2 packet 2b: it used to be
      // `DAPPER_UNSUPPORTED`, whose last entry (`tenancy-hierarchy`) drained
      // when the Dapper adapter learned the hierarchical subtree predicate —
      // draining the very register that made the drained readings mean
      // something.  `KNOWN_HEEX_GAPS` is the replacement because it is the one
      // register of this exact shape that is SETTLED rather than pending
      // (`DataGrid` on HEEx is a decided non-goal, D-DATAGRID-TARGETS), so it
      // cannot drain out from under this guard the way a TODO register does.
      expect(skipKeys("test/generator/elixir/heex-parity.test.ts", "KNOWN_HEEX_GAPS")).toEqual([
        "DataGrid",
      ]);
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
