import type { AstNode } from "langium";
import { AstUtils } from "langium";
import type { PrimitiveName, SensitivityTags } from "../ir/types/loom-ir.js";
import { COLLECTION_OP_SIGNATURES, isCollectionOp } from "../util/collection-ops.js";
import { intrinsicsForReceiver } from "../util/intrinsics.js";
import { PRINCIPAL_IS_SYSTEM, PRINCIPAL_ORG_PATH, PRINCIPAL_ROOT_ORG } from "../util/principal.js";
import { durationUnitOf } from "../util/temporal.js";
import {
  isValueObjectEqualsIntrinsic,
  VALUE_OBJECT_EQUALS,
  valueObjectEqualsSignature,
} from "../util/value-object-intrinsics.js";
import type {
  Aggregate,
  BoundedContext,
  Criterion,
  EntityPart,
  EventDecl,
  Expression,
  FunctionDecl,
  Operation,
  Parameter,
  PayloadDecl,
  PolicyDecl,
  PostfixChain,
  PostfixSuffix,
  Property,
  Repository,
  TypeRef,
  ValueObject,
} from "./generated/ast.js";
import {
  isAggregate,
  isBoundedContext,
  isContainment,
  isCriterion,
  isDerivedProp,
  isEntityPart,
  isFindDecl,
  isFunctionDecl,
  isMemberSuffix,
  isModel,
  isNameRef,
  isOperation,
  isPolicyDecl,
  isProperty,
  isRetrieval,
  isRetrievalLiteral,
  isSystem,
  isValueObject,
} from "./generated/ast.js";
import { stdFunction } from "./stdlib.js";
import { PRIMITIVE_FIELDS } from "./typing/primitive-fields.js";
import { typeToString } from "./typing/relations.js";
import { typingFor } from "./typing/shared.js";
import { PAGED_META, type Ty, withTags } from "./typing/ty.js";

// ---------------------------------------------------------------------------
// Type representation
//
// A type here is the single typing pass's `Ty` (`typing/ty.ts`), and the
// relations the validators judge with — equality, assignability,
// comparability, the ternary join, the diagnostic printer — are the pass's
// (`typing/relations.ts`). This module adds the AST-facing lookups the
// validators and the LSP share: environments, member walks, signatures.
// ---------------------------------------------------------------------------

export {
  comparable,
  isAssignable,
  sensitivityNarrows,
  tagsSubset,
  ternaryJoin,
  typesEqual,
  typeToString,
} from "./typing/relations.js";
export { mergeTags, withTags } from "./typing/ty.js";
export type { PrimitiveName, SensitivityTags, Ty };

/** Constructors for the types validators build by hand. A hand-built
 *  `unknown` is a validator standing down, not a typing-pass gap. */
export const T = {
  prim: (name: PrimitiveName): Ty => ({ kind: "primitive", name }),
  array: (e: Ty): Ty => ({ kind: "array", element: e }),
  opt: (i: Ty): Ty => ({ kind: "optional", inner: i }),
  slot: { kind: "slot" } as Ty,
  any: { kind: "any" } as Ty,
  never: { kind: "never" } as Ty,
  unknown: { kind: "unknown", cause: "no-rule" } as Ty,
  /** The record type of an aggregate or entity part. */
  record: (ref: Aggregate | EntityPart): Ty => ({
    kind: "record",
    shape: isAggregate(ref) ? { of: "aggregate", ref } : { of: "part", ref },
  }),
  /** `X id` for an aggregate or entity part. */
  id: (target: Aggregate | EntityPart): Ty => ({ kind: "id", target, name: target.name }),
};

/** Pull the tags declared at a Property's declaration site (if any). */
export function propertySensitivity(p: Property | undefined): SensitivityTags | undefined {
  const tags = p?.sensitivity?.tags;
  if (!tags || tags.length === 0) return undefined;
  return Object.freeze([...new Set(tags)].sort()) as SensitivityTags;
}

// ---------------------------------------------------------------------------
// TypeRef → Ty
// ---------------------------------------------------------------------------

/** A declared type, as the typing pass resolves it — including the
 *  macro-built references whose cross-reference never linked, which the pass
 *  finds by name. */
export function resolveTypeRef(ref: TypeRef | undefined): Ty {
  if (!ref?.base) return T.unknown;
  return typingFor(ref).resolveType(ref);
}

// ---------------------------------------------------------------------------
// Expression typing
// ---------------------------------------------------------------------------

/**
 * Lookup environment for an expression: maps identifiers to their declared
 * type and the AST node that introduced them.  Used both for type-checking
 * and for symbol resolution in generators.
 */
export interface Env {
  resolve(name: string): { type: Ty; origin: AstNode } | undefined;
  // The aggregate (root) currently in scope, if any — needed to type `id`
  // and lookup nested parts/functions/operations.
  aggregate?: Aggregate;
  // The entity part currently in scope, if any (a part declares its own
  // `id` of type PartName id).
  part?: EntityPart;
  // The value object currently in scope, if any.
  valueObject?: ValueObject;
  // The bounded context currently in scope.  Set explicitly for scopes that
  // have no `this` aggregate/part/value-object anchor — notably WORKFLOW bodies
  // (a saga orchestrates across aggregates and has no `this`) — so
  // context-level name lookups (value objects, criteria, policy fns, aggregate
  // names) still resolve there.  When absent, it's derived from the enclosing
  // aggregate/part/value-object via `envContext`.
  context?: BoundedContext;
}

/** The bounded context an `env` is scoped to: the explicit `context` anchor when
 *  set (a workflow body has no `this`, so it carries the context directly), else
 *  the context enclosing the aggregate / part / value object in scope. */
function envContext(env: Env): BoundedContext | undefined {
  if (env.context) return env.context;
  const start = env.aggregate ?? env.part ?? env.valueObject;
  return start ? AstUtils.getContainerOfType(start, isBoundedContext) : undefined;
}

