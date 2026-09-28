// -------------------------------------------------------------------------
// Shared check helpers — the generic ExprIR walker and the column /
// queryable-subset predicate helpers, used across several check modules.
// -------------------------------------------------------------------------

import { intrinsicFor, intrinsicReturnType } from "../../../util/intrinsics.js";
import type { AggregateIR, BoundedContextIR, ExprIR } from "../../types/loom-ir.js";
import { durationCtorOperand, isDatetimeTypedIR } from "../../util/temporal.js";
import { walkExprDeep } from "../../util/walk.js";

/** True when `name` is a stored field, containment, or derived property
 *  of the aggregate — the set of members a `sort` / `loads` path may
 *  root at. */
export function aggregateHasMember(agg: AggregateIR, name: string): boolean {
  return (
    agg.fields.some((f) => f.name === name) ||
    agg.contains.some((c) => c.name === name) ||
    agg.derived.some((d) => d.name === name)
  );
}

/** Walk an already-queryable expression and return the first
 * `this.<X>` member access whose `<X>` doesn't correspond to a real
 * aggregate field.  Returns null if every column reference resolves
 * cleanly. */
export function firstUnknownColumnRef(
  e: ExprIR,
  // Structural column source — an aggregate (fields + containments + derived)
  // or a workflow's instance state (`stateFields` only; no containments /
  // derived).  AggregateIR satisfies this directly; a workflow source passes
  // `{ fields: wf.stateFields, contains: [], derived: [] }`
  // (workflow-instance-views.md).
  agg: Pick<AggregateIR, "fields" | "contains" | "derived">,
  ctx: BoundedContextIR,
  opts?: {
    /** Admit `this.id` (the aggregate's own key) as a known column.  Set by
     *  the capability-filter selectability loop only: a filter predicate is
     *  always AGGREGATE-rooted, where `id` is a real stored column on every
     *  backend — the derived tenancy registry self-scope (`this.id ==
     *  currentUser.<claim>`) is the motivating shape.  Find /
     *  retrieval `where`s keep the strict field-list check (a
     *  workflow-instance read-model source has no `id` column, so admitting it
     *  there would emit SQL against a missing column). */
    allowSelfId?: boolean;
  },
): string | null {
  switch (e.kind) {
    case "literal":
    case "this":
    case "id":
    case "ref":
      return null;
    case "paren":
      return firstUnknownColumnRef(e.inner, agg, ctx, opts);
    case "unary":
      return firstUnknownColumnRef(e.operand, agg, ctx, opts);
    case "binary":
      return (
        firstUnknownColumnRef(e.left, agg, ctx, opts) ??
        firstUnknownColumnRef(e.right, agg, ctx, opts)
      );
    case "member": {
      // `this.X` — direct column.  Verify X is on the aggregate.
      if (e.receiver.kind === "this") {
        if (opts?.allowSelfId && e.member === "id" && e.memberType.kind === "id") return null;
        const fld = agg.fields.find((f) => f.name === e.member);
        if (fld) return null;
        const derived = agg.derived.find((d) => d.name === e.member);
        if (derived) {
          // Derived isn't a stored column — emitting SQL against it
          // would also fail.  Reject with a more specific message.
          return `'this.${e.member}' (derived properties are computed, not stored as columns)`;
        }
        const containment = agg.contains.find((c) => c.name === e.member);
        if (containment) {
          return `'this.${e.member}' (containments aren't queryable directly — see docs/language.md)`;
        }
        return `'this.${e.member}'`;
      }
      // `this.vo.sub` — value-object flattened column.  Verify vo
      // is a VO-typed field AND sub is a field on the VO.
      if (
        e.receiver.kind === "member" &&
        e.receiver.receiver.kind === "this" &&
        e.receiver.memberType.kind === "valueobject"
      ) {
        const voField = agg.fields.find(
          (f) => f.name === (e.receiver as { member: string }).member,
        );
        if (!voField) {
          return `'this.${(e.receiver as { member: string }).member}'`;
        }
        const voName =
          e.receiver.memberType.kind === "valueobject" ? e.receiver.memberType.name : "";
        const vo = ctx.valueObjects.find((v) => v.name === voName);
        if (vo?.fields.some((f) => f.name === e.member)) return null;
        return `'this.${(e.receiver as { member: string }).member}.${e.member}'`;
      }
      return null;
    }
    case "method-call":
      // Membership query (`this.<refColl>.contains(x)`) — verify the
      // collection field itself exists; the argument is a parameter,
      // not a column.
      return firstUnknownColumnRef(e.receiver, agg, ctx);
    default:
      return null;
  }
}

