// The type-system's THREE parallel member-resolution walkers (M-T5.16 (a)).
//
// `typeAfterSuffix`, `stepInto` and `stepIntoNode` all answer the same
// question — "what does `<receiver>.<name>` denote?" — and differ only in what
// they hand back (the member's type; the member's type along a dotted path;
// the member's AST node).  They were written as `if (t.kind === …)` chains
// falling through to a silent `T.unknown` / `undefined`, which is the shape the
// weak-spots audit §7 flagged: **a new `DddType` kind resolves on one walker,
// silently misses the other two, and nothing fails.**
//
// The divergence is not hypothetical.  On `main` before this change,
// `userclaim`, `id`, `array` and `primitive` all resolved members in
// `typeAfterSuffix` and resolved to `unknown` in `stepInto` — four kinds, none
// of them recorded anywhere.
//
// THE GUARD IS THE COMPILER.  Each walker is now a `switch (t.kind)` with a
// `const _exhaustive: never` default (the `src/ir/util/walk.ts` idiom), so a
// new `DddType` member fails `tsc -b` at all three sites at once.  That is the
// gate; this test is its READABILITY half, and it catches the two things the
// `never`-check alone cannot:
//
//   1. Someone satisfying `tsc` by dropping the new kind into the trailing
//      "no member surface" arm without deciding whether it has members — the
//      arms here are compared against a declared table, so that shows up as a
//      table edit.
//   2. The divergence drifting silently.  `MEMBER_RESOLVING_KINDS`
//      (exported from `type-system.ts`) states which kinds each walker
//      genuinely resolves ON; this test derives the same sets from the source
//      and fails if they disagree.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MEMBER_RESOLVING_KINDS } from "../../../src/language/type-system.js";

const SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../src/language/type-system.ts",
);
const source = fs.readFileSync(SRC, "utf8");

/** Every `kind:` literal in the `DddType` union declaration — read from the
 *  source so the test cannot drift behind a union that grew. */
function dddTypeKinds(): string[] {
  const start = source.indexOf("export type DddType =");
  expect(start, "the `DddType` union declaration moved or was renamed").toBeGreaterThan(-1);
  const end = source.indexOf("\n\n", start);
  const decl = source.slice(start, end);
  return [...decl.matchAll(/\{\s*kind:\s*"([a-z]+)"/g)].map((m) => m[1] as string);
}

/** The body of a top-level exported function, by name. */
function functionBody(name: string): string {
  const start = source.indexOf(`export function ${name}(`);
  expect(start, `\`${name}\` is no longer an exported function`).toBeGreaterThan(-1);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

/** Split a walker body into case-groups: consecutive `case "x":` labels share
 *  the statements that follow the last of them.  Returns, per kind, the body
 *  text its group runs. */
function caseGroups(fullBody: string): Map<string, string> {
  // Cut at the `default:` arm — otherwise the LAST case's group body swallows
  // the `never`-check block and never looks like a bare `return T.unknown;`.
  const dflt = fullBody.search(/^\s*default: \{/m);
  const body = dflt === -1 ? fullBody : fullBody.slice(0, dflt);
  const labels = [...body.matchAll(/^\s*case "([a-z]+)":/gm)];
  const out = new Map<string, string>();
  for (let i = 0; i < labels.length; i++) {
    const here = labels[i]!;
    const after = body.slice(here.index! + here[0].length, labels[i + 1]?.index ?? body.length);
    // A bare label (the next line is another `case`) shares the following
    // group's body — walk forward until a group with real statements.
    let j = i;
    let run = after;
    while (run.trim() === "" && j + 1 < labels.length) {
      j++;
      const nx = labels[j]!;
      run = body.slice(nx.index! + nx[0].length, labels[j + 1]?.index ?? body.length);
    }
    out.set(here[1] as string, run);
  }
  return out;
}

/** A group that does nothing but answer "no member here". */
function isNonResolving(groupBody: string): boolean {
  const stripped = groupBody
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
  return stripped === "return T.unknown;" || stripped === "return undefined;";
}

const WALKERS = ["typeAfterSuffix", "stepInto", "stepIntoNode"] as const;

describe("type-system member-resolution walkers are exhaustive over DddType", () => {
  const kinds = dddTypeKinds();

  it("the scan reaches the real union and the real walkers", () => {
    // Vacuum guard: a source scan that matched nothing would pass every
    // assertion below (experience_gathered §59).
    expect(kinds.length).toBeGreaterThanOrEqual(15);
    expect(kinds).toContain("userclaim");
    expect(kinds).toContain("payload");
    expect(new Set(kinds).size, "duplicate kind in the DddType union").toBe(kinds.length);
    for (const w of WALKERS) {
      expect(caseGroups(functionBody(w)).size, `${w} has no switch arms`).toBeGreaterThan(5);
    }
  });

  it.each(WALKERS)("%s has an explicit arm for every DddType kind", (walker) => {
    const groups = caseGroups(functionBody(walker));
    const missing = kinds.filter((k) => !groups.has(k));
    expect(
      missing,
      `${walker} has no \`case "<kind>":\` arm for these DddType kinds. ` +
        "A kind with no arm falls into the `never` default and resolves silently to " +
        "nothing — which is the M-T5.16 (a) defect. Add an arm (and, if the kind " +
        "genuinely resolves members, a row in MEMBER_RESOLVING_KINDS).",
    ).toEqual([]);
  });

  it.each(WALKERS)("%s's resolving kinds match the declared MEMBER_RESOLVING_KINDS", (walker) => {
    const groups = caseGroups(functionBody(walker));
    const resolving = [...groups.entries()]
      .filter(([, b]) => !isNonResolving(b))
      .map(([k]) => k)
      .sort();
    const declared = [...MEMBER_RESOLVING_KINDS[walker]].sort();
    expect(
      resolving,
      `${walker} resolves members on a different set of kinds than ` +
        "MEMBER_RESOLVING_KINDS declares. Widening or narrowing a walker is a " +
        "language change — record it in the table so the divergence between the " +
        "three walkers stays visible instead of silent.",
    ).toEqual(declared);
  });

  it("the declared divergence is the one the language actually has", () => {
    // `stepInto` is the dotted-path walk: a strict subset of the postfix walk.
    for (const k of MEMBER_RESOLVING_KINDS.stepInto) {
      expect(
        MEMBER_RESOLVING_KINDS.typeAfterSuffix as readonly string[],
        `${k} resolves on stepInto but not on typeAfterSuffix — the postfix walker ` +
          "is meant to be the widest of the three",
      ).toContain(k);
    }
    // The AST-node twin must track its type twin exactly, or go-to-definition
    // and hover disagree about what a member IS.
    expect([...MEMBER_RESOLVING_KINDS.stepIntoNode].sort()).toEqual(
      [...MEMBER_RESOLVING_KINDS.stepInto].sort(),
    );
    // And the divergence that exists today is real, not an artefact: four
    // kinds resolve on the postfix walker only.
    const onlyPostfix = MEMBER_RESOLVING_KINDS.typeAfterSuffix.filter(
      (k) => !(MEMBER_RESOLVING_KINDS.stepInto as readonly string[]).includes(k),
    );
    expect(onlyPostfix.sort()).toEqual(["array", "id", "primitive", "userclaim"]);
  });
});
