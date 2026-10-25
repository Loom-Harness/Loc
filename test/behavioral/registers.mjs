// ---------------------------------------------------------------------------
// The behavioural tier's PURE REGISTERS — the data that decides which cases run
// and which must carry a wire golden, with NOTHING but node: builtins behind it.
//
// WHY IT IS ITS OWN FILE.  These registers have two readers with very different
// dependency footprints: the runners (`cases.mjs` / `wire-differential.mjs`,
// which pull in `pg` and `esbuild` from test/behavioral/node_modules) and the
// FAST SUITE gate `test/conformance/wire-golden-coverage.test.ts`, which runs
// off the ROOT install where test/behavioral/node_modules does not exist at all
// — CI runs `npm ci` at the root and only the behavioural workflows also run it
// in here.
//
// Importing the runner modules from the fast suite therefore works on a
// developer machine that happens to have installed the behavioural deps, and
// fails in CI with `Cannot find package 'esbuild'`.  It did exactly that, and
// the local probe that "proved" it fine was measuring a machine, not the repo.
// Keeping the registers dependency-free is what makes one copy serve both.
// ---------------------------------------------------------------------------

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, "wire-golden");
const SYSTEMS_DIR = join(HERE, "systems");

/** True when a `.ddd` carries a behavioural block a runner can boot — a
 *  `test e2e "…"` (api) or a domain `test "…"` (unit). Mirror of the gate's
 *  detection in test/conformance/behavioural-coverage.test.ts. */
export function hasBehaviouralBlock(src) {
  return /(^|\n)\s*test\s+e2e\s+"/.test(src) || /(^|\n)\s*test\s+"/.test(src);
}

/** True when a `.ddd` DECLARES an api-tier `test e2e "…"` block.  The runner
 *  legs use this to tell a UNIT-ONLY case (domain `test "…"` blocks, no e2e —
 *  admitted by `hasBehaviouralBlock` above, and run by the node oracle via its
 *  derive-tiers-from-the-emitted-file-map posture) apart from a case that
 *  declared e2e and emitted nothing, which stays an error.  Until
 *  numeric-operands (M-T6.44) no fixture used the unit-only shape, so the five
 *  cross-backend legs had hard-required the e2e suite without anything
 *  noticing. */
export function declaresE2e(src) {
  return /(^|\n)\s*test\s+e2e\s+"/.test(src);
}

/** True when this `.ddd` makes its backends mount the root `POST /files` +
 *  `GET /files/{key}` pair (M-T1.2) — i.e. some declared field is `File`-typed
 *  AND an `objectStore` resource is wired.  Both halves are required: the
 *  emitters gate the routes on exactly that conjunction (an objectStore with no
 *  `File` field — `resources.ddd` — emits no /files route at all).
 *
 *  Read off the SOURCE, like `hasBehaviouralBlock` above and each runner's
 *  `authMode`, so all seven runner legs derive the same answer from the same
 *  place and cannot drift apart.  It gates one thing only: whether the wire
 *  differential fires its absent-file probe (M-T6.39).  A false positive would
 *  merely record the framework miss; a false negative loses the probe — which
 *  is why the conformance pin `files-absent-object-envelope-parity.test.ts`
 *  asserts the emitters directly rather than trusting this predicate. */
export function mountsFileRoutes(src) {
  return /:\s*File(\?|\[\])?\s*(\/\/|$|\n)/m.test(src) && /kind:\s*objectStore/.test(src);
}

/** Per-(platform, case) behavioural skips: a corpus feature or shared system that
 *  GENERATES and COMPILES on a backend but whose RUNTIME behaviour has a known,
 *  tracked gap there.  Honest and documented (not a silent drop) — the case still
 *  runs on every other backend, the gate (behavioural-coverage.test.ts) still
 *  requires it to EMIT everywhere, and each entry cites its bug in
 *  docs/audits/behavioral-parity-bugs-2026-07.md.  Removing an entry is how a fix
 *  re-arms the boot.  Keyed by platform clause; applies to BOTH featureCases and
 *  sharedSystemCases (a case name is either a corpus feature id or a systems/ file). */
