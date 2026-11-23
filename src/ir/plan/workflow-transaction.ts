// Whether a workflow's command body runs in one transaction, and the isolation
// level that transaction pins.
//
// A body runs in one transaction exactly when the workflow is declared
// `transactional`: the keyword is the only way a workflow gets one, so every
// boundary is visible in the source.  Two shapes need the whole body to roll
// back together — a `create` that answers an expected failure (`T or E`: an
// error answer rolls the command back) and a body that re-checks a held row's
// write scope (a row outside the scope fails the command after it may already
// have changed others) — and a workflow with either shape that does not say
// `transactional` is refused (`loom.workflow-implicit-transaction`).
//
// The isolation level is the workflow's own `transactional(<level>)`, else
// its context's state dataSource `isolationLevel:`.
//
// A reaction — an `on` reactor or an event-triggered `create` — always runs in
// one transaction, however the event arrived: a failed reaction leaves none of
// its effects (workflow.md § "Reactor failures"), so the saves a loop made
// before a later row failed roll back with it.  A durably delivered event is
// claimed in the consumer inbox inside that same transaction.  Events the
// reaction's saves raise are dispatched once it has committed.
//
// A command handler always runs in one transaction (D-HANDLER-TX): a failure
// part-way through its body — a loop that saved a row, then refused a later
// one — leaves none of its writes, on every backend.  An expected-failure
// `error` answer rolls it back too.  A resource call inside the handler runs
// inside that transaction, in statement order; its outside effect does not
// roll back with it.  A query handler writes nothing and needs none.
//
// A workflow-level `emit` of a DURABLE event type (one a `retention: log |
// work` channel carries) is owed exactly when the workflow's writes commit.
// When the body runs in a transaction, its outbox row is therefore written by
// that transaction, before the commit, and only the rest of the workflow's
// events are dispatched after it.  Written after the commit instead, a crash
// in between loses an event whose writes already committed.

import type {
  BoundedContextIR,
  CommandHandlerIR,
  IsolationLevel,
  QueryHandlerIR,
  SystemIR,
  WorkflowIR,
  WorkflowStmtIR,
} from "../types/loom-ir.js";
import { durableEventTypes } from "../util/channels.js";
import { resolveWorkflowIsolation } from "../util/resolve-datasource.js";
import { workflowEmits } from "../util/walk.js";
import { commandCreateEntryResult } from "../util/workflow-command-route.js";
import { bodyWriteScopeGuards, writeScopeContext } from "../util/write-scope-guards.js";
import { workflowClaims } from "./consumer-inbox.js";

/** True when the workflow's command body runs in one transaction.  This is
 *  the transaction boundary every backend keeps: any other workflow commits
 *  each save on its own, so a failure keeps the rows saved before it. */
export function workflowRunsInTransaction(
  wf: WorkflowIR,
  _ctx: BoundedContextIR | undefined,
): boolean {
  return !!wf.transactional;
}

/** Why the workflow's body must roll back as a whole, or `undefined` when it
 *  need not: it answers an expected failure (`T or E`), or it re-checks a held
 *  row's write scope.  Such a workflow must be declared `transactional`.
 *  Without `ctx` (no owning context known) a write-scope re-check cannot be
 *  seen. */
export function workflowRequiresTransaction(
  wf: WorkflowIR,
  ctx: BoundedContextIR | undefined,
): "entry-result" | "write-scope-recheck" | undefined {
  if (commandCreateEntryResult(wf) !== undefined) return "entry-result";
  if (
    ctx !== undefined &&
    bodyWriteScopeGuards(wf.statements, writeScopeContext(wf.statements, ctx)).length > 0
  )
    return "write-scope-recheck";
  return undefined;
}

/** A body that may hold a database transaction: a workflow's command
 *  `create`, a reaction (an `on` reactor or an event-triggered `create`), or a
 *  routed command / query handler. */
export type TransactionScope =
  | { readonly kind: "workflow"; readonly wf: WorkflowIR }
  | { readonly kind: "reaction"; readonly wf: WorkflowIR }
  | { readonly kind: "command-handler"; readonly handler: CommandHandlerIR }
  | { readonly kind: "query-handler"; readonly handler: QueryHandlerIR };