/** An expression's type, as the single typing pass synthesized it (null
 *  narrowing included). `unknown` for an expression the pass never reached. */
export function typeOf(expr: Expression | undefined, _env: Env): Ty {
  // A `retrieval { … }` literal is a query, not a value; only `run` reads it.
  if (!expr || isRetrievalLiteral(expr)) return T.unknown;
  return typingFor(expr).synthAt(expr) ?? T.unknown;
}

/**
 * Whether a type can be implicitly stringified in `string + X` arithmetic.
 * Yes for:
 *   - numeric primitives (int / long / decimal / money) — universally
 *     stringified in every backend
 *   - bool — `"true"` / `"false"`
 *   - enum — host enum-to-name conversion (`OrderStatus.Confirmed.toString()`
 *     etc.)
 *   - `X id` — wraps a primitive, ID's underlying form is its string
 *     representation
 * No for everything else — value objects, aggregates, entities,
 * arrays, datetime (format ambiguity), guid (rarely concatenated;
 * explicit `string(x)` once admitted).  Same set the explicit
 * `string(x)` conversion vocabulary admits.
 */
export function isImplicitlyStringifiable(t: Ty): boolean {
  if (t.kind === "primitive") {
    return (
      t.name === "int" ||
      t.name === "long" ||
      t.name === "decimal" ||
      t.name === "money" ||
      t.name === "bool"
    );
  }
  if (t.kind === "enum") return true;
  if (t.kind === "id") return true;
  if (t.kind === "record" && t.shape.of === "aggregate") return aggregateHasDisplay(t.shape.ref);
  return false;
}

/** True iff the aggregate declares a `derived display: string = ...`.
 * Anchors `string(aggregate)` and implicit `"x " + aggregate` to a
 * concrete expression; absence makes both compile errors. */
function aggregateHasDisplay(agg: Aggregate): boolean {
  return agg.members.some((m) => isDerivedProp(m) && m.name === "display");
}

/** The policy function a free call `name(args)` names when that call resolves
 *  to NOTHING in its own context but a function-form `policy` of that name is
 *  declared in another bounded context of the same model — the
 *  `loom.policy-out-of-scope` case.  `undefined` whenever any in-scope
 *  declaration (function, value object, criterion, local policy, top-level
 *  function, duration builtin) claims the name first: mirrors
 *  the typing pass's free-call order (`Elaborator.freeCall`) so the validator and the pass
 *  agree on which calls are out of scope.  Same-document only — a context in
 *  another file is not visible from here (the call then stays `unknown`). */
export function outOfScopePolicyCall(
  name: string,
  env: Env,
): { decl: PolicyDecl; declaredIn: BoundedContext; usedIn: BoundedContext } | undefined {
  const usedIn = envContext(env);
  if (!usedIn) return undefined;
  const sym = env.resolve(name);
  if (sym && (isFunctionDecl(sym.origin) || isValueObject(sym.origin))) return undefined;
  if (lookupFunctionInScope(name, env)) return undefined;
  if (lookupValueObjectByName(name, env)) return undefined;
  if (lookupCriterionByName(name, env)) return undefined;
  if (lookupPolicyFnByName(name, env)) return undefined;
  if (lookupTopLevelFunction(name, env)) return undefined;
  if (durationUnitOf(name)) return undefined;
  const root = AstUtils.findRootNode(usedIn);
  for (const node of AstUtils.streamAllContents(root)) {
    if (!isBoundedContext(node) || node === usedIn) continue;
    for (const m of node.members) {
      if (isPolicyDecl(m) && m.returnType !== undefined && m.name === name) {
        return { decl: m, declaredIn: node, usedIn };
      }
    }
  }
  return undefined;
}

/** The user `FunctionDecl` a free call `name(args)` resolves to, or `undefined`
 *  when the call targets anything else — a value-object constructor, a criterion,
 *  a policy function, a duration builtin, or an unresolved name.  Mirrors
 *  `typeOfFreeCall`'s resolution ORDER exactly (same lookups, same shadowing) so
 *  the arg-count/type validator and the type system can never disagree about
 *  what a free call targets.  The validator uses this to arg-check ONLY the
 *  unambiguous user-function case, leaving criteria / policy-fns / duration
 *  builtins to their own gates. */
export function freeCallFunction(name: string, env: Env): FunctionDecl | undefined {
  const sym = env.resolve(name);
  if (sym && isFunctionDecl(sym.origin)) return sym.origin;
  if (sym && isValueObject(sym.origin)) return undefined; // VO constructor, not a function
  const fn = lookupFunctionInScope(name, env);
  if (fn) return fn;
  if (lookupValueObjectByName(name, env)) return undefined; // VO shadows a top-level fn
  if (lookupCriterionByName(name, env)) return undefined;
  if (lookupPolicyFnByName(name, env)) return undefined;
  const topFn = lookupTopLevelFunction(name, env);
  if (topFn) return topFn;
  return undefined; // duration builtin / unresolved — not the call-arg validator's concern
}

/** The parameter list of the criterion / policy-function a free call `name(args)`
 *  targets, or `undefined` when it targets neither.  Mirrors `typeOfFreeCall`'s
 *  order for the predicate arms (after function / value-object resolution, which
 *  shadow a predicate).  Consumed by the arg-TYPE validator: a criterion / policy
 *  call already has its ARITY checked model-wide (`loom.criterion-arity` /
 *  `checkPolicyFns`), so the validator only type-checks the args this resolves. */
export function freeCallPredicate(name: string, env: Env): Parameter[] | undefined {
  // A function or value object shadows a predicate of the same name — the caller
  // only reaches here when `freeCallFunction` already returned undefined, so
  // guard the value-object case (functions are already excluded).
  const sym = env.resolve(name);
  if (sym && isValueObject(sym.origin)) return undefined;
  if (lookupValueObjectByName(name, env)) return undefined;
  const crit = lookupCriterionByName(name, env);
  if (crit) return crit.params;
  const pol = lookupPolicyFnByName(name, env);
  if (pol) return pol.params;
  return undefined;
}