/** Exported so the fast-suite golden-coverage gate
 *  (test/conformance/wire-golden-coverage.test.ts) can derive "does this case
 *  run anywhere?" from the SAME register the runners filter by, rather than
 *  keeping a second copy of it in sync. */
export const BEHAVIOURAL_SKIP = {
  node: {
    // B1 fixed (event-sourced create now folds events before asserting
    // invariants — src/generator/typescript/emit/aggregate.ts).  `ledger`
    // re-armed; no node skips remain.
  },
  dotnet: {
    // B2/B3/B4/B8/B12 fixed — no dotnet skips remain. (B12: `crudish` on a
    // `shape: document` aggregate now emits a matching `DeleteAsync` on the
    // document-repo impl, so the interface/impl method sets agree; repository.ts.)
  },
  java: {},
  // The DAPPER adapter of the .NET backend (`run-dapper.mjs` forces this exact
  // clause, and looks the skip set up by it).
  "dotnet { persistence: dapper }": {
    // DRAINED — all three entries (`projection-aggregation`, `projection-groupby`,
    // `read-gates`) claimed one boundary: "dapper emits no query-time projection
    // reads, `loom.dapper-unsupported` refuses to generate".  That claim was true
    // when `src/generator/dotnet/query-projection-emit.ts` had no `dapper` branch
    // at all (#2468); M-T6.25 ported the four direct-table arms to raw Npgsql, so
    // the three fixtures generate, compile and answer on this adapter.  The
    // adapter's own oracle agrees and is the ratchet that would have caught a
    // stale entry here: `test/e2e/corpus-dotnet-dapper-build.test.ts` now carries
    // `DAPPER_UNSUPPORTED = { "tenancy-hierarchy": … }` and nothing else, and it
    // FAILS an entry whose `loom.dapper-unsupported` no longer fires.  Deleting
    // these three RE-ARMS boots that had never run once on this leg.
  },
  elixir: {
    // B19 (`seed-values`) is FIXED — M-T6.37 landed the Ecto seeder, so this leg
    // now runs the collection reads over seeded rows like the other four:
    // `<Ctx>.Seeds` (elixir/vanilla/seed-emit.ts) inserts domain rows through the
    // aggregate's repository changeset, `raw` rows as schema-qualified INSERTs,
    // ship-once per dataset behind the `__loom_seed` marker, invoked from
    // `Application.start/2` on a SERVING node.  Its skip entry is deleted rather
    // than re-worded: an allowlist ratchets, so the fix removes the waiver.
    // B5/B6/B7/B9/B10/B11 fixed; batch-5 (core-domain/document/inheritance) booted
    // green on elixir — no elixir skips remain. (B11: `T or <primitive>` union return
    // now mints a valid PascalCase module alias; openapi-emit.ts.)
    // (B9: single `contains`
    // arms the `__put_assoc_parts/1` helper on an `assign` mutation + the helper
    // handles a single `has_one` struct; context-emit.ts. B10: parent-table
    // migrations ordered FK-topologically so a cross-aggregate reference target
    // is created first; migrations-emit.ts.)
  },
};

/**
 * The inverse of `BEHAVIOURAL_SKIP`, one level finer than a backend: corpus
 * cases ARMED on one persistence ADAPTER's leg although the manifest does not
 * (yet) declare that adapter's backend.  Keyed by the runner's platform clause,
 * like `BEHAVIOURAL_SKIP`; each value is the reason plus the named exit.
 *
 * It exists for a case that discriminates on an alternate adapter but cannot be
 * keyed for the whole backend, because the backend's DEFAULT adapter fails it
 * for a separate, filed reason — keying the backend would turn that default leg
 * red, and a `BEHAVIOURAL_SKIP` entry there is pinned at zero (and would read as
 * "this backend does not boot the case" to the gate ledger, which is untrue for
 * the adapter).  Arming here adds a gate and hides none.
 *
 * It RATCHETS DOWN: `test/behavioral/adapter-only-cases.test.ts` fails an entry
 * whose case the manifest already declares for the clause's backend (stale — the
 * exit landed, delete the entry), names a missing corpus case, or carries no
 * mission / PR id.  Empty is the target state.
 */
