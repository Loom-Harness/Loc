import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// ---------------------------------------------------------------------------
// Workflow-plan census: each workflow fact `src/ir/plan/` owns has ONE
// implementation, and the generators, platform packages and the system
// composer ask the plan for it instead of recomputing it.
//
// A recomputed copy is where backends drift: one copy learns a rule (an
// event-sourced workflow has no state row) and the next one does not, and a
// backend builds an entity for a table the migrations never created.  The
// census makes the copy impossible to add back silently.
//
// THE DETECTORS (TypeScript AST, so comments and strings never count):
//
//   state-row   a `&&` / `||` whose two operands read `.correlationField` and
//               `.eventSourced` with the state-row polarity — `corr && !es`
//               (`hasStateRow`) or `!corr || es` (its negation).  An
//               `es && corr` test is a different question and is not flagged.
//               → use `hasStateRow` / `stateRowWorkflows`.
//   set-filter  a `.filter(...)` whose callback just reads `.eventSourced` or
//               `.instanceWireShape` (bare, `!!`-wrapped or `!= null`).
//               → use `eventSourcedWorkflows` / `observableWorkflows`.
//   own-state   a callback handed to a `walk…Deep` walker that compares a
//               `refKind` with both `"this-prop"` and `"this-derived"` — the
//               hand-rolled "does this body read its own state" scan.
//               → use `workflowBodyUsesOwnState` / `workflowBodyReadsOwnState`
//               (`src/ir/util/workflow-own-state.ts`).
//
//   self-result a `&&` that tests a type's `.kind === "entity"` and compares its
//               `.name` with a workflow's `.name` — the hand-spelled "this
//               create returns the workflow itself" test.
//               → use `isWorkflowSelfType` / `commandCreateReturnsSelf`.
//
// SCOPE.  `src/generator/`, `src/platform/`, `src/system/`, `src/ir/validate/`.  The plan itself
// (`src/ir/plan/`) is the one place allowed to spell the predicates.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCANNED_ROOTS = ["src/generator", "src/platform", "src/system", "src/ir/validate"];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...tsFiles(full));
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** Strip parentheses; report how many `!` were peeled (parity = negation). */
function peel(e: ts.Expression): { inner: ts.Expression; negations: number } {
  let negations = 0;
  let cur = e;
  for (;;) {
    if (ts.isParenthesizedExpression(cur)) cur = cur.expression;
    else if (ts.isPrefixUnaryExpression(cur) && cur.operator === ts.SyntaxKind.ExclamationToken) {
      negations++;
      cur = cur.operand;
    } else break;
  }
  return { inner: cur, negations };
}

/** The property a (possibly optional-chained) access reads, or undefined. */
function propName(e: ts.Expression): string | undefined {
  return ts.isPropertyAccessExpression(e) ? e.name.text : undefined;
}

/** A read of `.correlationField` / `.eventSourced`: its name and whether the
 *  operand asserts it TRUE (an even number of `!`). */
function flagRead(e: ts.Expression): { name: string; positive: boolean } | undefined {
  const { inner, negations } = peel(e);
  const name = propName(inner);
  if (name !== "correlationField" && name !== "eventSourced") return undefined;
  return { name, positive: negations % 2 === 0 };
}

/** True when a filter callback's body is a bare truthiness read of `prop`. */
function isTruthinessRead(body: ts.Node, prop: string): boolean {
  if (!ts.isExpression(body)) return false;
  const { inner, negations } = peel(body);
  if (negations % 2 === 1) return false;
  if (propName(inner) === prop) return true;
  if (
    ts.isBinaryExpression(inner) &&
    (inner.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ||
      inner.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) &&
    (inner.right.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(inner.right) && inner.right.text === "undefined"))
  ) {
    return propName(inner.left) === prop;
  }
  return false;
}

interface Violation {
  rule: "state-row" | "set-filter" | "self-result" | "own-state";
  where: string;
  text: string;
}

