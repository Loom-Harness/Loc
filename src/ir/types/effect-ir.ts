// The closed effect vocabulary of a workflow / handler body.
//
// A body statement does one of a fixed set of things to the world: it reads
// rows, constructs an aggregate, mutates one (or the workflow's own state),
// removes one, emits an event, calls out of the body, or returns.  Persisting
// is NOT a statement: the body writes every aggregate it created or mutated
// once, at its exit (or at the end of a loop iteration / branch, whose saves
// the enclosing statement carries).  An explicit `Repo.save(x)` is refused at
// phase ④ (`loom.workflow-explicit-save`), so a `persist` effect only ever
// comes from those derived save lists.
//
// Effects are DERIVED from the lowered `WorkflowStmtIR` body on demand
// (`ir/util/effects.ts`), never stamped: the statements are the input, and an
// effect list is a pure function of them.  The union is closed so a consumer
// (a validator asking "does this create write state?", a test pinning "this
// body has exactly these effects") switches over it exhaustively.
//
// Nesting is carried as a `scope` path rather than as nested effect lists, so
// a consumer that only asks "is there an X anywhere" scans one flat list, and
// a consumer that cares where an effect sits reads its scope.  A new nesting
// construct (a procedural `for` outside a workflow) adds an `EffectScopeIR`
// kind, not a new effect.

import type { RepoOp } from "../../util/repository-contract.js";
import type { ExprIR } from "./loom-ir.js";

/** One level of nesting an effect sits under.  `iteration` is a `for` loop
 *  body (`var` is the loop variable); `branch` is an `if let` arm (`var` is the
 *  arm's binder — bound only in `then`). */
export type EffectScopeIR =
  | { kind: "iteration"; var: string }
  | { kind: "branch"; arm: "then" | "else"; var: string };

/** What a `call` effect calls: a domain-service operation, a verb on an
 *  ambient resource handle, or a typed operation of an in-system api. */
export type CallTargetIR =
  | { kind: "domain-service"; service: string; op: string }
  | { kind: "resource"; resource: string; verb: string }
  | { kind: "remote-api"; resource: string; api: string; operationId: string };

/** What a `mutate` effect writes: an aggregate held by a local (through one of
 *  its operations), or a field of the workflow's own state. */
export type MutateTargetIR =
  | { kind: "aggregate"; name: string; aggName: string; op: string }
  | { kind: "state"; field: string };

interface EffectBase {
  /** Outermost first; empty at the top level of the body. */
  scope: readonly EffectScopeIR[];
}

export type EffectIR =
  /** A repository read.  `binds` is the local the result lands in (absent for
   *  a read inside an expression). */
  | (EffectBase & {
      kind: "load";
      op: Exclude<RepoOp, "remove">;
      repoName: string;
      aggName: string;
      binds?: string;
    })
  /** An aggregate constructed through its factory, bound to `binds`. */
  | (EffectBase & { kind: "create"; aggName: string; binds: string })
  | (EffectBase & { kind: "mutate"; target: MutateTargetIR })
  /** A derived save: the aggregate held by `name` is written at the end of the
   *  effect's scope. */
  | (EffectBase & { kind: "persist"; name: string; aggName: string; repoName: string })
  | (EffectBase & { kind: "delete"; repoName: string; aggName: string; entity: ExprIR })
  | (EffectBase & { kind: "emit"; eventName: string })
  | (EffectBase & { kind: "call"; target: CallTargetIR })
  /** The body's result value (`create(…): T` / a handler's `return`). */
  | (EffectBase & { kind: "return"; value: ExprIR });

export type EffectKind = EffectIR["kind"];
