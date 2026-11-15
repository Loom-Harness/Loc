import { createInputFields } from "../../../ir/enrich/wire-projection.js";
import type { AssertionRelation } from "../../../ir/plan/test-assertion.js";
import { testPrincipal } from "../../../ir/plan/test-principal.js";
import type {
  AggregateIR,
  BoundedContextIR,
  ContainmentIR,
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
import { escapePythonIdent, pythonIdent, snake } from "../../../util/naming.js";
import { PY_IMPORTS, pyModule, pyRef } from "../../_imports/python.js";
import { ref, spellMarkers } from "../../_imports/symbol.js";
import {
  coerceTestArgs,
  coerceTestValue,
  type TestValueTarget,
  withServiceMoneyArgs,
} from "../../_test/arg-coercion.js";
import {
  type AssertionTarget,
  type CompareOperands,
  renderAssertion,
} from "../../_test/assertion-target.js";
import { type PrincipalTarget, renderTestPrincipal } from "../../_test/principal-target.js";
import { DOMAIN_REJECTION_ERRORS } from "../../_test/throw-kind.js";
import { PY, pyIdType, pyVoOrEnum } from "../py-symbols.js";
import { renderPyExpr, renderPyType } from "../render-expr.js";
import { PY_CALENDAR_DATE } from "./calendar-date.js";

/** Python leaves for the shared test-literal coercion rule
 *  (`_test/arg-coercion.ts`).  `<X>Id(…)` is the id class the generator emits
 *  into `app/domain/ids.py`; `datetime` parses via `fromisoformat`. */
const PY_TEST_LITERAL: TestValueTarget = {
  id: (rendered, targetName) => `${pyIdType(targetName)}(${rendered})`,
  datetime: (rendered) => `${PY.datetime}.fromisoformat(${rendered})`,
  date: (rendered) => `${PY_CALENDAR_DATE}.fromisoformat(${rendered})`,
  money: (digits) => renderPyExpr({ kind: "literal", lit: "money", value: digits }),
  valueObject: (name, args) => `${pyVoOrEnum(name)}(${args.join(", ")})`,
  omitted: "None",
};

/** The call a test module reads its principal through; a currentUser-reading
 *  operation call takes it as its trailing argument.  A unit-test module
 *  defines it as the test principal, an integration module as the principal
 *  bound in `current_user_var`. */
export const TEST_PRINCIPAL_CALL = "_test_principal()";

/** Python spelling of the shared test principal (`testPrincipal`,
 *  src/ir/plan/test-principal.ts): the `User` dataclass, every declared claim
 *  by keyword. */
export const PY_PRINCIPAL: PrincipalTarget = {
  text: (v) => JSON.stringify(v),
  guid: (v) => JSON.stringify(v),
  id: (targetName, v) => `${pyIdType(targetName)}(${JSON.stringify(v)})`,
  int: "0",
  decimal: (money) => (money ? `${PY.Decimal}("0")` : "0.0"),
  bool: "False",
  datetime: `${PY.datetime}.fromtimestamp(0, tz=${PY.UTC})`,
  date: `${PY_CALENDAR_DATE}(1970, 1, 1)`,
  enumMember: (name, member) =>
    renderPyExpr({
      kind: "ref",
      name: member,
      refKind: "enum-value",
      enumName: name,
      type: { kind: "enum", name },
    } as ExprIR),
  list: (_element, items) => `[${items.join(", ")}]`,
  absent: "None",
  record: (claims) =>
    `${pyRef("app.auth.user", "User")}(${claims.map((c) => `${snake(c.field.name)}=${c.rendered}`).join(", ")})`,
};

/** `import pytest` — the `pytest.raises` context manager. */
const PYTEST = ref(pyModule("pytest"));

// ---------------------------------------------------------------------------
// `test "..." { ... }` DSL → pytest file at `tests/test_<snake(agg)>.py`.
//
// Each test block becomes one `def test_<slug>() -> None:` function.
// Statement forms (the IR validator already restricted the body to the
// pure subset — see the TS emitter's notes):
//
//   expect(x).toBe(y)        → `assert x == y` (comparison matchers map
//                               1:1 onto operators; `.not.` inverts)
//   expect <bool-expr>       → `assert <bool-expr>`
//   expect(<call>).toThrow() → `with pytest.raises((DisallowedError, DomainError,
//                               ForbiddenError)): <call>` — a DOMAIN rejection
//                               only (`DOMAIN_REJECTION_ERRORS`), so a NameError
//                               from broken code fails the test
//   let x = …                → `x = …`
//
// `<Agg>.create({ … })` literals coerce each field to its declared
// domain type the same way the TS emitter does: id strings brand via
// `<X>Id("…")`, value-object literals construct positionally in
// declared field order (omitted optionals → None), datetime literals
// parse via `datetime.fromisoformat`.
// ---------------------------------------------------------------------------

/** What a bare `toThrow()` accepts: the domain floor's refusal classes, as the
 *  tuple `pytest.raises` takes.  Not `Exception` — that admitted a `NameError`
 *  out of broken generated code as a passing negative test (claims D2). */
const DOMAIN_REJECTION_TUPLE = `(${DOMAIN_REJECTION_ERRORS.map((n) => pyRef("app.domain.errors", n)).join(", ")})`;

export function renderPyTestsFile(
  agg: AggregateIR,
  ctx: BoundedContextIR,
  user?: readonly FieldIR[],
): string | null {
  return renderPySubjectTests(
    agg.name,
    agg.tests,
    ctx,
    {
      module: `app.domain.${snake(agg.name)}`,
      symbols: [agg.name, ...agg.parts.map((p) => p.name)],
    },
    user,
  );
}

/** Value-object unit-test module (test-placement.md).  The VO is
 *  imported through the shared `app.domain.value_objects` narrowing — no
 *  dedicated subject import. */
export function renderPyVoTestsFile(
  vo: ValueObjectIR,
  ctx: BoundedContextIR,
  user?: readonly FieldIR[],
): string | null {
  return renderPySubjectTests(vo.name, vo.tests, ctx, null, user);
}

/** Domain-service unit-test module (test-placement.md).  A service op
 *  renders as a bare module-level function (`snake(op)(…)`), so the test imports
 *  the referenced op functions from `app.domain.services.<snake(svc)>`. */
export function renderPyServiceTestsFile(
  svc: DomainServiceIR,
  ctx: BoundedContextIR,
  user?: readonly FieldIR[],
): string | null {
  return renderPySubjectTests(
    svc.name,
    svc.tests,
    ctx,
    {
      module: `app.domain.services.${snake(svc.name)}`,
      symbols: svc.operations.map((o) => snake(o.name)),
    },
    user,
  );
}

/** Shared pytest-module renderer for any subject.  `subjectImport` names the
 *  module + symbols carrying the subject's own code (an aggregate's per-agg
 *  module, a service's ops module); `null` for a value object, imported through
 *  the `app.domain.value_objects` narrowing.  Symbols are narrowed to names the
 *  body actually references. */
function renderPySubjectTests(
  describeName: string,
  tests: readonly TestIR[],
  ctx: BoundedContextIR,
  subjectImport: { module: string; symbols: string[] } | null,
  user: readonly FieldIR[] | undefined,
): string | null {
  if (tests.length === 0) return null;

  const body: string[] = [];
  const usedNames = new Set<string>();
  for (const t of tests) {
    body.push("", "");
    body.push(...renderTest(t, ctx, usedNames));
  }
  if (body.some((l) => l.includes(TEST_PRINCIPAL_CALL))) {
    const principal = renderTestPrincipal(
      testPrincipal(user ?? [], undefined, enumPool(ctx)),
      PY_PRINCIPAL,
    );
    body.unshift(
      "",
      "",
      `def ${TEST_PRINCIPAL_CALL.slice(0, -2)}() -> ${pyRef("app.auth.user", "User")}:`,
      `    return ${principal}`,
    );
  }
  const bodyStr = body.join("\n");

  const refs = (n: string): boolean => new RegExp(`\\b${n}\\b`).test(bodyStr);
  const subjectNames = subjectImport ? subjectImport.symbols.filter(refs) : [];
  // …and every OTHER aggregate in the context the body names.  A test body may
  // legally reach for a sibling aggregate — the validator admits it, and it is
  // the only way to exercise a value object holding a CROSS-aggregate reference
  // (`Berth { ship: Ship id }` needs a `Ship` to get an id from).  Scoping the
  // import to the subject alone emitted `Ship.create(...)` with no `Ship`
  // bound: ruff `F821`, and a `NameError` when the test runs.  Each sibling
  // has its own module, so this is one `from … import` each, narrowed by the
  // same body scan as everything else here.  Freight audit D3 follow-up.
  const siblingAggs = ctx.aggregates
    .filter((a) => a.name !== describeName && refs(a.name))
    .map((a) => a.name)
    .sort();
  // The module has always set a lone `from typing import cast` flush against
  // the docstring (no blank line) — kept for byte-identity.
  const spelled = spellMarkers(bodyStr);
  const castOnly =
    /\bcast\(/.test(spelled) &&
    !/\b(datetime\.|timedelta\(|Decimal\(|math\.|pytest\.|SimpleNamespace\()/.test(spelled);

  const out: string[] = [];
  out.push(`"""Domain tests for ${describeName}.  Auto-generated."""`);
  // A test observes state a METHOD changed — `assert wo.status == S.Scheduled`,
  // `wo.complete()`, `assert wo.status == S.Completed`.  mypy keeps the first
  // assert's narrowing across the call, so the second compare reads as
  // non-overlapping (`comparison-overlap` under --strict) on every enum
  // progression.  The file-level inline config scopes the waiver to this test
  // module (a pyproject `tests.*` override cannot: `tests/` has no
  // `__init__.py`, so mypy names the module `test_<x>`), and only a file that
  // compares at all carries it.
  if (/^\s+assert .*[=!]= /m.test(spelled)) {
    out.push(`# mypy: disable-error-code="comparison-overlap"`);
  }
  if (!castOnly) out.push("");
  out.push(PY_IMPORTS);
  if (subjectImport && subjectNames.length > 0) {
    out.push(`from ${subjectImport.module} import ${subjectNames.join(", ")}`);
  }
  for (const name of siblingAggs) {
    out.push(`from app.domain.${snake(name)} import ${name}`);
  }
  return `${out.join("\n")}\n${bodyStr}\n`;
}

/** A test name slug usable as a python identifier, deduped per file. */
export function testFnName(name: string, used: Set<string>): string {
  const base =
    `test_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`.replace(/_+$/, "") || "test_case";
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) candidate = `${base}_${i++}`;
  used.add(candidate);
  return candidate;
}

function renderTest(t: TestIR, ctx: BoundedContextIR, used: Set<string>): string[] {
  const out: string[] = [];
  out.push(`def ${testFnName(t.name, used)}() -> None:`);
  // Track let-bound aggregate types: a bare `o.cancel()` expression
  // statement lowers with an untyped receiver, so gated-op detection
  // resolves the aggregate through the let's declared type instead.
  const lets = new Map<string, string>();
  for (const s of t.statements) {
    if (s.kind === "let" && s.type?.kind === "entity") lets.set(s.name, s.type.name);
  }
  const stmts = t.statements.flatMap((s) => renderTestStmt(s, ctx, lets));
  out.push(...(stmts.length > 0 ? stmts : ["    pass"]));
  return out;
}

/** Render a test-body expression: `<Agg>.create({ … })` object literals
 *  become coerced keyword arguments; everything else defers to
 *  `renderPyExpr`. */
/** True when a member read yields `T | None` on the generated domain object —
 *  an OPTIONAL field, or a SINGLE (non-collection) containment (which is
 *  `T | None` even when required, since it's unset at create and set later by an
 *  op).  A further access on it fails `mypy --strict` (`Item "None" … has no
 *  attribute`), so it's wrapped in `cast(T, …)`.  Mirror of the TS emitter's
 *  `isNullableMemberRead`. */
function isNullableMemberReadPy(e: ExprIR, ctx: BoundedContextIR): boolean {
  if (e.kind !== "member") return false;
  if (e.memberType.kind === "optional") return true;
  if (e.receiverType.kind === "entity") {
    const typeName = e.receiverType.name;
    const member = e.member;
    const owner: { contains?: readonly ContainmentIR[] } | undefined =
      ctx.aggregates.find((a) => a.name === typeName) ??
      ctx.aggregates.flatMap((a) => a.parts ?? []).find((p) => p.name === typeName);
    const c = owner?.contains?.find((x) => x.name === member);
    if (c && !c.collection) return true;
  }
  return false;
}

export function renderTestExpr(
  e: ExprIR,
  ctx: BoundedContextIR,
  lets?: Map<string, string>,
): string {
  const service = withServiceMoneyArgs(e, ctx);
  if (service !== e) return renderTestExpr(service, ctx, lets);
  // A member read whose RECEIVER is a nullable field (single containment or
  // optional field, both `T | None` on the domain object) fails `mypy --strict`
  // on the follow-on access.  Wrap the receiver in `cast(T, …)` so the read
  // type-checks: `o.shipment.carrier` → `cast(Shipment, o.shipment).carrier`.
  // The op that sets it ran earlier in the test, so the cast is sound.
  if (
    e.kind === "member" &&
    e.receiver.kind === "member" &&
    isNullableMemberReadPy(e.receiver, ctx)
  ) {
    const recv = renderTestExpr(e.receiver, ctx, lets);
    const rt = e.receiver.memberType;
    const inner = rt.kind === "optional" ? rt.inner : rt;
    return `${PY.cast}(${renderPyType(inner)}, ${recv}).${pythonIdent(e.member)}`;
  }
  // Calls of currentUser-gated ops thread the synthetic actor as the
  // trailing argument (mirrors the TS test emitter).  The aggregate
  // resolves through the receiver's type when lowered, else through the
  // let-binding table (bare expression statements lower untyped).
  if (e.kind === "method-call" && !e.isCollectionOp && !e.isIntrinsicMatcher) {
    const aggName =
      e.receiverType.kind === "entity"
        ? e.receiverType.name
        : e.receiver.kind === "ref"
          ? lets?.get(e.receiver.name)
          : undefined;
    const agg = aggName ? ctx.aggregates.find((a) => a.name === aggName) : undefined;
    const op = agg?.operations.find((o) => o.name === e.member);
    if (op) {
      // Coerce each argument to the operation's declared PARAM type — the same
      // rule `create(...)` applies to its create-input fields below.  A bare
      // string in an `X id` position becomes `<X>Id(…)`, an ISO-8601 string in
      // a `datetime` position `datetime.fromisoformat(…)`.  pytest does not
      // typecheck, so passing the literal raw is invisible until the generated
      // project's own `mypy --strict` rejects it — and for `datetime` the value
      // STORED on the aggregate is a `str` where the field is a `datetime`.
      const recv = renderTestExpr(e.receiver, ctx, lets);
      const args = coerceTestArgs(
        op.params,
        e.args,
        (a) => renderTestExpr(a, ctx, lets),
        PY_TEST_LITERAL,
      );
      // A currentUser-reading op's method signature carries a trailing
      // `current_user` parameter; thread the test principal.
      if (operationBodyUsesCurrentUser(op)) args.push(TEST_PRINCIPAL_CALL);
      return `${recv}.${pythonIdent(e.member)}(${args.join(", ")})`;
    }
  }
  if (
    e.kind === "method-call" &&
    e.member === "create" &&
    e.receiver.kind === "ref" &&
    e.args.length === 1 &&
    e.args[0]!.kind === "object"
  ) {
    const agg = ctx.aggregates.find((a) => a.name === (e.receiver as { name: string }).name);
    if (agg) {
      return `${pyRef(`app.domain.${snake(agg.name)}`, agg.name)}.create(${renderCreateInput(e.args[0] as Extract<ExprIR, { kind: "object" }>, agg, ctx)})`;
    }
  }
  return renderPyExpr(e);
}

export function renderCreateInput(
  obj: Extract<ExprIR, { kind: "object" }>,
  agg: AggregateIR,
  ctx: BoundedContextIR,
): string {
  const declared = new Map(createInputFields(agg).map((f) => [f.name, f.type] as const));
  // Emit EXACTLY the fields the test author wrote.
  //
  // Filling each omission from the create-input set would make the assertion
  // vacuous: `test "an omitted default is applied at construction"` writes
  // `Item.create(name="N")` and checks `qty == 1`, and the fill would emit
  // `Item.create(name="N", qty=1, …)`, passing the value it then asserts.
  //
  // The factory defaults omittable inputs itself (`factoryDefault` in
  // emit/aggregate.ts), so the omission both type-checks AND exercises the
  // domain rule under test.
  return obj.fields
    .map((f) => {
      const t = declared.get(f.name);
      return `${pythonIdent(f.name)}=${t === undefined ? renderPyExpr(f.value) : coerceCreateValue(f.value, t, ctx)}`;
    })
    .join(", ");
}

/** Coerce one create-input value to its declared type for a domain test —
 *  the shared rule (`_test/arg-coercion.ts`): VO literal → positional ctor,
 *  `X id` / date / datetime literal → its strong type. */
function coerceCreateValue(value: ExprIR, type: TypeIR | undefined, ctx: BoundedContextIR): string {
  return coerceTestValue(type, value, ctx, (e) => renderTestExpr(e, ctx), PY_TEST_LITERAL);
}

/** Python's operator for each relation. */
const PY_RELATION_OP: Readonly<Record<AssertionRelation, string>> = {
  eq: "==",
  gt: ">",
  ge: ">=",
  lt: "<",
  le: "<=",
};

/** One comparison: `Decimal`, `datetime`, `date`, dataclasses and lists all
 *  compare by value under Python's own operators, once the expected literal is
 *  built at the subject's type. */
function pyCompare({ relation, negate, optional, actual, expected }: CompareOperands): string {
  const cmp = `${actual} ${PY_RELATION_OP[relation]} ${expected}`;
  // An ordering over a subject that may be `None` narrows it first, so the
  // comparison type-checks under `mypy --strict`; an absent subject fails the
  // assertion either way.
  if (optional && relation !== "eq") {
    return `    assert ${actual} is not None and ${negate ? `not (${cmp})` : cmp}`;
  }
  return negate ? `    assert not (${cmp})` : `    assert ${cmp}`;
}

/** pytest leaves for the shared assertion plan. */
const PYTEST_ASSERTIONS: AssertionTarget = {
  compare: {
    scalar: pyCompare,
    decimal: pyCompare,
    instant: pyCompare,
    date: pyCompare,
    structural: pyCompare,
    sequence: pyCompare,
  },
  // `is None` rather than `== None`: identity cannot be intercepted by a
  // `__eq__` on a value-object subject.
  isNull: (negate, actual) =>
    negate ? `    assert ${actual} is not None` : `    assert ${actual} is None`,
  // Python's `in` covers element membership and substring, with the operands
  // in the opposite order to every other matcher (`needle in haystack`).
  contain: (_within, negate, actual, expected) =>
    negate ? `    assert ${expected} not in ${actual}` : `    assert ${expected} in ${actual}`,
  literal: PY_TEST_LITERAL,
};

/** `expect(x).<matcher>(y)` / `.not.<matcher>(y)` → a comparison assert, or
 *  null for a bare boolean assertion, which the caller wraps. */
export function renderExplicitMatcher(
  expr: ExprIR,
  ctx: BoundedContextIR,
  lets?: Map<string, string>,
): string | null {
  return renderAssertion(expr, PYTEST_ASSERTIONS, {
    // Python CHAINS comparisons: `a == b == True` parses as
    // `(a == b) and (b == True)`, so a subject that is itself a comparison is
    // parenthesized.
    renderSubject: (e) => {
      const rendered = renderTestExpr(e, ctx, lets);
      const chains =
        e.kind === "binary" && ["==", "!=", "<", "<=", ">", ">=", "&&", "||"].includes(e.op);
      return chains ? `(${rendered})` : rendered;
    },
    renderExpected: (e) => renderTestExpr(e, ctx, lets),
  });
}

export function renderTestStmt(
  s: TestStmtIR,
  ctx: BoundedContextIR,
  lets?: Map<string, string>,
): string[] {
  if (s.kind === "expect") {
    const explicit = renderExplicitMatcher(s.expr, ctx, lets);
    if (explicit) return [explicit];
    return [`    assert ${renderTestExpr(s.expr, ctx, lets)}`];
  }
  if (s.kind === "expect-throws") {
    const call = `        ${renderTestExpr(s.expr, ctx, lets)}`;
    // `toThrow(<kind>)` — catch the `DomainError` (a value object's
    // `ValueObjectInvariantError` subclasses it) and assert its structural
    // `kind`, never its message, which a rule's own text replaces.
    // `rejected` is rebound by each assertion, so several in one test body
    // don't collide.
    if (s.throwKind) {
      return [
        `    with ${PYTEST}.raises(${PY.DomainError}) as rejected:`,
        call,
        `    assert rejected.value.kind == ${JSON.stringify(s.throwKind)}, str(rejected.value)`,
      ];
    }
    return [`    with ${PYTEST}.raises(${DOMAIN_REJECTION_TUPLE}):`, call];
  }
  if (s.kind === "let") {
    return [`    ${escapePythonIdent(snake(s.name))} = ${renderTestExpr(s.expr, ctx, lets)}`];
  }
  if (s.kind === "call") {
    const args = s.args.map((a) => renderTestExpr(a, ctx, lets)).join(", ");
    return [`    ${snake(s.name)}(${args})`];
  }
  if (s.kind === "expression") {
    return [`    ${renderTestExpr(s.expr, ctx, lets)}`];
  }
  // Mutating kinds are validator-rejected before they reach the
  // generator — same contract as the TS emitter.
  throw new Error(
    `internal: aggregate test body contains '${s.kind}' which the IR validator should have rejected`,
  );
}
