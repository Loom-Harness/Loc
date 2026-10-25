import { createInputFields, createOmissionValue } from "../../../ir/enrich/wire-projection.js";
import type {
  AggregateIR,
  BoundedContextIR,
  DomainServiceIR,
  ExprIR,
  FieldIR,
  TestIR,
  TestStmtIR,
  TypeIR,
  ValueObjectIR,
} from "../../../ir/types/loom-ir.js";
import { operationBodyUsesCurrentUser } from "../../../ir/util/op-gates.js";
import { lines } from "../../../util/code-builder.js";
import { intrinsicMatcherSig } from "../../../util/intrinsic-matchers.js";
import { escapeJavaIdent, upperFirst } from "../../../util/naming.js";
import { isServerSourcedDefault } from "../../_frontend/server-default.js";
import { javaRef } from "../../_imports/java.js";
import {
  coerceMatcherExpected,
  coerceTestLiteral,
  type TestLiteralTarget,
} from "../../_test/arg-coercion.js";
import { javaThrowKind } from "../../_test/throw-kind.js";
import { jid } from "../java-ident.js";
import { J } from "../java-symbols.js";
import { type JavaRenderContext, renderJavaExpr, withLambdaScope } from "../render-expr.js";
import { stubUserValue } from "./auth.js";

// ---------------------------------------------------------------------------
// `test "..." { ... }` DSL → JUnit 5 test class (the xUnit/vitest analog).
// Each block becomes a @Test method with @DisplayName carrying the source
// name.  Explicit matchers lower to JUnit assertions; a bare `toThrow()` to
// an assertion over the domain-rejection family (`javaBareToThrow`); a bare
// boolean to assertTrue.
// Pure domain tests — no Spring context, they run under plain `mvn test`.
// ---------------------------------------------------------------------------

export function renderJavaTestsFile(
  agg: AggregateIR,
  ctx: BoundedContextIR,
  basePkg: string,
  pkg: string,
  /** System user-block fields — when ops referencing currentUser are
   *  invoked from a test body, a stub test user is materialised with the
   *  dev-stub claim values and threaded as the trailing argument. */
  userFields?: readonly FieldIR[],
  /** Package holding another aggregate's root class, resolved through the SAME
   *  layout router this file's own package came from — so the sibling import
   *  below is correct under `byLayer` and `byFeature` alike. */
  siblingPkgFor?: (aggregateName: string) => string,
): string | null {
  return renderJavaSubjectTests(
    agg.name,
    agg.tests,
    ctx,
    basePkg,
    pkg,
    userFields,
    false,
    siblingPkgFor,
  );
}

/** Value-object unit-test class (test-placement.md).  The VO is
 *  reachable through the shared `${basePkg}.domain.valueobjects.*` wildcard. */
export function renderJavaVoTestsFile(
  vo: ValueObjectIR,
  ctx: BoundedContextIR,
  basePkg: string,
  pkg: string,
  userFields?: readonly FieldIR[],
): string | null {
  return renderJavaSubjectTests(vo.name, vo.tests, ctx, basePkg, pkg, userFields, false);
}

/** Domain-service unit-test class (test-placement.md).  Adds the
 *  `${basePkg}.domain.services.*` wildcard so `<Service>.<op>(…)` resolves. */
export function renderJavaServiceTestsFile(
  svc: DomainServiceIR,
  ctx: BoundedContextIR,
  basePkg: string,
  pkg: string,
  userFields?: readonly FieldIR[],
): string | null {
  return renderJavaSubjectTests(svc.name, svc.tests, ctx, basePkg, pkg, userFields, true);
}

