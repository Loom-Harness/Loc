// Every tracked `.ddd` in the repo parses — and every standalone one validates.
//
// The repo has ~340 `.ddd` files and, until this gate, no check that asked all
// of them anything.  What existed were hand-maintained ALLOWLISTS — the playground
// picker's three suites name their files one by one, the corpus manifest names
// its features, the behavioral corpus names its systems.  A list is exactly as
// good as someone's memory to append to it: a fixture nobody lists is a fixture
// nobody checks, and it rots silently until a contributor opens it.
//
// That is not hypothetical.  This gate's first run found `examples/sales-ui.ddd`
// — a file the top-level README advertises in its examples table — failing with
// six syntax errors.  (It turns out to say so itself, in its own header; see the
// pin below.  The README does not.)
//
// TWO gates, because they answer different questions:
//
//  1. PARSE — every tracked file, no exception beyond the pinned set, must reach
//     ZERO `parserErrors`.  This is the syntax-rot net: a grammar change that
//     invalidates an old fixture fails here, in the fast suite, instead of at
//     whatever slow matrix happens to touch that file.  It also closes the
//     error-RECOVERY hole (`experience_gathered.md` §59, #2302): Langium recovers
//     from a syntax error and hands back a partial AST, so a test that only looks
//     at the AST sees a smaller model rather than a failure.  `parserErrors` is
//     the only place that recovery is visible.
//
//  2. VALIDATE — every file that is a self-contained document must reach zero
//     AST-validation errors.  Members of a MULTI-FILE project are excluded, and
//     the exclusion is DERIVED, not listed: a file is a member iff some other
//     tracked `.ddd` imports it (the `import "./x.ddd"` graph).  Standalone, a
//     member reports its siblings' declarations as unresolved — an artifact of
//     reading it alone, not a defect — and its ENTRY is validated through the
//     project loader by the playground suites.  Deriving membership means a new
//     fragment classifies itself instead of failing until someone edits a list.
//
// Both ratchet on an EXACT set: a pin that stops matching (the file was fixed,
// renamed or deleted) fails as stale, so the fix deletes its pin in the same PR.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, normalize, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRawResult, parseString } from "../_helpers/parse.js";

const REPO = resolve(import.meta.dirname, "..", "..");