/**
 * True iff a free call to `name` is an A5 duration-constructor BUILTIN in
 * `env` — i.e. `name` is one of `days`/`hours`/`minutes` AND no
 * user declaration (function / value object / criterion) shadows it.
 * Mirrors `typeOfFreeCall`'s lookup order exactly; exported for the
 * temporal validator (`checkDurationConstructors`), so the validator and
 * the type system can never disagree about what is a builtin.
 */
export function isDurationBuiltinCall(name: string, env: Env): boolean {
  if (!durationUnitOf(name)) return false;
  const sym = env.resolve(name);
  if (sym && (isFunctionDecl(sym.origin) || isValueObject(sym.origin))) return false;
  if (lookupFunctionInScope(name, env)) return false;
  if (lookupTopLevelFunction(name, env)) return false;
  if (lookupValueObjectByName(name, env)) return false;
  if (lookupCriterionByName(name, env)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The two dotted-path member walkers — and why each is an EXHAUSTIVE switch.
//
// `stepInto` and `stepIntoNode` answer "what does `<receiver>.<name>` denote?"
// along a dotted path (an lvalue, a projection source), returning the member's
// type and the member's AST node.  The POSTFIX walk (`recv.member` in an
// expression) was a third such walker; since M-T5.47 it is the single typing
// pass's, read through `suffixType`.  They were written as `if (t.kind === …)`
// chains falling through to a silent `unknown` / `undefined` — the shape
// M-T5.16 (a) names: **a new type kind resolves on one walker, silently
// misses the other, and nothing fails.**
//
// Each walker is a `switch (t.kind)` covering EVERY member of the `Ty`
// union with a `const _exhaustive: never` default (the `walk.ts` idiom), so
// adding a kind fails `tsc` at both sites at once, and a kind that genuinely
// has no members carries an explicit arm saying so.
//
// The kinds each one resolves ON are pinned as data — `MEMBER_RESOLVING_KINDS`
// below, asserted by `test/language/type-system/walker-exhaustiveness.test.ts`.
// ---------------------------------------------------------------------------

/** Which `Ty` kinds each dotted-path walker actually resolves a member ON
 *  (as opposed to answering `unknown` / `undefined`), stated as data so that
 *  widening one of them is a visible edit here rather than an invisible one at
 *  the site. */
export const MEMBER_RESOLVING_KINDS = {
  /** Dotted-path step (`a.b.c` in an lvalue / projection source).  NARROWER
   *  than the postfix walk (the typing pass's) on purpose: a dotted path is a record walk, so
   *  collection ops (`array`), scalar intrinsics (`primitive`), `X id`
   *  dereference and the principal record are not reachable through it
   *  today.  Widening it is a language change, not a bug fix. */
  stepInto: ["record", "valueobject"],
  /** AST-node twin of `stepInto`, for go-to-definition. Same kinds. */
  stepIntoNode: ["record", "valueobject"],
} as const satisfies Record<string, ReadonlyArray<Ty["kind"]>>;

/** The record shapes a dotted path walks into: the declared records. A
 *  workflow / projection state, the principal, a resource handle and a store
 *  have no dotted-path surface. */
type DeclaredRecord =
  | { of: "aggregate"; ref: Aggregate }
  | { of: "part"; ref: EntityPart }
  | { of: "event"; ref: EventDecl }
  | { of: "payload"; ref: PayloadDecl };

function declaredRecord(t: Ty & { kind: "record" }): DeclaredRecord | undefined {
  switch (t.shape.of) {
    case "aggregate":
    case "part":
    case "event":
    case "payload":
      return t.shape;
    default:
      return undefined;
  }
}

/** The receiver type AFTER `suffix` — what the single typing pass recorded
 *  for it (M-T5.47): the one member-access walk validators and the LSP read. */
export function suffixType(suffix: PostfixSuffix): Ty {
  return typingFor(suffix).synthAt(suffix) ?? T.unknown;
}

/** For the unknown-user-claim validator: `name` is definitively NOT reachable
 *  on the `currentUser` principal.  Returns the declared claim names (for the
 *  diagnostic's "declared claims" tail) when the member is absent, and
 *  `undefined` when it resolves *or* the receiver isn't the principal.
 *
 *  The principal is the one record whose membership `lookupUserMember` above
 *  deliberately fails OPEN on (unknown ⇒ `string`), and that fallback is not
 *  cosmetic: an undeclared claim rides all the way through lowering and reaches
 *  the generated backend verbatim, where the emitted `UserClaims` interface —
 *  built from exactly these `user { }` fields (`auth-emit.ts`) — has no such
 *  property.  node/.NET/Java then fail their OWN compile; python/elixir read
 *  nothing at request time.  So the membership judgement has to be made here,
 *  at the only layer that still has a CST node to point at.
 *
 *  Valid members = the declared `UserField`s PLUS the two derived tenancy
 *  members (`orgPath` / `rootOrg`), which are computed per-request from the
 *  tenancy claim rather than declared in `user { }`.  Referencing either
 *  WITHOUT a `tenancy by` line is already its own diagnostic
 *  (`loom.orgpath-without-tenancy`, `validators/tenancy.ts`), so they are
 *  accepted here unconditionally — never double-reported. */
export function absentUserClaim(recvType: Ty, name: string): string[] | undefined {
  const t = recvType.kind === "optional" ? recvType.inner : recvType;
  if (t.kind !== "record" || t.shape.of !== "principal" || !t.shape.ref) return undefined;
  if (name === PRINCIPAL_ORG_PATH || name === PRINCIPAL_ROOT_ORG) return undefined;
  if (name === PRINCIPAL_IS_SYSTEM) return undefined;
  const user = t.shape.ref;
  if (user.fields.some((f) => f.name === name)) return undefined;
  return user.fields.map((f) => f.name);
}

/** For the unknown-member validator: `name` is definitively NOT reachable on a
 *  primitive receiver.  Returns the receiver's primitive name plus everything
 *  that IS reachable on it (for the diagnostic's tail); `undefined` when the
 *  member resolves *or* the receiver isn't a primitive.
 *
 *  A primitive is a VALUE, not a record — it has no fields beyond
 *  `PRIMITIVE_FIELDS` above and no operations beyond the intrinsic catalogue,
 *  and both are fully enumerable.  Yet a bare member READ on one was the last
 *  fail-open hole in the member funnel: the CALL form has been gated since the
 *  stdlib landed (`loom.intrinsic-unknown`), while `s.totallyMadeUp` typed as
 *  `unknown`, every operand validator suppressed on `unknown`
 *  (anti-double-reporting), and the invented member reached the emitters
 *  verbatim.  On node/.NET/Java the generated project then failed its own
 *  compile; on python/elixir it did not, so an `invariant m.amount > 0` written
 *  over a `money` field became a business rule that can never fire.
 *
 *  Fail-open by construction — `undefined` on every non-primitive receiver
 *  (record, array, enum, `X id`, slot, `any`, `unknown`), so this never
 *  competes with `absentRecordMember` / `absentUserClaim`.
 *
 *  A single optional level is unwrapped first, exactly as member RESOLUTION
 *  does everywhere else: `nickname.length` on a `string?` stays a membership
 *  question, and whether the DEREF is safe is a separate judgement
 *  (`loom.nullable-receiver`).
 *
 *  INTRINSIC NAMES RESOLVE HERE even when written bare (`s.trim`): the name is
 *  reachable, it is the missing call that is wrong, and that already has its
 *  own code (`loom.intrinsic-bare`).  One diagnostic per mistake.  The string
 *  regex `matches` is reachable the same way though it is not a catalogue row. */
export function absentPrimitiveMember(
  recvType: Ty,
  name: string,
): { prim: PrimitiveName; known: string[] } | undefined {
  const t = recvType.kind === "optional" ? recvType.inner : recvType;
  if (t.kind !== "primitive") return undefined;
  const fields = [...(PRIMITIVE_FIELDS.get(t.name)?.keys() ?? [])];
  const ops = intrinsicsForReceiver(t.name).map((s) => s.name);
  const extra = t.name === "string" ? ["matches"] : [];
  if (fields.includes(name) || ops.includes(name) || extra.includes(name)) return undefined;
  return { prim: t.name, known: [...fields, ...ops, ...extra] };
}

/** For the unknown-member validator: when `recvType` is a record we can
 *  fully enumerate (aggregate / entity / value object / event-or-payload, or
 *  an `X id` resolving to one) and `name` is **not** one of its members,
 *  returns the record's display name (for the diagnostic).  Returns
 *  `undefined` when the member exists *or* the receiver isn't a fully
 *  enumerable record (array, primitive, slot, enum, `any`, `unknown`, or a
 *  nested optional) — i.e. it fails open and never reports on uncertainty.
 *
 *  Membership is a name match across *any* declared member (property,
 *  containment, derived, function, operation), not the type-returning
 *  lookups: those map a function/operation member to `T.unknown` (no useful
 *  type without a call), which is indistinguishable from "absent" and would
 *  flag a legitimate `this.someOperation()`.  `id` is always valid on an
 *  aggregate / entity / id receiver (the implicit identity accessor). */
export function absentRecordMember(recvType: Ty, name: string): string | undefined {
  // Member access transparently unwraps a single optional level.
  const t = recvType.kind === "optional" ? recvType.inner : recvType;
  switch (t.kind) {
    // An ARRAY's member surface is exactly the collection-op catalogue
    // (`COLLECTION_OP_SIGNATURES`) — which is already what `membersOfType`
    // offers for completion on an array receiver, so this arm only makes
    // VALIDATION agree with what completion has always claimed.
    //
    // Without it `collectionOpType`'s `default` returned `T.unknown` for an
    // absent member, and `unknown` is the value every downstream check
    // suppresses on — so a typo'd or invented collection op on an array
    // receiver was reported NOWHERE and reached the emitters verbatim
    // (testability audit F1's residue; the same shape in an aggregate
    // `operation` and in a `domainService` body alike).
    //
    // `sum`/`avg`/`min`/`max` in their BARE form are collection ops, so they
    // pass here and are refused by `loom.bare-collection-accessor` instead —
    // its message names the lambda form, which is the actionable fix.
    case "array":
      // `length` is an alias `collectionOpType` types as `int` (see there); it
      // is legal on an array but absent from the catalogue, so `isCollectionOp`
      // alone would reject it.
      return isCollectionOp(name) || name === "length" || (t.pagedMeta && PAGED_META.has(name))
        ? undefined
        : typeToString(t);
    case "record": {
      const r = declaredRecord(t);
      switch (r?.of) {
        case "aggregate":
          if (name === "id") return undefined;
          return aggregateChainHasMember(r.ref, name) ? undefined : r.ref.name;
        case "part": {
          // Entity parts don't participate in `extends` inheritance (aggregate-only).
          if (name === "id") return undefined;
          const has = r.ref.members.some((m) => (m as { name?: string }).name === name);
          return has ? undefined : r.ref.name;
        }
        case "event":
        case "payload":
          return r.ref.fields.some((f) => f.name === name) ? undefined : r.ref.name;
        default:
          return undefined;
      }
    }
    case "id": {
      if (name === "id") return undefined;
      const tgt = t.target;
      if (!tgt || !(isAggregate(tgt) || isEntityPart(tgt))) return undefined;
      const has = isAggregate(tgt)
        ? aggregateChainHasMember(tgt, name)
        : tgt.members.some((m) => (m as { name?: string }).name === name);
      return has ? undefined : tgt.name;
    }
    case "valueobject": {
      if (!t.ref) return undefined;
      const has = t.ref.members.some((m) => (m as { name?: string }).name === name);
      // `equals` is the value-equality intrinsic, not an absent member — its
      // call shape is judged by `checkIntrinsicCalls`.
      if (!has && name === VALUE_OBJECT_EQUALS) return undefined;
      return has ? undefined : t.ref.name;
    }
    default:
      return undefined;
  }
}

/** True iff `name` is declared anywhere in an aggregate's `extends` chain.
 *  A concrete aggregate inherits the abstract base's fields / operations, so
 *  the membership check (`absentRecordMember`) must walk `superType` — without
 *  it, `this.<inheritedField>` on a subtype is a false positive.  The local
 *  `seen` set below guards against an infinite loop on a malformed `extends`
 *  cycle; the cycle itself is reported separately as `loom.extends-cycle` by
 *  the inheritance validator (`validators/inheritance.ts`, Rule 1b). */
function aggregateChainHasMember(agg: Aggregate, name: string): boolean {
  const seen = new Set<Aggregate>();
  let cur: Aggregate | undefined = agg;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (cur.members.some((m) => (m as { name?: string }).name === name)) return true;
    cur = cur.superType?.ref;
  }
  return false;
}

// Collection-op catalogue moved to src/util/collection-ops.ts (pure data
// catalogue, consumed by ir/, generator/, system/ as well — keeps the
// language layer free of back-edges).

function lookupFunctionInScope(
  name: string,
  env: Env,
): import("./generated/ast.js").FunctionDecl | undefined {
  const scopes: Array<Aggregate | EntityPart | ValueObject | undefined> = [
    env.part,
    env.aggregate,
    env.valueObject,
  ];
  for (const s of scopes) {
    if (!s) continue;
    for (const m of s.members) {
      if (isFunctionDecl(m) && m.name === name) return m;
    }
  }
  return undefined;
}

/** A TOP-LEVEL (ambient) helper `function` named `name` (stdlib) —
 *  declared at file root or inside a `system { }`, visible workspace-wide.
 *  Checked AFTER local functions / VO ctors / criteria / policy fns (which
 *  shadow it), mirroring the lowerer's inline precedence (`inlineTopLevelFn`
 *  only fires when `resolveCallKind` is `"free"`). */
function lookupTopLevelFunction(
  name: string,
  env: Env,
): import("./generated/ast.js").FunctionDecl | undefined {
  const anchor = env.aggregate ?? env.part ?? env.valueObject ?? env.context;
  if (anchor) {
    const model = AstUtils.getContainerOfType(anchor, isModel);
    if (model) {
      for (const m of model.members) {
        if (isFunctionDecl(m) && m.name === name) return m;
        if (isSystem(m)) {
          for (const sm of m.members) if (isFunctionDecl(sm) && sm.name === name) return sm;
        }
      }
    }
  }
  // Ambient std prelude (stdlib) — after any user-declared top-level
  // function (which shadows it), so a call to a prelude function types to its
  // declared return.
  return stdFunction(name);
}

/** Resolve a criterion by name against the enclosing bounded context.
 *  Criteria are context-level predicate specifications (see
 *  docs/criterion.md); a reference to one in expression position types
 *  as `bool`. */
function lookupCriterionByName(name: string, env: Env): Criterion | undefined {
  const ctx = envContext(env);
  if (!ctx) return undefined;
  for (const m of ctx.members) {
    if (isCriterion(m) && m.name === name) return m;
  }
  return undefined;
}

/** Resolve a FUNCTION-form `policy` declaration by name against the enclosing
 *  bounded context (auth).  A reference to one in expression position
 *  (e.g. a `requires PolicyName(args)` gate) types as `bool`.  Only the
 *  function form (carrying a `returnType`) is callable; a block-form
 *  `policy {}` read ladder is not. */
function lookupPolicyFnByName(name: string, env: Env): PolicyDecl | undefined {
  const ctx = envContext(env);
  if (!ctx) return undefined;
  for (const m of ctx.members) {
    if (isPolicyDecl(m) && m.returnType !== undefined && m.name === name) return m;
  }
  return undefined;
}

function lookupValueObjectByName(name: string, env: Env): ValueObject | undefined {
  // Walk up to bounded context and search value objects.  `members` on
  // BoundedContext is `ContextMember[]` in the generated AST — we use
  // the typed `isValueObject` guard to narrow rather than escape-hatch
  // casting through `unknown`.
  const ctx = envContext(env);
  if (!ctx) return undefined;
  for (const m of ctx.members) {
    if (isValueObject(m) && m.name === name) return m;
  }
  return undefined;
}

// Matcher catalogue + isCollectionOp moved to src/util/intrinsic-matchers.ts
// and src/util/collection-ops.ts — pure data catalogues that all layers
// can import without back-edges into language/.

// ---------------------------------------------------------------------------
// Helpers for collecting parameters / let-bindings into an Env
// ---------------------------------------------------------------------------

export function paramType(p: Parameter): Ty {
  return resolveTypeRef(p.type);
}

/** The aggregate a criterion/retrieval `of <T>` candidate names, or `undefined`
 *  when the target isn't a bare (non-array, non-optional) aggregate — e.g. the
 *  `of bool` pure-ambient criterion, which has no `this`. */
function typeRefAggregate(t: TypeRef | undefined): Aggregate | undefined {
  if (!t || t.array || t.optional) return undefined;
  const dt = resolveTypeRef(t);
  return dt.kind === "record" && dt.shape.of === "aggregate" ? dt.shape.ref : undefined;
}

export function makeEnv(
  outer: Env | undefined,
  bindings: Map<string, { type: Ty; origin: AstNode }>,
  ctx: {
    aggregate?: Aggregate;
    part?: EntityPart;
    valueObject?: ValueObject;
    context?: BoundedContext;
  } = {},
): Env {
  return {
    aggregate: ctx.aggregate ?? outer?.aggregate,
    part: ctx.part ?? outer?.part,
    valueObject: ctx.valueObject ?? outer?.valueObject,
    context: ctx.context ?? outer?.context,
    resolve(name) {
      const found = bindings.get(name);
      if (found) return found;
      return outer?.resolve(name);
    },
  };
}

// ---------------------------------------------------------------------------
// AST-walk helpers used by the validator and other consumers.  Imports
// for Aggregate / FunctionDecl / Operation already exist at the top of
// this file.
// ---------------------------------------------------------------------------

/** Resolve a bare identifier as an aggregate root member (or `id`). */
export function lookupRootMember(agg: Aggregate, name: string): Ty {
  if (name === "id") return T.id(agg);
  for (const m of agg.members) {
    if (isProperty(m) && m.name === name)
      return withTags(resolveTypeRef(m.type), propertySensitivity(m));
    if (isContainment(m) && m.name === name) {
      const part = m.partType?.ref;
      if (!part) return T.unknown;
      const t = T.record(part);
      return m.collection ? T.array(t) : t;
    }
    if (isDerivedProp(m) && m.name === name) return resolveTypeRef(m.type);
  }
  return T.unknown;
}

/** Walk a single dotted path step on a typed receiver.  Exhaustive over
 *  `Ty["kind"]` — see the note above `MEMBER_RESOLVING_KINDS`; the kinds it
 *  deliberately does NOT resolve on are `MEMBER_RESOLVING_KINDS.stepInto`'s
 *  complement, and each carries an explicit arm below. */
export function stepInto(t: Ty, name: string): Ty {
  switch (t.kind) {
    case "record": {
      const r = declaredRecord(t);
      switch (r?.of) {
        case "aggregate":
        case "part": {
          if (name === "id") return T.id(r.ref);
          for (const m of r.ref.members) {
            if (isProperty(m) && m.name === name)
              return withTags(resolveTypeRef(m.type), propertySensitivity(m));
            if (isContainment(m) && m.name === name) {
              const part = m.partType?.ref;
              if (!part) return T.unknown;
              return m.collection ? T.array(T.record(part)) : T.record(part);
            }
            if (isDerivedProp(m) && m.name === name) return resolveTypeRef(m.type);
          }
          return T.unknown;
        }
        case "event":
        case "payload":
          // A transport record is a flat list of `Property` fields — no `id`,
          // containment, or derived members.  Resolving the field type (instead
          // of cascading to `unknown`) is what lets the binary-operand /
          // assignment validators check expressions over event/payload fields.
          for (const f of r.ref.fields) {
            if (f.name === name) return withTags(resolveTypeRef(f.type), propertySensitivity(f));
          }
          return T.unknown;
        default:
          return T.unknown;
      }
    }
    case "valueobject": {
      for (const m of t.ref?.members ?? []) {
        if (isProperty(m) && m.name === name)
          return withTags(resolveTypeRef(m.type), propertySensitivity(m));
        if (isDerivedProp(m) && m.name === name) return resolveTypeRef(m.type);
      }
      return T.unknown;
    }
    // Not reachable through a dotted path today.  `array` / `primitive` / the
    // principal / `id` DO resolve members in the postfix walk (the typing
    // pass's); a dotted path is a record walk, so collection ops, scalar
    // intrinsics, the principal and `X id` dereference are out of its surface.
    // A union is read through a `match`, never member by member.  The
    // remaining kinds have no member surface anywhere.  Widening any of these
    // is a language change — make it here and in `MEMBER_RESOLVING_KINDS`.
    case "array":
    case "primitive":
    case "id":
    case "enum":
    case "optional":
    case "union":
    case "none":
    case "generic":
    case "slot":
    case "action":
    case "any":
    case "never":
    case "unknown":
      return T.unknown;
    default: {
      const _exhaustive: never = t;
      void _exhaustive;
      return T.unknown;
    }
  }
}

export function findFunction(agg: Aggregate, name: string): FunctionDecl | undefined {
  for (const m of agg.members) {
    if (isFunctionDecl(m) && m.name === name) return m;
  }
  return undefined;
}

export function findOperation(agg: Aggregate, name: string): Operation | undefined {
  for (const m of agg.members) {
    if (isOperation(m) && m.name === name) return m;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// envForNode — builds a `typeOf`-ready Env for any node in the AST.
//
// Walks up to the closest scope-bearing container (operation, domain-service
// operation, function, invariant, derived prop, value object, part, aggregate)
// and assembles bindings + scope context.  The validator constructs equivalent
// envs inline; LSP services (hover, completion) need the same data without
// having to recreate the walk per provider.
//
// Bindings come from (in increasing precedence):
//   1. Aggregate / part / value-object members (as bare names).
//   2. Function or operation parameters.
//   3. `let` bindings from preceding statements in the enclosing block.
//
// `let` bindings are typed `T.unknown` for simplicity — the validator
// already does this; the precise type would require running `typeOf`
// at the bind site, which is awkward in a one-pass env builder.
// ---------------------------------------------------------------------------

export function envForNode(node: AstNode): Env {
  const part = AstUtils.getContainerOfType(node, isEntityPart);
  const vo = AstUtils.getContainerOfType(node, isValueObject);
  const find = AstUtils.getContainerOfType(node, isFindDecl);
  // A `criterion`/`retrieval` body's `this` is the candidate aggregate its
  // `of <T>` names.
  const crit = AstUtils.getContainerOfType(node, isCriterion);
  const retr = AstUtils.getContainerOfType(node, isRetrieval);

  // The `this`/root aggregate: an enclosing aggregate container, else the
  // repository's `for` aggregate (find filters) — reached through a
  // cross-reference, not containment — else a criterion/retrieval candidate
  // aggregate (its `of <T>` target).  Workflows orchestrate across aggregates
  // and have no `this`.
  const agg =
    AstUtils.getContainerOfType(node, isAggregate) ??
    (find ? (find.$container as Repository | undefined)?.aggregate?.ref : undefined) ??
    (crit ? typeRefAggregate(crit.target) : undefined) ??
    (retr ? typeRefAggregate(retr.target) : undefined);

  // One environment model (M-T5.47 cutover 3e): a name resolves through the
  // single typing pass's scope at `node` — params, lets, lambda / for / match
  // / if-let bindings and event params bound lexically, then the enclosing
  // record's members — not through a second, hand-assembled binding map.
  return {
    aggregate: agg ?? undefined,
    part: part ?? undefined,
    valueObject: vo ?? undefined,
    // The enclosing bounded context — the anchor context-level name lookups
    // (value objects, criteria, policy fns, aggregate names) use when there is
    // no `this` aggregate/part/vo, e.g. inside a workflow body.
    context: AstUtils.getContainerOfType(node, isBoundedContext),
    resolve(name) {
      const b = typingFor(node).bindingAt(node, name);
      return b ? { type: b.ty, origin: b.origin } : undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// iterateEntityMembers — yields each member of an aggregate / part /
// value-object once, with its display kind + type, in declaration order.
// Used by hover (one-line summary) and completion (member-access arm).
// ---------------------------------------------------------------------------

export interface EntityMemberInfo {
  name: string;
  kind: "property" | "containment" | "derived" | "function" | "operation";
  type: Ty;
  node: AstNode;
}

export function iterateEntityMembers(
  target: Aggregate | EntityPart | ValueObject,
): EntityMemberInfo[] {
  const out: EntityMemberInfo[] = [];
  for (const m of target.members) {
    if (isProperty(m)) {
      out.push({
        name: m.name,
        kind: "property",
        type: withTags(resolveTypeRef(m.type), propertySensitivity(m)),
        node: m,
      });
    } else if (isDerivedProp(m)) {
      out.push({ name: m.name, kind: "derived", type: resolveTypeRef(m.type), node: m });
    } else if (isContainment(m)) {
      const partRef = m.partType?.ref;
      if (partRef) {
        const inner = T.record(partRef);
        out.push({
          name: m.name,
          kind: "containment",
          type: m.collection ? T.array(inner) : inner,
          node: m,
        });
      }
    } else if (isFunctionDecl(m)) {
      out.push({
        name: m.name,
        kind: "function",
        type: resolveTypeRef(m.returnType),
        node: m,
      });
    } else if (isOperation(m)) {
      // Operations don't have a return type in the type system (they
      // mutate state and return void); record `unknown` so callers
      // that key off `kind` can still display a label.
      out.push({ name: m.name, kind: "operation", type: T.unknown, node: m });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Member enumeration — the single source of truth for "what `.member` names
// are valid on a value of type `t`".  Consumed by the LSP completion provider
// (`ddd-completion.ts`) and the web Model-builder's structured expression
// editor, so member completion behaves identically in VS Code and the
// playground.  This is the enumeration counterpart of the member-access typing
// in `typeOf` — keep the two in step.
// ---------------------------------------------------------------------------

export interface MemberCompletion {
  name: string;
  kind: "field" | "method" | "enum-value";
  /** Short type/signature hint for the completion popup. */
  detail?: string;
}

function entityMemberCompletions(
  ref: Aggregate | EntityPart | ValueObject,
  withId: boolean,
): MemberCompletion[] {
  const out: MemberCompletion[] = [];
  // Aggregates / entity parts expose the magic `id` accessor; value objects don't.
  if (withId) out.push({ name: "id", kind: "field", detail: `${ref.name} id` });
  for (const m of iterateEntityMembers(ref)) {
    out.push({
      name: m.name,
      kind: m.kind === "function" || m.kind === "operation" ? "method" : "field",
      detail: typeToString(m.type),
    });
  }
  return out;
}

export function membersOfType(t: Ty): MemberCompletion[] {
  switch (t.kind) {
    case "array":
      return COLLECTION_OP_SIGNATURES.map((op) => ({
        name: op.name,
        kind: "method",
        detail: `collection op: ${op.signature}`,
      }));
    case "record":
      switch (t.shape.of) {
        case "aggregate":
        case "part":
          return entityMemberCompletions(t.shape.ref, true);
        case "event":
        case "payload":
          return t.shape.ref.fields.map((f) => ({
            name: f.name,
            kind: "field",
            detail: typeToString(resolveTypeRef(f.type)),
          }));
        case "principal":
          return [
            ...(t.shape.ref?.fields ?? []).map(
              (f): MemberCompletion => ({
                name: f.name,
                kind: "field",
                detail: typeToString(resolveTypeRef(f.type)),
              }),
            ),
            { name: PRINCIPAL_ORG_PATH, kind: "field", detail: "string" },
            { name: PRINCIPAL_ROOT_ORG, kind: "field", detail: "string" },
            { name: PRINCIPAL_IS_SYSTEM, kind: "field", detail: "bool" },
          ];
        default:
          return [];
      }
    case "valueobject": {
      if (!t.ref) return [];
      const own = entityMemberCompletions(t.ref, false);
      return isValueObjectEqualsIntrinsic(t.ref.members, VALUE_OBJECT_EQUALS)
        ? [
            ...own,
            {
              name: VALUE_OBJECT_EQUALS,
              kind: "method",
              detail: valueObjectEqualsSignature(t.ref.name),
            },
          ]
        : own;
    }
    case "id":
      // `X id.member` follows the typed reference into X's schema.
      return t.target && (isAggregate(t.target) || isEntityPart(t.target))
        ? entityMemberCompletions(t.target, true)
        : [];
    case "optional":
      // Member access transparently unwraps an optional (the validator
      // enforces the null-guard separately).
      return membersOfType(t.inner);
    case "primitive": {
      const intrinsics: MemberCompletion[] = intrinsicsForReceiver(t.name).map((s) => ({
        name: s.name,
        kind: "method",
        detail: s.signature,
      }));
      const fields: MemberCompletion[] = [...(PRIMITIVE_FIELDS.get(t.name) ?? [])].map(
        ([name, detail]) => ({ name, kind: "field", detail }),
      );
      return [...fields, ...intrinsics];
    }
    case "enum": {
      const ref = t.ref;
      return ref
        ? ref.values.map((v) => ({ name: v.name, kind: "enum-value", detail: ref.name }))
        : [];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// stepIntoNode — like `stepInto` but returns the matching member's AST
// node, not its type.  Used by the LSP definition provider for member
// access (`order.lines` → the `Containment` declaration).
// ---------------------------------------------------------------------------

export function stepIntoNode(t: Ty, name: string): AstNode | undefined {
  switch (t.kind) {
    case "record": {
      const r = declaredRecord(t);
      switch (r?.of) {
        case "aggregate":
        case "part":
          for (const m of r.ref.members) {
            if (isProperty(m) && m.name === name) return m;
            if (isContainment(m) && m.name === name) return m;
            if (isDerivedProp(m) && m.name === name) return m;
            if (isFunctionDecl(m) && m.name === name) return m;
            if (isOperation(m) && m.name === name) return m;
          }
          return undefined;
        case "event":
        case "payload":
          return r.ref.fields.find((f) => f.name === name);
        default:
          return undefined;
      }
    }
    case "valueobject": {
      for (const m of t.ref?.members ?? []) {
        if (isProperty(m) && m.name === name) return m;
        if (isDerivedProp(m) && m.name === name) return m;
        if (isFunctionDecl(m) && m.name === name) return m;
      }
      return undefined;
    }
    // No declaration node to jump to: `array` / `primitive` / `id` members are
    // synthetic (collection ops, scalar intrinsics, the derived `id`), a union
    // is read through a `match`, and the rest have no member surface. See the
    // note above `MEMBER_RESOLVING_KINDS`.
    case "array":
    case "primitive":
    case "id":
    case "enum":
    case "optional":
    case "union":
    case "none":
    case "generic":
    case "slot":
    case "action":
    case "any":
    case "never":
    case "unknown":
      return undefined;
    default: {
      const _exhaustive: never = t;
      void _exhaustive;
      return undefined;
    }
  }
}

export interface CalleeSignature {
  name: string;
  params: ReadonlyArray<{ name: string; type: TypeRef }>;
  ret?: TypeRef;
}

/** Resolve a call's callee to its parameter signature — a function / operation
 *  (its params) or a value-object constructor (its declared properties,
 *  positional). Shared by the LSP signature-help provider and the Model
 *  builder's structured editor. Undefined when the callee can't be resolved.
 *
 *  Postfix-chain call: pass the chain plus the index of the call suffix
 *  (in `chain.suffixes`) whose signature we want. */
export function calleeSignature(
  call: import("./generated/ast.js").BuilderCall | { chain: PostfixChain; suffixIdx: number },
): CalleeSignature | undefined {
  if (!("chain" in call)) {
    // BuilderCall branch.
    if (call.$type === "BuilderCall") {
      const ctx = AstUtils.getContainerOfType(call, isBoundedContext);
      const vo = ctx?.members.find(
        (m): m is ValueObject => isValueObject(m) && m.name === call.type,
      );
      if (vo) {
        return {
          name: vo.name,
          params: vo.members.filter(isProperty).map((p) => ({ name: p.name, type: p.type })),
        };
      }
      return undefined;
    }
    return undefined;
  }
  const { chain, suffixIdx } = call;
  const s = chain.suffixes[suffixIdx];
  if (!s) return undefined;
  // MemberSuffix(call=true): a method invocation — resolve via the
  // receiver's type at the point before this suffix is applied.
  if (isMemberSuffix(s)) {
    if (!s.call) return undefined;
    let recvType: Ty = typeOf(chain.head, envForNode(chain.head));
    for (let i = 0; i < suffixIdx; i++) {
      recvType = suffixType(chain.suffixes[i]!);
    }
    const decl = stepIntoNode(recvType, s.member);
    if (decl && (isFunctionDecl(decl) || isOperation(decl))) {
      return {
        name: s.member,
        params: decl.params,
        ret: isFunctionDecl(decl) ? decl.returnType : undefined,
      };
    }
    return undefined;
  }
  // CallSuffix: a free call applied to the chain head — only meaningful
  // when the head is a NameRef and this is the first suffix.
  if (suffixIdx === 0 && isNameRef(chain.head)) {
    const name = chain.head.name;
    const owner =
      AstUtils.getContainerOfType(chain, isAggregate) ??
      AstUtils.getContainerOfType(chain, isEntityPart) ??
      AstUtils.getContainerOfType(chain, isValueObject);
    for (const m of owner?.members ?? []) {
      if ((isFunctionDecl(m) || isOperation(m)) && m.name === name) {
        return {
          name: m.name,
          params: m.params,
          ret: isFunctionDecl(m) ? m.returnType : undefined,
        };
      }
    }
    const ctx = AstUtils.getContainerOfType(chain, isBoundedContext);
    const vo = ctx?.members.find((m): m is ValueObject => isValueObject(m) && m.name === name);
    if (vo) {
      return {
        name: vo.name,
        params: vo.members.filter(isProperty).map((p) => ({ name: p.name, type: p.type })),
      };
    }
  }
  return undefined;
}