function renderJavaSubjectTests(
  name: string,
  tests: readonly TestIR[],
  ctx: BoundedContextIR,
  basePkg: string,
  pkg: string,
  userFields: readonly FieldIR[] | undefined,
  includeServices: boolean,
  siblingPkgFor?: (aggregateName: string) => string,
): string | null {
  if (tests.length === 0) return null;
  const imports = new Set<string>();
  const state = { usesTestUser: false, userFields, ctx };
  const methods = tests.flatMap((t) => renderTest(t, ctx, state));
  // Every OTHER aggregate the bodies name.  A test body may legally reach for a
  // sibling aggregate — the validator admits it, and it is the only way to
  // exercise a value object holding a CROSS-aggregate reference
  // (`Berth { ship: Ship id }` needs a `Ship` to get an id from).  The
  // wildcards below cover the shared `domain.*` packages, but an aggregate ROOT
  // lives in its own per-aggregate package, so `Ship.create(...)` was
  // `cannot find symbol`.  Narrowed to names the rendered bodies actually
  // spell.  Freight audit D3 follow-up.
  if (siblingPkgFor) {
    const bodyText = methods.join("\n");
    for (const a of ctx.aggregates) {
      if (a.name === name) continue;
      if (!new RegExp(`\\b${a.name}\\b`).test(bodyText)) continue;
      const sp = siblingPkgFor(a.name);
      if (sp && sp !== pkg) imports.add(`${sp}.${a.name}`);
    }
  }
  while (methods[methods.length - 1] === "") methods.pop();
  return lines(
    `package ${pkg};`,
    ``,
    ...[...imports].sort().map((i) => `import ${i};`),
    imports.size > 0 ? `` : null,
    `import static org.junit.jupiter.api.Assertions.*;`,
    ``,
    `import org.junit.jupiter.api.DisplayName;`,
    `import org.junit.jupiter.api.Test;`,
    ``,
    `import ${basePkg}.domain.common.*;`,
    `import ${basePkg}.domain.enums.*;`,
    `import ${basePkg}.domain.events.*;`,
    `import ${basePkg}.domain.ids.*;`,
    `import ${basePkg}.domain.valueobjects.*;`,
    includeServices ? `import ${basePkg}.domain.services.*;` : null,
    ``,
    `public class ${name}Tests {`,
    ...(state.usesTestUser
      ? [
          `    private static final ${javaRef(`${basePkg}.auth`, "User")} __testUser = new ${javaRef(`${basePkg}.auth`, "User")}(${(
            userFields ?? []
          )
            .map((f) => stubUserValue(f.type))
            .join(", ")});`,
          ``,
        ]
      : []),
    ...methods,
    `}`,
    ``,
  );
}

interface TestEmitState {
  usesTestUser: boolean;
  userFields?: readonly FieldIR[];
  ctx: BoundedContextIR;
}

/** Append the stub test user to top-level op calls whose target
 *  operation references currentUser (the entity method takes a trailing
 *  User parameter). */
function withTestUser(expr: ExprIR, rendered: string, state: TestEmitState): string {
  if (expr.kind !== "method-call" || expr.receiverType.kind !== "entity") return rendered;
  const agg = state.ctx.aggregates.find(
    (a) => a.name === (expr.receiverType as { name: string }).name,
  );
  const op = agg?.operations.find((o) => o.name === expr.member);
  if (!op || !operationBodyUsesCurrentUser(op) || !state.userFields) return rendered;
  state.usesTestUser = true;
  return rendered.replace(/\)$/, expr.args.length > 0 ? ", __testUser)" : "__testUser)");
}

function renderTest(t: TestIR, ctx: BoundedContextIR, state: TestEmitState): string[] {
  const methodName =
    t.name
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^([0-9])/, "_$1") || "test";
  const rctx = testBodyRenderContext(t, (name) => escapeJavaIdent(name));
  const body = t.statements.flatMap((s, i) => renderTestStmt(s, ctx, state, i, rctx));
  return [
    `    @Test`,
    `    @DisplayName(${JSON.stringify(t.name)})`,
    `    public void ${methodName}() {`,
    ...body,
    `    }`,
    ``,
  ];
}

const TEST_CTX: JavaRenderContext = { thisName: "this" };

/** The render context of one test method body: its `let` locals (in the
 *  spelling `localOf` declares them) seed the lambda scope.  A Java lambda
 *  parameter may not redeclare an enclosing local ("variable x is already
 *  defined") while a Loom lambda binder legally shadows one, so a binder that
 *  lands on a test local renders under `<name>_` — the same seam the domain
 *  and workflow emitters use.  No collision, no rename. */
export function testBodyRenderContext(
  t: TestIR,
  localOf: (name: string) => string,
): JavaRenderContext {
  const lets = t.statements.flatMap((s) => (s.kind === "let" ? [localOf(s.name)] : []));
  return withLambdaScope(TEST_CTX, lets);
}

