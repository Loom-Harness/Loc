// -------------------------------------------------------------------------
// Test-body checks — `test`/`test e2e` statement legality and the
// `api.<x>.<verb>` / `ui.<x>.<verb>` magic-call resolution.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { lowerFirst, plural, snake } from "../../../util/naming.js";
import type {
  AggregateIR,
  BoundedContextIR,
  DeployableIR,
  ExprIR,
  SubdomainIR,
  SystemIR,
  TestE2EIR,
  TestStmtIR,
  TypeIR,
} from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";
import { routeContractWillReport } from "./e2e-route-checks.js";
import { walkExpr } from "./shared.js";

// ---------------------------------------------------------------------------
// Aggregate-level `test "..." { ... }` body checks.
//
// Test blocks at the aggregate level have no `this` aggregate
// instance bound — they're meant for value-object invariant tests
// and pure-function exercises.  Three statement kinds are
// accepted: `let`, `expect`, `expect-throws`, plus bare
// expressions.  Anything that mutates aggregate state
// (`assign` / `add` / `remove` / `emit`) or that depends on the
// aggregate's runtime invariants (`precondition`) is structurally
// nonsensical here, and earlier versions of the generator
// silently rendered them as `// TODO: ...` comments — leaking the
// fallback into user-facing generated code.  Now caught at parse
// time with a structured diagnostic.
//
// `call` is allowed when the callee is a pure `function` (the
// usual helper-call case); rejected when it's a `private-operation`
// or unresolved `free` call (those need an aggregate instance).
// ---------------------------------------------------------------------------

export function validateAggregateTestBodies(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  for (const agg of ctx.aggregates) {
    for (const test of agg.tests) {
      checkMatcherSubjects(test.statements, `${ctx.name}/${agg.name}.test:${test.name}`, diags);
      for (const stmt of test.statements) {
        checkThrowKindReadable(stmt, agg, ctx, test.name, diags);
        const reason = invalidTestStmt(stmt);
        if (!reason) continue;
        diags.push({
          severity: "error",
          code: "loom.aggregate-test-context",
          message: diagMessage("loom.aggregate-test-context", {
            name: agg.name,
            testName: test.name,
            reason,
          }),
          source: `${ctx.name}/${agg.name}.test:${test.name}`,
        });
      }
    }
  }
}

/** `toThrow(<kind>)` against a rule that carries an authored `message "..."`.
 *
 *  Four of the five backends discriminate the rung by the MESSAGE PREFIX the
 *  domain layer emits — `"Precondition failed: "` / `"Invariant violated: "` —
 *  and an authored `message` REPLACES that whole string rather than extending
 *  it (`render-stmt.ts`'s `message ?? \`Precondition failed: …\`` on every one
 *  of them).  So the very clause that makes a rule's failure legible to a
 *  human is the clause that makes it illegible to this matcher.
 *
 *  Only elixir escapes it, because `GuardError` is `defexception [:message,
 *  :kind]` and the rung rides the struct instead of the text.  Giving the other
 *  four the same structural `kind` is the RIGHT long-term answer and is filed
 *  as its own mission — an error-shape change across five backends should not
 *  ride along on a matcher's first outing (design M-T5.36 § 2a, decision 7).
 *
 *  So: refuse, narrowly and at the source.  A unit `test` is emitted for ALL
 *  five backends from one `.ddd`, so a shape four of them cannot express is not
 *  writable portably — accepting it would mean the same assertion silently
 *  proving less on four legs than on one, which is the defect this whole packet
 *  exists to remove. */
function checkThrowKindReadable(
  stmt: TestStmtIR,
  agg: AggregateIR,
  ctx: BoundedContextIR,
  testName: string,
  diags: LoomDiagnostic[],
): void {
  if (stmt.kind !== "expect-throws" || !stmt.throwKind) return;
  const offender = messagedRuleFor(stmt, agg, ctx);
  if (!offender) return;
  diags.push({
    severity: "error",
    code: "loom.throw-kind-custom-message",
    message: diagMessage("loom.throw-kind-custom-message", {
      kind: stmt.throwKind,
      rule: offender.source,
      message: offender.message,
      subject: offender.subject,
    }),
    source: `${ctx.name}/${agg.name}.test:${testName}`,
  });
}