function scan(file: string): Violation[] {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const rel = path.relative(repoRoot, file);
  const out: Violation[] = [];
  const at = (n: ts.Node) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const visit = (n: ts.Node): void => {
    if (
      ts.isBinaryExpression(n) &&
      (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        n.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      const a = flagRead(n.left);
      const b = flagRead(n.right);
      if (a && b && a.name !== b.name) {
        const corr = a.name === "correlationField" ? a : b;
        const es = a.name === "eventSourced" ? a : b;
        const isAnd = n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
        // `corr && !es` is hasStateRow; `!corr || es` is its negation.
        if ((isAnd && corr.positive && !es.positive) || (!isAnd && !corr.positive && es.positive)) {
          out.push({ rule: "state-row", where: at(n), text: n.getText(sf) });
        }
      }
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      const sides = [n.left, n.right].map((e) => peel(e).inner);
      const isEntityKind = (e: ts.Expression) =>
        ts.isBinaryExpression(e) &&
        e.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        propName(e.left) === "kind" &&
        ts.isStringLiteral(e.right) &&
        e.right.text === "entity";
      const isWorkflowName = (e: ts.Expression) =>
        ts.isBinaryExpression(e) &&
        e.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        propName(e.left) === "name" &&
        ts.isPropertyAccessExpression(e.right) &&
        e.right.name.text === "name" &&
        /^(wf|workflow)$/.test(e.right.expression.getText(sf));
      if (sides.some(isEntityKind) && sides.some(isWorkflowName)) {
        out.push({ rule: "self-result", where: at(n), text: n.getText(sf) });
      }
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "filter" &&
      n.arguments.length === 1
    ) {
      const cb = n.arguments[0]!;
      if (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) {
        let body: ts.Node = cb.body;
        if (ts.isBlock(body) && body.statements.length === 1) {
          const only = body.statements[0]!;
          if (ts.isReturnStatement(only) && only.expression) body = only.expression;
        }
        if (isTruthinessRead(body, "eventSourced") || isTruthinessRead(body, "instanceWireShape")) {
          out.push({ rule: "set-filter", where: at(n), text: n.getText(sf) });
        }
      }
    }
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      /^walk\w*Deep$/.test(n.expression.text)
    ) {
      for (const arg of n.arguments) {
        if (!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)) continue;
        const kinds = new Set<string>();
        const collect = (m: ts.Node): void => {
          if (
            ts.isBinaryExpression(m) &&
            (m.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
              m.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken) &&
            propName(m.left) === "refKind" &&
            ts.isStringLiteral(m.right)
          ) {
            kinds.add(m.right.text);
          }
          ts.forEachChild(m, collect);
        };
        collect(arg.body);
        if (kinds.has("this-prop") && kinds.has("this-derived")) {
          out.push({ rule: "own-state", where: at(n), text: n.expression.text });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("workflow-plan census: plan facts are not recomputed outside src/ir/plan/", () => {
  const files = SCANNED_ROOTS.flatMap((r) => tsFiles(path.join(repoRoot, r)));
  const violations = files.flatMap(scan);

  it("reaches the scanned trees", () => {
    expectReach("source files", files.length, 700);
  });

  it("no backend recomputes the state-row workflow predicate (use hasStateRow / stateRowWorkflows)", () => {
    const hits = violations.filter((v) => v.rule === "state-row");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-spells the workflow self-result test (use isWorkflowSelfType / commandCreateReturnsSelf)", () => {
    const hits = violations.filter((v) => v.rule === "self-result");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-filters the event-sourced / observable workflow sets (use eventSourcedWorkflows / observableWorkflows)", () => {
    const hits = violations.filter((v) => v.rule === "set-filter");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-scans a workflow body for own-state reads (use workflowBodyUsesOwnState / workflowBodyReadsOwnState)", () => {
    const hits = violations.filter((v) => v.rule === "own-state");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });
});
