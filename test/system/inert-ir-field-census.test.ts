// The INERT-IR-FIELD census — a DENOMINATOR for `loom.reserved-not-emitted`
// (M-T5.9 (a)).
//
// Loom's grammar has repeatedly grown a clause ahead of the emitter that would
// honour it: the clause parses, the validator accepts it, the lowerer stamps it
// onto the IR — and no generator reads it. The author gets a clean `ddd parse`,
// byte-identical output with and without the clause, and a runtime that quietly
// does something else.
//
// `src/ir/validate/checks/reserved-surfaces.ts` is the honest answer to that:
// one registry, one meta-diagnostic, a catalog entry, a docs anchor, a firing
// fixture, and a no-stale-rows reachability test. What it has never had is a
// DENOMINATOR. `RESERVED_SURFACES` is a list someone maintains, so the mission's
// actual ask — "routed through EVERY parse-but-no-emit surface" — has no way to
// be true or false. That is the shape `gated-features-inventory.md` rotted into.
//
// THE MEASUREMENT. A field declared on the IR and read by NO file under
// `src/generator/**`, `src/system/**` or `src/platform/**` — nor by a
// `src/ir/util/` helper those files import — is a CANDIDATE inert surface:
// something the pipeline computes and no target consumes.  A name that appears
// only in a comment is not a read.
//
// THE RULE is a shrink-only exact list, not a hard gate at zero, because the
// scan over-approximates in one direction: a field consumed only by another
// IR-layer derivation, read through a destructure the text scan cannot see, or
// read by the CLI / `ddd verify` instead of an emitter is benign.  So the list
// is split in two:
//
//   - `NO_READER_ALLOWED` — benign by design, with the reason.  Permanent.
//   - `NO_READER_DEBT` — should be resolved (given a reader, a
//     `RESERVED_SURFACES` row, deleted, or moved to the allowed list), each
//     naming the issue that owns it.  Meant to reach zero.
//
// A new unread field fails until it is placed in one of the two.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";
import { irTypesSource } from "../_helpers/ir-types-source.js";

/** Roots that EMIT. A field no file here mentions reaches no target. */
const EMITTING_ROOTS = ["src/generator", "src/system", "src/platform"];
/** Per-root file floors (~90% of today's count).  A root missing here fails (floor = Infinity). */
const ROOT_FLOOR: Record<string, number> = {
  "src/generator": 580,
  "src/system": 24,
  "src/platform": 36,
};

/** IR fields no target reads, by design.  Each says why that is benign. */
const NO_READER_ALLOWED: Readonly<Record<string, string>> = {
  sensitivity:
    "consumed in the IR by `fieldRedactedInInspect` (src/ir/enrich/mask-taint.ts): `synthesizeInspect` redacts the leaf for every target, and Phoenix's Inspect-impl gate calls the same predicate",
  foldTenantClaim:
    "read through `foldTenancyFor` in `src/ir/enrich/fold-tenancy.ts` (an enrich helper the scan does not cover), which every backend's projection emitter and the migrations builder import",
  timezone:
    "has a RESERVED_SURFACES row (`timer-source-timezone`), so the author is told no target honours it",
  whenSource:
    "diagnostic text only: `loom.loop-gate-not-implied` names the gate; the 409 detail is constant, so no target may echo it",
};

/**
 * IR fields no target reads that SHOULD be resolved — debt, with the issue that
 * owns it.  Shrink-only and exact: a field leaves when it gains a reader, a
 * `RESERVED_SURFACES` row, a deletion, or a move to `NO_READER_ALLOWED`; a NEW
 * unread field fails until someone says which.
 */
const NO_READER_DEBT: Readonly<Record<string, string>> = {
  // Parse-but-no-emit: the clause parses, lowers, and vanishes.
  accessSource: "#3373", // provenance beside `access`; `access` is read, this is not
  sourceDeployableName: "#3373", // from a `uiCompose { … }` clause
  uiBindings: "#3373", // from a `uiCompose { … }` clause
  // Not yet dispositioned.
  auditHistory: "#4636",
  execTestsByCodeElement: "#4636",
  generic: "#4636",
  impliedBy: "#4636",
  keyPrefix: "#4636",
  loadPlan: "#4636",
  needs: "#4636",
  overlap: "#4636",
  policyDenies: "#4636",
  priority: "#4636",
  readonly: "#4636",
  resourceInterfaces: "#4636",
  retain: "#4636",
  rootEnums: "#4636",
  sessions: "#4636",
  sourceAlias: "#4636",
  testCaseId: "#4636",
  ttl: "#4636",
  urlStyle: "#4636",
  verifiesTestCase: "#4636",
};

const NO_DOWNSTREAM_READER: readonly string[] = [
  ...Object.keys(NO_READER_ALLOWED),
  ...Object.keys(NO_READER_DEBT),
];