/** The messaged rule a `toThrow(<kind>)` would have to read through, or
 *  undefined when every candidate rule still carries its derived prefix.
 *
 *  Resolution is by NAME, the same way the five test emitters resolve a test
 *  body's calls (receiver types are unreliable in test position — see
 *  `isAggOp` in the elixir emitter):
 *
 *    * `<local>.<op>()`       → that operation's `precondition` statements;
 *    * `<Agg>.create({...})`  → the canonical create's guards, plus — because a
 *                               create runs the invariant floor too — the
 *                               aggregate's invariants;
 *    * `<VO> { ... }`         → the value object's invariants.
 *
 *  A rung with NO candidate rule at all is left alone here: that is a different
 *  complaint (an assertion with no subject) and belongs to whichever gate grows
 *  to make it, not to this one. */
function messagedRuleFor(
  stmt: Extract<TestStmtIR, { kind: "expect-throws" }>,
  agg: AggregateIR,
  ctx: BoundedContextIR,
): { source: string; message: string; subject: string } | undefined {
  const kind = stmt.throwKind;
  const e = stmt.expr;
  if (kind === "invariant") {
    // A value-object construction (`Money { amount: -1 }` / `Money(-1, "USD")`)
    // trips the VO's own invariants, not the aggregate's.
    const voName = valueObjectCtorName(e);
    const vo = voName ? ctx.valueObjects.find((v) => v.name === voName) : undefined;
    const invariants = vo ? vo.invariants : agg.invariants;
    const subject = vo ? vo.name : agg.name;
    const messaged = invariants.find((i) => i.message);
    return messaged
      ? { source: messaged.source, message: messaged.message!.text, subject }
      : undefined;
  }
  // `precondition`: the guards of the operation (or create) under call.
  const ops = [
    ...agg.operations,
    ...(agg.creates ?? []),
    ...(agg.destroys ?? []),
    ...(agg.canonicalCreate ? [agg.canonicalCreate] : []),
  ];
  if (e.kind !== "method-call") return undefined;
  const op = ops.find((o) => o.name === e.member);
  if (!op) return undefined;
  for (const st of op.statements) {
    if (st.kind === "precondition" && st.message) {
      return { source: st.source, message: st.message.text, subject: `${agg.name}.${op.name}` };
    }
  }
  return undefined;
}

/** `Money { amount: -1 }` / `Money(-1, "USD")` — the value-object construction
 *  a `toThrow(invariant)` can sit over.  BOTH source forms (builder and
 *  positional) lower to the same `callKind: "value-object-ctor"` call, so one
 *  branch covers them; returns undefined when the asserted expression is not a
 *  VO construction, and the aggregate's own invariants are then the subject. */
function valueObjectCtorName(e: ExprIR): string | undefined {
  return e.kind === "call" && e.callKind === "value-object-ctor" ? e.name : undefined;
}

// ---------------------------------------------------------------------------
// Context-scoped INTEGRATION test bodies (test-placement.md).
//
// The node integration renderer awaits a repository read at STATEMENT level
// (`const x = await repos.<agg>.<find>(...)`), so a find must be let-bound before
// its result is asserted.  A find written INLINE inside `expect(...)` has no
// statement to await it — reject it with a fix hint (the async-in-expression
// edition is a deferred follow-up).
// ---------------------------------------------------------------------------