/** Coerce a raw test literal (rendered) to a strongly-typed Java factory /
 *  operation parameter.  The domain surface takes strong types
 *  (`CustomerId` / `Instant` / …) where the test writes a bare string; enums
 *  already render as `Enum.Value` refs.  Only the string-literal types need a
 *  cast: ids (wrap in the Id record — a `guid` value type wraps the string in
 *  `UUID.fromString` first, since `record CustomerId(UUID value)`) and
 *  `datetime` (`Instant.parse`).  Mirrors wire.ts's `wireToDomain`, but from a
 *  raw literal rather than a wire value. */
/** Java leaves for the shared rule.  Closes over the file's import set so an
 *  emitted `UUID` / `Instant` brings its import with it. */
function javaTestLiteral(): TestLiteralTarget {
  return {
    id: (rendered, targetName, valueType) => {
      if (valueType === "guid") return `new ${targetName}Id(${J.UUID}.fromString(${rendered}))`;
      return `new ${targetName}Id(${rendered})`;
    },
    datetime: (rendered) => `${J.Instant}.parse(${rendered})`,
  };
}

function coerceLiteralToJavaType(type: TypeIR | undefined, v: ExprIR, rendered: string): string {
  return coerceTestLiteral(type, v, rendered, javaTestLiteral());
}

/** `x.op(args)` on an aggregate receiver → the same call with each arg coerced
 *  to the operation's declared param type (an id-typed param takes the strong
 *  Id record, not the raw guid string).  Returns null when `e` isn't a
 *  resolvable aggregate operation call (intrinsic matcher, unknown receiver,
 *  unknown member) so the caller falls back to the plain renderer. */
export function renderOperationCall(
  e: ExprIR,
  ctx: BoundedContextIR,
  rctx: JavaRenderContext = TEST_CTX,
): string | null {
  if (e.kind !== "method-call" || e.isIntrinsicMatcher) return null;
  const rt = e.receiverType as { name?: string } | undefined;
  const aggName = rt?.name;
  if (!aggName) return null;
  const agg = ctx.aggregates.find((a) => a.name === aggName);
  if (!agg) return null;
  const op = [...(agg.operations ?? []), ...(agg.creates ?? []), ...(agg.destroys ?? [])].find(
    (o) => o.name === e.member,
  );
  if (!op || op.params.length === 0) return null;
  const recv = renderJavaExpr(e.receiver, rctx);
  const args = e.args.map((a, i) => {
    const rendered = renderJavaExpr(a, rctx);
    const p = op.params[i];
    return p ? coerceLiteralToJavaType(p.type, a, rendered) : rendered;
  });
  return `${recv}.${jid(e.member)}(${args.join(", ")})`;
}

/** `Agg.create({...})` → the positional `Agg.create(...)` factory call,
 *  omitted create-inputs filled with their omission value (the factory
 *  takes every canonical create-input positionally). */
export function renderCreateCall(
  e: ExprIR,
  ctx: BoundedContextIR,
  rctx: JavaRenderContext = TEST_CTX,
): string | null {
  if (e.kind !== "method-call" || e.member !== "create" || e.args.length !== 1) return null;
  const objArg = e.args[0];
  const receiver = e.receiver;
  if (objArg?.kind !== "object" || receiver.kind !== "ref") return null;
  const agg = ctx.aggregates.find((a) => a.name === receiver.name);
  if (!agg) return null;
  const byName = new Map(objArg.fields.map((f) => [f.name, f.value]));
  const args = createInputFields(agg).map((f) => {
    const v = byName.get(f.name);
    if (v) {
      // A provided string literal renders as a raw value; coerce it to the
      // factory param's strong Java type (id record / Instant / …).
      return coerceLiteralToJavaType(f.type, v, renderJavaExpr(v, rctx));
    }
    // Java has no optional or named parameters, so an omitted create input is
    // spelled `null` — the same signal the create DTO sends, and what the
    // factory's `x != null ? x : <default>` reads (emit/entity.ts).
    //
    // This used to render the DEFAULT VALUE here instead, which made the
    // assertion vacuous: `test "an omitted default is applied at construction"`
    // writes `Item.create({ name: "N" })` and checks `qty == 1`, and the fill
    // emitted `Item.create("N", 1, …)` — passing the value it then asserted.
    // Passing `null` keeps the call compiling AND leaves the domain rule under
    // test as the thing that decides the value.
    //
    // A SERVER-SOURCED default (`now()`, `currentUser.*`) is not a factory
    // default (see `javaFactoryDefault`), so it still renders its expression.
    const omission = createOmissionValue(f);
    if (omission.kind === "default" && isServerSourcedDefault(omission.expr)) {
      return renderJavaExpr(omission.expr, rctx);
    }
    return "null";
  });
  return `${agg.name}.create(${args.join(", ")})`;
}

