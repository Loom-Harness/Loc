// Unit-test lowering — `test "…" { … }` AST → `TestIR` (test-placement.md).
//
// A `test` block is subject-agnostic: it lowers its statements against whatever
// per-subject `Env` the caller supplies (an aggregate's / value object's /
// domain service's scope).  This leaf owns:
//   - the hoisted-test index (`test … for <Subject>` written at context/root),
//     grouped by resolved subject node;
//   - `collectSubjectTests`, which unions a subject's nested + hoisted tests;
//   - `lowerTest` / `expectStmtIR`, the per-block / per-assertion lowerers
//     (the latter also consumed by the e2e-test lowerer in `lower.ts`).
//
// Leaf module: it never imports `lower.ts` (the graph is acyclic — the
// orchestrator imports this and calls `indexHoistedTests` once per project).
import { AstUtils } from "langium";
import {
  type Aggregate,
  type BoundedContext,
  type DomainService,
  isAggregate,
  isDomainService,
  isExpectStmt,
  isLetStmt,
  isListLit,
  isMemberSuffix,
  isPostfixChain,
  isStringLit,
  isTestBlock,
  isTestPrincipal,
  isValueObject,
  type LetStmt,
  type Model,
  type Statement,
  type TestBlock,
  type TestPrincipal,
  type ValueObject,
} from "../../language/generated/ast.js";
import { classifyRepoArg, queryNamesOf } from "../../language/repo-query-arg.js";
import { bypassReadMethodName } from "../../util/repository-contract.js";
import type {
  BypassReadIR,
  ExprIR,
  TestIR,
  TestPrincipalClaimIR,
  TestPrincipalIR,
  TestStmtIR,
} from "../types/loom-ir.js";
import type { OriginRef } from "../types/origin.js";
import { resolveBypass } from "./lower-capabilities.js";
import { lowerExpr } from "./lower-expr.js";
import { lowerStatement } from "./lower-stmt.js";
import { cstText, type Env } from "./lower-types.js";
import { originFor } from "./origin.js";

/** The declaration kinds a `test` may anchor to (aggregate, value object,
 *  domain service, bounded context). */
export type TestSubjectNode = Aggregate | ValueObject | DomainService | BoundedContext;

// Hoisted unit tests (`test "…" for <Subject> { … }` written at context or file
// root, outside the subject) grouped by their resolved home AST node.
// Populated once per project via `indexHoistedTests`, consumed by every
// subject's lowerer through `collectSubjectTests`.
let hoistedTestsBySubject: Map<TestSubjectNode, TestBlock[]> = new Map();

/** Scan every document for hoisted `TestBlock`s — those whose container is a
 *  `context` or the file root, i.e. NOT the subject declaration itself — and
 *  index them by the subject their `for` head resolves to.  A nested test
 *  (member of an aggregate / value object / domain service) keeps its
 *  containment path and is skipped here; an unresolved `for` target (a linker
 *  error) drops out via the `?.ref` guard. */
export function indexHoistedTests(models: ReadonlyArray<Model>): void {
  const index = new Map<TestSubjectNode, TestBlock[]>();
  for (const model of models) {
    for (const node of AstUtils.streamAllContents(model)) {
      if (!isTestBlock(node)) continue;
      const c = node.$container;
      if (isAggregate(c) || isValueObject(c) || isDomainService(c)) continue; // nested
      const home = node.target?.ref;
      if (!home) continue; // missing/unresolved `for` — validator/linker owns it
      const list = index.get(home);
      if (list) list.push(node);
      else index.set(home, [node]);
    }
  }
  hoistedTestsBySubject = index;
}

/** Collect a subject's unit tests — its NESTED `test` members plus any HOISTED
 *  `test … for <subject>` blocks routed to it — lowering every one under the
 *  same per-subject `env`.  Nested come first (source order), then hoisted (in
 *  document-scan order), so placement never changes the emitted suite. */
export function collectSubjectTests(
  nested: readonly TestBlock[],
  subject: TestSubjectNode,
  env: Env,
): TestIR[] {
  const tests: TestIR[] = [];
  for (const block of nested) tests.push(lowerTest(block, env));
  for (const block of hoistedTestsBySubject.get(subject) ?? []) tests.push(lowerTest(block, env));
  return tests;
}

