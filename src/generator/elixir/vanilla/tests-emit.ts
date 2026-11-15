import { type AssertionRelation, assertionPlan } from "../../../ir/plan/test-assertion.js";
import {
  type TestPrincipalShape,
  testPrincipal,
  testPrincipalShape,
} from "../../../ir/plan/test-principal.js";
import {
  FLOOR_RUNGS,
  type RejectionPlan,
  rejectionNeedsInvariant,
  rejectionPlan,
} from "../../../ir/plan/test-rejection.js";
import type {
  AggregateIR,
  DomainServiceIR,
  EnrichedAggregateIR,
  EnumIR,
  ExprIR,
  FieldIR,
  OperationIR,
  TestIR,
  TestStmtIR,
  ValueObjectIR,
} from "../../../ir/types/loom-ir.js";
import { walkExprDeep } from "../../../ir/util/walk.js";
import type { ThrowKindName } from "../../../util/intrinsic-matchers.js";
import { elixirString, escapeElixirIdent, snake, upperFirst } from "../../../util/naming.js";
import { elixirCodePointLength } from "../../_expr/code-point.js";
import { coerceTestLiteral, type TestLiteralTarget } from "../../_test/arg-coercion.js";
import { type AssertionTarget, renderAssertionPlan } from "../../_test/assertion-target.js";
import { type PrincipalTarget, renderTestPrincipal } from "../../_test/principal-target.js";
import { opUsesCurrentUser } from "../domain/predicates.js";
import { renderExpr, valueObjectFunctionCall } from "../render-expr.js";
import { appModuleOf, guardErrorModule } from "./denial.js";
import { pureDerivedAccessorNames } from "./domain-core-emit.js";
import { isValueObjectType, renderValueObjectEquality } from "./value-object-type-emit.js";

/** Elixir leaves for the shared test-literal coercion rule
 *  (`_test/arg-coercion.ts`).
 *
 *  `id` is IDENTITY on this backend: an aggregate id is an Ecto `:binary_id`,
 *  whose runtime representation IS the uuid string — there is no brand or
 *  wrapper type to construct, so the raw literal is already correct.
 *
 *  `datetime` is not: the column is `:utc_datetime`, which wants a
 *  `%DateTime{}`.  `elem(DateTime.from_iso8601(…), 1)` is the same conversion
 *  `channels-emit.ts` already uses for ISO-8601 wire text. */
const EX_TEST_LITERAL: TestLiteralTarget = {
  id: (rendered) => rendered,
  datetime: (rendered) => `elem(DateTime.from_iso8601(${rendered}), 1)`,
  date: (rendered) => `Date.from_iso8601!(${rendered})`,
  money: (digits) => renderExpr({ kind: "literal", lit: "money", value: digits }),
};

// ---------------------------------------------------------------------------
// Vanilla (Ecto/Phoenix) domain `test "..."` → runnable ExUnit, ported 1:1 from
// the Loom test idiom onto the aggregate's PURE DOMAIN CORE (domain-core-emit.ts):
//
//   let p = Agg.create(...)              →  {:ok, p} = Agg.create(%{...})
//   expect(Agg.create(bad)).toThrow()    →  assert {:error, _} = Agg.create(%{...})
//   p.op(x)                              →  p = Agg.op(p, %{"x" => ...})  (threads state)
//   expect(p.op(bad)).toThrow()          →  assert_raise ArgumentError, fn -> Agg.op(p, %{...}) end
//   expect(p.field).toBe(v)              →  assert p.field == v   (money/decimal via Decimal)
//
// All DB-free: `create/1` runs `apply_action` (validations, no Repo); an op core
// raises its precondition before any persist and mutates the struct in memory.
// Verified end-to-end against a generated project (`mix test`, no database).
//
// Operation calls are recognised by NAME (the aggregate's declared operations),
// not by `receiverType` — a `let p = Agg.create(...)` binding is only weakly
// typed in test position, so the receiver type can't be trusted.
//
// A value-object construction invariant (`expect(Money{ amount: -1 }).toThrow()`)
// lowers to the VO's validating constructor — `assert {:error, _} =
// Money.new(%{…})` (F5; valueobject-emit.ts) — when the VO declares an invariant.
// Anything this renderer still can't faithfully lower (a VO with no invariant,
// an unexpected shape) is emitted as a documented `@tag :skip`, never broken Elixir.
// ---------------------------------------------------------------------------

