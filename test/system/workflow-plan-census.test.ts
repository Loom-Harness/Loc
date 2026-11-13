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
//   tx-boundary a read of a workflow's `.transactional` in a generator or a
//               platform package (not a `db.transactional(…)` call) — a
//               backend choosing its own transaction boundary.  A workflow
//               runs in one transaction exactly when the plan says so; any
//               other commits each save on its own.
//               → use `workflowRunsInTransaction` / `workflowIsolation`.
//   wire-status a `workflowCanAnswerNotFound(…)` call that is not an argument
//               of `errorStatuses` (or a backend wrapper that forwards to it:
//               `errorResponsesKwarg`, `errorResponses`) — a backend
//               deciding a workflow route's declared not-found rung itself;
//               or a `defaultErrorStatus(…)` call / an `errorStatusOverrides[…]`
//               lookup — a backend mapping an error variant to its wire status
//               itself.  Both mappings live in the IR's wire policy.
//               → use `errorStatuses("workflow", …)` / `errorVariantResponse`.
//   saves       an object literal carrying `name`, `aggName` and `repoName` in a
//               workflow / reactor / dispatch emitter — a backend building its
//               own save entry.  Which bindings save, at the exit or at the end
//               of a loop iteration or branch, is lowered onto the IR.
//               → read `wf.savesAtExit` / a statement's `saves` (`nestedSaves`).
//   outbox-capture  a `&&` chain that calls `workflowRunsInTransaction` and
//               asks about durable events (`hasDurableEvents`,
//               `durableEventTypes`, `workflowEmits`) — the hand-spelled "does
//               this workflow write its outbox rows inside its transaction"
//               test.
//               → use `workflowCapturesDurableEmits`.
//   folded-events  a `.map(…)` over an `appliers` list whose callback returns
//               the applier's `.event` — the hand-rolled "which events does
//               this stream fold" list.
//               → use `foldedEventNames`.
//   event-log   a template literal with a `${snake(…)}_events` span — the
//               hand-spelled per-context event-log table name.
//               → use `eventLogTable`.
//   repos       a callback handed to a `walkWorkflowStmt…` walker that tests a
//               `kind` against `"repo-let"` / `"repo-run"` / `"repo-delete"` and
//               collects a statement's `.repoName` / `.aggName` — the
//               hand-rolled "which repositories does this body need" scan.
//               → use `reposNeeded`.
//   refs-read   a callback handed to a `walkWorkflowStmt…` walker that tests
//               `kind === "ref"` and collects the ref's `.name` into a set —
//               the hand-rolled "which names / params / lets does this body
//               read" scan.  A diagnostic scan that also pushes a finding is
//               not a name set and is not flagged.
//               → use `refsRead` / `namesUsed`.
//   read-ports  a function or callback that both looks a service operation up
//               (`.operations.find(…)`) and asks `readPortsForOperation` — the
//               hand-rolled "which repositories does this service call need"
//               resolver.
//               → use `serviceOpReadPorts` / `serviceReadPorts` /
//               `servicesCalled` / `domainServiceReadPorts`.
//   state-required  a `||` of a `.name === corr` test and a `.optional` read
//               — the hand-spelled "which state fields need a zero" skip.
//               → use `requiredStateFields`.
//   state-zero  a state-zero function (`…StateDefault`, `…Zero…`,
//               `initialValueFor`, `defaultLiteralFor`) whose body switches on a
//               primitive's `.name` over `int`, `bool`, `datetime` and `date` — a per-backend copy of the zero
//               classification instead of a spelling table over `stateZero`.
//               → switch on `stateZero(t, ctx).kind`.
//   guarded     a `wf.statements.some(…)` whose callback is just
//               `s.kind === "requires"` — the hand-spelled, top-level-only
//               "can this workflow route answer 403" test.
//               → use `workflowIsGuarded`.
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
    | "tx-boundary"
    | "wire-status"
    | "saves"
    | "outbox-capture"
    | "folded-events"
    | "event-log"
    | "repos"
    | "refs-read"
    | "read-ports"
    | "state-required"
    | "state-zero"
    | "guarded"
    | "sub-handler"
    | "es-shared";
  where: string;
  text: string;
}

/** The callees that own a route's declared error-status set. */
const STATUS_TABLES = new Set(["errorStatuses", "errorResponsesKwarg", "errorResponses"]);

