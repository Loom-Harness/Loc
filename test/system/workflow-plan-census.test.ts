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
//   audited-call  a body-scan callback (handed to a `walk…Deep` /
//               `walk…Children` walker or to `.some` / `.every` / `.filter` /
//               `.find` / `.forEach`; inline, or a same-file function passed by
//               name or as a visitor-object property) that
//               compares a `kind` with `"op-call"` and reads `.audited` — the
//               hand-rolled "does this body call an audited operation" scan.
//               → use `auditedOpCallAggregates` / `callsAuditedOp`.
//   needs-user  the same kind of callback comparing a `kind` with `"op-call"`
//               and asking `operation{Body,Gates,}Use(s)CurrentUser` — the
//               hand-rolled "must this body bind the principal" scan.
//               → use `workflowNeedsCurrentUser`.
//   resource-calls  the same kind of callback, over workflow statements (a
//               `walkWorkflowStmt…` walker, or one that also tests the
//               `"resource-call"` statement kind), comparing a `callKind` with
//               `"resource-op"` or `"remote-api-op"` — the hand-rolled "which
//               resource helpers does this body import" scan.
//               → use `resourceCalls`.
//   emits       a callback handed to a `walkWorkflowStmt…` walker comparing a
//               `kind` with `"emit"` — the hand-rolled "does this body emit"
//               scan.  (Operation statements have an `emit` kind too, so the
//               rule reads only the workflow walkers.)
//               → use `workflowEmits`.
//   deref-loads the same kind of callback comparing a `kind` with `"op-call"`
//               and collecting its `.target` into a set (`names.add(st.target)`)
//               — the hand-rolled "which loads does this body dereference" scan.
//               → use `dereferencedLoads`.
//   durable     `durableEventTypes(…).size` — the hand-spelled "does this
//               context route events through the outbox" test.
//               → use `hasDurableEvents`.
//   isolation   a call to `resolveWorkflowIsolation` — the per-backend choice
//               of when a dataSource's `isolationLevel:` applies.
//               → use `workflowIsolation`.
//   implicit-tx a `||` over `.transactional` and a `bodyWriteScopeGuards(…)`
//               call — the hand-spelled "does this body run in one
//               transaction" test.
//               → use `workflowRunsInTransaction`.
//   folded-events  a `.map(…)` over an `appliers` list whose callback returns
//               the applier's `.event` — the hand-rolled "which events does
//               this stream fold" list.
//               → use `foldedEventNames`.
//   event-log   a template literal with a `${snake(…)}_events` span — the
//               hand-spelled per-context event-log table name.
//               → use `eventLogTable`.
//   sub-handler a `.find(…)` whose callback matches a `create`'s
//               `.eventBinding` against a subscription's `.param` — the
//               hand-rolled "which body does this subscription run" lookup.
//               → use `subscriptionHandler`.
//   es-shared   a `.some(…)` over a workflow's `subscriptions` whose callback
//               compares an `.event` — the hand-spelled "does this starter
//               share its event with a reactor" test.
//               → use `esStarterSharesEvent`.
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
  rule:
    | "state-row"
    | "set-filter"
    | "self-result"
    | "own-state"
    | "audited-call"
    | "needs-user"
    | "resource-calls"
    | "emits"
    | "deref-loads"
    | "durable"
    | "isolation"
    | "implicit-tx"
    | "folded-events"
    | "event-log"
    | "sub-handler"
    | "es-shared";
  where: string;
  text: string;
}

/** Bodies of the function-like callbacks among `args`: an inline arrow or
 *  function, a same-file named function or `const f = (…) => …` passed by
 *  name, or either of those as a property value of an object literal (the
 *  `walkWorkflowStmtChildren(st, { workflowStmt: walk })` visitor form). */
function callbackBodies(
  args: readonly ts.Expression[],
  localFns: ReadonlyMap<string, ts.Node>,
): ts.Node[] {
  const out: ts.Node[] = [];
  const take = (e: ts.Expression): void => {
    if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) out.push(e.body);
    else if (ts.isIdentifier(e)) {
      const body = localFns.get(e.text);
      if (body) out.push(body);
    } else if (ts.isObjectLiteralExpression(e)) {
      for (const prop of e.properties) {
        if (ts.isPropertyAssignment(prop)) take(prop.initializer);
        else if (ts.isShorthandPropertyAssignment(prop)) take(prop.name);
      }
    }
  };
  for (const a of args) take(a);
  return out;
}