export interface Env {
  /** The aggregate under test, or `null` for a value-object / domain-service
   *  subject (test-placement.md) — those have no aggregate identity, so
   *  the agg-op / create paths are inert. */
  agg: AggregateIR | null;
  /** Fully-qualified module of the aggregate under test, e.g. `App.Ctx.Order`;
   *  `null` for a non-aggregate subject. */
  aggMod: string | null;
  /** Bounded-context module prefix, e.g. `App.Ctx`. */
  ctxModule: string;
  /** Application root module, e.g. `App` — used to address a `domainService`
   *  module (`App.Domain.Services.<Name>`) from a service test. */
  appModule: string;
  /** Value objects that have a validating constructor (`<VO>.new/1`, F5) — only
   *  these can lower a `expect(VO{bad}).toThrow()` to `assert {:error, _} =
   *  <VO>.new(…)`; a VO without invariants has no module, so such a test skips. */
  validatableVos: Set<string>;
  /** Aggregate `derived` fields exposed as a pure-core accessor
   *  (`Agg.<derived>(record)`) — B18.  A derived read routes to the accessor when
   *  its name is here; a derived NOT here has no pure accessor (non-relational or
   *  non-pure expression), so reading it degrades to `@tag :skip`. */
  derivedAccessors: Set<string>;
  /** The context's `persistedAs: eventLog` aggregates → their canonical
   *  `create` (absent when the aggregate declares none).  An event-sourced pure
   *  `create/1` runs THAT command (`domain-core-emit.ts`), so whether a failed
   *  create is observable, and whether it needs an actor, is read off it. */
  esCreates?: ReadonlyMap<string, OperationIR | undefined>;
  /** The context's `shape: document` aggregates.  Their pure core's record is
   *  the `<Agg>.Data` embed, which stores an enum as its declared-case STRING
   *  (not the `Ecto.Enum` atom the relational struct holds). */
  docAggs?: ReadonlySet<string>;
  /** The test principal a currentUser-reading op call takes. */
  principal?: string;
  /** Test-local names bound to a document aggregate's record, collected while a
   *  test renders (`let d = Doc.create(…)`), so a later read or op call on `d`
   *  speaks the embed's string enums. */
  docVars?: Set<string>;
  /** Render enum values as strings (inside a document record's attrs/reads). */
  enumAsString?: boolean;
}

/** Elixir spelling of the shared test principal (`testPrincipal`,
 *  src/ir/plan/test-principal.ts): a map of every declared claim, which is the
 *  shape `.field` access on the actor reads and `as_principal/1` takes. */
export const EX_PRINCIPAL: PrincipalTarget = {
  text: (v) => elixirString(v),
  guid: (v) => elixirString(v),
  // An id is an Ecto `:binary_id`, whose runtime value is the uuid string.
  id: (_targetName, v) => elixirString(v),
  int: "0",
  decimal: () => `Decimal.new("0")`,
  bool: "false",
  datetime: "~U[1970-01-01 00:00:00Z]",
  date: "~D[1970-01-01]",
  enumMember: (_name, member) => elixirString(member),
  list: (_element, items) => `[${items.join(", ")}]`,
  absent: "nil",
  record: (claims) => `%{${claims.map((c) => `${snake(c.field.name)}: ${c.rendered}`).join(", ")}}`,
};

/** The test principal a currentUser-reading op call in a unit test takes. */
export function exTestPrincipal(
  user: TestPrincipalShape | undefined,
  enums: readonly EnumIR[],
): string {
  return renderTestPrincipal(
    testPrincipal(user ?? testPrincipalShape(undefined), undefined, enums),
    EX_PRINCIPAL,
  );
}

/** A domain `test` shape the vanilla ExUnit emitter deliberately cannot lower to
 *  the pure domain core — an unsupported matcher/statement/expression, or a
 *  `toThrow` over a non-create/op/validatable-VO expression. This is the ONLY
 *  error class that degrades a test to `@tag :skip`; every other throw is a real
 *  emitter bug and must propagate loudly rather than masquerade as an
 *  "unsupported shape" skip that leaves `behavioral-e2e-elixir` green while the
 *  domain suite silently shrinks. Carries a one-line reason surfaced both in the
 *  emitted skip comment and to the no-silent-skip conformance gate
 *  (test/conformance/elixir-domain-test-no-silent-skip.test.ts). */
export class UnsupportedTestShapeError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnsupportedTestShapeError";
  }
}

/** The `@tag :skip` body, carrying the concrete reason so a human reading the
 *  generated file (and the conformance gate) sees WHY the port degraded. */
