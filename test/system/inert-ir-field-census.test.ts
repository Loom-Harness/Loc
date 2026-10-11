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
// THE MEASUREMENT. A field declared on the IR and referenced by NO file under
// `src/generator/**`, `src/system/**` or `src/platform/**` is a CANDIDATE inert
// surface: something the pipeline computes and no target consumes. Measured
// here: **27 of 330 declared fields**.
//
// THE RULE is a shrink-only exact baseline, not a hard gate at zero, and that is
// deliberate — the scan over-approximates in one direction. Three false-positive
// classes are real and benign:
//
//   - a field consumed only by another IR-layer derivation (`loadPlan`,
//     `resourceInterfaces`) — internal plumbing, never meant to reach a target;
//   - a field read through a destructure or a spread this text scan cannot see;
//   - a field the CLI / API / trace surfaces read instead of an emitter
//     (`testCaseId`, `verifiesTestCase` — the `ddd verify` rollup).
//
// So a row here is "someone must say which of those it is", and the ratchet is
// that the list can only get SHORTER: a new IR field with no downstream reader
// fails until it is either given one, dispositioned here, or given a
// `RESERVED_SURFACES` row (which is the honest outcome when the answer is "no
// emitter honours this yet").
//
// THREE CONFIRMED, checked by hand, each a real parse-but-no-emit surface with
// no `RESERVED_SURFACES` row today:
//
//   - `uiBindings` + `sourceDeployableName` — written by
//     `src/ir/lower/lower-deployment.ts:139,142,185` from a `uiCompose { … }`
//     clause, and read by NOTHING. The clause parses, lowers, and vanishes.
//   - `accessSource` — stamped by `lower-members.ts:141` and
//     `enrich/enrichments.ts:1890,1909` (`"declared"` / `"default"` / `"stamp"`)
//     beside `access`, which IS read. The provenance half is not.
//
// Adding those rows is `src/ir/validate/checks/**` — packet 4c's fence, not
// 4f's — so this census ships the measurement and the wave C4 packet 4f hand-off
// carries the rows. When a row lands, its name comes OUT of the baseline below.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";

const IR_TYPES = path.join(REPO_ROOT, "src/ir/types/loom-ir.ts");

/** Roots that EMIT. A field no file here mentions reaches no target. */
const EMITTING_ROOTS = ["src/generator", "src/system", "src/platform"];

/**
 * IR fields with no reference under an emitting root.  Shrink-only and exact:
 * a name leaves this list when it gains a reader, a disposition, or a
 * `RESERVED_SURFACES` row — and a NEW name fails until someone says which.
 */
const NO_DOWNSTREAM_READER: readonly string[] = [
  // --- confirmed parse-but-no-emit; rows owed to RESERVED_SURFACES ---------
  "accessSource", // provenance beside `access`; `access` is read, this is not
  "sourceDeployableName", // lower-deployment.ts:142, read by nothing
  "uiBindings", // lower-deployment.ts:139,185 — a whole `uiCompose` clause
  // --- the rest: candidates awaiting a disposition -------------------------
  "auditHistory",
  "crossTenant",
  "execTestsByCodeElement",
  "impliedBy",
  "keyPrefix",
  "loadPlan",
  "policyDenies",
  "policyReadLevels",
  "policyWriteLevels",
  "priority",
  "readonly",
  "resourceInterfaces",
  "retain",
  "rootEnums",
  "rootPayloads",
  "rootValueObjects",
  "runtimeString",
  "sessions",
  "sourceAlias",
  "sourceModule",
  "testCaseId",
  "timezone", // already has a RESERVED_SURFACES row (`timer-source-timezone`)
  "ttl",
  "verifiesTestCase",
];

/** Every field name declared at interface-member indent in `loom-ir.ts`. */
function declaredFields(): Set<string> {
  const src = fs.readFileSync(IR_TYPES, "utf8");
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

/** A field is "read downstream" when any emitting-root file mentions it as a
 *  member access (`x.f`, `x?.f`) or as an object key / destructured binding
 *  (`f:`, `f,`, `f}`).  Deliberately generous — a false NEGATIVE here would
 *  hide a real inert surface, while a false positive only shortens the list. */
function downstreamReaders(): (field: string) => boolean {
  const blob = EMITTING_ROOTS.flatMap(tsFilesUnder)
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
  return (field) => new RegExp(`[.?]${field}\\b|\\b${field}\\s*[:,}]`).test(blob);
}

describe("inert-IR-field census (M-T5.9 (a) denominator)", () => {
  const fields = declaredFields();

  it("the scan reaches the real IR and the real emitters", () => {
    // Vacuum guard: a scan that matched nothing would pass everything below
    // (experience_gathered §59).
    expect(fields.size).toBeGreaterThan(250);
    for (const known of ["wireShape", "name", "statements", "params"]) {
      expect(fields, `${known} is no longer a declared IR field`).toContain(known);
    }
    for (const root of EMITTING_ROOTS) {
      expect(tsFilesUnder(root).length, `${root} has no .ts files`).toBeGreaterThan(10);
    }
    // And the baseline must be a subset of what is actually declared — a name
    // left here after the field was deleted is a stale row, not a finding.
    const stale = NO_DOWNSTREAM_READER.filter((f) => !fields.has(f));
    expect(stale, "baseline names a field `loom-ir.ts` no longer declares:").toEqual([]);
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