/** Returns a description of the first binary comparison whose two
 * sides are BOTH column references, or null if none exists. */
export function firstColumnVsColumn(e: ExprIR): string | null {
  if (e.kind === "binary") {
    if (
      ["==", "!=", "<", "<=", ">", ">="].includes(e.op) &&
      isColumnRef(e.left) &&
      isColumnRef(e.right)
    ) {
      return `${describeColumnRef(e.left)} vs ${describeColumnRef(e.right)}`;
    }
    return firstColumnVsColumn(e.left) ?? firstColumnVsColumn(e.right);
  }
  if (e.kind === "paren") return firstColumnVsColumn(e.inner);
  if (e.kind === "unary") return firstColumnVsColumn(e.operand);
  return null;
}

function isColumnRef(e: ExprIR): boolean {
  if (e.kind === "paren") return isColumnRef(e.inner);
  if (e.kind === "ref" && e.refKind === "this-prop") return true;
  if (e.kind === "member" && e.receiver.kind === "this") return true;
  if (e.kind === "member" && e.receiver.kind === "member" && e.receiver.receiver.kind === "this")
    return true;
  // A queryable scalar intrinsic over a column is still column-side —
  // `this.name.trim()` renders as SQL over the column, so a comparison
  // against another column must trip the column-vs-column gate too.
  if (
    e.kind === "method-call" &&
    e.receiverType.kind === "primitive" &&
    intrinsicFor(e.receiverType.name, e.member)?.queryable
  ) {
    return isColumnRef(e.receiver);
  }
  return false;
}

function describeColumnRef(e: ExprIR): string {
  if (e.kind === "paren") return describeColumnRef(e.inner);
  if (e.kind === "ref" && e.refKind === "this-prop") return `'this.${e.name}'`;
  if (e.kind === "member" && e.receiver.kind === "this") return `'this.${e.member}'`;
  if (e.kind === "member" && e.receiver.kind === "member" && e.receiver.receiver.kind === "this")
    return `'this.${e.receiver.member}.${e.member}'`;
  if (e.kind === "method-call") return `${describeColumnRef(e.receiver)}.${e.member}()`;
  return "<column>";
}

/** `isColumnRef`, plus the one column-side shape that is a `binary` node: the
 *  A5 temporal `this.due ± days(n)` form, which every backend renders as SQL
 *  interval arithmetic over the column (drizzle's `renderColumnRef` opens with
 *  exactly this arm).  Kept separate from `isColumnRef` because that helper
 *  feeds the column-vs-column gate, whose subject is a different question. */
function isColumnRooted(e: ExprIR): boolean {
  if (e.kind === "paren") return isColumnRooted(e.inner);
  if (e.kind === "binary" && (e.op === "+" || e.op === "-")) {
    const rightDur = durationCtorOperand(e.right);
    const leftDur = e.op === "+" ? durationCtorOperand(e.left) : null;
    const dur = rightDur ?? leftDur;
    const other = rightDur ? e.left : leftDur ? e.right : null;
    return dur !== null && other !== null && isColumnRooted(other);
  }
  return isColumnRef(e);
}

/** A column-rooted expression whose value is the primitive `bool` — the one
 *  shape that is a whole predicate on its own (`where this.active`,
 *  `where this.flags.active`).  A NON-column boolean (a `bool` parameter, a
 *  `currentUser.<claim>`, a literal) is deliberately excluded: see
 *  {@link firstNonQueryablePredicate}. */
function isColumnRootedBool(e: ExprIR): boolean {
  if (e.kind === "paren") return isColumnRootedBool(e.inner);
  const isBool = (t: { kind: string; name?: string } | undefined): boolean =>
    t?.kind === "primitive" && t.name === "bool";
  if (e.kind === "member" && isColumnRef(e)) return isBool(e.memberType);
  if (e.kind === "ref" && e.refKind === "this-prop") return isBool(e.type);
  return false;
}

/** Names the offending leaf in a `firstNonQueryablePredicate` refusal.  Kept
 *  apart from `describeColumnRef`, whose fall-through is `<column>` — the
 *  whole point of this message is that the leaf is NOT one. */