function skipBody(reason: string): string[] {
  return [
    "  # Skipped on vanilla Elixir: this emitter can't lower the test to the pure",
    `  # domain core.  Reason: ${reason}`,
    "  :ok",
  ];
}

/** The per-context shape facts a unit-test body needs to reach a SIBLING
 *  aggregate's pure core (`Env.esCreates` / `Env.docAggs`). */
export interface ShapeFacts {
  esCreates: ReadonlyMap<string, OperationIR | undefined>;
  docAggs: ReadonlySet<string>;
  /** The test principal (`exTestPrincipal`) a currentUser-reading op call
   *  takes as its trailing argument. */
  principal?: string;
}

export function renderVanillaAggregateTestModule(
  agg: AggregateIR,
  contextModule: string,
  appModule: string,
  validatableVos: Set<string>,
  shapes?: ShapeFacts,
): string {
  const env: Env = {
    agg,
    aggMod: `${contextModule}.${upperFirst(agg.name)}`,
    ctxModule: contextModule,
    appModule,
    validatableVos,
    derivedAccessors: pureDerivedAccessorNames(contextModule, agg as EnrichedAggregateIR),
    ...shapes,
  };
  return renderSubjectTestModule(agg.name, agg.tests, contextModule, env);
}

/** Value-object test module (test-placement.md) — no aggregate
 *  identity; the invariant-throw path (`<VO>.new/1`) is what these exercise. */
export function renderVanillaVoTestModule(
  vo: ValueObjectIR,
  contextModule: string,
  appModule: string,
  validatableVos: Set<string>,
  shapes?: ShapeFacts,
): string {
  const env: Env = {
    agg: null,
    aggMod: null,
    ctxModule: contextModule,
    appModule,
    validatableVos,
    derivedAccessors: new Set(),
    ...shapes,
  };
  return renderSubjectTestModule(vo.name, vo.tests, contextModule, env);
}

/** Domain-service test module (test-placement.md) — exercises the
 *  service's PURE ops via `App.Domain.Services.<Name>.<op>(…)`. */
export function renderVanillaServiceTestModule(
  svc: DomainServiceIR,
  contextModule: string,
  appModule: string,
  validatableVos: Set<string>,
  shapes?: ShapeFacts,
): string {
  const env: Env = {
    agg: null,
    aggMod: null,
    ctxModule: contextModule,
    appModule,
    validatableVos,
    derivedAccessors: new Set(),
    ...shapes,
  };
  return renderSubjectTestModule(svc.name, svc.tests, contextModule, env);
}

/** The shared ExUnit module shell for any subject — `defmodule
 *  <Ctx>.<Name>Test`, one `test` per block (or a `@tag :skip` for a shape the
 *  vanilla renderer can't lower). */
function renderSubjectTestModule(
  name: string,
  tests: readonly TestIR[],
  contextModule: string,
  env: Env,
): string {
  const blocks = tests.map((t) => renderTest(t, env));
  const body = blocks.flatMap((block) => ["", ...block.map((l) => (l === "" ? "" : `  ${l}`))]);
  return `# Auto-generated.  Do not edit by hand.
defmodule ${contextModule}.${upperFirst(name)}Test do
  use ExUnit.Case, async: true${body.length > 0 ? `\n${body.join("\n")}` : ""}
end
`;
}

function renderTest(t: TestIR, outer: Env): string[] {
  const env: Env = { ...outer, docVars: new Set() };
  try {
    const used = usedRefNames(t.statements);
    const lines = t.statements.flatMap((s, i) => renderStmt(s, env, used, i));
    return [`test ${elixirString(t.name)} do`, ...lines.map((l) => `  ${l}`), "end"];
  } catch (err) {
    // ONLY a deliberate "can't lower this shape" signal degrades to a skip
    // (VO-construction invariants, VO instance methods, exotic shapes) — never
    // broken Elixir. Any OTHER error is a real emitter bug and propagates: it
    // would otherwise be swallowed as a benign skip and pass CI green.
    if (!(err instanceof UnsupportedTestShapeError)) throw err;
    return ["@tag :skip", `test ${elixirString(t.name)} do`, ...skipBody(err.message), "end"];
  }
}

