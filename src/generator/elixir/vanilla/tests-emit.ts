import type {
  AggregateIR,
  DomainServiceIR,
  EnrichedAggregateIR,
  ExprIR,
  OperationIR,
  TestIR,
  TestStmtIR,
  TypeIR,
  ValueObjectIR,
} from "../../../ir/types/loom-ir.js";
import type { ThrowKindName } from "../../../util/intrinsic-matchers.js";
import { elixirString, escapeElixirIdent, snake, upperFirst } from "../../../util/naming.js";
import { elixirCodePointLength } from "../../_expr/code-point.js";
import { coerceTestLiteral, type TestLiteralTarget } from "../../_test/arg-coercion.js";
import { opUsesCurrentUser } from "../domain/predicates.js";
import { appModuleOf, guardErrorModule } from "./denial.js";
import { pureDerivedAccessorNames } from "./domain-core-emit.js";

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
};

// ---------------------------------------------------------------------------
// Vanilla (Ecto/Phoenix) domain `test "..."` → runnable ExUnit, ported 1:1 from
// the Loom test idiom onto the aggregate's PURE DOMAIN CORE (domain-core-emit.ts):
//
//   let p = Agg.create({...})            →  {:ok, p} = Agg.create(%{...})
//   expect(Agg.create({bad})).toThrow()  →  assert {:error, _} = Agg.create(%{...})
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
}

const MATCHER_OP: Record<string, string> = {
  toBe: "==",
  toBeGreaterThan: ">",
  toBeGreaterThanOrEqual: ">=",
  toBeLessThan: "<",
  toBeLessThanOrEqual: "<=",
};

/** Decimal comparison tail per matcher — `Decimal.compare/2` returns
 *  `:lt | :eq | :gt`, scale-insensitive (unlike `==` on `%Decimal{}`). */
const MONEY_CMP: Record<string, string> = {
  toBeGreaterThan: "== :gt",
  toBeGreaterThanOrEqual: "in [:gt, :eq]",
  toBeLessThan: "== :lt",
  toBeLessThanOrEqual: "in [:lt, :eq]",
};

// A synthetic privileged actor threaded into a currentUser-gated op call in a
// domain test (the pure-core fn gained a trailing `current_user \\ nil` arg —
// §11d).  A bare test block has no auth context, so without this the guard reads
// a nil actor (`nil.role` → BadMapError, not the ArgumentError a `requires`
// raises) and the test mis-fails.  Mirror of node's `TEST_ACTOR` (emit/tests.ts):
// a map satisfying the common guard fields (role/permissions/id) — Elixir `.field`
// access works on a plain map, so no `%User{}` struct is needed.
const TEST_ACTOR =
  '%{id: "00000000-0000-0000-0000-000000000000", role: "admin", permissions: ["*"]}';

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
    "  # See docs/audits/test-parity-generated-backends.md.",
    "  :ok",
  ];
}

