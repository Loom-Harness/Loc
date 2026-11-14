import type { ExprIR, VariantArmBinding, VariantSubject } from "./expr.js";
import type { MessageIR } from "./members.js";
import type { Sourced, TypeIR } from "./types.js";

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export type StmtIR = (
  | ({ kind: "precondition"; expr: ExprIR; source: string } & Messaged)
  | {
      kind: "requires";
      expr: ExprIR;
      source: string;
      /** Set on the write gate enrichment prepends to an operation that
       *  assigns a caller-supplied value to a `mask unless` field
       *  (`applyMaskWriteGates`, `src/ir/enrich/mask-taint.ts`) — the masked
       *  field's name.  It authorizes the WRITE of that one field only, so it
       *  is not the operation's own exposure gate (`validateDefaultDeny`) and
       *  not a client-evaluable action gate. */
      maskWriteOf?: string;
    }
  | { kind: "let"; name: string; expr: ExprIR; type: TypeIR }
  | ({
      kind: "assign";
      target: PathIR;
      value: ExprIR;
      targetType: TypeIR;
    } & ProvSited)
  | ({
      kind: "add";
      target: PathIR;
      value: ExprIR;
      elementType: TypeIR;
      /** True when the target is a collection (append); false for a
       *  scalar compound `+=` (arithmetic).  Domain bodies only ever emit
       *  collection `add`; page handlers overload it for counters, so the
       *  walker reads this to choose `[...xs, v]` vs `x + v`. */
      collection: boolean;
    } & ProvSited)
  | ({
      kind: "remove";
      target: PathIR;
      value: ExprIR;
      elementType: TypeIR;
      /** True when the target is a collection (remove element); false for
       *  a scalar compound `-=` (arithmetic). */
      collection: boolean;
    } & ProvSited)
  | {
      kind: "emit";
      eventName: string;
      fields: { name: string; value: ExprIR }[];
    }
  | {
      kind: "call";
      target: "function" | "private-operation" | "action" | "store-action";
      name: string;
      args: ExprIR[];
      /** Populated when `target === "store-action"` (Stage 5) — the resolved
       *  store the `<Store>.<action>(…)` call dispatches to.  `name` is the
       *  action; backends bind the store action without re-resolving. */
      store?: string;
      /** Populated when `target === "private-operation"` — the resolved privacy
       *  of the target sibling operation (see the ExprIR `call` node's
       *  `targetPrivate`).  Absent (⇒ public) for `function` and the rest. */
      targetPrivate?: boolean;
    }
  /**
   * Bare expression-statement.  Used when a chained call like
   * `a.b.c(args)` appears as an operation- or test-body statement.
   * Renderers emit `<expr>;` (TS / e2e) or `<expr>;` (C#).
   */
  | { kind: "expression"; expr: ExprIR }
  /**
   * Effect-form variant `match` — a `match SUBJECT { Variant b => <stmts> }`
   * used for its side effects, where each arm runs a statement block rather
   * than yielding a value (the statement twin of the `match` ExprIR).
   *
   * Two homes.  In a frontend action body the subject is usually an awaited
   * remote call (`match await op() { … }`, a `call`/`method-call` ExprIR with
   * `awaited: true`), and the walker renders the async envelope (await the
   * mutation, reify the thrown error into the error variant) + a discriminant
   * switch.  In an operation / `create` / `destroy` / domain-service body the
   * subject is a value the body already holds, and the shared `_stmt/target.ts`
   * spine hands each backend the rendered arm bodies.  A `T?` subject is a
   * presence check (`subjectShape: "absence"`): its arm bindings are aliased
   * to the subject at lowering, so the backends render an if/else.
   */
  | ({
      kind: "variant-match";
      subject: ExprIR;
      arms: ({
        varType: TypeIR;
        body: StmtIR[];
      } & VariantArmBinding)[];
    } & VariantSubject &
      ElseBranch<StmtIR>)
  /**
   * `if <cond> { … } else { … }` — the plain boolean conditional.  One of the
   * two NESTING statements a backend body can contain (with `variant-match`),
   * so the shared `_stmt/target.ts` spine recurses into the two branches and
   * hands each backend the rendered blocks, exactly as `renderWorkflowStmts`
   * does for `for-each` / `if-let`.
   *
   * `else if` chains lower to a single-statement `elseBody` holding the next
   * `if` — there is no separate else-if node, so every consumer sees one
   * shape.  `elseBody` is absent (not empty) when the source had no `else`.
   */
  | ({
      kind: "if";
      cond: ExprIR;
      thenBody: StmtIR[];
    } & ElseBranch<StmtIR>)
  /**
   * `return <expr>` — an operation's designed-in outcome
   * (exception-less.md).  `value` produces the operation's declared
   * `or`-union return; the route translator maps an `error`-variant result
   * to a ProblemDetails status and a success variant to HTTP 200.
   *
   * In a union-returning operation, lowering tags the return with the matching
   * variant: `variantTag` is the wire discriminator, `variantShape` says how
   * the value carries on the wire — `"record"` (fields flattened beside
   * `type`), `"scalar"` (a single `value` field), or `"none"` (the bare unit).
   * Absent when the operation has no union return (a plain value return).
   */
  | {
      kind: "return";
      value: ExprIR;
      variantTag?: string;
      variantShape?: "record" | "scalar" | "none";
      /**
       * A returned value `match` whose arms build union variants is tagged per
       * arm: one entry per arm (`arms` for the predicate form, `variantArms`
       * for the variant form), then one for its `else`.  Each arm answers its
       * own tag, and an `error` variant is the error path only when its arm
       * runs.  Set only on an exhaustive match whose every arm resolves to a
       * declared variant; `variantTag` / `variantShape` are absent then.
       * `distributeUnionReturn` (`src/ir/util/union-return.ts`) expands it
       * into one tagged `return` per arm.
       */
      armVariants?: ReturnVariantIR[];
    }
) &
  Sourced;