export const ADAPTER_ONLY_CASES = {
  "dotnet { persistence: dapper }": {
    // EF refuses a TPH subtype filter over a non-root column at validation
    // (`loom.tph-filter-unsupported`, lifted by #3960); Dapper's explicit SQL
    // guards every read by `kind` and passes both.
    "tph-crossings":
      "#3960 — EF refuses the TPH subtype-only-column filter (`loom.tph-filter-unsupported`); the Dapper adapter passes it",
    "inheritance-read-restrictions":
      "#3960 — EF refuses the TPH subtype-only-column filter (`loom.tph-filter-unsupported`); the Dapper adapter passes it",
    // EF loses the re-hosted nested parts (#4136); Dapper's explicit SQL
    // deletes and re-inserts them and passes.
    "contained-part-rebuild":
      "#4136 — EF loses a rebuilt part's nested owned children (M-T6.96); the Dapper adapter passes it",
  },
};

/** The behavioural runner LEGS — the wire-gate backend labels, one per runner
 *  (`run.mjs` is `node`, `run-mikroorm.mjs` is `mikroorm`, …).  The two
 *  persistence-adapter legs are legs of their own because an adapter can fail
 *  a case its backend's default adapter passes. */
export const LEGS = ["node", "mikroorm", "dotnet", "dapper", "java", "python", "elixir"];

/** The manifest backend key each leg boots (cases.mjs `featureCases`). */
export const LEG_BACKEND = {
  node: "node",
  mikroorm: "node",
  dotnet: "dotnet",
  dapper: "dotnet",
  java: "java",
  python: "python",
  elixir: "vanilla",
};

/** `.NET` refuses a TPH subtype filter over a column the root does not
 *  declare — at validation, on both adapters (EF Core hosts query filters on
 *  the root entity only).  #3960 lifts the refusal with root-hosted,
 *  type-guarded named filters. */
const TPH_FILTER_REFUSED = {
  issue: "#3960",
  expect: "error",
  match: "loom\\.tph-filter-unsupported",
  reason: "`loom.tph-filter-unsupported` refuses the TPH subtype-only-column filter at generate",
};

/** A folded projection's `valueobject` field: the migration spreads it into
 *  leaf columns, the response nests it, and only node bridges the two.  How
 *  each backend breaks is pinned per leg. */
const projectionVoRow = (pin) => ({
  issue: "#4023",
  ...pin,
  reason: "the read model does not bridge the flat VO leaf columns to the nested wire shape",
});

/** The blocks of `inheritance-base-reads` and how a leg that has not been
 *  fixed fails each one. */
const BASE_READS_TESTS = {
  tphBaseCap: ["TPH: a base capability narrows every subtype", "expected the call to reject, but it resolved"],
  tpcBaseCap: ["TPC: a base capability narrows every subtype", "expected the call to reject, but it resolved"],
  polymorphic: ["TPH: the polymorphic base reads", "GET \\S+/api/equipments/\\S+ → 404 .*no route for GET"],
};

/** `inheritance-base-reads` — the base capability (#3956) and the polymorphic
 *  base reads (#3959) of epic #3954, as each leg's EXACT failing set, so a leg
 *  where half the fix lands goes red and narrows its own entry.  `passes`
 *  names the blocks a leg already gets right; `pins` overrides a block's
 *  message regex where that leg fails it differently. */
