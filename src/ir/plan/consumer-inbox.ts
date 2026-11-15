// The consumer inbox: how a durably delivered event is applied once.
//
// A durable delivery (the outbox relay, or a broker consumer of a
// `retention: work | log` channel) carries the envelope id, and the delivery
// is at-least-once: the same id can arrive twice, on one replica or on two at
// the same time.  Every in-process consumer that applies it — a projection
// fold, an event-triggered `create` starter, an `on` handler of a workflow
// (state-based or event-sourced) — claims `(consumer, event_id)` in the inbox
// in the SAME transaction as its effects:
//
//   insert into __loom_inbox (consumer, event_id, received_at) … on conflict do nothing
//
// A claim that inserts no row means the event was already applied, so the
// consumer does nothing.  Two concurrent deliveries of one id serialise on the
// primary key: the second claim waits for the first transaction and then finds
// its row.  A consumer that fails rolls its claim back with its effects, so the
// redelivery applies again.  A frame with no event id (inline dispatch of an
// ephemeral event) is never redelivered and applies without a claim.
//
// Every backend renders the claim from `inboxClaimSql` with the key from
// `foldConsumerKey` / `workflowConsumerKey`, and the purge from
// `inboxPurgeSql`; none decides the gate, the key or the table itself
// (D-CONSUMER-INBOX).

import type {
  BoundedContextIR,
  EventSubscriptionIR,
  SystemIR,
  WorkflowIR,
} from "../types/loom-ir.js";
import type { ChannelPlan } from "./channel-plan.js";
import { foldsDedupe } from "./projection-fold.js";

/** The inbox table every consumer claims in. */
export const INBOX_TABLE = "__loom_inbox";

/** The claim: inserts `(consumer, event_id)` and affects no row when the
 *  event was already claimed.  `consumer` / `eventId` are the backend's
 *  parameter placeholders.  `received_at` is written explicitly so the claim
 *  needs no column default (MikroORM owns its schema and declares none).
 *  `returning` adds `returning event_id` for drivers that report the claim
 *  through a result set rather than an affected-row count. */
export function inboxClaimSql(consumer: string, eventId: string, returning: boolean): string {
  return `insert into ${INBOX_TABLE} (consumer, event_id, received_at) values (${consumer}, ${eventId}, now()) on conflict do nothing${returning ? " returning event_id" : ""}`;
}

/** The retention purge: deletes claims received before `cutoff` (the
 *  backend's placeholder or literal).  It runs on the outbox retention window,
 *  so a claim outlives every redelivery of its event. */
export function inboxPurgeSql(cutoff: string): string {
  return `delete from ${INBOX_TABLE} where received_at < ${cutoff}`;
}

/** The closed set of in-process consumers of a delivered event. */
export type InboxConsumerKind = "fold" | "create" | "on";

/** The consumer key: `<context>/<kind>/<owner>.<event>`, with `#<n>` for the
 *  n-th further handler of one kind on one event in one owner (a workflow may
 *  declare two `on` handlers for an event; a projection and a workflow's
 *  `create` starters may not).  Unique for every handler that can receive the
 *  same event id, and the same on every deployable that hosts the handler, so
 *  deployables sharing a database apply an event once between them. */
export function inboxConsumerKey(
  context: string,
  kind: InboxConsumerKind,
  owner: string,
  event: string,
  ordinal = 0,
): string {
  return `${context}/${kind}/${owner}.${event}${ordinal > 0 ? `#${ordinal + 1}` : ""}`;
}

/** The context that declares workflow or projection `owner`, from the
 *  system; `fallback` (the emitter's context) when there is no system or no
 *  declaring context.  A deployable that hosts several contexts emits them
 *  merged under one name, so the key must not use the merged name. */
function declaringContext(
  sys: SystemIR | undefined,
  kind: InboxConsumerKind,
  owner: string,
  fallback: string,
): string {
  if (!sys) return fallback;
  const contexts = sys.subdomains.flatMap((s) => s.contexts);
  const declares = (c: BoundedContextIR): boolean =>
    kind === "fold"
      ? c.projections.some((p) => p.name === owner)
      : c.workflows.some((w) => w.name === owner);
  const own = contexts.find((c) => c.name === fallback && declares(c));
  return (own ?? contexts.find(declares))?.name ?? fallback;
}

/** The consumer key of projection `projection`'s fold of `event`. */
export function foldConsumerKey(
  sys: SystemIR | undefined,
  ctx: BoundedContextIR,
  projection: string,
  event: string,
): string {
  return inboxConsumerKey(
    declaringContext(sys, "fold", projection, ctx.name),
    "fold",
    projection,
    event,
  );
}

/** The consumer key of the workflow handler subscription `sub`.  `subs` is
 *  the subscription list `sub` came from: a second handler of the same kind
 *  on the same event takes the next ordinal. */
export function workflowConsumerKey(
  sys: SystemIR | undefined,
  ctx: BoundedContextIR,
  sub: EventSubscriptionIR,
  subs: readonly EventSubscriptionIR[],
): string {
  const kind: InboxConsumerKind = sub.trigger === "create" ? "create" : "on";
  const same = subs.filter(
    (s) =>
      !s.projection &&
      s.workflow === sub.workflow &&
      s.trigger === sub.trigger &&
      s.event === sub.event,
  );
  const at = same.indexOf(sub);
  const ordinal =
    at >= 0
      ? at
      : Math.max(
          0,
          same.findIndex((s) => s.param === sub.param),
        );
  return inboxConsumerKey(
    declaringContext(sys, kind, sub.workflow, ctx.name),
    kind,
    sub.workflow,
    sub.event,
    ordinal,
  );
}

/** True when `wf`'s event handlers claim in the inbox: the deployable
 *  delivers durably (`durable` — `ChannelPlan.receivesDurable` or
 *  `contextReceivesDurable`) and the workflow consumes events.  State-based
 *  and event-sourced workflows alike. */
export function workflowClaims(wf: WorkflowIR, durable: boolean): boolean {
  return (
    durable && (wf.subscriptions.length > 0 || wf.creates.some((c) => c.triggerKind === "event"))
  );
}

/** True when some workflow of `ctx` claims in the inbox. */
export function workflowsDedupe(ctx: BoundedContextIR, durable: boolean): boolean {
  return ctx.workflows.some((wf) => workflowClaims(wf, durable));
}

/** True when some consumer of `ctx` claims in the inbox — a fold or a
 *  workflow handler. */
export function inboxDedupes(ctx: BoundedContextIR, durable: boolean): boolean {
  return foldsDedupe(ctx, durable) || workflowsDedupe(ctx, durable);
}

/** The one fact the inbox hangs on, for a deployable: some hosted consumer
 *  claims.  The deployable's migrations carry the table and its boot starts
 *  the purge (`inboxPurgeSql`) on exactly this answer. */
export function deployableNeedsInbox(
  contexts: readonly BoundedContextIR[],
  plan: Pick<ChannelPlan, "receivesDurable">,
): boolean {
  return contexts.some((c) => inboxDedupes(c, plan.receivesDurable));
}