function describePredicateLeaf(e: ExprIR): string {
  if (e.kind === "paren") return describePredicateLeaf(e.inner);
  if (e.kind === "literal") return `the literal '${String(e.value)}'`;
  if (e.kind === "ref") return `'${e.name}' (a ${e.refKind})`;
  if (e.kind === "member" && e.receiver.kind === "ref" && e.receiver.refKind === "current-user")
    return `'currentUser.${e.member}'`;
  if (e.kind === "member") return `'${describeColumnRef(e)}'`;
  if (e.kind === "method-call") return `'.${e.member}(...)'`;
  return `a '${e.kind}' expression`;
}

/** Options for {@link firstNonQueryablePredicate}. */
export type PredicateGateOptions = {
  /** Set by a call site whose predicate was lowered WITHOUT an aggregate to
   *  resolve `this` against, so `memberType` is a placeholder rather than the
   *  column's type.  Today that is the context-level `filter` capability. */
  readonly thisTypesUnresolved?: boolean;
};

const PREDICATE_COMPARE_OPS: ReadonlySet<string> = new Set(["==", "!=", "<", "<=", ">", ">="]);

/** Returns null if `e` is a queryable expression IN PREDICATE POSITION;
 *  otherwise a short label describing the first offending node.
 *
 *  `firstNonQueryableNode` is position-BLIND — it walks a value tree and asks
 *  only "could this node reach SQL at all".  That is the right question for a
 *  comparison OPERAND and the wrong one for the predicate itself, because
 *  every relational lowerer's output vocabulary is `<fn>(<column>, <value>)`:
 *  there is no left-hand value position and no bare-value position.  So a
 *  predicate with NO column in it — `where true`, `where f` (a `bool`
 *  parameter), `where currentUser.isAdmin`, `where 1 == 1` — is admitted by
 *  the value oracle and then has nowhere to go: drizzle's find builder throws
 *  `QueryEmissionRefusal … the IR validator should have rejected this filter`
 *  (measured on all four shapes), MikroORM refuses it per-adapter through
 *  a per-adapter `loom.*-unsupported` code (now deleted), and EF Core / JPA /
 *  SQLAlchemy each emit
 *  a host-language boolean into a `WHERE`, which is a different query from the
 *  one that was written.  Four outcomes for one source, none of them a
 *  diagnostic — the same shape as the `contains(<column>)` crash, and closed
 *  the same way: target-neutrally, here, where every site and every backend
 *  consults it.
 *
 *  A predicate leaf must therefore be one of:
 *    - a comparison with at least one COLUMN-rooted operand,
 *    - a column-rooted `bool` standing alone (`where this.active`),
 *    - `this.<refColl>.contains(<value>)` membership,
 *    - a bool-returning queryable intrinsic (`where this.path.startsWith(p)`),
 *    - an authorization / tenancy filter sentinel,
 *  combined with `&&` / `||` / `!` / parentheses.  Everything inside those
 *  leaves is still judged by `firstNonQueryableNode`. */