/** Explicit intrinsic matcher → a JUnit assertion.  Comparisons over
 *  BigDecimal receivers route through compareTo (BigDecimal's equals is
 *  scale-sensitive and `<`/`>` don't exist). */
export function renderExplicitMatcher(
  expr: ExprIR,
  rctx: JavaRenderContext = TEST_CTX,
): string | null {
  if (expr.kind !== "method-call" || !expr.isIntrinsicMatcher) return null;
  const sig = intrinsicMatcherSig(expr.member);
  if (sig?.on !== "value") return null;
  let receiver = expr.receiver;
  let negate = false;
  if (receiver.kind === "member" && receiver.member === "not" && sig.negatable) {
    negate = true;
    receiver = receiver.receiver;
  }
  const inner = receiver.kind === "paren" ? receiver.inner : receiver;
  const actual = renderJavaExpr(inner, rctx);
  const arg = expr.args[0];
  const rawExpected = arg !== undefined ? renderJavaExpr(arg, rctx) : "";
  // A `datetime` subject against an ISO-8601 literal (`_test/arg-coercion.ts`)
  // compares as an `Instant`, which never `equals` a `String`.
  const expected = coerceMatcherExpected(expr, rawExpected, javaTestLiteral()) ?? rawExpected;
  const moneyLike =
    (inner.kind === "member" &&
      inner.memberType.kind === "primitive" &&
      (inner.memberType.name === "money" || inner.memberType.name === "decimal")) ||
    (arg?.kind === "literal" && (arg.lit === "money" || arg.lit === "decimal"));
  const cmp = (op: string): string =>
    moneyLike ? `(${actual}).compareTo(${expected}) ${op} 0` : `${actual} ${op} ${expected}`;
  switch (expr.member) {
    case "toBe":
      if (moneyLike) {
        return negate
          ? `assertTrue((${actual}).compareTo(${expected}) != 0);`
          : `assertEquals(0, (${actual}).compareTo(${expected}));`;
      }
      return negate
        ? `assertNotEquals(${expected}, ${actual});`
        : `assertEquals(${expected}, ${actual});`;
    case "toBeGreaterThan":
      return `assert${negate ? "False" : "True"}(${cmp(">")});`;
    case "toBeGreaterThanOrEqual":
      return `assert${negate ? "False" : "True"}(${cmp(">=")});`;
    case "toBeLessThan":
      return `assert${negate ? "False" : "True"}(${cmp("<")});`;
    case "toBeLessThanOrEqual":
      return `assert${negate ? "False" : "True"}(${cmp("<=")});`;
    // Absence.  An optional field is a boxed reference here (`Integer`, not
    // `int`), so the language's one absence value is Java's `null`.
    // (`toBeAbsent` never reaches this emitter — it is e2e-only, because a
    // declared Java field has no "absent" form, only `null`.)
    case "toBeNull":
      return negate ? `assertNotNull(${actual});` : `assertNull(${actual});`;
    // Containment.  Java spells BOTH lowerings `.contains(...)` — it is
    // declared on `Collection<E>` (element membership) and on `String`
    // (substring) — so the subject's static type picks the method, which is
    // the same dispatch `checkContainReceiver` already validated.  One arm
    // covers the two receiver kinds the DSL promises.
    case "toContain":
      return `assert${negate ? "False" : "True"}(${actual}.contains(${expected}));`;
    default:
      return null;
  }
}

/** The exception classes a BARE `toThrow()` accepts on Java: every way the
 *  in-process domain floor refuses a call.
 *
 *    DomainException     — a `precondition`, an aggregate / part invariant, and
 *                          a value object's invariant (`ValueObjectInvariantException`
 *                          extends it);
 *    DisallowedException — an operation's `when` state gate (a SIBLING of
 *                          `DomainException`, so the advice can answer it 409);
 *    ForbiddenException  — a `requires` left in the operation body.
 *
 *  All three are emitted unconditionally into `domain.common`, which every test
 *  class imports by wildcard.  Not `RuntimeException`: a NullPointerException
 *  out of broken generated code must FAIL a negative test, not pass it. */