function renderStmt(s: TestStmtIR, env: Env, used: Set<string>, index = 0): string[] {
  switch (s.kind) {
    case "let": {
      const name = used.has(s.name) ? escapeElixirIdent(snake(s.name)) : `_${snake(s.name)}`;
      if (isCreate(s.expr)) {
        // A bound create is the happy path → bind the {:ok, _} struct.
        const line = `{:ok, ${name}} = ${renderCreate(s.expr, env)}`;
        if (env.docAggs?.has(createTarget(s.expr) ?? "")) env.docVars?.add(s.name);
        return [line];
      }
      return [`${name} = ${vtExpr(s.expr, env)}`];
    }
    case "expect":
      return [renderExpect(s.expr, env)];
    case "expect-throws": {
      const plan = rejectionPlan(s);
      return renderThrows(plan.call, env, plan.accepts === "rung" ? plan.rung : undefined, index);
    }
    case "expression": {
      // A bare operation call is state-threading setup: `p.confirm()` →
      // rebind the receiver to the returned (mutated) struct.
      if (s.expr.kind === "method-call" && isAggOp(s.expr, env)) {
        return [`${vtExpr(s.expr.receiver, env)} = ${renderOp(s.expr, env)}`];
      }
      return [vtExpr(s.expr, env)];
    }
    case "call":
      return [`${snake(s.name)}(${s.args.map((a) => vtExpr(a, env)).join(", ")})`];
    default:
      // assign / add / remove / return etc. don't appear at test top-level.
      throw new UnsupportedTestShapeError(`unsupported test statement '${s.kind}'`);
  }
}

/** `Decimal.compare/2`, `DateTime.compare/2` and `Date.compare/2` answer
 *  `:lt | :eq | :gt`; the tail each relation asserts on that answer. */
const COMPARE_TAIL: Readonly<Record<AssertionRelation, string>> = {
  eq: "== :eq",
  gt: "== :gt",
  ge: "in [:gt, :eq]",
  lt: "== :lt",
  le: "in [:lt, :eq]",
};

const EX_RELATION_OP: Readonly<Record<AssertionRelation, string>> = {
  eq: "==",
  gt: ">",
  ge: ">=",
  lt: "<",
  le: "<=",
};

const exVerb = (negate: boolean, s: string): string => (negate ? `refute ${s}` : `assert ${s}`);

/** ExUnit leaves for the shared assertion plan.  `==` on a `%Decimal{}` is
 *  scale-sensitive and `<`/`>` on a `%DateTime{}` or `%Date{}` is structural
 *  term order, so those compare through their modules' `compare/2`.  A record
 *  or list compares through the app's value equality, which normalizes every
 *  decimal and instant inside it. */
const EXUNIT_ASSERTIONS: AssertionTarget = {
  compare: {
    scalar: ({ relation, negate, actual, expected }) =>
      exVerb(negate, `${actual} ${EX_RELATION_OP[relation]} ${expected}`),
    decimal: ({ relation, negate, actual, expected }) =>
      exVerb(
        negate,
        relation === "eq"
          ? `Decimal.equal?(${actual}, ${expected})`
          : `Decimal.compare(${actual}, ${expected}) ${COMPARE_TAIL[relation]}`,
      ),
    instant: ({ relation, negate, actual, expected }) =>
      exVerb(negate, `DateTime.compare(${actual}, ${expected}) ${COMPARE_TAIL[relation]}`),
    date: ({ relation, negate, actual, expected }) =>
      exVerb(negate, `Date.compare(${actual}, ${expected}) ${COMPARE_TAIL[relation]}`),
    structural: ({ negate, actual, expected }) =>
      exVerb(negate, renderValueObjectEquality("==", actual, expected)),
    sequence: ({ negate, actual, expected }) =>
      exVerb(negate, renderValueObjectEquality("==", actual, expected)),
  },
  // A struct field that holds nothing holds `nil`.  `is_nil/1` keeps the
  // assertion a guard, which ExUnit reports more usefully than `== nil`.
  isNull: (negate, actual) => exVerb(negate, `is_nil(${actual})`),
  // Elixir has no operator covering both lowerings: `in` is membership in an
  // enumerable (it raises on a binary) and `String.contains?/2` is substring
  // (it raises on a list), so the plan's subject kind picks the call.
  contain: (within, negate, actual, expected) =>
    exVerb(
      negate,
      within === "string" ? `String.contains?(${actual}, ${expected})` : `${expected} in ${actual}`,
    ),
  literal: EX_TEST_LITERAL,
};

export function renderExpect(expr: ExprIR, env: Env): string {
  const plan = assertionPlan(expr);
  if (plan === undefined) throw new UnsupportedTestShapeError("expect requires a matcher");
  return renderAssertionPlan(plan, EXUNIT_ASSERTIONS, {
    renderSubject: (e) => vtExpr(e, env),
    renderExpected: (e) => vtExpr(e, readsDocRecord(plan.subject, env) ? docEnv(env) : env),
  });
}

