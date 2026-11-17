import { createInputFields, createOmissionValue } from "../../../ir/enrich/wire-projection.js";
import { unitTestGateChecks } from "../../../ir/plan/gate-ladder.js";
import type { AssertionRelation } from "../../../ir/plan/test-assertion.js";
import {
  type TestPrincipalShape,
  testPrincipal,
  testPrincipalShape,
} from "../../../ir/plan/test-principal.js";
import { type RejectionPlan, rejectionPlan } from "../../../ir/plan/test-rejection.js";
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
import { CS_REJECTION_CLASSES, csThrowKind, rejectionClasses } from "../../_test/throw-kind.js";
import { csCalendarDateParseExact } from "../codec-spelling.js";
import { renderCsExpr, renderCsType } from "../render-expr.js";

/** C# leaves for the shared test-literal coercion rule
 *  (`_test/arg-coercion.ts`).  An id is a `record struct <X>Id(Guid Value)`;
 *  `datetime` parses round-trip so the `Z` offset is honoured. */
export const CS_TEST_LITERAL: TestValueTarget = {
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
// and an assertion over the domain-rejection family (`csRejection`) for an
// operation call (xUnit + AwesomeAssertions coexist).
// ---------------------------------------------------------------------------

export function renderTestsFile(
  agg: AggregateIR,
  ctx: BoundedContextIR,
  ns: string,
  principal?: TestPrincipalShape,
): string | null {
  return renderSubjectTestsFile(
    agg.name,
    agg.tests,
    ctx,
    ns,
    upperFirst(plural(agg.name)),
    `${ns}.Domain.${upperFirst(plural(agg.name))}`,
    principal,
  );
}

/** Value-object unit-test class (test-placement.md).  The VO lives in
 *  `${ns}.Domain.ValueObjects`, already among the shared usings — no dedicated
 *  subject using needed. */
export function renderVoTestsFile(
  vo: ValueObjectIR,
  ctx: BoundedContextIR,
  ns: string,
  principal?: TestPrincipalShape,
): string | null {
  return renderSubjectTestsFile(vo.name, vo.tests, ctx, ns, "ValueObjects", null, principal);
}

/** Domain-service unit-test class (test-placement.md).  The service
 *  lives in `${ns}.Domain.Services`. */
export function renderServiceTestsFile(
  svc: DomainServiceIR,
  ctx: BoundedContextIR,
  ns: string,
  principal?: TestPrincipalShape,
): string | null {
  return renderSubjectTestsFile(
    svc.name,
    svc.tests,
    ctx,
    ns,
    "Services",
    `${ns}.Domain.Services`,
    principal,
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
  principal: TestPrincipalShape | undefined,
): string | null {
  if (tests.length === 0) return null;
  // Render the test bodies first so we know whether the test principal was
  // threaded into any currentUser-reading op call — only then does the class
  // declare it and import the Auth-layer `User` (a system with no `user` block
  // emits no `${ns}.Auth` namespace, so an unconditional import would not
  // compile).
  const methodBlocks = tests.map((t) => renderTest(t, ctx, principal).map((l) => `    ${l}`));
  const principalRef = new RegExp(`\\b${TEST_PRINCIPAL}\\b`);
  const usesActor = methodBlocks.some((b) => b.some((l) => principalRef.test(l)));
  const defaultActor = methodBlocks.some(
    (b, i) => !tests[i]!.principal && b.some((l) => principalRef.test(l)),
  );
  const gated = methodBlocks.some((b) => b.some((l) => l.includes(`${GATED}(`)));
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
  // A domain service named by a test body, or by a route gate a unit test
  // checks (`unitTestGateChecks`).
  if (
    ownUsing !== `${ns}.Domain.Services` &&
    ctx.domainServices.some((d) => new RegExp(`\\b${d.name}\\.`).test(bodyText))
  )
    lines.push(`using ${ns}.Domain.Services;`);
  if (usesActor) lines.push(`using ${ns}.Auth;`);
  lines.push("");
  lines.push(`namespace ${ns}.Tests.${nsSuffix};`);
  lines.push("");
  lines.push(`public sealed class ${name}Tests`);
  lines.push("{");
  if (gated) lines.push(...gatedHelpers());
  if (defaultActor) {
    const rendered = renderTestPrincipal(
      testPrincipal(principal ?? testPrincipalShape(undefined), undefined, enumPool(ctx)),
      CS_PRINCIPAL,
    );
    lines.push(`    private static readonly User ${TEST_PRINCIPAL} = ${rendered};`, "");
  }
  for (const block of methodBlocks) {
    lines.push(...block);
    lines.push("");
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

function renderTest(
  t: TestIR,
  ctx: BoundedContextIR,
  principal: TestPrincipalShape | undefined,
): string[] {
  const methodName = upperFirst(t.name.replace(/[^A-Za-z0-9]+/g, "_")) || "Test";
  const body: string[] = [];
  for (const [i, s] of t.statements.entries()) {
    const rendered = renderTestStmt(s, ctx, i);
    if (rendered) body.push(...rendered.split("\n"));
  }
  // A head `as { … }` clause shadows the class's `TestPrincipal` with this
  // test's principal, so its operation calls and their gates run as it.
  const principalRef = new RegExp(`\\b${TEST_PRINCIPAL}\\b`);
  const own =
    t.principal && body.some((l) => principalRef.test(l))
      ? [
          `    var ${TEST_PRINCIPAL} = ${renderTestPrincipal(testPrincipal(principal ?? testPrincipalShape(undefined), t.principal, enumPool(ctx)), CS_PRINCIPAL)};`,
        ]
      : [];
  return [
    `[Fact(DisplayName = ${JSON.stringify(t.name)})]`,
    `public void ${methodName}()`,
    `{`,
    ...own,
    ...body,
    `}`,
  ];
}

/** The class-local helpers a unit test checks an operation's route gates with
 *  (`unitTestGateChecks`): the route runs them before the domain method, so a
 *  test calling the method runs them itself, against its test principal. */
export const GATED = "Gated";
export function gatedHelpers(): string[] {
  const loop = [
    "        foreach (var (allowed, message) in gates)",
    "            if (!allowed) throw new ForbiddenException(message);",
  ];
  return [
    "    /// <summary>Route <c>requires</c> gates of the operation called next: refused as the route refuses them.</summary>",
    `    private static T ${GATED}<T>((bool, string)[] gates, Func<T> call)`,
    "    {",
    ...loop,
    "        return call();",
    "    }",
    "",
    `    private static void ${GATED}((bool, string)[] gates, Action call)`,
    "    {",
    ...loop,
    "        call();",
    "    }",
    "",
  ];
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
  // A returned union is a sealed record family: one record per arm.
  tag: (negate, actual, arm) => should(actual, negate, `BeOfType<${arm.union}_${arm.tag}>`, ""),
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

/** `expect(<call>).toThrow(…)` as an xUnit assertion, in either tier
 *  (`rejectionPlan`).  `body` is the lambda body (`t.Close();`); `isAsync`
 *  renders the integration-test form.
 *
 *  xUnit's `Assert.Throws<T>` matches the EXACT type, and the floor's
 *  exceptions are siblings, not one hierarchy: `DomainException` (a
 *  precondition, an aggregate or part invariant), `DisallowedException` (a
 *  `when` gate), `ForbiddenException` (a `requires` left in the body), and
 *  `ValueObjectInvariantException` (a value object refused, emitted only when
 *  the context declares such an invariant).  A single class asserts it
 *  exactly; several catch any exception and require the family, so a
 *  NullReferenceException out of broken generated code fails the test.  A
 *  named rung asserts the exception's structural `Kind`, never its message;
 *  a value object's invariant is its own exception TYPE, so there the type
 *  already is the rung. */
export function csRejection(
  plan: RejectionPlan,
  body: string,
  local: string,
  indent: string,
  ctx: BoundedContextIR,
  isAsync = false,
): string {
  const voCtor = plan.call.kind === "call" && plan.call.callKind === "value-object-ctor";
  const one = (type: string): string =>
    isAsync
      ? `await Assert.ThrowsAsync<${type}>(async () => { ${body} await Task.CompletedTask; })`
      : `Assert.Throws<${type}>(() => { ${body} })`;
  if (plan.accepts === "rung") {
    if (voCtor && plan.rung === "invariant")
      return `${indent}${one("ValueObjectInvariantException")};`;
    return [
      `${indent}var ${local} = ${one("DomainException")};`,
      `${indent}Assert.Equal(${csThrowKind(plan.rung)}, ${local}.Kind);`,
    ].join("\n");
  }
  const classes = voCtor
    ? ["ValueObjectInvariantException"]
    : [
        ...rejectionClasses(CS_REJECTION_CLASSES, plan.rungs),
        ...(plan.rungs.includes("invariant") && hasValueObjectInvariants(ctx)
          ? ["ValueObjectInvariantException"]
          : []),
      ];
  if (classes.length === 1) return `${indent}${one(classes[0]!)};`;
  const caught = isAsync
    ? `await Assert.ThrowsAnyAsync<Exception>(async () => { ${body} await Task.CompletedTask; })`
    : `Assert.ThrowsAny<Exception>(() => { ${body} })`;
  return [
    `${indent}var ${local} = ${caught};`,
    `${indent}Assert.True(${local} is ${classes.join(" or ")},`,
    `${indent}    $"expected the domain to reject this call, but it threw: {${local}}");`,
  ].join("\n");
}

/** The lambda body of a throw assertion: an invocation is a valid expression
 *  statement whether it returns void or a value; any other expression is
 *  bound (CS0201), never a void call (CS0815). */
export function csThrowBody(e: ExprIR, rendered: string): string {
  const isInvocation = e.kind === "method-call" || e.kind === "call";
  return isInvocation ? `${rendered};` : `var __ = ${rendered};`;
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
    const plan = rejectionPlan(s);
    const body = csThrowBody(plan.call, renderTestExpr(plan.call, ctx));
    return csRejection(plan, body, `__thrown${index}`, "    ", ctx);
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
      const call = `${recv}.${upperFirst(e.member)}(${args.join(", ")})`;
      const gates = unitTestGateChecks(op, e).map(
        (c) =>
          `(${renderCsExpr(c.cond, { thisName: "this", currentUserExpr: principal })}, ${JSON.stringify(`Forbidden: ${c.gate.source}`)})`,
      );
      return gates.length === 0 ? call : `${GATED}(new[] { ${gates.join(", ")} }, () => ${call})`;
    }
  }
  return renderCreateCall(e, ctx) ?? renderCsExpr(e);
}
