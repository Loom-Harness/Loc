import { createInputFields, createOmissionValue } from "../../../ir/enrich/wire-projection.js";
import type { AssertionRelation } from "../../../ir/plan/test-assertion.js";
import { testPrincipal } from "../../../ir/plan/test-principal.js";
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
import { enumPool } from "../../../ir/util/reachable-types.js";
import { hasValueObjectInvariants } from "../../../ir/util/value-object-invariants.js";
import { escapeCsharpIdent, plural, upperFirst } from "../../../util/naming.js";
import { isServerSourcedDefault } from "../../_frontend/server-default.js";
import { csUsing } from "../../_imports/dotnet.js";
import { coerceTestValue, type TestValueTarget } from "../../_test/arg-coercion.js";
import {
  type AssertionTarget,
  type CompareOperands,
  renderAssertion,
} from "../../_test/assertion-target.js";
import { type PrincipalTarget, renderTestPrincipal } from "../../_test/principal-target.js";
import { csThrowKind } from "../../_test/throw-kind.js";
import { csCalendarDateParseExact } from "../codec-spelling.js";
import { renderCsExpr, renderCsType } from "../render-expr.js";

/** C# leaves for the shared test-literal coercion rule
 *  (`_test/arg-coercion.ts`).  An id is a `record struct <X>Id(Guid Value)`;
 *  `datetime` parses round-trip so the `Z` offset is honoured. */
const CS_TEST_LITERAL: TestValueTarget = {
  id: (rendered, targetName) => `new ${targetName}Id(Guid.Parse(${rendered}))`,
  datetime: (rendered) =>
    `DateTime.Parse(${rendered}, null, System.Globalization.DateTimeStyles.RoundtripKind)`,
  date: (rendered) => csCalendarDateParseExact(rendered),
  money: (digits) => renderCsExpr({ kind: "literal", lit: "money", value: digits }),
  valueObject: (name, args) => `new ${name}(${args.join(", ")})`,
  omitted: "null",
};

/** The member a unit-test class binds its principal to; a currentUser-reading
 *  operation call takes it as its trailing argument. */
const TEST_PRINCIPAL = "TestPrincipal";

/** C# spelling of the shared test principal (`testPrincipal`,
 *  src/ir/plan/test-principal.ts): the `User` record, every declared claim by
 *  name. */
export const CS_PRINCIPAL: PrincipalTarget = {
  text: (v) => JSON.stringify(v),
  guid: (v) => `System.Guid.Parse(${JSON.stringify(v)})`,
  // `readonly record struct <T>Id(Guid Value)` declares no conversion from a
  // `Guid`, so the strong id is constructed.
  id: (targetName, v) => `new ${targetName}Id(System.Guid.Parse(${JSON.stringify(v)}))`,
  int: "0",
  decimal: () => "0m",
  bool: "false",
  datetime: "System.DateTime.UnixEpoch",
  date: "new System.DateOnly(1970, 1, 1)",
  enumMember: (name, member) => `${name}.${upperFirst(member)}`,
  list: (element, items) =>
    `new System.Collections.Generic.List<${renderCsType(element)}>${items.length > 0 ? ` { ${items.join(", ")} }` : "()"}`,
  absent: "null",
  record: (claims) =>
    `new User(${claims.map((c) => `${upperFirst(c.field.name)}: ${c.rendered}`).join(", ")})`,
};

// ---------------------------------------------------------------------------
// `test "..." { ... }` DSL → xUnit test class.
//
// Each test block becomes a `[Fact]`-decorated method.  Explicit, typed
// matchers (`expect(x).toBe(y)`, `.toBeGreaterThan(…)`, with optional
// `.not.`) lower to AwesomeAssertions fluent calls — the OSS continuation of
// FluentAssertions — so failures name actual and expected operands:
//
//   expect(m.amount).toBe(10.5m)          → m.Amount.Should().Be(10.5m);
//   expect(x).toBeGreaterThan(0)          → x.Should().BeGreaterThan(0);
//   expect(x).not.toBeLessThanOrEqual(0)  → x.Should().NotBeLessThanOrEqualTo(0);
//
// Every `expect` carries a matcher (no bare-boolean fallback);
// `expect(call).toThrow()` emits `Assert.Throws<DomainException>` for a create
// (a value-object construction: `Assert.Throws<ValueObjectInvariantException>`),
// and an assertion over the domain-rejection family (`csBareToThrow`) for an
// operation call (xUnit + AwesomeAssertions coexist).
// ---------------------------------------------------------------------------