/** Named function-like declarations in a file: `function f` and
 *  `const f = (…) => …` / `function (…)`. */
function localFunctions(sf: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) out.set(n.name.text, n.body);
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    ) {
      out.set(n.name.text, n.initializer.body);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** What a body-scan callback looks at. */
function callbackFacts(body: ts.Node) {
  const f = {
    opCall: false,
    audited: false,
    userAsk: false,
    resourceKind: false,
    workflowOnlyKind: false,
    emitKind: false,
    addsTarget: false,
  };
  const collect = (m: ts.Node): void => {
    if (
      ts.isBinaryExpression(m) &&
      (m.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        m.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) &&
      ts.isStringLiteral(m.right)
    ) {
      const field = propName(m.left);
      const lit = m.right.text;
      if (field === "kind" && lit === "op-call") f.opCall = true;
      if (field === "kind" && lit === "emit") f.emitKind = true;
      if (field === "kind" && lit === "resource-call") f.workflowOnlyKind = true;
      if (field === "callKind" && (lit === "resource-op" || lit === "remote-api-op")) {
        f.resourceKind = true;
      }
    }
    if (ts.isPropertyAccessExpression(m) && m.name.text === "audited") f.audited = true;
    if (
      ts.isCallExpression(m) &&
      ts.isIdentifier(m.expression) &&
      /^operation(Body|Gates)?Uses?CurrentUser$/.test(m.expression.text)
    ) {
      f.userAsk = true;
    }
    // `names.add(st.target)` — collecting op-call targets.
    if (
      ts.isCallExpression(m) &&
      ts.isPropertyAccessExpression(m.expression) &&
      m.expression.name.text === "add" &&
      m.arguments.length === 1 &&
      propName(m.arguments[0]!) === "target"
    ) {
      f.addsTarget = true;
    }
    ts.forEachChild(m, collect);
  };
  collect(body);
  return f;
}

function scan(file: string): Violation[] {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const rel = path.relative(repoRoot, file);
  const out: Violation[] = [];
  const localFns = localFunctions(sf);
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
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const walkerName = ts.isIdentifier(callee) ? callee.text : "";
      const isWalker = /^walk\w*(Deep|Children)$/.test(walkerName);
      const isWorkflowWalker = /^walkWorkflowStmt/.test(walkerName);
      const isIter =
        ts.isPropertyAccessExpression(callee) &&
        ["some", "every", "filter", "find", "forEach"].includes(callee.name.text);
      if (isWalker || isIter) {
        for (const body of callbackBodies(n.arguments, localFns)) {
          const f = callbackFacts(body);
          const hit = (rule: Violation["rule"]) =>
            out.push({ rule, where: at(n), text: callee.getText(sf) });
          if (f.opCall && f.audited) hit("audited-call");
          if (f.opCall && f.userAsk) hit("needs-user");
          if (f.resourceKind && (isWorkflowWalker || f.workflowOnlyKind)) hit("resource-calls");
          if (f.emitKind && isWorkflowWalker) hit("emits");
          if (f.opCall && f.addsTarget) hit("deref-loads");
        }
      }
    }
    if (
      ts.isPropertyAccessExpression(n) &&
      n.name.text === "size" &&
      ts.isCallExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === "durableEventTypes"
    ) {
      out.push({ rule: "durable", where: at(n), text: n.getText(sf) });
    }
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "resolveWorkflowIsolation"
    ) {
      out.push({ rule: "isolation", where: at(n), text: n.getText(sf) });
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
      !(
        ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.BarBarToken
      )
    ) {
      // The outermost `||` of a chain: does it test `.transactional` and ask
      // for the body's write-scope guards?
      let transactional = false;
      let guards = false;
      const look = (m: ts.Node): void => {
        if (ts.isPropertyAccessExpression(m) && m.name.text === "transactional")
          transactional = true;
        if (
          ts.isCallExpression(m) &&
          ts.isIdentifier(m.expression) &&
          m.expression.text === "bodyWriteScopeGuards"
        ) {
          guards = true;
        }
        ts.forEachChild(m, look);
      };
      look(n);
      if (transactional && guards) {
        out.push({ rule: "implicit-tx", where: at(n), text: n.getText(sf) });
      }
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "map" &&
      /\bappliers\b/.test(n.expression.expression.getText(sf)) &&
      n.arguments.length === 1 &&
      ts.isArrowFunction(n.arguments[0]!) &&
      ts.isExpression(n.arguments[0]!.body) &&
      propName(n.arguments[0]!.body) === "event"
    ) {
      out.push({ rule: "folded-events", where: at(n), text: n.getText(sf) });
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      (n.expression.name.text === "find" || n.expression.name.text === "some") &&
      n.arguments.length === 1 &&
      (ts.isArrowFunction(n.arguments[0]!) || ts.isFunctionExpression(n.arguments[0]!))
    ) {
      const method = n.expression.name.text;
      const receiver = n.expression.expression.getText(sf);
      let bindingVsParam = false;
      let comparesEvent = false;
      const look = (m: ts.Node): void => {
        if (
          ts.isBinaryExpression(m) &&
          m.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
        ) {
          const l = propName(m.left);
          const r = propName(m.right);
          if ((l === "eventBinding" && r === "param") || (l === "param" && r === "eventBinding")) {
            bindingVsParam = true;
          }
          if (l === "event") comparesEvent = true;
        }
        ts.forEachChild(m, look);
      };
      look(n.arguments[0]!.body);
      if (method === "find" && bindingVsParam) {
        out.push({ rule: "sub-handler", where: at(n), text: n.getText(sf) });
      }
      if (method === "some" && /\bsubscriptions\b/.test(receiver) && comparesEvent) {
        out.push({ rule: "es-shared", where: at(n), text: n.getText(sf) });
      }
    }
    if (
      ts.isTemplateExpression(n) &&
      n.templateSpans.some(
        (span) =>
          span.literal.text.startsWith("_events") &&
          ts.isCallExpression(span.expression) &&
          ts.isIdentifier(span.expression.expression) &&
          span.expression.expression.text === "snake",
      )
    ) {
      out.push({ rule: "event-log", where: at(n), text: n.getText(sf) });
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

  it("no backend re-scans a body for audited op-calls (use auditedOpCallAggregates / callsAuditedOp)", () => {
    const hits = violations.filter((v) => v.rule === "audited-call");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-scans a body for principal-needing op-calls (use workflowNeedsCurrentUser)", () => {
    const hits = violations.filter((v) => v.rule === "needs-user");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-scans a body for resource calls (use resourceCalls)", () => {
    const hits = violations.filter((v) => v.rule === "resource-calls");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-scans a body for emits (use workflowEmits)", () => {
    const hits = violations.filter((v) => v.rule === "emits");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-scans a body for dereferenced loads (use dereferencedLoads)", () => {
    const hits = violations.filter((v) => v.rule === "deref-loads");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-spells the durable-events test (use hasDurableEvents)", () => {
    const hits = violations.filter((v) => v.rule === "durable");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend decides on its own when a dataSource isolation level applies (use workflowIsolation)", () => {
    const hits = violations.filter((v) => v.rule === "isolation");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-spells when a workflow body runs in one transaction (use workflowRunsInTransaction)", () => {
    const hits = violations.filter((v) => v.rule === "implicit-tx");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-lists the events a stream folds (use foldedEventNames)", () => {
    const hits = violations.filter((v) => v.rule === "folded-events");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-spells the event-log table name (use eventLogTable)", () => {
    const hits = violations.filter((v) => v.rule === "event-log");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-resolves a subscription's handler body (use subscriptionHandler)", () => {
    const hits = violations.filter((v) => v.rule === "sub-handler");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-spells the shared starter/reactor event test (use esStarterSharesEvent)", () => {
    const hits = violations.filter((v) => v.rule === "es-shared");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-scans a workflow body for own-state reads (use workflowBodyUsesOwnState / workflowBodyReadsOwnState)", () => {
    const hits = violations.filter((v) => v.rule === "own-state");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });
});