export function firstNonQueryablePredicate(
  e: ExprIR,
  opts: PredicateGateOptions = {},
): string | null {
  const inner = e.kind === "paren" ? e.inner : e;
  if (inner.kind === "binary") {
    if (inner.op === "&&" || inner.op === "||") {
      return (
        firstNonQueryablePredicate(inner.left, opts) ??
        firstNonQueryablePredicate(inner.right, opts)
      );
    }
    if (PREDICATE_COMPARE_OPS.has(inner.op)) {
      const bad = firstNonQueryableNode(inner);
      if (bad) return bad;
      if (!isColumnRooted(inner.left) && !isColumnRooted(inner.right)) {
        return (
          `a comparison with no column on either side ('${inner.op}') — a query predicate is ` +
          `lowered as '<column> ${inner.op} <value>' on every adapter, so one side must read ` +
          `'this.<field>'`
        );
      }
      return null;
    }
    // Arithmetic standing alone as the whole predicate — not a boolean.
    return `arithmetic '${inner.op}' in predicate position`;
  }
  if (inner.kind === "unary") {
    if (inner.op === "!") return firstNonQueryablePredicate(inner.operand, opts);
    return `unary '${inner.op}' in predicate position`;
  }
  if (inner.kind === "authz-filter") return null;
  if (isColumnRootedBool(inner)) return null;
  // A CONTEXT-LEVEL `filter` is lowered without an aggregate to resolve `this`
  // against, so its member accesses carry a fall-through `string` type rather
  // than the column's real one (measured: `filter !this.isDeleted` over a
  // declared `isDeleted: bool` lowers with `memberType: primitive string`).
  // Judging the leaf's TYPE there would refuse every context-level boolean
  // filter, so the caller says so and the gate checks STRUCTURE only — the
  // column still has to exist, which `firstUnknownColumnRef` has already
  // established per propagated aggregate before this gate runs.
  if (opts.thisTypesUnresolved && isColumnRef(inner)) return null;
  if (inner.kind === "method-call") {
    // `this.<refColl>.contains(x)` membership and a bool-returning queryable
    // intrinsic are both whole predicates; `firstNonQueryableNode` owns the
    // shape rules for each (including the argument / receiver position
    // checks), so defer to it rather than restating them.
    const isMembership =
      inner.member === "contains" &&
      inner.receiverType.kind === "array" &&
      inner.receiverType.element.kind === "id";
    const sig =
      inner.receiverType.kind === "primitive"
        ? intrinsicFor(inner.receiverType.name, inner.member)
        : undefined;
    const isBoolIntrinsic =
      sig?.queryable === true &&
      inner.receiverType.kind === "primitive" &&
      intrinsicReturnType(sig, inner.receiverType.name) === "bool";
    if (isMembership || isBoolIntrinsic) return firstNonQueryableNode(inner);
  }
  const bad = firstNonQueryableNode(inner);
  if (bad) return bad;
  // A `this`-rooted COLUMN standing alone is the one refusal this gate cannot
  // tell apart from a MISSING column: the lowerer types an undeclared
  // `this.isDeleted` as `primitive string`, byte-identical to a real `string`
  // field (measured).  So DEFER it — the caller runs `firstUnknownColumnRef`
  // first, whose "unknown field" is the better answer when the column does not
  // exist, and falls back to {@link bareColumnPredicateLeaf} when it does.
  // Deferring only this ONE shape is what keeps the gate's own verdicts
  // (`collection op '.any'`, `lambda`, arithmetic, a comparison with no column)
  // authoritative: those are never a missing-column report.
  if (isBareColumnLeaf(inner)) return null;
  return notAPredicate(inner);
}

/** A `this`-rooted column reached as a plain member / bare `this-prop` ref —
 *  NOT a method-call over one.  `this.code.startsWith(p)` is column-rooted too,
 *  but it is a bool-returning intrinsic and therefore a whole predicate, so it
 *  must never reach the deferral. */
function isBareColumnLeaf(e: ExprIR): boolean {
  const inner = e.kind === "paren" ? e.inner : e;
  if (inner.kind !== "member" && inner.kind !== "ref") return false;
  return isColumnRef(inner);
}

/** The refusal {@link firstNonQueryablePredicate} defers: a `this`-rooted
 *  column standing alone in predicate position that is NOT a boolean
 *  (`where this.code`).  Call it after `firstUnknownColumnRef` has declined —
 *  at that point the column exists, so the shape really is the problem. */
export function bareColumnPredicateLeaf(e: ExprIR): string | null {
  const inner = e.kind === "paren" ? e.inner : e;
  if (inner.kind === "binary") {
    if (inner.op === "&&" || inner.op === "||") {
      return bareColumnPredicateLeaf(inner.left) ?? bareColumnPredicateLeaf(inner.right);
    }
    return null;
  }
  if (inner.kind === "unary" && inner.op === "!") return bareColumnPredicateLeaf(inner.operand);
  if (isColumnRootedBool(inner)) return null;
  if (isBareColumnLeaf(inner)) return notAPredicate(inner);
  return null;
}

function notAPredicate(inner: ExprIR): string {
  return (
    `${describePredicateLeaf(inner)} is not a predicate — a query filter must TEST a column ` +
    `(a comparison, a boolean column, a '.contains(...)' membership, or a combination of them ` +
    `with '&&' / '||' / '!'), not evaluate to a value the database never sees`
  );
}

/** Returns null if the expression is fully queryable; otherwise a
 * short label describing the first non-queryable node encountered.
 * The label is human-readable (`"collection op .where"`,
 * `"lambda"`, `"call to function 'X'"`) so the diagnostic message
 * can be specific. */