function baseReads({ passes = [], pins = {} } = {}) {
  const tests = {};
  for (const [key, [name, re]] of Object.entries(BASE_READS_TESTS)) {
    if (!passes.includes(key)) tests[name] = pins[key] ?? re;
  }
  return {
    issue: "#3956, #3959",
    expect: "fail",
    tests,
    reason:
      "a capability on the abstract base is not inherited by its subtypes (#3956), and the TPH base by-id read is not routed (#3959)",
  };
}

/**
 * TRACKED EXPECTED FAILURES — per (leg, case) cells that are BOOTED on that leg
 * and known to fail there, each linked to the issue that fixes it.
 *
 * This is how a corpus fixture runs on ALL five backends (#3595) while some of
 * them are still wrong: the cell is not dropped from the leg (the shape
 * `BEHAVIOURAL_SKIP` and a backend missing from a manifest row both have), it
 * runs, and `case-loop.mjs` settles it:
 *
 *   - it fails as recorded → the leg stays green.  `expect` is the outcome
 *     kind: `error` (refused at generate, failed to build or boot — `match`
 *     must find the error message), `fail` (tests or ladder rungs failed —
 *     `tests` maps a test-name fragment to a message regex and must claim
 *     EXACTLY the failing set), or `wire` (every test passed, the recording
 *     diverged from the golden);
 *   - it PASSES → the leg goes red until the entry is deleted (the fix's PR
 *     deletes its own entry, like every waiver register here);
 *   - it fails any OTHER way — another kind, another message, one more or one
 *     fewer failing test → the leg goes red: an entry vouches for one known
 *     defect, not for whatever else breaks in the same case.
 *
 * Cases enter a leg from here even when the manifest row does not declare that
 * backend — a backend that REFUSES a crossing at generate is absent from the
 * row (the generation gate requires every declared cell to generate cleanly)
 * and still owes the crossing; this is where the debt is booted.  A case node
 * fails has no golden (node is the oracle it is captured from), and needs none
 * until it passes.
 *
 * `test/behavioral/expected-failures.test.ts` (fast suite) keeps the register
 * honest without booting: every entry names a real case and leg, an `#NNNN`
 * issue and a well-formed pin, and every behavioural corpus fixture is
 * accounted for on every one of the five backends.
 */