export function lowerTest(block: TestBlock, env: Env): TestIR {
  let inner = env;
  const statements: TestStmtIR[] = [];
  for (const s of block.body) {
    if (isExpectStmt(s)) {
      statements.push(expectStmtIR(lowerExpr(s.expr, inner), cstText(s.expr), originFor(s)));
    } else if (isTestPrincipal(s)) {
      statements.push({ kind: "principal", principal: lowerTestPrincipal(s)! });
    } else {
      const r = lowerStatement(s as Statement, inner);
      statements.push(isLetStmt(s) ? widenByIdRead(r.stmt, s, inner) : r.stmt);
      inner = r.envAfter;
    }
  }
  const principal = lowerTestPrincipal(block.principal);
  return {
    name: block.name,
    statements,
    verifiesTestCase: block.verifies?.ref?.name,
    origin: originFor(block),
    ...(principal ? { principal } : {}),
  };
}

/** Lower an `as { … }` clause to its claim map.  A value that is not a string
 *  literal or a list of string literals is `loom.test-principal-value` at AST
 *  validation, so it is dropped here rather than guessed at. */
export function lowerTestPrincipal(node: TestPrincipal | undefined): TestPrincipalIR | undefined {
  if (!node) return undefined;
  const claims: TestPrincipalClaimIR[] = [];
  for (const c of node.claims) {
    const v = c.value;
    let value: string | string[] | undefined;
    if (isStringLit(v)) value = v.value;
    else if (isListLit(v) && v.elements.every(isStringLit)) {
      value = v.elements.map((e) => (isStringLit(e) ? e.value : ""));
    }
    if (value === undefined) continue;
    claims.push({ name: c.name, value, origin: originFor(c) });
  }
  return { claims, origin: originFor(node) };
}

/** A context integration test's `let o = Order.find(id) ignoring …`: the read
 *  calls its own widened method, so name it on the lowered call and carry the
 *  source + stance enrichment derives that method from.  Any other `let`
 *  passes through unchanged (placement refuses `ignoring` everywhere else in a
 *  test body). */
function widenByIdRead(stmt: TestStmtIR, s: LetStmt, env: Env): TestStmtIR {
  const chain = s.expr;
  if (stmt.kind !== "let" || stmt.expr.kind !== "method-call" || !isPostfixChain(chain)) {
    return stmt;
  }
  const stance = resolveBypass(chain);
  if (!stance.bypassAll && !stance.bypassCaps) return stmt;
  const call = stmt.expr;
  const arg = chain.suffixes.at(-1);
  const positional = arg && isMemberSuffix(arg) ? arg.args?.find((a) => !a.name)?.value : undefined;
  if (call.member !== "find" || classifyRepoArg(positional, queryNamesOf(env.ctx)) === "criterion")
    return stmt;
  const bypassRead: BypassReadIR = { source: { kind: "id" }, ...stance };
  return {
    ...stmt,
    expr: { ...call, member: bypassReadMethodName(bypassRead.source, bypassRead), bypassRead },
  };
}

/** Build the `TestStmtIR` for an `expect(...)` test statement.  The
 *  method-based throw assertion `expect(call).toThrow(…)` is recognised here
 *  and rewritten into the platform-neutral `expect-throws` IR node — so every
 *  backend renders it as a throw exactly as before — carrying whichever of the
 *  two mutually-exclusive refinements the author wrote:
 *
 *    * `status`    — `toThrow(404)`, an integer pinning the rejected HTTP
 *                    status in an e2e api body;
 *    * `throwKind` — `toThrow(precondition)` / `toThrow(invariant)`, the
 *                    failure RUNG, unit tier only.
 *
 *  They cannot both be present: the grammar makes the `ThrowKind` slot and the
 *  `CallArg` list alternatives on the same suffix, and each is refused in the
 *  other's tier (`checkExpectMatcher`).  Every other `expect(...)` carries a
 *  value/locator matcher (`toBe`, `toHaveText`, …); a bare-boolean `expect` is
 *  rejected by the validator (`checkExpectMatcher`). */
export function expectStmtIR(e: ExprIR, source: string, origin?: OriginRef): TestStmtIR {
  if (e.kind === "method-call" && e.isIntrinsicMatcher && e.member === "toThrow") {
    const inner = e.receiver.kind === "paren" ? e.receiver.inner : e.receiver;
    const arg = e.args[0];
    const status =
      arg && arg.kind === "literal" && arg.lit === "int" ? Number(arg.value) : undefined;
    if (e.throwKind) {
      const at = origin ? { origin } : {};
      return { kind: "expect-throws", expr: inner, source, throwKind: e.throwKind, ...at };
    }
    return status != null
      ? { kind: "expect-throws", expr: inner, source, status }
      : { kind: "expect-throws", expr: inner, source };
  }
  return { kind: "expect", expr: e, source };
}