const JAVA_DOMAIN_REJECTIONS = ["DomainException", "DisallowedException", "ForbiddenException"];

/** The bare `expect(<expr>).toThrow()` assertion (claims D17).
 *
 *  A `create(...)` or value-object construction can only be refused by an
 *  invariant, so it keeps the exact `assertThrows(DomainException.class, …)`.
 *  Anything else, an operation call above all, may be refused by a `when` gate
 *  or a `requires` too, and `assertThrows` takes ONE class: catch the common
 *  base, then require the domain family, so any other runtime error still
 *  fails with its own name in the message. */
export function javaBareToThrow(
  e: ExprIR,
  rendered: string,
  local: string,
  indent: string,
): string[] {
  const invariantOnly =
    (e.kind === "method-call" && e.member === "create") ||
    (e.kind === "call" && e.callKind === "value-object-ctor");
  if (invariantOnly) return [`${indent}assertThrows(DomainException.class, () -> ${rendered});`];
  const isDomain = JAVA_DOMAIN_REJECTIONS.map((n) => `${local} instanceof ${n}`).join(" || ");
  return [
    `${indent}RuntimeException ${local} = assertThrows(RuntimeException.class, () -> ${rendered});`,
    `${indent}assertTrue(${isDomain},`,
    `${indent}    "expected the domain to reject this call, but it threw: " + ${local});`,
  ];
}

function renderTestStmt(
  s: TestStmtIR,
  ctx: BoundedContextIR,
  state: TestEmitState,
  /** Position in the enclosing test body — only used to mint a collision-free
   *  local for a `toThrow(<kind>)` assertion's bound exception. */
  index = 0,
  rctx: JavaRenderContext = TEST_CTX,
): string[] {
  // Only expect / expect-throws / let / expression / call survive the IR
  // validator (validateAggregateTestBodies).
  if (s.kind === "expect") {
    const explicit = renderExplicitMatcher(s.expr, rctx);
    if (explicit) return [`        ${explicit}`];
    return [`        assertTrue(${renderJavaExpr(s.expr, rctx)});`];
  }
  if (s.kind === "expect-throws") {
    const expr =
      renderCreateCall(s.expr, ctx, rctx) ??
      withTestUser(s.expr, renderOperationCall(s.expr, ctx, rctx) ?? render(s.expr, rctx), state);
    // `toThrow(<kind>)` — bind the thrown `DomainException` (a value object's
    // `ValueObjectInvariantException` subclasses it) and assert its structural
    // `getKind()`, never its message, which an authored `message "..."`
    // replaces.  `assertThrows` already RETURNS the exception, so the rung
    // costs one local and one assertion; the local is suffixed with the
    // statement index so several throw assertions in one test body don't
    // collide.
    if (s.throwKind) {
      // `assertEquals` needs no import bookkeeping — the module shell already
      // emits `import static org.junit.jupiter.api.Assertions.*;`.
      const local = `__thrown${index}`;
      return [
        `        DomainException ${local} = assertThrows(DomainException.class, () -> ${expr});`,
        `        assertEquals(${javaThrowKind(s.throwKind)}, ${local}.getKind(), ${local}.getMessage());`,
      ];
    }
    return javaBareToThrow(s.expr, expr, `__thrown${index}`, "        ");
  }
  if (s.kind === "let") {
    const expr =
      renderCreateCall(s.expr, ctx, rctx) ??
      withTestUser(s.expr, renderOperationCall(s.expr, ctx, rctx) ?? render(s.expr, rctx), state);
    return [`        var ${escapeJavaIdent(s.name)} = ${expr};`];
  }
  if (s.kind === "call") {
    const args = s.args.map((a) => render(a, rctx)).join(", ");
    return [`        ${s.name}(${args});`];
  }
  if (s.kind === "expression") {
    const expr =
      renderCreateCall(s.expr, ctx, rctx) ??
      withTestUser(s.expr, renderOperationCall(s.expr, ctx, rctx) ?? render(s.expr, rctx), state);
    return [`        ${expr};`];
  }
  throw new Error(
    `internal: aggregate test body contains '${s.kind}' which the IR validator should have rejected`,
  );
}

function render(e: ExprIR, rctx: JavaRenderContext): string {
  return renderJavaExpr(e, rctx);
}

void upperFirst;