/** Whether a body holds a transaction, and the isolation level it pins. */
export interface BodyIsolation {
  /** True when the body runs inside one database transaction. */
  readonly holdsTransaction: boolean;
  /** The level the transaction pins, or `undefined` for the connection
   *  default.  Only a body that holds a transaction has one. */
  readonly level?: IsolationLevel;
}

/** The transaction a body holds and its isolation level — the one answer every
 *  backend renders, so no backend decides a body's boundary or level itself.
 *
 *  - a workflow's command `create` holds one exactly when the workflow is
 *    `transactional`; its level is the workflow's own `transactional(<level>)`,
 *    else its owning context's state dataSource `isolationLevel:`;
 *  - a reaction always holds one, at the connection default;
 *  - a command handler always holds one (D-HANDLER-TX), at the connection
 *    default; a query handler writes nothing and holds none.
 *
 *  `ctx` is the body's OWNING context (a merged multi-context deployable's
 *  context is not); without `ctx` and `sys` only a workflow's own level is
 *  known. */
export function bodyIsolation(
  scope: TransactionScope,
  ctx?: BoundedContextIR,
  sys?: SystemIR,
): BodyIsolation {
  switch (scope.kind) {
    case "workflow": {
      const wf = scope.wf;
      if (!workflowRunsInTransaction(wf, ctx)) return { holdsTransaction: false };
      const level = sys && ctx ? resolveWorkflowIsolation(wf, ctx, sys) : wf.isolation;
      return level === undefined ? { holdsTransaction: true } : { holdsTransaction: true, level };
    }
    case "reaction":
      return { holdsTransaction: true };
    case "command-handler":
      return { holdsTransaction: true };
    case "query-handler":
      return { holdsTransaction: false };
    default: {
      const never: never = scope;
      return never;
    }
  }
}

/** True when the workflow's command body runs in a transaction AND emits a
 *  durable event type, so the transaction must capture those events' outbox
 *  rows before it commits. */
export function workflowCapturesDurableEmits(wf: WorkflowIR, ctx: BoundedContextIR): boolean {
  if (!workflowRunsInTransaction(wf, ctx)) return false;
  const durable = durableEventTypes(ctx);
  return workflowEmits(wf.statements).some((st) => durable.has(st.eventName));
}

/** How a reaction (`on` reactor or event-triggered `create`) of `wf` runs:
 *  always in one transaction, claiming a durably delivered event in the
 *  consumer inbox inside it when the deployable delivers durably
 *  (`receivesDurable`). */
export interface ReactionBoundary {
  readonly transaction: true;
  readonly claimsInbox: boolean;
}

export function reactionBoundary(wf: WorkflowIR, receivesDurable: boolean): ReactionBoundary {
  return { transaction: true, claimsInbox: workflowClaims(wf, receivesDurable) };
}

/** The transaction scope of a routed handler, by its role. */
export function handlerScope(
  handler: CommandHandlerIR | QueryHandlerIR,
  role: "command" | "query",
): TransactionScope {
  return role === "command"
    ? { kind: "command-handler", handler: handler as CommandHandlerIR }
    : { kind: "query-handler", handler: handler as QueryHandlerIR };
}

/** One workflow body that runs inside a database transaction. */
export interface TransactionBody {
  /** How the author names the body: `create`, `create(<Event>)`, `on(<Event>)`. */
  readonly label: string;
  /** True for a reaction (`on` reactor, event-triggered `create`). */
  readonly reaction: boolean;
  readonly statements: readonly WorkflowStmtIR[];
}

/** The workflow's bodies that run inside a transaction: every reaction (an
 *  `on` reactor or an event-triggered `create`) always, and the command
 *  `create`s when the workflow is `transactional`. */
export function workflowTransactionBodies(wf: WorkflowIR): TransactionBody[] {
  const out: TransactionBody[] = [];
  for (const c of wf.creates) {
    if (c.triggerKind === "event") {
      out.push({
        label: `create(${c.eventRef ?? "event"})`,
        reaction: true,
        statements: c.statements,
      });
    } else if (workflowRunsInTransaction(wf, undefined)) {
      out.push({
        label: c.name ? `create ${c.name}` : "create",
        reaction: false,
        statements: c.statements,
      });
    }
  }
  for (const s of wf.subscriptions ?? []) {
    out.push({ label: `on(${s.event})`, reaction: true, statements: s.statements });
  }
  return out;
}