export function validateContextIntegrationTests(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
): void {
  const BUILTIN_READS = new Set(["findById", "getById", "findAll"]);
  const isRepoFind = (e: ExprIR): boolean => {
    if (e.kind !== "method-call" || e.receiver.kind !== "ref") return false;
    const aggName = (e.receiver as { name: string }).name;
    const repos = ctx.repositories.filter((r) => r.aggregateName === aggName);
    if (repos.length === 0) return false;
    return (
      BUILTIN_READS.has(e.member) || repos.some((r) => r.finds.some((f) => f.name === e.member))
    );
  };
  for (const test of ctx.tests) {
    checkMatcherSubjects(test.statements, `${ctx.name}.test:${test.name}`, diags);
    for (const stmt of test.statements) {
      if (stmt.kind !== "expect" && stmt.kind !== "expect-throws") continue;
      // `toThrow(<kind>)` is UNIT-TIER ONLY, and the context-integration rung is
      // not the unit tier: it renders through each backend's
      // `integration-tests.ts`, which carries no rung and would emit a bare
      // `.rejects.toThrow()` — the author's `precondition` word silently gone.
      // Measured, not assumed: that is exactly what the node leg emitted before
      // this gate existed.  A dropped refinement is the defect this matcher was
      // built to remove, so refuse it here rather than quietly weakening the
      // claim in the one tier the emitters don't reach.
      if (stmt.kind === "expect-throws" && stmt.throwKind) {
        diags.push({
          severity: "error",
          code: "loom.throw-kind-integration-unsupported",
          message: diagMessage("loom.throw-kind-integration-unsupported", {
            kind: stmt.throwKind,
            name: ctx.name,
            testName: test.name,
          }),
          source: `${ctx.name}.test:${test.name}`,
        });
      }
      let inlineFind = false;
      walkExpr(stmt.expr, (e) => {
        if (isRepoFind(e)) inlineFind = true;
      });
      if (inlineFind) {
        diags.push({
          severity: "error",
          code: "loom.integration-find-must-bind",
          message: diagMessage("loom.integration-find-must-bind", {
            name: ctx.name,
            testName: test.name,
          }),
          source: `${ctx.name}.test:${test.name}`,
        });
      }
    }
  }
}

function invalidTestStmt(s: TestStmtIR): string | null {
  switch (s.kind) {
    case "assign":
      return `'${s.target.segments.join(".")} := ...' mutates state.`;
    case "add":
      return `'${s.target.segments.join(".")} += ...' mutates a contained collection.`;
    case "remove":
      return `'${s.target.segments.join(".")} -= ...' mutates a contained collection.`;
    case "emit":
      return `'emit ${s.eventName}' fires a domain event from an aggregate's mutator.`;
    case "precondition":
      return `'precondition' guards an operation; aggregate-level tests don't run in an op body.`;
    case "requires":
      return `'requires' is an authorization gate for per-request handlers; aggregate-level tests don't sit in a per-request scope.`;
    case "call":
      if (s.target === "private-operation") {
        return `call to private operation '${s.name}'.`;
      }
      return null; // pure function call is fine
    default:
      return null;
  }
}

export function validateE2ETest(
  test: TestE2EIR,
  sys: SystemIR,
  modulesByName: Map<string, SubdomainIR>,
  diags: LoomDiagnostic[],
): void {
  const target = sys.deployables.find((d) => d.name === test.deployableName);
  if (!target) {
    // Validator (Layer ②) already catches this via the cross-ref;
    // skip downstream walks rather than crash.
    return;
  }
  const contexts = collectContexts(target, modulesByName);
  const source = `${sys.name}/${test.name}`;
  const magicId = test.kind === "ui" ? "ui" : "api";

  // Every name an e2e body may legitimately spell: the magic receivers and its
  // own `let` bindings.  Collected up front (not as the walk progresses) so a
  // forward reference reports as its own problem rather than as an unknown
  // name.
  //
  // BOTH magic ids are bound, not just this test's `magicId`.  A test's kind is
  // derived from the TARGET DEPLOYABLE's platform, not from what the body
  // spells — so an api-shaped body (`api.orders.create(…)`) aimed at a
  // UI-mounting deployable classifies as `ui` while still, correctly, spelling
  // `api`.  Binding only `magicId` rejected every such test: the whole
  // behavioral Phoenix leg failed to generate.
  const bound = new Set<string>(["api", "ui"]);
  for (const stmt of test.statements) if (stmt.kind === "let") bound.add(stmt.name);

  for (const stmt of test.statements) {
    walkStmt(stmt, (e) => checkUnresolvedRef(e, bound, test.name, source, diags));
  }

  checkMatcherSubjects(test.statements, source, diags);

  for (const stmt of test.statements) {
    const badKind = unsupportedE2EStmtKind(stmt);
    if (badKind) {
      // Mirror validateAggregateTestBodies: an e2e body only drives the
      // deployable through `api`/`ui` calls and asserts via expect.  A
      // domain-mutation / guard statement can't be lowered, and silently
      // emitting it would ship a green-but-empty test — so reject it here
      // with a source location instead of leaking a generator fallback.
      diags.push({
        severity: "error",
        code: "loom.e2e-unsupported-statement",
        message: diagMessage("loom.e2e-unsupported-statement", {
          name: test.name,
          badKind,
          magicId,
        }),
        source,
      });
      continue;
    }
    walkStmt(stmt, (e) => checkMagicCall(e, magicId, contexts, source, diags));
  }
}