// Exported for the queryable-subset parity test
// (`test/ir/queryable-subset-parity.test.ts`), which pins the invariant
// that everything this gate admits, `lowerToDrizzle` can lower.
export function firstNonQueryableNode(e: ExprIR): string | null {
  switch (e.kind) {
    case "literal":
    case "this":
    case "id":
      return null;
    case "ref":
      // Refs the lowering produces that translate cleanly to SQL —
      // `param`/`let`/`lambda` are bare identifiers, `this-prop`
      // becomes `tableName.col`, `enum-value` becomes a literal
      // string.  `current-user` is a closure-captured value; the
      // renderer threads a `currentUser` parameter through the repo
      // method and the ref / its member accesses become plain JS / C#
      // value references.
      //
      // NOTE: `this-vo-prop` is deliberately NOT admitted here.  A
      // value-object sub-property is queryable only in its
      // `this.<vo>.<sub>` MEMBER form (handled by the `member` case
      // below, which Drizzle flattens to a `<vo>_<sub>` column).  A
      // *bare* `this-vo-prop` ref carries only the sub-property name,
      // not its parent VO field, so it cannot form the flattened
      // column — `lowerToDrizzle` returns null for it.  (It is only
      // produced inside a value-object's own body, never in an
      // aggregate find/retrieval `where`, so this rejects an
      // unreachable shape rather than a real one — but admitting it
      // would let an internal-error throw replace a clean diagnostic
      // if it ever became reachable.)
      if (
        e.refKind === "param" ||
        e.refKind === "let" ||
        e.refKind === "lambda" ||
        e.refKind === "this-prop" ||
        e.refKind === "enum-value" ||
        e.refKind === "current-user"
      )
        return null;
      return `ref to '${e.name}' (${e.refKind})`;
    case "paren":
      return firstNonQueryableNode(e.inner);
    case "unary":
      if (e.op === "!") return firstNonQueryableNode(e.operand);
      return `unary '${e.op}'`;
    case "binary":
      switch (e.op) {
        case "==":
        case "!=":
        case "<":
        case "<=":
        case ">":
        case ">=":
        case "&&":
        case "||":
          return firstNonQueryableNode(e.left) ?? firstNonQueryableNode(e.right);
        default: {
          // A5 temporal: `datetime ± days/hours/minutes(n)` IS
          // queryable — the Drizzle lowerer renders SQL interval arithmetic
          // (`col ± make_interval(days => n)`), and the other backends'
          // universal renderers translate it natively.  Only the DIRECT
          // constructor form is admitted (paren-transparent); a duration-
          // typed `let` / a `duration ± duration` composite stays rejected —
          // exactly the subset `lowerToDrizzle` lowers (see the parity test).
          // Loom `datetime - datetime` in where-position also stays rejected
          // (falls through: neither operand is a duration constructor).
          if (e.op === "+" || e.op === "-") {
            const rightDur = durationCtorOperand(e.right);
            const leftDur = e.op === "+" ? durationCtorOperand(e.left) : null;
            const dur = rightDur ?? leftDur;
            const other = rightDur ? e.left : leftDur ? e.right : null;
            if (dur && other && !durationCtorOperand(other) && isDatetimeTypedIR(other)) {
              return firstNonQueryableNode(other) ?? firstNonQueryableNode(dur.amount);
            }
          }
          return `arithmetic '${e.op}'`;
        }
      }
    case "member":
      // Reject any member access whose receiver evaluates to a
      // collection — `.count`, `.first`, `.length`, etc. are
      // projections that need a SQL subquery to express, which
      // the queryable sublanguage doesn't support.
      if (e.receiverType.kind === "array") {
        return `collection projection '.${e.member}' on a list`;
      }
      // Allowed member-access shapes:
      //   - `this.col`               — direct column
      //   - `this.vo.sub`            — value-object's flattened column
      //   - `currentUser.<field>`    — row-level filter; the
      //                                renderer threads a `currentUser`
      //                                parameter so the access becomes
      //                                a plain JS / C# value reference.
      if (e.receiver.kind === "this") return null;
      if (
        e.receiver.kind === "member" &&
        e.receiver.receiver.kind === "this" &&
        e.receiver.memberType.kind === "valueobject"
      )
        return null;
      if (e.receiver.kind === "ref" && e.receiver.refKind === "current-user") return null;
      return "member access not rooted at 'this' or beyond a flattened value object";
    case "method-call":
      // (The `deep` / DENY authorization filter sentinels are NOT `method-call`
      // nodes — they are the discriminated `authz-filter` kind, admitted in its
      // own arm below.)
      // Membership over a reference collection — `this.<refColl>.contains(x)`
      // — is the one collection op we admit: it lowers to an EXISTS-style
      // subquery against the field's join table.  Everything else
      // (`.count`, `.any`, `.where`, …) still needs richer SQL we don't
      // emit, so stays rejected.
      if (
        e.member === "contains" &&
        e.receiverType.kind === "array" &&
        e.receiverType.element.kind === "id" &&
        isColumnRef(e.receiver) &&
        e.args.length === 1
      ) {
        // The ARGUMENT is BOUND, on every adapter: the subquery is
        // `<targetFk> = ?` (drizzle `inArray`, Dapper / MikroORM a raw
        // fragment, EF Core `Any(...)` over a closed-over value), so a COLUMN
        // there has nowhere to go.  `firstNonQueryableNode` alone admits it —
        // a column is perfectly queryable in a general predicate — which is why
        // this is a POSITION check, the same shape as the `startsWith` receiver
        // check below.
        //
        // Reachable only from a query-time `projection … where`, which has no
        // parameters to bind: `where o.tags.contains(o.id)` validated clean on a
        // bare `platform: node` deployable and then CRASHED codegen ("internal:
        // where-clause for projection 'X' could not lower to Drizzle, but the
        // validator should have caught this") — the adapter gate that refuses it
        // under `persistence: mikroorm` keys on `dep.persistence`, which a
        // deployable using the DEFAULT adapter does not carry, so it never ran
        // (ledger `drizzle-projection-membership-column-arg-crash`).  The shape
        // is unlowerable on all five, so the refusal is target-neutral and lands
        // here rather than in a per-adapter descriptor.
        const arg = e.args[0]!;
        const argInner = arg.kind === "paren" ? arg.inner : arg;
        if (isColumnRef(argInner)) {
          return (
            `'.contains(<column>)' — a reference-collection membership binds its ` +
            `argument as a query parameter on every adapter, so it must be a value ` +
            `(a parameter, a literal, or a 'currentUser' claim), not another column`
          );
        }
        return firstNonQueryableNode(arg);
      }
      // Queryable scalar intrinsics (src/util/intrinsics.ts) — an op the
      // catalogue marks `queryable` is admitted when its receiver and every
      // argument are themselves queryable (every backend's predicate
      // renderer carries a matching SQL arm, pinned by the intrinsic
      // completeness test).  A non-queryable intrinsic reports itself by
      // name so `loom.find-where-not-queryable` stays actionable.
      if (e.receiverType.kind === "primitive") {
        const sig = intrinsicFor(e.receiverType.name, e.member);
        if (sig?.queryable) {
          // A BOOL-returning queryable intrinsic (`startsWith`) is a whole
          // PREDICATE, not a comparison operand, so its receiver has to be the
          // COLUMN — every backend renders it as `<sqlfn>(col, value)`, reaching
          // its snippet table from the column-position renderer.  Swap the sides
          // (`p.startsWith(this.path)` — the ancestor mirror of the subtree read)
          // and the receiver is a value: drizzle's `renderColumnRef` returns null
          // → the find builder throws its internal "validator should have caught
          // this", Java's Criteria arm throws `unsupported`, and Python renders
          // the HOST `p.startswith(...)` against a column attribute — a runtime
          // TypeError, not a predicate.  Three outcomes for one source, none of
          // them a diagnostic, all freshly reachable when `startsWith` became
          // queryable, and exactly the crash class this operator's PR fixed for
          // Dapper.  So reject the shape HERE, where the two throwing backends
          // both say it should have been rejected.
          //
          // Scalar intrinsics are unaffected: they only ever appear as comparison
          // operands, where a value receiver (`this.name == q.trim()`) is
          // legitimate and renders host-side.  Supporting the swapped-side form
          // would mean teaching three renderers to bind a value receiver against
          // a column argument — a real feature, with its own runtime fixture,
          // not a validator relaxation.
          if (
            intrinsicReturnType(sig, e.receiverType.name) === "bool" &&
            !isColumnRef(e.receiver)
          ) {
            return (
              `intrinsic '.${e.member}' on a non-column receiver ` +
              `(a bool-returning queryable intrinsic is the whole predicate, so it must read ` +
              `'this.<column>.${e.member}(<value>)')`
            );
          }
          const recv = firstNonQueryableNode(e.receiver);
          if (recv) return recv;
          for (const a of e.args) {
            const bad = firstNonQueryableNode(a);
            if (bad) return bad;
          }
          return null;
        }
        if (sig) return `non-queryable intrinsic '.${e.member}'`;
      }
      return `collection op '.${e.member}'`;
    case "lambda":
      return "lambda";
    case "call":
      return `call to '${e.name}' (${e.callKind})`;
    case "new":
      return `'new ${e.partName}' construction`;
    case "object":
      return "object literal";
    case "ternary":
      return "ternary";
    case "convert":
      // Primitive conversions don't lower to SQL — they're per-
      // host coercions (`String(x)`, `Decimal.to_string`, etc.).
      // Reject in queryable contexts; the user should restructure
      // the query to avoid the conversion (e.g. cast on the DB
      // side via a `derived` projection if needed).
      return `conversion to '${e.target}'`;
    case "duration":
      // A5 temporal: a duration constructor is queryable when its amount
      // is (a literal / param binds; a column interpolates) — the Drizzle
      // lowerer renders it (ms on the value side, `make_interval` on the
      // column side).  Every duration unit is absolute (fixed width), so
      // there is no calendar-relative carve-out here.
      return firstNonQueryableNode(e.amount);
    case "i18nFormat":
      // Transparent i18n wrapper (M-T1.11) — a display-formatting node that
      // only rides user-visible templates, never a find `where`; queryability
      // follows the wrapped value.
      return firstNonQueryableNode(e.inner);
    case "match":
      // `match { ... }` is a value-producing expression but contains
      // arbitrary arm conditions / values; it doesn't translate to a
      // single SQL fragment.  Same posture as ternary in v22 — reject
      // from the queryable sublanguage; full match semantics live in
      // the application layer / generator.
      return "match expression";
    case "list":
      // Bracketed list literals are walker-config sugar (e.g. responsive
      // Grid cols) — never queryable.
      return "list literal";
    case "action-ref":
      // A named-action reference is a UI-handler-arg form — never queryable
      // (it only appears in a page/component body, not a find `where`).
      return "action reference";
    case "authz-filter":
      // The authorization/tenancy filter sentinels (M-T9.9) — both the `deny`
      // carve-out and the `scope` subtree predicate.  Every backend renders
      // them to a native query fragment (see `DEEP_SCOPE_SEMANTICS` / the
      // always-false fragments), so they are queryable by construction — admit
      // them rather than have the tenant-floor rewrite trip the selectability
      // gate.
      return null;
    default: {
      // Wave 2 packet 2.3 — every `ExprIR` kind is already listed above;
      // this turns that into a compile-time guarantee.
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}

/** Visit `e` and every sub-expression.  Thin alias over the shared, exhaustive
 *  {@link walkExprDeep} (`src/ir/util/walk.ts`) — kept as a named re-export so
 *  the many `checks/*` call sites need no churn.  A hand-rolled copy here would
 *  drift on `convert.value`, `list.elements`, and block-body lambda
 *  statements. */
export const walkExpr = walkExprDeep;

/** repository name → the OTHER context that declares it (first wins).  Names
 *  `ctx` itself declares are EXCLUDED, so a locally-resolving read is never a
 *  candidate and a same-name repository in two contexts keeps resolving
 *  locally.
 *
 *  Shared by the two gates that reject a body reaching across the context
 *  boundary for a repository — `loom.domain-service-cross-context-read`
 *  (`domain-service-checks.ts`) and `loom.workflow-cross-context-repository`
 *  (`workflow-checks.ts`).  Both rest on the same mechanism: the lowerer indexes
 *  the repositories it resolves reads against from the ENCLOSING context's
 *  members alone, so a foreign name never resolves and survives into the IR as a
 *  `ref` with `refKind: "unknown"`. */
export function foreignRepositoryOwners(
  ctx: BoundedContextIR,
  allCtxs: readonly BoundedContextIR[],
): ReadonlyMap<string, string> {
  const local = new Set(ctx.repositories.map((r) => r.name));
  const owners = new Map<string, string>();
  for (const other of allCtxs) {
    if (other.name === ctx.name) continue;
    for (const repo of other.repositories) {
      if (local.has(repo.name) || owners.has(repo.name)) continue;
      owners.set(repo.name, other.name);
    }
  }
  return owners;
}
