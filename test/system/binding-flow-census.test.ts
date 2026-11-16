// Binding-flow census: "is this name read later" and "which outer names does
// this nested body carry" are answered by `src/ir/plan/binding-flow.ts`, and
// no generator or platform package spells them again.
//
// Two backends that answer liveness differently disagree silently: one binds
// a name the other drops, and a later read sees a stale value or a linter
// rejects an unused local.  Each spelling outside the plan is one more place
// for that to happen, so the census refuses a new one.
//
// THE DETECTORS (TypeScript AST, so comments and strings never count):
//
//   read-after  a `namesUsed(…)` / `refsRead(…)` call whose result is asked
//               `.has(…)` directly — the hand-spelled "is this name read
//               after here" test.
//               → use `isReadAfter` / `readAfter`.
//   carried     a `.filter(…)` over a spread `namesUsed(…)` / `refsRead(…)`
//               whose callback is a negated `.has(…)` — the hand-spelled
//               "names a nested body reads that are bound outside it".
//               → use `carriedInto`.
//
// SCOPE.  `src/generator/`, `src/platform/`, `src/system/`.
//
// WAIVERS are typed and expire: `deferred` with `reviewUntil` and a live
// `blockedBy` fence (test/_helpers/live-fences.ts), or `standing` with a
// reason.  A waiver whose site is gone fails, so the fix deletes it.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";
import { fenceProblem } from "../_helpers/live-fences.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCANNED_ROOTS = ["src/generator", "src/platform", "src/system"];
const NAME_SETS = new Set(["namesUsed", "refsRead"]);
const MAX_DEFERRAL_DAYS = 180;

type Waiver = { standing: string } | { deferred: string; reviewUntil: string; blockedBy?: string };

/** `rule  file  site text` → waiver.  Keyed by text, not line. */
const WAIVERS: Readonly<Record<string, Waiver>> = {};

/** The waiver count may only fall. */
const WAIVER_CEILING = 0;

interface Violation {
  rule: "read-after" | "carried";
  file: string;
  line: number;
  text: string;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...tsFiles(full));
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function isNameSetCall(e: ts.Node): boolean {
  return (
    ts.isCallExpression(e) && ts.isIdentifier(e.expression) && NAME_SETS.has(e.expression.text)
  );
}

/** True when `body` is `!<x>.has(…)`. */
function isNegatedHas(body: ts.Node): boolean {
  let b = body;
  while (ts.isParenthesizedExpression(b)) b = b.expression;
  return (
    ts.isPrefixUnaryExpression(b) &&
    b.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isCallExpression(b.operand) &&
    ts.isPropertyAccessExpression(b.operand.expression) &&
    b.operand.expression.name.text === "has"
  );
}

function scan(file: string): Violation[] {
  const rel = path.relative(repoRoot, file);
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const out: Violation[] = [];
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "has" &&
      isNameSetCall(n.expression.expression)
    ) {
      out.push({ rule: "read-after", file: rel, line: at(n), text: n.getText(sf) });
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "filter" &&
      ts.isArrayLiteralExpression(n.expression.expression) &&
      n.expression.expression.elements.some(
        (el) => ts.isSpreadElement(el) && isNameSetCall(el.expression),
      ) &&
      n.arguments.length === 1 &&
      (ts.isArrowFunction(n.arguments[0]!) || ts.isFunctionExpression(n.arguments[0]!)) &&
      isNegatedHas((n.arguments[0] as ts.ArrowFunction).body)
    ) {
      out.push({ rule: "carried", file: rel, line: at(n), text: n.getText(sf) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const keyOf = (v: Violation): string => `${v.rule}  ${v.file}  ${v.text.split("\n")[0]!.trim()}`;

function waiverProblem(w: Waiver, today: Date): string {
  if ("standing" in w) return w.standing.trim() === "" ? "a standing waiver needs a reason" : "";
  const due = Date.parse(`${w.reviewUntil}T23:59:59Z`);
  if (Number.isNaN(due)) return `reviewUntil "${w.reviewUntil}" is not a date`;
  if (due < today.getTime()) return `the deferral expired on ${w.reviewUntil}`;
  if ((due - today.getTime()) / 86_400_000 > MAX_DEFERRAL_DAYS) {
    return `reviewUntil ${w.reviewUntil} is past the ${MAX_DEFERRAL_DAYS}-day cap`;
  }
  return w.blockedBy ? fenceProblem(w.blockedBy) : "";
}

describe("binding-flow census: liveness is answered by src/ir/plan/binding-flow.ts", () => {
  const files = SCANNED_ROOTS.flatMap((r) => tsFiles(path.join(repoRoot, r)));
  const found = files.flatMap(scan);
  const open = found.filter((v) => !Object.hasOwn(WAIVERS, keyOf(v)));

  it("reaches the scanned trees", () => {
    expectReach("source files", files.length, 700);
  });

  it("no backend re-spells a read-after test (use isReadAfter / readAfter)", () => {
    const hits = open.filter((v) => v.rule === "read-after");
    expect(hits.map((v) => `${v.file}:${v.line}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-spells the names a nested body carries (use carriedInto)", () => {
    const hits = open.filter((v) => v.rule === "carried");
    expect(hits.map((v) => `${v.file}:${v.line}  ${v.text}`)).toEqual([]);
  });

  it("every waiver still names a site, none has expired, and the ledger is pinned", () => {
    const keys = new Set(found.map(keyOf));
    expect(
      Object.keys(WAIVERS).filter((k) => !keys.has(k)),
      "the site is gone: delete its waiver",
    ).toEqual([]);
    const today = new Date();
    expect(
      Object.entries(WAIVERS)
        .map(([k, w]) => [k, waiverProblem(w, today)] as const)
        .filter(([, p]) => p !== "")
        .map(([k, p]) => `${k}: ${p}`),
    ).toEqual([]);
    const ks = Object.keys(WAIVERS);
    expect(ks).toEqual([...ks].sort());
    expect(ks.length).toBeLessThanOrEqual(WAIVER_CEILING);
  });
});