/** A conditional statement's `else` block, shared by every branching
 *  statement of both statement languages.  Absent (not empty) when the
 *  source wrote no `else`; an `else if` chain lowers to a one-statement
 *  `elseBody` holding the next `if`. */
export interface ElseBranch<S> {
  elseBody?: S[];
}

/** A failing check's declared message, shared by both statement languages'
 *  `precondition`.  Present for a NAMED rule: it carries the rule's key and
 *  text to the 4xx body; absent for an anonymous check. */
export interface Messaged {
  message?: MessageIR;
}

/** The provenance rule snapshot of an assignment to a `provenanced` field
 *  (`assign` / `add` / `remove`); absent when the target is not
 *  provenanced. */
export interface ProvSited {
  prov?: ProvSite;
}

/** The union variant a `return` produces: its wire discriminator and how the
 *  value carries on the wire (see the `return` statement). */
export interface ReturnVariantIR {
  variantTag: string;
  variantShape: "record" | "scalar" | "none";
}

/**
 * A path used as the LHS of an assignment / collection mutation.  All
 * paths are rooted in `this` (the enclosing aggregate).  The first
 * segment is the property/containment name on the root; subsequent
 * segments walk into nested structure.  Paths never reference parameters
 * or let-bindings (those are not assignable in Loom).
 */
export interface PathIR {
  segments: string[];
}

/**
 * Per-write-site provenance metadata, attached to an `assign`/`add`/`remove`
 * statement whose target resolves to a `provenanced` stored field.  Each
 * site is its own immutable rule snapshot: the RHS expression structure
 * (`exprText` + the lowered `value` ExprIR) anchored at a source span.
 * The runtime trace records which write produced the field's current value
 * and points back at `snapshotId`.
 */
export interface ProvSite {
  /** Stable hash of source path + target + span (commit-independent). */
  snapshotId: string;
  /** Resolved aggregate type + field name this write targets. */
  target: { type: string; field: string };
  /** Source text of the RHS expression (structure, no runtime values). */
  exprText: string;
  source: { path: string; span: { start: number; end: number } };
}