function renderThrows(expr: ExprIR, env: Env, kind?: ThrowKindName, index = 0): string[] {
  const inner = expr.kind === "paren" ? expr.inner : expr;
  if (isCreate(inner) && env.esCreates?.has(createTarget(inner) ?? "")) {
    // An event-sourced create runs its command and folds its events: a failed
    // `precondition` / `requires` returns `{:error, {:precondition_failed, _}}`,
    // a broken invariant on the folded state `{:error, {:invariant_failed, _}}`.
    const term =
      kind === "precondition"
        ? "{:error, {:precondition_failed, _}}"
        : kind === "invariant"
          ? "{:error, {:invariant_failed, _}}"
          : "{:error, _}";
    return [`assert ${term} = ${renderCreate(inner, env)}`];
  }
  if (isCreate(inner)) {
    // A failed create returns `{:error, _}`; it does not raise.  The changeset
    // is this backend's invariant floor (`{:error, %Ecto.Changeset{}}`), and
    // the pure `create/1` runs the create body's preconditions after it
    // (`{:error, {:precondition_failed, _}}`).
    const term =
      kind === "precondition"
        ? "{:error, {:precondition_failed, _}}"
        : kind === "invariant"
          ? "{:error, %Ecto.Changeset{}}"
          : "{:error, _}";
    return [`assert ${term} = ${renderCreate(inner, env)}`];
  }
  if (inner.kind === "method-call" && isAggOp(inner, env)) {
    // A failed `precondition` / `requires` raises the typed `<App>.GuardError`
    // before any persist.  ONE exception type for both rungs (the `:kind` field
    // separates them) is what lets the BARE assertion stay shape-agnostic — a
    // `toThrow()` expression doesn't say which rung the op will trip.
    const guardError = guardErrorModule(appModuleOf(env.ctxModule));
    const raises = `assert_raise ${guardError}, fn -> ${renderOp(inner, env)} end`;
    // `loom.test-throw-unsupported` refuses an invariant rejection over an
    // operation of a document-shaped aggregate, whose pure core reaches no
    // invariant floor (the `invariant` rung, or a bare `toThrow()` over an op
    // that cannot refuse before its invariants), when it declares one.
    const plan: RejectionPlan = kind
      ? { accepts: "rung", rung: kind, call: inner }
      : { accepts: "floor", rungs: FLOOR_RUNGS, call: inner };
    const document = env.agg !== null && (env.docAggs?.has(env.agg.name) ?? false);
    if (
      document &&
      env.agg !== null &&
      env.agg.invariants.length > 0 &&
      rejectionNeedsInvariant(plan, findOp(inner.member, env), env.agg)
    ) {
      throw unreachableThrowShape(
        "an invariant rejection over an operation of a document-shaped aggregate",
      );
    }
    if (kind !== undefined) {
      // THE structural form, and the reason this backend needs no message
      // prefix: `GuardError` is `defexception [:message, :kind]`, so the rung
      // is a field rather than a substring a rule's own text could erase.
      // The binding is READ on the next line, so it carries no leading
      // underscore: Elixir warns on a used `_`-prefixed variable, and the
      // emitted suite runs under `mix test --warnings-as-errors`.
      const bound = `rejected${index}`;
      return [`${bound} = ${raises}`, `assert ${bound}.kind == :${kind}`];
    }
    return [raises];
  }
  // A value-object construction invariant (F5): `expect(Money{-1}).toThrow()` →
  // the VO's validating constructor returns {:error, _}.  Only VOs that declare
  // an invariant have a `new/1` module; anything else can't be checked in memory.
  if (
    inner.kind === "call" &&
    inner.callKind === "value-object-ctor" &&
    env.validatableVos.has(inner.name)
  ) {
    // A value object declares `invariant`s and nothing else, so a
    // `toThrow(precondition)` over one fails at run time here as on every
    // other backend: its constructor answers `{:error, changeset}`.
    if (kind === "precondition") {
      const voMod = `${env.ctxModule}.${upperFirst(inner.name)}`;
      return [`assert {:error, {:precondition_failed, _}} = ${voMod}.new(${vtExpr(inner, env)})`];
    }
    const voMod = `${env.ctxModule}.${upperFirst(inner.name)}`;
    return [`assert {:error, _} = ${voMod}.new(${vtExpr(inner, env)})`];
  }
  // A domain-service operation raises the typed `GuardError` on a failed
  // precondition, as an aggregate operation does.  Any other expression (a
  // function, arithmetic) cannot be refused by the domain floor on any backend,
  // so the assertion fails at run time here as it does there.
  const guardError = guardErrorModule(appModuleOf(env.ctxModule));
  const raises = `assert_raise ${guardError}, fn -> ${vtExpr(inner, env)} end`;
  if (kind === undefined) return [raises];
  const bound = `rejected${index}`;
  return [`${bound} = ${raises}`, `assert ${bound}.kind == :${kind}`];
}

