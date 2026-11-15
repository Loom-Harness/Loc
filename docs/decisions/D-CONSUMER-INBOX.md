# D-CONSUMER-INBOX — a durably delivered event is applied once per consumer

**Status:** decided, 2026-11-15.

**Decision.** Every consumer of a durably delivered event — a projection fold,
and every event handler of a state-based workflow (a saga reactor, an
event-triggered `create` starter, a stateless `on` reactor) — claims the event
in the consumer inbox before it applies it:

```sql
insert into __loom_fold_inbox (projection, event_id, received_at)
values (<consumer>, <event id>, now()) on conflict do nothing
```

The claim runs in the **same transaction** as the consumer's effects: the
aggregate saves, the saga row, the folded read-model row.

- A claim that inserts a row is the first delivery of that event to that
  consumer: the consumer applies it, and the claim commits with its effects.
- A claim that inserts no row means the event was already applied, by this
  replica or another: the consumer does nothing.
- Two deliveries of one id that arrive at the same time serialise on the
  table's primary key: the second claim waits for the first transaction, then
  finds its row.
- A consumer that fails rolls its claim back with its effects, so the
  redelivery applies again.  A crash between the effect and the claim cannot
  leave one without the other.
- A frame with no event id (an ephemeral event dispatched inline) is never
  redelivered and applies without a claim.

The event id is the envelope `id`, which is the producer's outbox row id. The
outbox relay sets it for a local redelivery, and the broker consumer sets it
for every envelope it dispatches.

The consumer key is the projection name for a fold and `workflow:<Name>` for a
workflow's handlers.  The `workflow:` prefix keeps the two apart.  One
table, one claim spelling (`inboxClaimSql`), one purge
(`foldInboxPurgeSql`).

**Where it is decided.** `src/ir/plan/consumer-inbox.ts`:
`workflowClaims(wf, durable)`, `foldsDedupe(ctx, durable)` and
`inboxDedupes(ctx, durable)`, where `durable` is the deployable's
`ChannelPlan.receivesDurable`: the deployable hosts a durable channel, or it
consumes an event that a wired foreign durable channel carries.  A broker
redelivers a foreign durable event exactly as the local relay redelivers a
hosted one.  Every backend renders the claim inside the transaction its
handler already runs in:

| Backend | Transaction |
|---|---|
| node | `db.transaction` (drizzle) / `em.transactional` (MikroORM), opened by the exported handler around `<handler>Apply` |
| .NET | `IConsumerInbox.ApplyOnceAsync`: the `AppDbContext` transaction (EF) or the Dapper unit of work's ambient transaction, which every repository enlists in |
| python | the handler's `AsyncSession`, committed by the relay / consumer after dispatch |
| java | the dispatcher's `@Transactional` method, claiming through its `JdbcTemplate` |
| elixir | the handler's `Repo.transaction` |

The migrations create the table whenever a module has a consumer that
`inboxDedupes` answers yes for, under any durable channel in the system.  The
outbox relay purges claims older than `LOOM_OUTBOX_RETENTION_DAYS` beside the
outbox.  A deployable that runs no relay (a consumer of a foreign durable
channel only) runs the same purge on its own.

**Why.** The saga row's `last_event_id` could not dedupe.  A check of the
loaded row followed by a later save is check-then-apply: two replicas receiving
one envelope at the same time both found the row without the id and both
applied it.  And a column holding only the last id cannot remember the earlier
ones.  A unique key taken in the effect's transaction is the only claim that
holds under concurrency and across a crash.  `last_event_id` stays on the saga
row as the record of the last event applied to it; nothing reads it to decide.

**Enforced by** `test/e2e/support/redelivery-witness.ts`, run by every
`channels-e2e-rabbit*` leg: one envelope id redelivered in sequence, and twenty
ids each delivered to two replicas at once, change the consumer's state once
per id.  `test/e2e/saga-redelivery-e2e.test.ts` covers a forced local-relay
redelivery on every backend and persistence adapter.