export function renderVanillaAggregateTestModule(
  agg: AggregateIR,
  contextModule: string,
  appModule: string,
  validatableVos: Set<string>,
): string {
  const env: Env = {
    agg,
    aggMod: `${contextModule}.${upperFirst(agg.name)}`,
    ctxModule: contextModule,
    appModule,
    validatableVos,
    derivedAccessors: pureDerivedAccessorNames(contextModule, agg as EnrichedAggregateIR),
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
): string {
  const env: Env = {
    agg: null,
    aggMod: null,
    ctxModule: contextModule,
    appModule,
    validatableVos,
    derivedAccessors: new Set(),
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
): string {
  const env: Env = {
    agg: null,
    aggMod: null,
    ctxModule: contextModule,
    appModule,
    validatableVos,
    derivedAccessors: new Set(),
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

function renderTest(t: TestIR, env: Env): string[] {
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
        return [`{:ok, ${name}} = ${renderCreate(s.expr, env)}`];
      }
      return [`${name} = ${vtExpr(s.expr, env)}`];
    }
    case "expect":
      return [renderExpect(s.expr, env)];
    case "expect-throws":
      return renderThrows(s.expr, env, s.throwKind, index);
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

/** `string?` is still a string for containment; `string[]?` still a list. */
function unwrapOptionalType(t: TypeIR): TypeIR {
  return t.kind === "optional" ? unwrapOptionalType(t.inner) : t;
}

/** The asserted subject's resolved type, with `.not.` peeled.
 *
 *  `receiverType` is the type of the matcher's RECEIVER, and for a negated
 *  assertion that receiver is the synthetic `.not` member rather than the
 *  value under test — so read the type off the `.not` node's own receiverType
 *  in that case, or the dispatch below sees the wrong type. */
function matcherSubjectType(expr: ExprIR & { kind: "method-call" }): TypeIR {
  const recv = expr.receiver;
  return recv.kind === "member" && recv.member === "not" ? recv.receiverType : expr.receiverType;
}

export function renderExpect(expr: ExprIR, env: Env): string {
  if (expr.kind !== "method-call" || !expr.isIntrinsicMatcher) {
    throw new UnsupportedTestShapeError("expect requires a matcher");
  }
  let receiver = expr.receiver;
  let negate = false;
  if (receiver.kind === "member" && receiver.member === "not") {
    negate = true;
    receiver = receiver.receiver;
  }
  const inner = receiver.kind === "paren" ? receiver.inner : receiver;
  const op = MATCHER_OP[expr.member];
  const actual = vtExpr(inner, env);
  const arg = expr.args[0];
  const expected = arg ? vtExpr(arg, env) : "";
  const verb = (s: string): string => (negate ? `refute ${s}` : `assert ${s}`);

  // Absence.  An Elixir struct field that holds nothing holds `nil`, so the
  // language's one absence value is `nil` here.  `is_nil/1` rather than
  // `== nil` keeps the assertion a guard, which ExUnit reports more usefully.
  // (`toBeAbsent` never reaches this emitter — it is e2e-only: a struct
  // ALWAYS carries its declared keys, defaulted to nil, so in-process there is
  // no absent form to observe.)
  if (expr.member === "toBeNull") return verb(`is_nil(${actual})`);

  // Containment — the one backend where the DSL's "two lowerings, chosen by
  // the subject's type" is literally two different function calls.  Elixir has
  // no operator covering both: `in` is membership in an enumerable and would
  // raise `Protocol.UnimplementedError` on a binary, while `String.contains?/2`
  // is substring and would raise `FunctionClauseError` on a list.  Picking the
  // wrong one is a run-time crash in the generated suite, not a wrong answer,
  // so read the SUBJECT'S RESOLVED TYPE off the IR — the same dispatch
  // `checkContainReceiver` validated, which has already refused every third
  // receiver type.
  if (expr.member === "toContain") {
    const t = unwrapOptionalType(matcherSubjectType(expr));
    if (t.kind === "array") return verb(`${expected} in ${actual}`);
    if (t.kind === "primitive" && t.name === "string") {
      return verb(`String.contains?(${actual}, ${expected})`);
    }
    throw new UnsupportedTestShapeError(
      `toContain over a '${t.kind}' subject: elixir spells collection membership and ` +
        "substring as two different calls, and this subject is neither a collection nor " +
        "a string",
    );
  }

  if (!op) throw new UnsupportedTestShapeError(`unsupported value matcher '${expr.member}'`);

  if (isMoneyLike(inner, arg)) {
    if (expr.member === "toBe") return verb(`Decimal.equal?(${actual}, ${expected})`);
    return verb(`Decimal.compare(${actual}, ${expected}) ${MONEY_CMP[expr.member]}`);
  }
  return verb(`${actual} ${op} ${expected}`);
}

function renderThrows(expr: ExprIR, env: Env, kind?: ThrowKindName, index = 0): string[] {
  const inner = expr.kind === "paren" ? expr.inner : expr;
  if (isCreate(inner)) {
    // A failed create returns {:error, changeset}; it does not raise.
    //
    // The changeset IS this backend's invariant floor — `validate_invariants/1`
    // is piped into `base_changeset` (changeset-invariant-emit.ts) — so an
    // `invariant` rung reads honestly here.  A `precondition` does NOT: the
    // pure `create/1` is `base_changeset |> apply_action(:insert)` with no
    // guard in it at all, so there is nothing for that rung to trip.
    if (kind === "precondition") {
      throw new UnsupportedTestShapeError(
        "toThrow(precondition) over a create: the vanilla pure `create/1` applies a " +
          "changeset and runs no guard, so a precondition has no in-memory subject",
      );
    }
    return [`assert {:error, _} = ${renderCreate(inner, env)}`];
  }
  if (inner.kind === "method-call" && isAggOp(inner, env)) {
    // A failed `precondition` / `requires` raises the typed `<App>.GuardError`
    // before any persist.  ONE exception type for both rungs (the `:kind` field
    // separates them) is what lets the BARE assertion stay shape-agnostic — a
    // `toThrow()` expression doesn't say which rung the op will trip.
    const guardError = guardErrorModule(appModuleOf(env.ctxModule));
    const raises = `assert_raise ${guardError}, fn -> ${renderOp(inner, env)} end`;
    if (kind === "invariant") {
      // Unlike the other four backends, the vanilla pure op core does NOT run
      // the invariant floor: `complete/2` is preconditions plus an in-memory
      // struct update, and the aggregate's invariants live in the Ecto
      // changeset, which only the PERSISTENCE path pipes through.  So an
      // `invariant` rung has no in-memory subject on this backend — say so
      // through the established seam rather than emitting an assertion that
      // can only fail, or one that passes for the wrong reason.
      throw new UnsupportedTestShapeError(
        "toThrow(invariant) over an aggregate operation: the vanilla pure op core runs " +
          "preconditions only — aggregate invariants are enforced in the Ecto changeset " +
          "(`validate_invariants/1`), which no in-memory op call reaches",
      );
    }
    if (kind === "precondition") {
      // THE structural form, and the reason this backend needs no message
      // prefix: `GuardError` is `defexception [:message, :kind]`, so the rung
      // is a field rather than a substring an authored `message` could erase.
      const bound = `__thrown${index}`;
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
    // A value object declares `invariant`s and nothing else — it has no
    // operation body, so no `precondition` can exist for that rung to name.
    if (kind === "precondition") {
      throw new UnsupportedTestShapeError(
        "toThrow(precondition) over a value-object construction: a value object declares " +
          "invariants only, so there is no precondition to trip",
      );
    }
    const voMod = `${env.ctxModule}.${upperFirst(inner.name)}`;
    return [`assert {:error, _} = ${voMod}.new(${vtExpr(inner, env)})`];
  }
  throw new UnsupportedTestShapeError(
    "toThrow over a non-create/op/validatable-VO expression is not runnable on vanilla",
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
      return e.refKind === "enum-value" ? `:${e.name}` : snake(e.name);
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
  const arg = e.args[0];
  const attrs =
    arg && arg.kind === "object"
      ? `%{${arg.fields.map((f) => `${snake(f.name)}: ${vtExpr(f.value, env)}`).join(", ")}}`
      : "%{}";
  // `Agg.create(...)` — the receiver is the bare aggregate ref; honour its name.
  const mod =
    e.receiver.kind === "ref" ? `${env.ctxModule}.${upperFirst(e.receiver.name)}` : env.aggMod;
  return `${mod}.create(${attrs})`;
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
          vtExpr(a, env),
          EX_TEST_LITERAL,
        )}`,
    )
    .join(", ");
  // A currentUser-gated op's pure-core fn carries a trailing `current_user`
  // (§11d); thread a synthetic privileged actor so the guard runs (parity with
  // node's test emitter).  Ungated ops are byte-identical.
  const actor = opUsesCurrentUser(op) ? `, ${TEST_ACTOR}` : "";
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

function isMoneyLike(inner: ExprIR, arg: ExprIR | undefined): boolean {
  const memberMoney =
    inner.kind === "member" &&
    inner.memberType.kind === "primitive" &&
    (inner.memberType.name === "money" || inner.memberType.name === "decimal");
  const argMoney = arg?.kind === "literal" && (arg.lit === "money" || arg.lit === "decimal");
  return Boolean(memberMoney || argMoney);
}

function usedRefNames(statements: readonly TestStmtIR[]): Set<string> {
  const used = new Set<string>();
  const collect = (e: ExprIR): void => {
    if (e.kind === "ref") used.add(e.name);
    for (const c of childExprs(e)) collect(c);
  };
  for (const s of statements) {
    for (const e of stmtExprs(s)) collect(e);
  }
  return used;
}

function stmtExprs(s: TestStmtIR): ExprIR[] {
  if (s.kind === "expect" || s.kind === "expect-throws" || s.kind === "let") return [s.expr];
  if (s.kind === "expression") return [s.expr];
  if (s.kind === "call") return s.args;
  return [];
}

function childExprs(e: ExprIR): ExprIR[] {
  switch (e.kind) {
    case "member":
      return [e.receiver];
    case "method-call":
      return [e.receiver, ...e.args];
    case "call":
      return e.args;
    case "new":
    case "object":
      return e.fields.map((f) => f.value);
    case "paren":
      return [e.inner];
    case "unary":
      return [e.operand];
    case "binary":
      return [e.left, e.right];
    case "ternary":
      return [e.cond, e.then, e.otherwise];
    case "convert":
      return [e.value];
    case "list":
      return e.elements;
    default:
      return [];
  }
}