/** A `toThrow` shape the pure domain core cannot observe.
 *  `loom.test-throw-unsupported` refuses every model that would reach one, so
 *  reaching it is an emitter bug, never a skipped test. */
function unreachableThrowShape(what: string): Error {
  return new Error(
    `internal: ${what} reached the Elixir test emitter; loom.test-throw-unsupported refuses it`,
  );
}

// ---------------------------------------------------------------------------
// Expression rendering
// ---------------------------------------------------------------------------

/** Render a test-position expression to Elixir, with money/decimal literals
 *  coerced to `Decimal` and aggregate `create`/op calls routed to the pure
 *  domain core. */
export function vtExpr(e: ExprIR, env: Env): string {
  switch (e.kind) {
    case "literal":
      return renderLiteral(e.lit, e.value);
    case "ref":
      // An enum value is the DECLARED-case atom (`:Public`) — matches the
      // `Ecto.Enum` field's loaded form for assertions AND casts cleanly when
      // passed in a create-attrs map.  Locals are snake names.  (Value names are
      // grammar identifiers, so the atom is never quoted — `:"Public"` would warn.)
      if (e.refKind === "enum-value")
        return env.enumAsString ? JSON.stringify(e.name) : `:${e.name}`;
      return snake(e.name);
    case "member": {
      const recv = vtExpr(e.receiver, env);
      if (e.receiverType.kind === "array" && (e.member === "count" || e.member === "length")) {
        return `Enum.count(${recv})`;
      }
      if (
        e.receiverType.kind === "primitive" &&
        e.receiverType.name === "string" &&
        e.member === "length"
      ) {
        // CODE POINTS, matching the runtime renderer (`render-expr.ts`) and the
        // published `minLength`/`maxLength` — `String.length/1` counts graphemes.
        return elixirCodePointLength(recv);
      }
      // A derived-field read has no struct field on elixir — route it to the
      // pure-core accessor `Agg.<derived>(record)` (B18) when the receiver is the
      // aggregate itself.  A derived without a pure accessor (non-pure expression)
      // can't be read in a domain test → skip honestly.
      if (e.receiver.kind === "ref" && env.agg?.derived.some((d) => d.name === e.member)) {
        if (!env.derivedAccessors.has(e.member)) {
          throw new UnsupportedTestShapeError(
            `derived '${e.member}' has no pure accessor on vanilla (its expression isn't purely renderable)`,
          );
        }
        return `${env.aggMod}.${snake(e.member)}(${recv})`;
      }
      return `${recv}.${snake(e.member)}`;
    }
    case "method-call": {
      if (isCreate(e)) return renderCreate(e, env);
      if (isAggOp(e, env)) return renderOp(e, env);
      // `xs.first()` over a collection — the head, raising on an empty list like
      // the runtime renderer's `hd/1` (a domain test reading a contained part).
      if (e.receiverType.kind === "array" && e.member === "first" && e.args.length === 0) {
        return `hd(${vtExpr(e.receiver, env)})`;
      }
      if (e.receiverType.kind === "valueobject") {
        return valueObjectFunctionCall(
          env.ctxModule,
          e.receiverType.name,
          e.member,
          vtExpr(e.receiver, env),
          e.args.map((a) => vtExpr(a, env)),
        );
      }
      throw new UnsupportedTestShapeError(
        `unsupported method-call '${e.member}' in vanilla test position`,
      );
    }
    case "call":
      // A value-object constructor builds a plain map on vanilla.
      if (e.callKind === "value-object-ctor") {
        const names = e.argNames ?? [];
        const fields = e.args
          .map((a, i) => `${snake(names[i] ?? `f${i}`)}: ${vtExpr(a, env)}`)
          .join(", ");
        return `%{${fields}}`;
      }
      if (e.callKind === "free") {
        return `${snake(e.name)}(${e.args.map((a) => vtExpr(a, env)).join(", ")})`;
      }
      // A `domainService` op call — the pure module fn `App.Domain.Services.<Name>.<op>(…)`
      // (parity with the main elixir render-expr's `domainServiceCall`).  Lets a
      // service unit test exercise its PURE ops (reading ops have no standalone
      // module fn — they skip like an unsupported shape).
      if (e.callKind === "domain-service" && e.serviceRef) {
        const ref = e.serviceRef;
        return `${env.appModule}.Domain.Services.${upperFirst(ref.service)}.${snake(ref.op)}(${e.args
          .map((a) => vtExpr(a, env))
          .join(", ")})`;
      }
      throw new UnsupportedTestShapeError(
        `unsupported call kind '${e.callKind}' in vanilla test position`,
      );
    case "object":
    case "new":
      return `%{${e.fields.map((f) => `${snake(f.name)}: ${vtExpr(f.value, env)}`).join(", ")}}`;
    case "paren":
      return `(${vtExpr(e.inner, env)})`;
    // A list literal (`charges: []` in a create's attrs map).
    case "list":
      return `[${e.elements.map((x) => vtExpr(x, env)).join(", ")}]`;
    case "unary": {
      if (e.op === "!") return `not ${vtExpr(e.operand, env)}`;
      // Fold a negative sign into a money/decimal literal — `-Decimal.new("1.0")`
      // is invalid (unary minus doesn't apply to a %Decimal{} struct).
      if (
        e.operand.kind === "literal" &&
        (e.operand.lit === "money" || e.operand.lit === "decimal")
      ) {
        return `Decimal.new(${JSON.stringify(`-${e.operand.value}`)})`;
      }
      return `-${vtExpr(e.operand, env)}`;
    }
    case "binary":
      // Value-object `==` / `!=` (and `.equals`, which lowers to it) is VALUE
      // equality across the shapes a VO takes — the same leaf the domain
      // renderer uses (`render-expr.ts`).
      if (
        (e.op === "==" || e.op === "!=") &&
        (isValueObjectType(e.leftType) || isValueObjectType(e.rightType))
      ) {
        const eq = renderValueObjectEquality(e.op, vtExpr(e.left, env), vtExpr(e.right, env));
        return e.op === "==" ? eq : `(${eq})`;
      }
      return `${vtExpr(e.left, env)} ${binOp(e.op)} ${vtExpr(e.right, env)}`;
    default:
      throw new UnsupportedTestShapeError(
        `unsupported expression kind '${e.kind}' in vanilla test position`,
      );
  }
}