/**
 * A bare name in an e2e body that binds to nothing.
 *
 * `lower-expr.ts` deliberately does NOT resolve enum values (or any
 * context-scoped name) inside an e2e test — there is no single enclosing
 * context to resolve against, since one body may drive several — so bare names
 * lower to `refKind: "unknown"` and the e2e renderer emits them VERBATIM.
 * That is exactly right for a `let` local, and silently wrong for everything
 * else: `api.orders.update(o, { status: Placed })` lowered to an unknown ref
 * and emitted `status: Placed`, an undefined identifier.  Valid `.ddd` in,
 * uncompilable TypeScript out, with no diagnostic anywhere in between — the
 * silent-codegen class this repo keeps finding by compiling its own output.
 *
 * An e2e test speaks WIRE, not domain: it POSTs JSON and reads JSON back.  So
 * the fix for the enum case is to write the serialized string (`"Placed"`),
 * which is what the backend actually sends and receives, and the message says
 * so.
 */
function checkUnresolvedRef(
  e: ExprIR,
  bound: ReadonlySet<string>,
  testName: string,
  source: string,
  diags: LoomDiagnostic[],
): void {
  // The CALL twin of the same hole.  A name applied to arguments lowers to a
  // `callKind: "free"` Call (never a `ref`), which the renderer also emits
  // VERBATIM — so `expect(number(t.revenue)).toBe(40)` shipped `number(...)`,
  // a ReferenceError in the generated suite, past a bare-name gate that only
  // looked at `ref`.  Everything an e2e body may legitimately call lowers to
  // something else first (`money("…")`/`decimal(x)` → convert, `now()` →
  // literal), so a residual free call is always an undefined identifier.
  if (e.kind === "call" && e.callKind === "free") {
    diags.push({
      severity: "error",
      code: "loom.e2e-unresolved-call",
      message: diagMessage("loom.e2e-unresolved-call", { testName, name: e.name }),
      source,
    });
    return;
  }
  if (e.kind !== "ref" || e.refKind !== "unknown" || bound.has(e.name)) return;
  diags.push({
    severity: "error",
    code: "loom.e2e-unresolved-ref",
    message: diagMessage("loom.e2e-unresolved-ref", { testName, name: e.name }),
    source,
  });
}

/** Statement kinds an e2e test body cannot lower (domain mutations and
 *  operation guards have no meaning when driving a deployable over HTTP /
 *  the browser).  Returns the offending kind, or null when supported. */
function unsupportedE2EStmtKind(s: TestStmtIR): string | null {
  switch (s.kind) {
    case "expect":
    case "expect-throws":
    case "let":
    case "expression":
    case "call":
      return null;
    default:
      return s.kind;
  }
}

function walkStmt(s: TestStmtIR, visit: (e: ExprIR) => void): void {
  if (
    s.kind === "expect" ||
    s.kind === "expect-throws" ||
    s.kind === "let" ||
    s.kind === "expression"
  ) {
    walkExpr(s.expr, visit);
  }
  if (s.kind === "call") {
    for (const a of s.args) walkExpr(a, visit);
  }
}

/** Strip `optional` wrappers — `string?` is still a string for containment,
 *  and `tags: string[]?` is still a collection. */
function unwrapOptional(t: TypeIR): TypeIR {
  return t.kind === "optional" ? unwrapOptional(t.inner) : t;
}

/** A short, author-facing spelling of a resolved type, for the refusal text. */
function typeLabel(t: TypeIR): string {
  switch (t.kind) {
    case "primitive":
      return t.name;
    case "array":
      return `${typeLabel(t.element)}[]`;
    case "optional":
      return `${typeLabel(t.inner)}?`;
    case "id":
      return `${t.targetName} id`;
    default:
      return t.kind === "enum" || t.kind === "valueobject" || t.kind === "entity" ? t.name : t.kind;
  }
}