/** Every field name declared at interface-member indent in the IR types. */
function declaredFields(): Set<string> {
  const src = irTypesSource();
  const out = new Set<string>();
  for (const line of src.split("\n")) {
    const m = /^ {2}(?:readonly )?([a-z][A-Za-z0-9_]*)\??:/.exec(line);
    if (m) out.add(m[1] as string);
  }
  return out;
}

function tsFilesUnder(rel: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts")) out.push(p);
    }
  };
  walk(path.join(REPO_ROOT, rel));
  return out;
}

/** `src/ir/util/` modules an emitting root imports, closed over their own
 *  imports inside `src/ir/util/`.  A field such a helper reads reaches every
 *  target that calls it (`read-gates.ts`, `entry-result.ts`, …), so it counts
 *  as read downstream. */
function irUtilReachedFromEmitters(): string[] {
  const utilDir = path.join(REPO_ROOT, "src/ir/util");
  const importsOf = (file: string): string[] =>
    [...fs.readFileSync(file, "utf8").matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)].map((m) =>
      path.resolve(path.dirname(file), (m[1] as string).replace(/\.js$/, ".ts")),
    );
  const reached = new Set<string>();
  const queue = EMITTING_ROOTS.flatMap(tsFilesUnder).flatMap(importsOf);
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (reached.has(file) || !file.startsWith(utilDir) || !fs.existsSync(file)) continue;
    reached.add(file);
    queue.push(...importsOf(file));
  }
  return [...reached];
}

/** A field is "read downstream" when any emitting-root file mentions it as a
 *  member access (`x.f`, `x?.f`) or as an object key / destructured binding
 *  (`f:`, `f,`, `f}`).  Deliberately generous — a false NEGATIVE here would
 *  hide a real inert surface, while a false positive only shortens the list. */
function downstreamReaders(): (field: string) => boolean {
  // Comments are dropped: a field named only in prose is not read.
  const read = (files: string[]): string =>
    files
      .map((f) => fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, "$1"))
      .join("\n");
  const emitters = read(EMITTING_ROOTS.flatMap(tsFilesUnder));
  // In an `ir/util` helper an object key is usually a WRITE (it builds IR), so
  // only a member access counts there.
  const helpers = read(irUtilReachedFromEmitters());
  return (field) =>
    new RegExp(`[.?]${field}\\b|\\b${field}\\s*[:,}]`).test(emitters) ||
    new RegExp(`[.?]${field}\\b`).test(helpers);
}

describe("inert-IR-field census (M-T5.9 (a) denominator)", () => {
  const fields = declaredFields();

  it("the scan reaches the real IR and the real emitters", () => {
    // Vacuum guard: a scan that matched nothing would pass everything below
    // (experience_gathered §59).
    expectReach("IR fields", fields.size, 306);
    for (const known of ["wireShape", "name", "statements", "params"]) {
      expect(fields, `${known} is no longer a declared IR field`).toContain(known);
    }
    for (const root of EMITTING_ROOTS) {
      expectReach(
        `${root} .ts files`,
        tsFilesUnder(root).length,
        ROOT_FLOOR[root] ?? Number.POSITIVE_INFINITY,
      );
    }
    // And the baseline must be a subset of what is actually declared — a name
    // left here after the field was deleted is a stale row, not a finding.
    const stale = NO_DOWNSTREAM_READER.filter((f) => !fields.has(f));
    expect(stale, "baseline names a field the IR types no longer declare:").toEqual([]);
  });

  it("no IR field silently reaches no target", () => {
    const isRead = downstreamReaders();
    const unread = [...fields].filter((f) => !isRead(f)).sort();
    const known = new Set(NO_DOWNSTREAM_READER);

    const added = unread.filter((f) => !known.has(f));
    expect(
      added,
      "New IR field(s) that NO file under src/generator, src/system or " +
        "src/platform reads. A field the pipeline computes and no target " +
        "consumes is a parse-but-no-emit surface: the clause parses, the author " +
        "gets byte-identical output with and without it, and nothing says so " +
        "(M-T5.9). Give it a reader, give it a `RESERVED_SURFACES` row in " +
        "`src/ir/validate/checks/reserved-surfaces.ts`, or add it below with the " +
        "reason it is benign.",
    ).toEqual([]);

    // Anti-slack: a field that gained a reader must leave this list in the same
    // change, or the baseline rots into a number nobody believes.
    const fixed = NO_DOWNSTREAM_READER.filter((f) => fields.has(f) && isRead(f));
    expect(
      fixed,
      "These now HAVE a downstream reader — delete them from NO_DOWNSTREAM_READER:",
    ).toEqual([]);
  });
});