export function renderTestsFile(
  agg: AggregateIR,
  ctx: BoundedContextIR,
  ns: string,
  user?: readonly FieldIR[],
): string | null {
  return renderSubjectTestsFile(
    agg.name,
    agg.tests,
    ctx,
    ns,
    upperFirst(plural(agg.name)),
    `${ns}.Domain.${upperFirst(plural(agg.name))}`,
    user,
  );
}

/** Value-object unit-test class (test-placement.md).  The VO lives in
 *  `${ns}.Domain.ValueObjects`, already among the shared usings — no dedicated
 *  subject using needed. */
export function renderVoTestsFile(
  vo: ValueObjectIR,
  ctx: BoundedContextIR,
  ns: string,
  user?: readonly FieldIR[],
): string | null {
  return renderSubjectTestsFile(vo.name, vo.tests, ctx, ns, "ValueObjects", null, user);
}

/** Domain-service unit-test class (test-placement.md).  The service
 *  lives in `${ns}.Domain.Services`. */
export function renderServiceTestsFile(
  svc: DomainServiceIR,
  ctx: BoundedContextIR,
  ns: string,
  user?: readonly FieldIR[],
): string | null {
  return renderSubjectTestsFile(
    svc.name,
    svc.tests,
    ctx,
    ns,
    "Services",
    `${ns}.Domain.Services`,
    user,
  );
}

/** Shared xUnit test-class renderer for any subject.  `nsSuffix` is the test
 *  sub-namespace/folder (`Orders` for an aggregate, `ValueObjects` / `Services`
 *  for the Phase-2 subjects); `ownUsing` is the subject's own domain namespace
 *  (an aggregate's per-agg namespace, a service's `Domain.Services`), or `null`
 *  for a value object whose `Domain.ValueObjects` is already imported. */