/** The SUBJECT of a matcher call, with `.not.` peeled — and its resolved type.
 *
 *  `expr.receiverType` is the type of `expr.receiver`, which for a negated
 *  assertion is the synthetic `.not` member rather than the asserted value.
 *  Peel it the same way every emitter does, and take the type from the `.not`
 *  node's OWN receiverType so the subject's real type reaches the check. */
function matcherSubject(expr: ExprIR & { kind: "method-call" }): {
  subject: ExprIR;
  type: TypeIR;
} {
  let receiver = expr.receiver;
  let type = expr.receiverType;
  if (receiver.kind === "member" && receiver.member === "not") {
    type = receiver.receiverType;
    receiver = receiver.receiver;
  }
  const subject = receiver.kind === "paren" ? receiver.inner : receiver;
  return { subject, type };
}

/** `toContain` is ONE matcher with TWO lowerings, picked by the subject's
 *  type: membership for a collection, substring for a string.  There is no
 *  third lowering, so any other subject has to be refused — and the IR is the
 *  first phase where the resolved type is available to refuse it.
 *
 *  Left unchecked, each backend's emitter would pick its own answer for, say,
 *  an `int` subject: python would emit `assert 3 in 7` (a TypeError at run
 *  time), java a `.contains` that does not compile, vitest a matcher that
 *  fails with a confusing message.  One refusal here, at the author's span,
 *  replaces five different downstream failures. */
function checkContainReceiver(
  e: ExprIR,
  source: string,
  diags: LoomDiagnostic[],
  seen: Set<ExprIR>,
): void {
  if (e.kind !== "method-call" || !e.isIntrinsicMatcher || e.member !== "toContain") return;
  if (seen.has(e)) return;
  seen.add(e);
  const { subject, type } = matcherSubject(e);
  const t = unwrapOptional(type);
  if (t.kind === "array") return;
  if (t.kind === "primitive" && t.name === "string") return;
  diags.push({
    severity: "error",
    code: "loom.contain-receiver-invalid",
    message: diagMessage("loom.contain-receiver-invalid", {
      actual: exprLabel(subject),
      type: typeLabel(t),
    }),
    source,
  });
}

/** `toBeAbsent()` rewrites its assertion onto the RECEIVER — the generated
 *  `expect("estimate" in read).toBe(false)` needs an object and a key, which
 *  only a field read supplies.  Anything else would reach `renderExpectStmt`'s
 *  compiler-invariant throw and kill `generate system` with a stack trace, so
 *  name it here instead (the shape audit 2026-09-03 F6 found for locator
 *  matchers: validates clean, then crashes the compiler). */
function checkAbsentReceiver(
  e: ExprIR,
  source: string,
  diags: LoomDiagnostic[],
  seen: Set<ExprIR>,
): void {
  if (e.kind !== "method-call" || !e.isIntrinsicMatcher || e.member !== "toBeAbsent") return;
  if (seen.has(e)) return;
  seen.add(e);
  const { subject } = matcherSubject(e);
  if (subject.kind === "member") return;
  diags.push({
    severity: "error",
    code: "loom.absent-receiver-invalid",
    message: diagMessage("loom.absent-receiver-invalid", { actual: exprLabel(subject) }),
    source,
  });
}

/** Best-effort author-facing rendering of an expression, for a message. */
function exprLabel(e: ExprIR): string {
  if (e.kind === "member") return `${exprLabel(e.receiver)}.${e.member}`;
  if (e.kind === "ref") return e.name;
  if (e.kind === "paren") return exprLabel(e.inner);
  if (e.kind === "literal") return String(e.value);
  return `the asserted expression`;
}

/** Both matcher-subject checks, over every expression in one test body. */
export function checkMatcherSubjects(
  statements: readonly TestStmtIR[],
  source: string,
  diags: LoomDiagnostic[],
): void {
  const seen = new Set<ExprIR>();
  for (const stmt of statements) {
    walkStmt(stmt, (e) => {
      checkContainReceiver(e, source, diags, seen);
      checkAbsentReceiver(e, source, diags, seen);
    });
  }
}