/** Every `.ddd` git tracks — the whole population, by construction. */
function trackedDddFiles(): string[] {
  return execSync("git ls-files '*.ddd'", { cwd: REPO, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
}

/** `__PLATFORM__`-tokenized corpus fixtures are templates, not sources — the
 *  runners substitute a backend before parsing, and so does this census. */
function sourceOf(file: string): string {
  return readFileSync(resolve(REPO, file), "utf8").replaceAll("__PLATFORM__", "node");
}

/** Every participant in a multi-file project — BOTH directions of the import
 *  edge, because a single-document parse resolves neither:
 *
 *    • a file that IS imported reports its entry's declarations as unresolved;
 *    • the ENTRY that does the importing reports its members' declarations as
 *      unresolved, since `parseString` does not follow the import statements
 *      (that is `loadProject`'s job, and what the playground suites use).
 *
 *  Derived from the `import "…"` statements themselves, so a new fragment — or a
 *  new entry — classifies itself instead of failing until someone edits a list. */
function projectMembers(files: readonly string[]): Set<string> {
  const members = new Set<string>();
  for (const f of files) {
    const dir = dirname(resolve(REPO, f));
    const matches = [...sourceOf(f).matchAll(/^\s*import\s+"([^"]+)"/gm)];
    if (matches.length === 0) continue;
    members.add(normalize(f)); // the entry
    for (const m of matches) {
      members.add(normalize(relative(REPO, resolve(dir, m[1])))); // its members
    }
  }
  return members;
}

// ---------------------------------------------------------------------------
// The pins.  Each is a file that CANNOT satisfy the gate, with the reason —
// never a file that merely happens to fail.
// ---------------------------------------------------------------------------

/** Does not PARSE, and says so in its own first paragraph: "This file does NOT
 *  parse with the current Langium grammar; it is the target syntax driving the
 *  discussion.  It is a HISTORICAL prototype".  It is a design document that
 *  happens to carry a `.ddd` extension — `Dashboard(items: [...])`, `Stat { api
 *  Sales.Order.all }` and `MasterDetail` were proposed and never shipped (or
 *  were retired), which its header also records.
 *
 *  Kept rather than deleted: it is the page-metamodel discussion's record, and
 *  `docs/new-plan/missions/M-T1.3-charts-and-dashboards-scope.md` cites it as
 *  prior art.  Pinned rather than silently skipped, because "a tracked .ddd that
 *  does not parse" is worth one line of explanation — and because the README
 *  advertises it beside files that DO parse, which is a docs-truth gap this pin
 *  is the evidence for. */
const UNPARSEABLE = [
  "examples/sales-ui.ddd",
  // The recorded repro for the "a `let` inside a `for` body is required"
  // refusal (FieldOps evaluation, F-002): `for l in ls { Parts.getById(
  // l.partId).consume(l.qty) }` does not parse — a call cannot be chained onto
  // a repository read inside a `for`.  Pinned rather than fixed because the
  // file IS the evidence; when the grammar accepts the chained form this pin
  // goes stale and the check below says so.
  "eval/repro/wf-for-let-d.ddd",
] as const;

/** Parses, but is INVALID ON PURPOSE — the subject of a negative test. Its own
 *  name says so; `test/cli/*` asserts the diagnostics it produces, and the
 *  `stmt-placement-*` trio is the refusal corpus of M-T5.28
 *  (`test/language/validators/stmt-placement.test.ts`) — one file per gated
 *  statement, each carrying the one construct its code refuses.  They live
 *  beside their gate rather than in `test/fixtures/corpus/` because that corpus
 *  is a POSITIVE matrix: every fixture there must GENERATE on each backend its
 *  manifest row declares, so it has no shape for an expected-diagnostic source.
 *  The `it("still rejects …")` control below therefore also asserts all four
 *  keep refusing — a gate deleted by accident fails here too. */
const DELIBERATELY_INVALID = [
  "test/cli/fixtures/bad-model.ddd",
  // The #2922 audit's F-014 repro: a `valueobject Money` constructed with
  // `currency` omitted.  Before #2923 this validated CLEAN — a record named
  // after a walker primitive skipped construction validation entirely — and
  // emitted `new Money(new Decimal("1.00"))` against a 2-arg constructor.  It
  // is kept as tracked evidence beside the audit, and the negative control
  // below turns it into a live regression guard: revert #2923 and it validates
  // clean again, failing here.
  "eval/repro/F014-money-ctor-unchecked.ddd",
  "test/language/validators/fixtures/stmt-placement-variant-match.ddd",
  "test/language/validators/fixtures/stmt-placement-for.ddd",
  "test/language/validators/fixtures/stmt-placement-if-let.ddd",
  // The error-QUALITY corpus from the external evaluation in `eval/`: ten models,
  // each carrying one realistic authoring mistake, written to measure whether the
  // diagnostic points at the right line and is actionable.  Being refused IS the
  // assertion, so they belong here rather than being "fixed".
  //
  // Pinning them buys something beyond silencing this gate: the control below
  // asserts each still produces at least one error, so this list is now a
  // regression net for the eight diagnostics the evaluation measured.  If a
  // validator change ever made one of these validate clean, that control fails.
  //
  // Only the AST-level nine are listed.  Two of the ten are absent on purpose:
  // `broken/08-page-wrong-aggregate.ddd` and `broken/09-unqueryable-filter.ddd`
  // are refused at the IR layer (phase (7)), which this census does not run.
  //
  // `broken/05-cyclic-containment.ddd` joined this list when F-020 was fixed, as
  // the earlier revision of this comment said it must: it used to validate clean
  // and crash the generator with a `RangeError` naming an `out/**.js` frame, and
  // now `checkContainmentCycles` refuses it at the AST layer with a real
  // file:line ("Cyclic containment in aggregate 'A': X -> Y -> X").
  "eval-fieldops/repro/H-rowlevel-currentuser.ddd",
  "eval-fieldops/repro/broken/05-cyclic-containment.ddd",
  // Joined when F-003 was fixed, for the same reason as 05: the cross-aggregate
  // `invariant Technicians.getById(...)` used to validate clean and emit an
  // unresolvable identifier on four backends (and nothing at all on Phoenix);
  // `checkRuleExprPurity` now refuses it at the rule's own line.
  "eval-fieldops/repro/A-cross-agg-invariant.ddd",
  "eval-fieldops/repro/broken/01-typo-type.ddd",
  "eval-fieldops/repro/broken/02-invariant-unknown-field.ddd",
  "eval-fieldops/repro/broken/03-wrong-arity.ddd",
  "eval-fieldops/repro/broken/04-bare-aggregate-ref.ddd",
  "eval-fieldops/repro/broken/06-duplicate-names.ddd",
  "eval-fieldops/repro/broken/07-bad-enum-value.ddd",
  "eval-fieldops/repro/broken/10-type-mismatch.ddd",
  // A SECOND, independent evaluation's repro corpus (`eval-clinica/`), already on
  // main.  It found two of the same defects this branch fixes, which is useful
  // corroboration in itself: r02 is a cross-aggregate `invariant` reaching a
  // repository (F-003) and r18 is cyclic containment (F-020).  Both were written
  // as deliberately-broken evidence and validated clean until these gates landed,
  // so they belong here for exactly the reason the entries above do.
  "eval-clinica/repro/r02-overlap.ddd",
  "eval-clinica/repro/r02-overlap-system.ddd",
  "eval-clinica/repro/r18-recursive-containment-crash.ddd",
  // `eval/repro/broken/` — the error-QUALITY corpus of the FieldOps
  // evaluation: ten models each carrying exactly one ordinary mistake, used to
  // score what the toolchain says back.  Being refused is the whole point, so
  // they belong here rather than being fixed or untracked.  Only the seven
  // that fail at the AST layer are listed, plus `b05` — see below; `b09` (a
  // typo'd field in a page body) still validates CLEAN and is a finding in its
  // own right (F-041), so it stays in the positive population
  // above — the day either starts being refused, its pin is what should be
  // added, not this comment.
  //
  // Listing them here also puts them under the negative control below, which
  // turns the corpus into a standing ratchet: a gate that stops firing fails
  // this file.
  "eval/repro/broken/b01-typo-type.ddd",
  "eval/repro/broken/b02-missing-field.ddd",
  "eval/repro/broken/b03-wrong-arity.ddd",
  "eval/repro/broken/b04-bare-aggregate-ref.ddd",
  // `b05` was this corpus's F-040 — cyclic containment validating clean — and
  // it is now REFUSED, by the `loom.containment-cycle` AST gate this branch adds
  // for the same defect it found independently as F-020.  Per the note above
  // ("the day either starts being refused, its pin is what should be added"),
  // here is the pin.  Two evaluations reaching the same defect, one of them
  // closing it, is the corroboration both registers were written to produce.
  "eval/repro/broken/b05-cyclic-containment.ddd",
  "eval/repro/broken/b06-duplicate-names.ddd",
  "eval/repro/broken/b07-bad-enum-value.ddd",
  "eval/repro/broken/b10-money-decimal-mix.ddd",
] as const;

// A third exclusion list used to sit here — `PROJECT_MEMBER_NOT_IMPORTED`,
// holding `web/src/examples/erp/finance.ddd` on the reading that it was a
// project member "no import reaches, so the derived rule cannot see it".
//
// `web/src/examples/erp/main.ddd:63` imports `./finance.ddd`. The derived rule
// had covered it from the day it landed, and the pin excluded a file that was
// already excluded — inert, and silently so, because `excluded.has(f) ||
// inProject.has(f)` cannot tell a redundant pin from a load-bearing one.
//
// It is deleted rather than ratcheted because the category it named does not
// exist: `projectMembers` adds BOTH ends of every import edge, the entry
// included (`members.add(normalize(f))`), so a multi-file participant is
// reachable from the graph by construction. Anything a hand pin could add here
// is either already derived or is not a project member at all. Do not
// reintroduce it — extend the derivation instead, and let the sweep prove it.

describe("`.ddd` source census — every tracked file, not a hand-kept list", () => {
  const files = trackedDddFiles();

  it("finds the whole population (the census must not silently shrink)", () => {
    // Guards the scanner itself: a broken `git ls-files` or glob would make
    // every assertion below pass vacuously.
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain("test/fixtures/corpus/core-domain.ddd");
    expect(files).toContain("examples/acme.ddd");
  });

  it("parses every tracked `.ddd` with zero parser errors", () => {
    const failed: string[] = [];
    for (const f of files) {
      if ((UNPARSEABLE as readonly string[]).includes(f)) continue;
      const result = parseRawResult(sourceOf(f));
      if (result.parserErrors.length > 0) {
        failed.push(`${f}: ${result.parserErrors[0]?.message ?? "parser error"}`);
      }
    }
    expect(
      failed,
      "a tracked `.ddd` no longer parses. Langium RECOVERS from a syntax error and " +
        "returns a partial AST, so nothing else in the suite would notice — fix the " +
        "source, or pin it in UNPARSEABLE with the reason it cannot parse.",
    ).toEqual([]);
    // Explicit budget, not the suite default: this walks EVERY tracked `.ddd`,
    // so its cost grows with the repo, and CI runs it under 4-way shard
    // contention with coverage instrumentation attached — where the ~3s local
    // parse sweep is nowhere near the ~30s default, but the validate sweep
    // below was, and timed out at 30s on its first CI run.
  }, 300_000);

  it("pins no file that parses fine (a stale pin is a lie)", () => {
    const stale = (UNPARSEABLE as readonly string[]).filter(
      (f) => parseRawResult(sourceOf(f)).parserErrors.length === 0,
    );
    expect(stale, "these are pinned as unparseable but parse clean — delete the pin").toEqual([]);
  });

  it("validates every self-contained `.ddd` with zero AST errors", async () => {
    const inProject = projectMembers(files);
    const excluded = new Set<string>([...UNPARSEABLE, ...DELIBERATELY_INVALID]);
    const failed: string[] = [];
    for (const f of files) {
      if (excluded.has(f) || inProject.has(f)) continue;
      const result = await parseString(sourceOf(f), { validate: true });
      if (result.errors.length > 0) failed.push(`${f}: ${result.errors[0]}`);
    }
    expect(
      failed,
      "a tracked standalone `.ddd` fails AST validation. If it is a member of a " +
        "multi-file project, it should be reached by an `import` from its entry " +
        "(membership is derived from the import graph, not listed here).",
    ).toEqual([]);
    // ~15s locally for 339 files; the budget is the same one the parse sweep
    // carries, for the same reason.
  }, 300_000);

  it("still rejects the deliberately-invalid fixture", async () => {
    // The negative control. Without it, a validator that stopped reporting
    // anything at all would pass every assertion above.
    for (const f of DELIBERATELY_INVALID) {
      const result = await parseString(sourceOf(f), { validate: true });
      expect(result.errors.length, `${f} is pinned as invalid but validates clean`).toBeGreaterThan(
        0,
      );
    }
  });
});