export const BEHAVIOURAL_XFAIL = {
  node: {
    "inheritance-base-reads": baseReads({ passes: ["tphBaseCap", "tpcBaseCap"] }),
  },
  mikroorm: {
    "inheritance-base-reads": baseReads({ passes: ["tphBaseCap", "tpcBaseCap"] }),
  },
  dotnet: {
    "contained-part-rebuild": {
      issue: "#4136",
      expect: "fail",
      tests: { "a nested child removed by rebuilding its parent is gone": "expected 0 to be 1" },
      reason:
        "M-T6.96 — an EF owned entity cannot move between owners, so deleting the old line deletes the notes the rebuilt line holds",
    },
    "inheritance-read-restrictions": TPH_FILTER_REFUSED,
    "tph-crossings": TPH_FILTER_REFUSED,
    // EF hosts the base's filter on the TPH root entity, so it reaches every
    // concrete there — the one path #3956's audit found correct.
    "inheritance-base-reads": baseReads({ passes: ["tphBaseCap", "tpcBaseCap"] }),
    // EF maps the VO as a scalar onto a column the migration never creates; the
    // emitted project does not build.
    "projection-valueobject-row": projectionVoRow({ expect: "error", match: "dotnet build" }),
  },
  dapper: {
    "inheritance-base-reads": baseReads({ passes: ["tphBaseCap", "tpcBaseCap"] }),
    "projection-valueobject-row": projectionVoRow({ expect: "error", match: "dotnet build" }),
  },
  java: {
    "inheritance-base-reads": baseReads({ passes: ["tphBaseCap", "tpcBaseCap"] }),
    "workflow-two-handles-containment": {
      issue: "#4022",
      expect: "fail",
      tests: { "two handles on one row keep their own child graph": "expected the call to reject, but it resolved" },
      reason:
        "M-T6.93 — JPA's persistence context hands both `getById` loads one managed entity, so two handles adding a child never conflict",
    },
    "transactional-workflow-event-rollback": {
      issue: "#4022",
      expect: "fail",
      tests: { "a rolled-back transactional workflow": "expected the call to reject, but it resolved" },
      reason:
        "M-T6.93 — JPA's persistence context hands both `getById` loads one managed entity, so the second save is never stale",
    },
  },
  python: {
    "inheritance-base-reads": baseReads({ passes: ["tphBaseCap", "tpcBaseCap"] }),
    // `{"st": row.st}` against a model whose only attributes are the leaves.
    "projection-valueobject-row": projectionVoRow({
      expect: "fail",
      tests: { "a value object on a folded read model": "/place → 500" },
    }),
  },
  elixir: {
    "workflow-two-handles-containment": {
      issue: "#4081",
      expect: "fail",
      tests: { "two handles on one row keep their own child graph": "expected 2 to be 1" },
      reason: "M-T6.94 — removing a contained part (`lines -= …`) in an operation does not persist",
    },
    // Every test passes; the recording diverges from the golden in five
    // values — the 409 `detail` names no aggregate/id (#3838), and each op call
    // inside the workflow is persisted, so a document's `version` reads one
    // higher (#4089).
    "workflow-two-handles-document-eventlog": {
      issue: "#3838, #4089",
      expect: "wire",
      reason:
        "the workflow 409 `detail` names no aggregate or id, and per-call persistence bumps the document `version` twice",
    },
    // Elixir passes every block, the routed TPH base by-id read included; the
    // case has no wire golden until the node oracle routes that read too.
    "inheritance-base-reads": {
      issue: "#3959",
      expect: "wire",
      reason:
        "every block passes on elixir; the case has no golden until the node oracle passes the polymorphic base read (#3959)",
    },
  },
};

/** The expected-failure entry for one cell, or null. */
export function expectedFailure(leg, caseName) {
  return BEHAVIOURAL_XFAIL[leg]?.[caseName] ?? null;
}

/** The shared `systems/*.ddd` cases, DERIVED from the directory rather than a
 *  hand-list — a new shared system is gated the moment it lands, and a golden
 *  can't be deleted to dodge the gate. */
export function sharedSystemGoldenCases() {
  return readdirSync(SYSTEMS_DIR)
    .filter((f) => f.endsWith(".ddd"))
    .map((f) => f.replace(/\.ddd$/, ""))
    .sort();
}

/**
 * Cases deliberately allowed to run with NO golden.
 *
 * EMPTY, and meant to stay that way.  Every case the tier records is compared;
 * an entry here is a signed decision to leave one uncompared, and it needs the
 * same thing a wire waiver needs — a reason and a named exit.
 *
 * This list exists because the alternative is what `main` did until this
 * change: a missing golden was only a failure for the shared systems, and for
 * every FEATURE case it returned `none` — no comparison, no message.  Four
 * cases (`field-mask`, `policy-deny`, `seed-values`, `vo-field-default`) had
 * been running that way on every backend leg, two of them authorization-shaped.
 * Nothing was wrong with them; nothing was checking them either.
 *
 * That is the failure mode the skip-outcome comment below already names — "a
 * silently-off gate is worse than an absent one" — so the missing-golden branch
 * now holds to the same standard: a new fixture fails with the capture command
 * until someone decides, rather than joining the tier ungated by default.
 *
 * @type {ReadonlyArray<{case: string, reason: string}>}
 */
export const GOLDEN_OPT_OUT = [];

/** Every case that must carry a golden: all of them, minus the signed opt-outs. */
export function requiredGoldenCases() {
  const optedOut = new Set(GOLDEN_OPT_OUT.map((o) => o.case));
  return { optedOut, shared: sharedSystemGoldenCases() };
}

export const goldenPath = (caseName) => join(GOLDEN_DIR, `${caseName}.json`);