function checkMagicCall(
  e: ExprIR,
  magicId: "api" | "ui",
  contexts: BoundedContextIR[],
  source: string,
  diags: LoomDiagnostic[],
): void {
  // Match `<magicId>.<aggregateSlug>.<method>(...)`.
  if (e.kind !== "method-call") return;
  // …and REFUSE the one-level `<magicId>.<name>(...)`, which has no shape at
  // all: every call this harness can address is two-level, resolved against
  // the aggregate / projection / workflow slug sets below.  Falling through
  // silently is what made it dangerous — `e2e-render.ts`'s `matchApiCall`
  // mirrors this same match and returns null, so the call was rendered as an
  // ordinary expression against a bare `api` identifier the emitted file never
  // binds (`api is not defined` at run time), and when the name happened to
  // collide with a collection intrinsic it MIS-COMPILED instead:
  // `api.sum({ a: 2, b: 3 })` became
  // `(api).reduce((__acc, __x) => __acc + __num((({ a: 2, b: 3 }))(__x)), 0)`.
  // Both shapes validated with 0 errors before this arm.
  //
  // Explicit `route … -> <Handler>` routes are the shape that reaches for this
  // form, and the harness genuinely cannot address them yet — that gap is
  // tracked separately; this makes it an honest refusal rather than a silent
  // miscompile.
  if (e.receiver.kind === "ref" && e.receiver.name === magicId) {
    diags.push({
      severity: "error",
      code: "loom.e2e-unaddressable-call",
      message: diagMessage("loom.e2e-unaddressable-call", { magicId, method: e.member }),
      source,
    });
    return;
  }
  if (e.receiver.kind !== "member") return;
  const r = e.receiver;
  if (r.receiver.kind !== "ref" || r.receiver.name !== magicId) return;
  const aggregateSlug = r.member;
  const method = e.member;
  // The reserved `workflows` slug routes to system-level orchestration:
  // `<magicId>.workflows.<name>(...)` resolves to a workflow.
  // The React UI generator wires `ui` invocations; the reserved slug
  // validates against `api` for symmetry so backend-side dispatchers see a
  // consistent IR shape.
  if (aggregateSlug === "workflows") {
    const wf = contexts
      .flatMap((c) => c.workflows)
      .find((w) => lowerFirst(w.name) === method || snake(w.name) === method);
    if (!wf) {
      const known = contexts
        .flatMap((c) => c.workflows.map((w) => lowerFirst(w.name)))
        .sort()
        .join(", ");
      diags.push({
        severity: "error",
        code: "loom.e2e-unknown-workflow",
        message: diagMessage("loom.e2e-unknown-workflow", {
          magicId,
          method,
          known: known || "(none)",
        }),
        source,
      });
    }
    return;
  }
  // A folded projection's read surface (projection.md): `api.<proj>.byKey(k)` /
  // `.list()` read `GET /projections/<snake>`.  Resolved before the aggregate
  // lookup — the read verbs (`byKey`/`list`) are projection-only.  Only `api`
  // tests reach a projection (the UI has no projection-read page object).
  if (magicId === "api") {
    const proj = contexts
      .flatMap((c) => c.projections)
      .find((p) => lowerFirst(p.name) === aggregateSlug || snake(p.name) === aggregateSlug);
    if (proj) {
      if (method === "byKey" || method === "list") return;
      diags.push({
        severity: "error",
        code: "loom.e2e-unknown-method",
        message: diagMessage("loom.e2e-unknown-method#projection", {
          magicId,
          aggregateSlug,
          method,
        }),
        source,
      });
      return;
    }
  }
  const agg = findAggregateBySlug(aggregateSlug, contexts);
  if (!agg) {
    const known = contexts
      .flatMap((c) => c.aggregates.map((a) => snake(plural(a.name))))
      .sort()
      .join(", ");
    diags.push({
      severity: "error",
      code: "loom.e2e-unknown-aggregate",
      message: diagMessage("loom.e2e-unknown-aggregate", {
        magicId,
        aggregateSlug,
        known: known || "(none)",
      }),
      source,
    });
    return;
  }
  if (method === "create" || method === "getById") return;
  // The CANONICAL destroy (`DELETE /api/<aggs>/{id}`).  It lives on
  // `agg.canonicalDestroy`, NOT in `agg.operations` (lowering keeps the
  // lifecycle actions in their own arrays), so without this arm the verb the
  // route derivation exposes was rejected as an unknown method — the route
  // existed on all five backends and no `test e2e` body could reach it.
  // Gated on `canonicalDestroy` exactly as `deriveAggregateOperations` gates
  // the DELETE route: a NAMED destroy (`destroy archive { }`) has no route, so
  // it must keep falling through to the unknown-method error below.
  if (method === "destroy" && agg.canonicalDestroy) return;
  const isPublicOp = agg.operations.some((o) => o.visibility === "public" && o.name === method);
  if (isPublicOp) return;
  // Find queries — search every context's repositories for one
  // serving this aggregate.
  const repo = contexts.flatMap((c) => c.repositories).find((r) => r.aggregateName === agg.name);
  const isFind = (repo?.finds ?? []).some((f) => f.name === method);
  if (isFind) return;
  // Entity history (docs/audit.md): `api.<agg>.history(id)` → `GET
  // /<agg>/{id}/history`.  Checked against `historyFind` rather than `finds` —
  // the derived history read sits beside them (see `RepositoryIR.historyFind`),
  // so an aggregate that is not `audited` has no history to call and the
  // unknown-method error below is the right answer.
  if (method === "history" && repo?.historyFind) return;

  // ONE MISTAKE, ONE DIAGNOSTIC.  This arm and `e2e-route-checks.ts` ask two
  // different questions of the same call — does the verb NAME resolve, and does
  // it resolve to a ROUTE — and for a verb that is neither, both answered:
  // `api.widgets.noSuchOperation(w)` raised `loom.e2e-unknown-method` AND
  // `loom.e2e-unrouted-verb`, one typo described twice with two near-identical
  // "available" lists to read.
  //
  // The ROUTING answer is the one that survives, because it is the one that
  // names the fix — for `destroy` on an aggregate with no canonical destroy it
  // says *add `with crudish`, or an unnamed `destroy { }`; a NAMED destroy is a
  // domain command and gets no DELETE route*, where this arm can only list what
  // else exists.  So this arm defers whenever that check will speak, and speaks
  // itself for everything it does not reach (a projection verb, a workflow, a
  // slug it has no ground truth for).
  //
  // The predicate is a call INTO that check's own decision, never a second copy
  // of the routing rule: a copy would drift and leave a call with two
  // diagnostics again — or, worse, with none.
  if (routeContractWillReport(magicId, { slug: aggregateSlug, verb: method }, contexts)) return;

  const ops = agg.operations.filter((o) => o.visibility === "public").map((o) => o.name);
  const finds = (repo?.finds ?? []).map((f) => f.name);
  const knownVerbs = [
    "create",
    "getById",
    ...(agg.canonicalDestroy ? ["destroy"] : []),
    ...(repo?.historyFind ? ["history"] : []),
    ...ops,
    ...finds,
  ];
  diags.push({
    severity: "error",
    code: "loom.e2e-unknown-method",
    message: diagMessage("loom.e2e-unknown-method#aggregate-verb", {
      magicId,
      aggregateSlug,
      method,
      knownVerbs: knownVerbs.join(", "),
    }),
    source,
  });
}

function collectContexts(
  d: DeployableIR,
  modulesByName: Map<string, SubdomainIR>,
): BoundedContextIR[] {
  // D-STORAGE-SPLIT: d.contextNames lists bounded-context names
  // directly.  Walk every subdomain looking for matches by name.
  const want = new Set(d.contextNames);
  const out: BoundedContextIR[] = [];
  for (const m of modulesByName.values()) {
    for (const c of m.contexts) if (want.has(c.name)) out.push(c);
  }
  return out;
}

function findAggregateBySlug(slug: string, contexts: BoundedContextIR[]): AggregateIR | undefined {
  for (const c of contexts) {
    for (const a of c.aggregates) {
      if (lowerFirst(a.name) === slug) return a;
      if (snake(plural(a.name)) === slug) return a;
      if (lowerFirst(plural(a.name)) === slug) return a;
    }
  }
  return undefined;
}