function renderLiteral(lit: string, value: string): string {
  switch (lit) {
    case "money":
    case "decimal":
      return `Decimal.new(${JSON.stringify(value)})`;
    case "string":
    case "datetime":
      // Through the shared escaping funnel — the literal is `.ddd` text spliced
      // into a generated `.exs`, where a raw `#{` interpolates at test compile.
      return elixirString(value);
    case "bool":
      return value;
    case "null":
      return "nil";
    // `now()` — the domain renderer's spelling (render-expr.ts); verbatim it
    // was a bare `now`, an undefined variable in the generated `.exs`.
    case "now":
      return "DateTime.utc_now()";
    default:
      // int / long — emit verbatim.
      return value;
  }
}

function binOp(op: string): string {
  switch (op) {
    case "&&":
      return "and";
    case "||":
      return "or";
    default:
      return op;
  }
}

/** `Agg.create(%{...})` over the create call's object-literal argument. */
function renderCreate(e: ExprIR, env: Env): string {
  if (e.kind !== "method-call") throw new Error("renderCreate: not a method-call");
  const target = createTarget(e);
  // An event-sourced aggregate is constructed by its `create` command; one that
  // declares none is constructed out of band and has no pure `create/1` to call.
  const esCreate = target !== undefined && env.esCreates?.has(target);
  const create = esCreate ? env.esCreates?.get(target) : undefined;
  if (esCreate && !create) {
    throw new UnsupportedTestShapeError(
      `'${target}' is event-sourced and declares no \`create\`, so it has no pure constructor`,
    );
  }
  const attrEnv = target !== undefined && env.docAggs?.has(target) ? docEnv(env) : env;
  const arg = e.args[0];
  const attrs =
    arg && arg.kind === "object"
      ? `%{${arg.fields.map((f) => `${snake(f.name)}: ${vtExpr(f.value, attrEnv)}`).join(", ")}}`
      : "%{}";
  // `Agg.create(...)` — the receiver is the bare aggregate ref; honour its name.
  const mod = target !== undefined ? `${env.ctxModule}.${upperFirst(target)}` : env.aggMod;
  // An event-sourced create whose guard reads `currentUser` takes the actor.
  const actor = create && opUsesCurrentUser(create) ? `, ${env.principal ?? "%{}"}` : "";
  return `${mod}.create(${attrs}${actor})`;
}