function renderSubjectTestsFile(
  name: string,
  tests: TestIR[],
  ctx: BoundedContextIR,
  ns: string,
  nsSuffix: string,
  ownUsing: string | null,
  user: readonly FieldIR[] | undefined,
): string | null {
  if (tests.length === 0) return null;
  // Render the test bodies first so we know whether the test principal was
  // threaded into any currentUser-reading op call — only then does the class
  // declare it and import the Auth-layer `User` (a system with no `user` block
  // emits no `${ns}.Auth` namespace, so an unconditional import would not
  // compile).
  const methodBlocks = tests.map((t) => renderTest(t, ctx).map((l) => `    ${l}`));
  const principalRef = new RegExp(`\\b${TEST_PRINCIPAL}\\b`);
  const usesActor = methodBlocks.some((b) => b.some((l) => principalRef.test(l)));
  // Every OTHER aggregate the bodies name.  A test body may legally reach for a
  // sibling aggregate — the validator admits it, and it is the only way to
  // exercise a value object holding a CROSS-aggregate reference
  // (`Berth { ship: Ship id }` needs a `Ship` to get an id from).  Each
  // aggregate has its OWN per-aggregate namespace, so the subject's `using`
  // alone left `Ship.Create(...)` unresolved: `CS0246`.  Narrowed to names the
  // rendered bodies actually spell, so a project whose tests touch one
  // aggregate keeps a using-clean header under `/warnaserror`.  Freight audit
  // D3 follow-up.
  const bodyText = methodBlocks.flat().join("\n");
  const siblingUsings = ctx.aggregates
    .filter((a) => a.name !== name && new RegExp(`\\b${a.name}\\b`).test(bodyText))
    .map((a) => `${ns}.Domain.${upperFirst(plural(a.name))}`)
    .sort();

  const lines: string[] = [
    "// Auto-generated.  Do not edit by hand.",
    "using System;",
    // Rendered iff the class spells a `List` through `csRef`.
    csUsing("System.Collections.Generic"),
    "using Xunit;",
    "using AwesomeAssertions;",
  ];
  if (ownUsing) lines.push(`using ${ownUsing};`);
  for (const u of siblingUsings) if (u !== ownUsing) lines.push(`using ${u};`);
  lines.push(`using ${ns}.Domain.Common;`);
  // The ValueObjects / Enums / Ids namespaces only exist when the context
  // actually declares that kind — an unconditional `using` on an absent
  // namespace is a CS0234 compile error.  (Latent on the aggregate path too;
  // surfaced by the Phase-2 VO/service tests, which a project may have without
  // any enum.)
  if (ctx.valueObjects.length > 0) lines.push(`using ${ns}.Domain.ValueObjects;`);
  // Gated on the bodies actually spelling an enum from the context's POOL: a
  // sibling-context enum lives in the same project-wide `Domain.Enums`
  // namespace, so a body naming one needs the using even when this context
  // declares no enum of its own (claims D1).  C# can't reach an enum type
  // without spelling its name, so the scan is exact.
  if (enumPool(ctx).some((e) => new RegExp(`\\b${e.name}\\b`).test(bodyText)))
    lines.push(`using ${ns}.Domain.Enums;`);
  if (ctx.aggregates.length > 0) lines.push(`using ${ns}.Domain.Ids;`);
  if (usesActor) lines.push(`using ${ns}.Auth;`);
  lines.push("");
  lines.push(`namespace ${ns}.Tests.${nsSuffix};`);
  lines.push("");
  lines.push(`public sealed class ${name}Tests`);
  lines.push("{");
  if (usesActor) {
    const principal = renderTestPrincipal(
      testPrincipal(user ?? [], undefined, enumPool(ctx)),
      CS_PRINCIPAL,
    );
    lines.push(`    private static readonly User ${TEST_PRINCIPAL} = ${principal};`, "");
  }
  for (const block of methodBlocks) {
    lines.push(...block);
    lines.push("");
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

function renderTest(t: TestIR, ctx: BoundedContextIR): string[] {
  const methodName = upperFirst(t.name.replace(/[^A-Za-z0-9]+/g, "_")) || "Test";
  const out: string[] = [];
  out.push(`[Fact(DisplayName = ${JSON.stringify(t.name)})]`);
  out.push(`public void ${methodName}()`);
  out.push(`{`);
  for (const [i, s] of t.statements.entries()) {
    const rendered = renderTestStmt(s, ctx, i);
    if (rendered) out.push(...rendered.split("\n"));
  }
  out.push(`}`);
  return out;
}

/** Coerce a raw test literal to a strongly-typed C# factory / operation
 *  parameter.  The domain surface takes strong types (`CustomerId` — a
 *  `record struct CustomerId(Guid Value)` — / `DateTime` / …) where the test
 *  writes a bare string; enums already render as `Enum.Value` refs.  Only the
 *  string-literal types need a cast: ids (wrap in the Id struct; a `guid`
 *  value type wraps the string in `Guid.Parse` first) and `datetime`
 *  (`DateTime.Parse`, round-trip kind so the `Z` offset is honoured). */
function coerceLiteralToCsType(
  type: TypeIR | undefined,
  v: ExprIR,
  ctx: BoundedContextIR,
  render: (e: ExprIR) => string,
): string {
  return coerceTestValue(type, v, ctx, render, CS_TEST_LITERAL);
}

/** Render an aggregate `Agg.create(…)` factory call as a named-arg
 *  `Agg.Create(...)` — the same shape the workflow `factory-let` emitter
 *  produces.  Emits the inputs the test author named, plus an explicit value
 *  for each omitted input the factory has NO C# default for.
 *
 *  The factory's DEFAULTABLE parameters (a declared `= default`, a bare
 *  `bool`, a non-nullable collection) carry `= null` and materialize their
 *  value in the body (`csFactoryDefault` in emit/entity.ts), so those stay
 *  omitted.  Filling them would make
 *  `test "an omitted default is applied at construction"` assert a value the
 *  emitter just passed in.  Named args keep the source field order free of the
 *  CS1737 required-before-optional reordering.
 *
 *  Two kinds of omission have no factory default and must be spelled out,
 *  or the call is CS7036:
 *    - a PLAIN optional (`note: string?`) is a required `string? note`
 *      parameter, so it gets `null`, which is what omitting it means;
 *    - a SERVER-sourced default (`now()`, `currentUser.*`) is coalesced per
 *      request rather than by the factory, so it gets its rendered expression.
 *  The Java test emitter (`java/emit/tests.ts`) uses the same rule, positionally.
 *
 *  Returns `null` when the expression isn't an aggregate create call, so
 *  the caller falls back to the generic expression renderer (a bare
 *  `object` literal would otherwise render as a C# `new { … }`, which is
 *  not a valid argument to `Create(...)`). */
export function renderCreateCall(e: ExprIR, ctx: BoundedContextIR): string | null {
  if (e.kind !== "method-call" || e.member !== "create" || e.args.length !== 1) return null;
  const objArg = e.args[0];
  const receiver = e.receiver;
  if (objArg?.kind !== "object" || receiver.kind !== "ref") return null;
  const agg = ctx.aggregates.find((a) => a.name === receiver.name);
  if (!agg) return null;
  const typeByName = new Map(createInputFields(agg).map((f) => [f.name, f.type]));
  const provided = objArg.fields.map((f) => {
    const t = typeByName.get(f.name);
    return `${escapeCsharpIdent(f.name)}: ${t ? coerceLiteralToCsType(t, f.value, ctx, (x) => renderCsExpr(x)) : renderCsExpr(f.value)}`;
  });
  // Do NOT append every omitted create input from `createOmissionValue`: that
  // makes the assertion vacuous.  `test "an omitted default is applied at
  // construction"` writes `Item.Create(name: "N")` and checks `Qty == 1`, and
  // a full fill would emit `Item.Create(name: "N", qty: 1, …)`, passing the
  // value it then asserts.  Fill only the omissions the factory cannot default.
  const named = new Set(objArg.fields.map((f) => f.name));
  const omitted = createInputFields(agg)
    .filter((f) => !named.has(f.name))
    .flatMap((f) => {
      const v = csUndefaultedOmission(f);
      return v === undefined ? [] : [`${escapeCsharpIdent(f.name)}: ${v}`];
    });
  return `${agg.name}.Create(${[...provided, ...omitted].join(", ")})`;
}

/** The value a unit test passes for an omitted create input that the domain
 *  factory has NO C# parameter default for, or `undefined` when the factory
 *  defaults it itself, in which case the argument stays omitted.  These are
 *  the undefaulted arms of `csFactoryDefault` (emit/entity.ts): a plain
 *  optional (`null` omission) and a server-sourced default. */
function csUndefaultedOmission(f: FieldIR): string | undefined {
  const omission = createOmissionValue(f);
  if (omission.kind === "null") return "null";
  if (omission.kind === "default" && isServerSourcedDefault(omission.expr)) {
    return renderCsExpr(omission.expr);
  }
  return undefined;
}

/** AwesomeAssertions' verb (after `.Should().`) for each relation. */
const AWESOME_RELATION: Readonly<Record<AssertionRelation, string>> = {
  eq: "Be",
  gt: "BeGreaterThan",
  ge: "BeGreaterThanOrEqualTo",
  lt: "BeLessThan",
  le: "BeLessThanOrEqualTo",
};

/** A `DateTime` / `DateOnly` orders through the temporal verbs; the numeric
 *  `BeGreaterThan` family is not defined on them. */
const AWESOME_TEMPORAL: Readonly<Record<AssertionRelation, string>> = {
  eq: "Be",
  gt: "BeAfter",
  ge: "BeOnOrAfter",
  lt: "BeBefore",
  le: "BeOnOrBefore",
};

const should = (actual: string, negate: boolean, verb: string, expected: string): string =>
  `${actual}.Should().${negate ? `Not${verb}` : verb}(${expected});`;

/** The relation a negated ordering asserts: AwesomeAssertions has no
 *  `NotBeGreaterThan`, and over ordered values "not greater than" is "less
 *  than or equal to". */
const CONVERSE: Readonly<Record<AssertionRelation, AssertionRelation>> = {
  eq: "eq",
  gt: "le",
  ge: "lt",
  lt: "ge",
  le: "gt",
};

/** An equality or ordering assertion through `verbs`, a negated ordering
 *  asserted as its converse. */
function ordered(
  verbs: Readonly<Record<AssertionRelation, string>>,
  { relation, negate, actual, expected }: CompareOperands,
): string {
  if (negate && relation !== "eq")
    return should(actual, false, verbs[CONVERSE[relation]], expected);
  return should(actual, negate, verbs[relation], expected);
}

/** AwesomeAssertions leaves for the shared assertion plan — the OSS
 *  continuation of FluentAssertions, so a failure names both operands.  A C#
 *  `decimal` compares by value (`15.00m == 15m`), so `money` takes the plain
 *  verbs.  A record compares member by member (`Be` would use the record's
 *  `Equals`, which compares a list member by reference). */
const AWESOME_ASSERTIONS: AssertionTarget = {
  compare: {
    scalar: (c) => ordered(AWESOME_RELATION, c),
    decimal: (c) => ordered(AWESOME_RELATION, c),
    instant: (c) => ordered(AWESOME_TEMPORAL, c),
    date: (c) => ordered(AWESOME_TEMPORAL, c),
    structural: ({ negate, actual, expected }) =>
      should(
        actual,
        negate,
        "BeEquivalentTo",
        `${expected}, o => o.ComparingRecordsByMembers().WithStrictOrdering()`,
      ),
    sequence: ({ negate, actual, expected }) => should(actual, negate, "Equal", expected),
  },
  // Absence: `int?` holding nothing is `null` in C#, so the language's one
  // absence value is `null` here.
  isNull: (negate, actual) => should(actual, negate, "BeNull", ""),
  // `Contain` is defined on both collection and string assertions; the
  // subject's static type picks the overload.
  contain: (_within, negate, actual, expected) => should(actual, negate, "Contain", expected),
  literal: CS_TEST_LITERAL,
};

/** An explicit intrinsic value matcher (`expect(x).toBe(y)`, optionally
 *  `.not.`) as an AwesomeAssertions call, or null for a bare boolean, which the
 *  caller asserts with `Assert.True`. */
export function renderExplicitMatcherToAwesome(expr: ExprIR): string | null {
  return renderAssertion(expr, AWESOME_ASSERTIONS, {
    // `.Should()` is postfix member access, which binds tighter than every C#
    // operator: `a == b.Should().Be(true)` would compare `a` to the assertion
    // object.  A binary or unary subject is parenthesized.
    renderSubject: (e) =>
      e.kind === "binary" || e.kind === "unary" ? `(${renderCsExpr(e)})` : renderCsExpr(e),
    renderExpected: (e) => renderCsExpr(e),
  });
}

/** The exception types a BARE `toThrow()` accepts on .NET: every way the
 *  in-process domain floor refuses a call.  xUnit's `Assert.Throws<T>` matches
 *  the EXACT type, and these are siblings, not one hierarchy:
 *
 *    DomainException               — a `precondition`, an aggregate / part invariant;
 *    DisallowedException           — an operation's `when` state gate (409);
 *    ForbiddenException            — a `requires` left in the operation body;
 *    ValueObjectInvariantException — a value object refused inside the body,
 *                                    emitted only when the context declares
 *                                    such an invariant.
 *
 *  Not `Exception`: a NullReferenceException out of broken generated code must
 *  FAIL a negative test, not pass it. */
function csDomainRejections(ctx: BoundedContextIR): string[] {
  const out = ["DomainException", "DisallowedException", "ForbiddenException"];
  if (hasValueObjectInvariants(ctx)) out.push("ValueObjectInvariantException");
  return out;
}

/** The bare `expect(<expr>).toThrow()` assertion over the domain-rejection
 *  family (claims D17), or `null` to keep the exact single-type
 *  `Assert.Throws<…>`: a `create(...)` or a value-object construction can only
 *  be refused by an invariant.  Anything else, an operation call above all,
 *  may be refused by a `when` gate or a `requires` as well.  `body` is the
 *  lambda body (`t.Close();`); `isAsync` renders the integration-test form. */
export function csBareToThrow(
  e: ExprIR,
  body: string,
  local: string,
  indent: string,
  ctx: BoundedContextIR,
  isAsync = false,
): string | null {
  if (e.kind === "method-call" && e.member === "create") return null;
  if (e.kind === "call" && e.callKind === "value-object-ctor") return null;
  const caught = isAsync
    ? `await Assert.ThrowsAnyAsync<Exception>(async () => { ${body} await Task.CompletedTask; })`
    : `Assert.ThrowsAny<Exception>(() => { ${body} })`;
  return [
    `${indent}var ${local} = ${caught};`,
    `${indent}Assert.True(${local} is ${csDomainRejections(ctx).join(" or ")},`,
    `${indent}    $"expected the domain to reject this call, but it threw: {${local}}");`,
  ].join("\n");
}

function renderTestStmt(
  s: TestStmtIR,
  ctx: BoundedContextIR,
  /** Position in the enclosing test body — only used to mint a collision-free
   *  local for a `toThrow(<kind>)` assertion's bound exception. */
  index = 0,
): string {
  // See `validateAggregateTestBodies` in src/ir/validate/validate.ts — by the
  // time we reach the generator, only `expect` / `expect-throws` /
  // `let` / `expression` / pure-function `call` survive.
  if (s.kind === "expect") {
    const explicit = renderExplicitMatcherToAwesome(s.expr);
    if (explicit) return `    ${explicit}`;
    // Every `expect` carries a matcher (validator: checkExpectMatcher); a bare
    // boolean reaching codegen is an invariant violation, not user input.
    throw new Error("expect requires a matcher (e.g. expect(x).toBe(y)); got a bare expression.");
  }
  if (s.kind === "expect-throws") {
    const expr = renderTestExpr(s.expr, ctx);
    // An invocation (operation call) is a valid expression-statement whether it
    // returns void or a value — `() => { call(); }`.  Only a non-invocation
    // expression (e.g. a property access) needs binding to satisfy CS0201;
    // binding a void call to `var` is a CS0815 error, so never do it for calls.
    const isInvocation = s.expr.kind === "method-call" || s.expr.kind === "call";
    const body = isInvocation ? `${expr};` : `var __ = ${expr};`;
    // `Assert.Throws<T>` matches the EXACT type, and a value object's invariant
    // throws its own `ValueObjectInvariantException` (enums-vos.ts), a sibling
    // of `DomainException` rather than a subclass.  Asserting `DomainException`
    // for `expect(Money { amount: -1 … }).toThrow()` compiles, and then fails at
    // run time even though the invariant fired.
    // A `toThrow(precondition)` over one keeps `DomainException`, so it FAILS
    // at run time as it does on every other backend: a value object declares
    // invariants only, so no precondition can be what refused it.
    const voCtor =
      s.expr.kind === "call" &&
      s.expr.callKind === "value-object-ctor" &&
      s.throwKind !== "precondition";
    const exceptionType = voCtor ? "ValueObjectInvariantException" : "DomainException";
    const thrown = `Assert.Throws<${exceptionType}>(() => { ${body} })`;
    // `toThrow(<kind>)` — pin WHICH rung rejected by the exception's structural
    // `Kind`, never its message, which a rule's own text replaces.
    // `Assert.Throws` returns the caught exception, so the rung is one local
    // plus `Assert.Equal`; the local carries the statement index so two throw
    // assertions in one `[Fact]` don't collide.  A value object's invariant is
    // its own exception TYPE, so there the type already is the rung.
    if (s.throwKind && !voCtor) {
      const local = `__thrown${index}`;
      return [
        `    var ${local} = ${thrown};`,
        `    Assert.Equal(${csThrowKind(s.throwKind)}, ${local}.Kind);`,
      ].join("\n");
    }
    return csBareToThrow(s.expr, body, `__thrown${index}`, "    ", ctx) ?? `    ${thrown};`;
  }
  if (s.kind === "let") {
    const expr = renderTestExpr(s.expr, ctx);
    return `    var ${escapeCsharpIdent(s.name)} = ${expr};`;
  }
  if (s.kind === "call") {
    const args = s.args.map((a) => renderCsExpr(a)).join(", ");
    return `    ${upperFirst(s.name)}(${args});`;
  }
  if (s.kind === "expression") {
    return `    ${renderTestExpr(s.expr, ctx)};`;
  }
  throw new Error(
    `internal: aggregate test body contains '${s.kind}' which the IR validator should have rejected`,
  );
}

/** Render a test-body expression, threading `principal` (the unit tier's
 *  `TestPrincipal`, or the integration tier's ambient principal) into calls of
 *  currentUser-reading operations, whose method signature gained a trailing
 *  `User currentUser` parameter.  Everything else defers to
 *  `renderCreateCall` (typed `create({…})` input) / `renderCsExpr`. */
export function renderTestExpr(
  e: ExprIR,
  ctx: BoundedContextIR,
  principal: string = TEST_PRINCIPAL,
): string {
  if (
    e.kind === "method-call" &&
    e.receiverType.kind === "entity" &&
    !e.isCollectionOp &&
    !e.isIntrinsicMatcher
  ) {
    const entityName = e.receiverType.name;
    const agg = ctx.aggregates.find((a) => a.name === entityName);
    const op = agg?.operations.find((o) => o.name === e.member);
    if (op) {
      // Coerce each arg to the operation's declared param type (an id-typed
      // param takes the Id struct, not the raw guid string), then thread the
      // synthetic actor for a currentUser-gated op.
      const recv = renderTestExpr(e.receiver, ctx, principal);
      const args = e.args.map((a, i) => {
        const p = op.params[i];
        return p
          ? coerceLiteralToCsType(p.type, a, ctx, (x) => renderTestExpr(x, ctx, principal))
          : renderTestExpr(a, ctx, principal);
      });
      if (operationBodyUsesCurrentUser(op)) args.push(principal);
      return `${recv}.${upperFirst(e.member)}(${args.join(", ")})`;
    }
  }
  return renderCreateCall(e, ctx) ?? renderCsExpr(e);
}