/** Is `n` (transitively) an argument of a call to one of `STATUS_TABLES`? */
function insideStatusTable(n: ts.Node): boolean {
  for (let p = n.parent; p && !ts.isSourceFile(p); p = p.parent) {
    if (
      ts.isCallExpression(p) &&
      ts.isIdentifier(p.expression) &&
      STATUS_TABLES.has(p.expression.text) &&
      p.arguments.some((a) => a.pos <= n.pos && n.end <= a.end)
    ) {
      return true;
    }
    if (ts.isFunctionLike(p)) return false;
  }
  return false;
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
function callbackFacts(body: ts.Node, localFns: ReadonlyMap<string, ts.Node>) {
  const f = {
    opCall: false,
    audited: false,
    userAsk: false,
    resourceKind: false,
    workflowOnlyKind: false,
    emitKind: false,
    addsTarget: false,
    refKind: false,
    addsName: false,
    repoKind: false,
    collectsRepo: false,
    reports: false,
  };
  const seenFns = new Set<ts.Node>();
  const collect = (m: ts.Node): void => {
    // A switch arm is the same comparison as `x.kind === "…"`.
    if (ts.isCaseClause(m) && ts.isStringLiteral(m.expression)) {
      const lit = m.expression.text;
      if (lit === "repo-let" || lit === "repo-run" || lit === "repo-delete") f.repoKind = true;
    }
    // A call to a same-file helper is part of the callback (one helper deep is
    // enough for `(st) => collectRepoRefs(st, seen)`).
    if (ts.isCallExpression(m) && ts.isIdentifier(m.expression)) {
      const helper = localFns.get(m.expression.text);
      if (helper && !seenFns.has(helper)) {
        seenFns.add(helper);
        collect(helper);
      }
      // `add(st)` — a local collector handed the whole statement.
      if (m.expression.text === "add" && m.arguments.length === 1) f.collectsRepo = true;
    }
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
      if (field === "kind" && lit === "ref") f.refKind = true;
      if (field === "kind" && (lit === "repo-let" || lit === "repo-run" || lit === "repo-delete")) {
        f.repoKind = true;
      }
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
    if (
      ts.isCallExpression(m) &&
      ts.isPropertyAccessExpression(m.expression) &&
      m.expression.name.text === "add" &&
      m.arguments.length === 1 &&
      propName(m.arguments[0]!) === "name"
    ) {
      f.addsName = true;
    }
    if (
      ts.isCallExpression(m) &&
      m.arguments.some((a) => {
        const name = propName(a);
        return name === "repoName" || name === "aggName";
      }) &&
      ts.isPropertyAccessExpression(m.expression) &&
      (m.expression.name.text === "set" || m.expression.name.text === "add")
    ) {
      f.collectsRepo = true;
    }
    // A diagnostic scan (it pushes a finding per name) is not a name set.
    if (
      ts.isCallExpression(m) &&
      ts.isPropertyAccessExpression(m.expression) &&
      m.expression.name.text === "push"
    ) {
      f.reports = true;
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
          const f = callbackFacts(body, localFns);
          const hit = (rule: Violation["rule"]) =>
            out.push({ rule, where: at(n), text: callee.getText(sf) });
          if (f.opCall && f.audited) hit("audited-call");
          if (f.opCall && f.userAsk) hit("needs-user");
          if (f.resourceKind && (isWorkflowWalker || f.workflowOnlyKind)) hit("resource-calls");
          if (f.emitKind && isWorkflowWalker) hit("emits");
          if (f.opCall && f.addsTarget) hit("deref-loads");
          if (f.refKind && f.addsName && !f.reports && isWorkflowWalker) hit("refs-read");
          if (f.repoKind && f.collectsRepo && isWorkflowWalker) hit("repos");
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
      (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
      n.body
    ) {
      // Only the innermost function that does both: an enclosing function is
      // not flagged again for its nested resolver.
      let lookup = false;
      let ports = false;
      const look = (m: ts.Node): void => {
        if (m !== n && (ts.isFunctionLike(m) || ts.isArrowFunction(m))) return;
        if (
          ts.isCallExpression(m) &&
          ts.isPropertyAccessExpression(m.expression) &&
          m.expression.name.text === "find" &&
          /\boperations\??$/.test(m.expression.expression.getText(sf))
        ) {
          lookup = true;
        }
        if (
          ts.isCallExpression(m) &&
          ts.isIdentifier(m.expression) &&
          m.expression.text === "readPortsForOperation"
        ) {
          ports = true;
        }
        ts.forEachChild(m, look);
      };
      ts.forEachChild(n.body, look);
      if (lookup && ports)
        out.push({ rule: "read-ports", where: at(n), text: "service-op port lookup" });
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
      [n.left, n.right].some(
        (e) =>
          ts.isBinaryExpression(e) &&
          e.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
          propName(e.left) === "name" &&
          /^(corr|wf\.correlationField)$/.test(e.right.getText(sf)),
      ) &&
      [n.left, n.right].some((e) => propName(peel(e).inner) === "optional")
    ) {
      out.push({ rule: "state-required", where: at(n), text: n.getText(sf) });
    }
    if (
      (ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) &&
      n.name &&
      ts.isIdentifier(n.name) &&
      /(statedefault|zero|initialvaluefor|defaultliteralfor)/i.test(n.name.text)
    ) {
      // Only a switch on a primitive's `.name` — a spelling table switches on
      // `stateZero(…).kind` instead.
      const labels = new Set<string>();
      const look = (m: ts.Node): void => {
        if (ts.isSwitchStatement(m) && propName(m.expression) === "name") {
          for (const c of m.caseBlock.clauses) {
            if (ts.isCaseClause(c) && ts.isStringLiteral(c.expression))
              labels.add(c.expression.text);
          }
        }
        ts.forEachChild(m, look);
      };
      look(n);
      if (["int", "bool", "datetime", "date"].every((l) => labels.has(l))) {
        out.push({ rule: "state-zero", where: at(n), text: n.name.text });
      }
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
      ts.isPropertyAccessExpression(n) &&
      n.name.text === "transactional" &&
      !(ts.isCallExpression(n.parent) && n.parent.expression === n) &&
      (rel.startsWith("src/generator/") || rel.startsWith("src/platform/"))
    ) {
      out.push({ rule: "tx-boundary", where: at(n), text: n.getText(sf) });
    }
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      ((n.expression.text === "workflowCanAnswerNotFound" && !insideStatusTable(n)) ||
        n.expression.text === "defaultErrorStatus")
    ) {
      out.push({ rule: "wire-status", where: at(n), text: n.getText(sf) });
    }
    if (
      ts.isObjectLiteralExpression(n) &&
      (rel.startsWith("src/generator/") || rel.startsWith("src/platform/")) &&
      /(workflow|dispatch|reactor)[^/]*\.ts$/.test(rel) &&
      ["name", "aggName", "repoName"].every((k) =>
        n.properties.some((pr) => pr.name && ts.isIdentifier(pr.name) && pr.name.text === k),
      )
    ) {
      out.push({ rule: "saves", where: at(n), text: n.getText(sf) });
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      !(
        ts.isBinaryExpression(n.parent) &&
        n.parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      )
    ) {
      const called = new Set<string>();
      const look = (m: ts.Node): void => {
        if (ts.isCallExpression(m) && ts.isIdentifier(m.expression)) called.add(m.expression.text);
        ts.forEachChild(m, look);
      };
      look(n);
      if (
        called.has("workflowRunsInTransaction") &&
        ["hasDurableEvents", "durableEventTypes", "workflowEmits"].some((f) => called.has(f))
      ) {
        out.push({ rule: "outbox-capture", where: at(n), text: n.getText(sf) });
      }
    }
    if (
      ts.isElementAccessExpression(n) &&
      /\berrorStatusOverrides$/.test(n.expression.getText(sf))
    ) {
      out.push({ rule: "wire-status", where: at(n), text: n.getText(sf) });
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
      const cb = n.arguments[0]!;
      const cbBody = ts.isExpression(cb.body) ? peel(cb.body).inner : undefined;
      if (
        method === "some" &&
        /^(wf|workflow)\.statements$/.test(receiver) &&
        cbBody &&
        ts.isBinaryExpression(cbBody) &&
        cbBody.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        propName(cbBody.left) === "kind" &&
        ts.isStringLiteral(cbBody.right) &&
        cbBody.right.text === "requires"
      ) {
        out.push({ rule: "guarded", where: at(n), text: n.getText(sf) });
      }
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

  it("no backend chooses its own workflow transaction boundary (use workflowRunsInTransaction / workflowIsolation)", () => {
    const hits = violations.filter((v) => v.rule === "tx-boundary");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no workflow emitter builds its own save entry (read savesAtExit / a statement's saves)", () => {
    const hits = violations.filter((v) => v.rule === "saves");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-spells the durable outbox-capture test (use workflowCapturesDurableEmits)", () => {
    const hits = violations.filter((v) => v.rule === "outbox-capture");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend maps a workflow error to its wire status itself (use errorStatuses / errorVariantResponse)", () => {
    const hits = violations.filter((v) => v.rule === "wire-status");
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

  it("no backend re-scans a body for the repositories it needs (use reposNeeded)", () => {
    const hits = violations.filter((v) => v.rule === "repos");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-scans a body for the names it reads (use refsRead / namesUsed)", () => {
    const hits = violations.filter((v) => v.rule === "refs-read");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-resolves a service call's read ports (use serviceOpReadPorts / serviceReadPorts / servicesCalled)", () => {
    const hits = violations.filter((v) => v.rule === "read-ports");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-spells which state fields need a zero (use requiredStateFields)", () => {
    const hits = violations.filter((v) => v.rule === "state-required");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-classifies a state field's zero (switch on stateZero)", () => {
    const hits = violations.filter((v) => v.rule === "state-zero");
    expect(hits.map((v) => `${v.where}  ${v.text}`)).toEqual([]);
  });

  it("no backend re-spells the workflow guarded test (use workflowIsGuarded)", () => {
    const hits = violations.filter((v) => v.rule === "guarded");
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