/** The aggregate a `<Agg>.create(...)` call constructs (its bare receiver). */
function createTarget(e: ExprIR): string | undefined {
  return e.kind === "method-call" && e.receiver.kind === "ref" ? e.receiver.name : undefined;
}

/** True when `e` reads a field off a test-local bound to a document record. */
function readsDocRecord(e: ExprIR, env: Env): boolean {
  return e.kind === "member" && e.receiver.kind === "ref" && !!env.docVars?.has(e.receiver.name);
}

/** The env a document record's values render in: enums as declared-case strings. */
function docEnv(env: Env): Env {
  return { ...env, enumAsString: true };
}

/** `Agg.<op>(recv, %{"param" => value, ...})` over the pure domain core. */
function renderOp(e: ExprIR, env: Env): string {
  if (e.kind !== "method-call") throw new Error("renderOp: not a method-call");
  // Only reached via `isAggOp` (which requires a resolved agg op), so `agg`/
  // `aggMod` are non-null here — assert for the type checker.
  if (!env.agg || !env.aggMod) throw new Error("renderOp: no aggregate in scope");
  const op = findOp(e.member, env);
  if (!op) throw new Error(`operation '${e.member}' not found on ${env.agg.name}`);
  const recv = vtExpr(e.receiver, env);
  const argEnv = e.receiver.kind === "ref" && env.docVars?.has(e.receiver.name) ? docEnv(env) : env;
  // Coerce each argument to the operation's declared PARAM type via the shared
  // rule (`_test/arg-coercion.ts`).  An op's PURE CORE (the persistence-free
  // entry point this test calls) reads the attrs map and assigns the value
  // STRAIGHT onto the struct — unlike the context wrapper `Core.<op>_<agg>/2`,
  // which coerces the same wire text first.  So a bare ISO-8601 string lands a
  // BINARY in a `:utc_datetime` field.  Nothing but the emitted test calls the
  // pure core, so coercing here closes it; see the PR body for the deeper
  // pure-core/context-wrapper divergence this sits on top of.
  const params = e.args
    .map(
      (a, i) =>
        `${JSON.stringify(op.params[i]?.name ?? `arg${i}`)} => ${coerceTestLiteral(
          op.params[i]?.type,
          a,
          vtExpr(a, argEnv),
          EX_TEST_LITERAL,
        )}`,
    )
    .join(", ");
  // A currentUser-reading op's pure-core fn carries a trailing `current_user`;
  // thread the test principal so the guard runs.
  const actor = opUsesCurrentUser(op) ? `, ${env.principal ?? "%{}"}` : "";
  return `${env.aggMod}.${snake(op.name)}(${recv}, %{${params}}${actor})`;
}

// ---------------------------------------------------------------------------
// Classification + helpers
// ---------------------------------------------------------------------------

function findOp(member: string, env: Env): OperationIR | undefined {
  return env.agg?.operations.find((o) => o.name === member);
}

function isCreate(e: ExprIR): boolean {
  return e.kind === "method-call" && e.member === "create" && !e.isIntrinsicMatcher;
}

/** A call to one of the aggregate's declared operations.  Detected by NAME
 *  (receiver types are unreliable in test position); collection-ops and
 *  intrinsic matchers are excluded. */
function isAggOp(e: ExprIR, env: Env): boolean {
  return (
    e.kind === "method-call" &&
    !e.isCollectionOp &&
    !e.isIntrinsicMatcher &&
    e.member !== "create" &&
    findOp(e.member, env) !== undefined
  );
}

function usedRefNames(statements: readonly TestStmtIR[]): Set<string> {
  const used = new Set<string>();
  for (const s of statements) {
    for (const e of stmtExprs(s)) {
      walkExprDeep(e, (n) => {
        if (n.kind === "ref") used.add(n.name);
      });
    }
  }
  return used;
}

function stmtExprs(s: TestStmtIR): ExprIR[] {
  if (s.kind === "expect" || s.kind === "expect-throws" || s.kind === "let") return [s.expr];
  if (s.kind === "expression") return [s.expr];
  if (s.kind === "call") return s.args;
  return [];
}
