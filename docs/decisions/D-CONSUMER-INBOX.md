# D-CONSUMER-INBOX — a durably delivered event is applied once per consumer

**Status:** owner ruling, 2026-11-15.  Replaces D-PROJECTION-FOLD-INBOX.

**Decision.** Every in-process consumer of a durably delivered event claims it
in one inbox before it applies it.  That covers a projection fold, an
event-triggered `create` starter, and an `on` handler of a workflow,
state-based or event-sourced:

```sql
insert into _inbox (consumer, event_id, received_at)
values (<consumer>, <event id>, now()) on conflict do nothing
```

`_inbox (consumer text, event_id text, received_at timestamptz)` has the
primary key `(consumer, event_id)`.  The claim runs **in the same
transaction** as the consumer's effects: the aggregate saves, the saga row,
the stream append, the folded read-model row.

- A claim that inserts a row is the first delivery of that event to that
  consumer.  The consumer applies it, and the claim commits with its effects.
- A claim that inserts no row means the event was already applied, by this
  replica or another.  The consumer does nothing.
- Two deliveries of one id that arrive at the same time serialise on the
  primary key: the second claim waits for the first transaction, then finds
  its row.
- A consumer that fails rolls its claim back with its effects, so the
  redelivery applies again.  A crash between the effect and the claim cannot
  leave one without the other.
- A frame with no event id is an ephemeral event dispatched inline.  It is
  never redelivered, so it applies without a claim.

The event id is the envelope `id`: the producer's outbox row id.  The outbox
relay sets it for a local redelivery, and the broker consumer sets it for
every envelope it dispatches.

**The consumer key** is `<context>/<kind>/<owner>.<event>`, with
`kind ∈ {fold, create, on}`.  A workflow may declare two `on` handlers for one
event, so the n-th further handler of one kind on one event in one owner adds
`#n`.  The ordinal follows source order: a single handler per event carries
none, and adding handlers for other events never changes its key, but
reordering two same-event handlers, or inserting one before another, re-keys
the later ones.  A re-keyed handler applies an event still inside the
retention window once more.  The context is the one that **declares** the workflow or projection,
not the name a multi-context deployable merges its contexts under.  So every
deployable that hosts a consumer uses the same key.  Deployables that host
the same consumer and share one database apply an event exactly once between
them; deployables with separate databases each have their own inbox and each
apply it once.

**Where it is decided.** `src/ir/plan/consumer-inbox.ts` holds every part of
the decision:
- `inboxConsumerKey` builds the key.  `foldConsumerKey` and
  `workflowConsumerKey` are the only ways the backends reach it.
- `inboxClaimSql` and `inboxPurgeSql` are the one spelling of the claim and
  the purge.
- `foldsDedupe` / `workflowClaims` decide which consumers claim, given
  `durable = ChannelPlan.receivesDurable`: the deployable hosts a durable
  channel, or it consumes an event that a wired foreign durable channel
  carries.  A broker redelivers a foreign durable event exactly as the local
  relay redelivers a hosted one.
- `deployableNeedsInbox` is the one fact that the deployable carries the table
  and starts the purge.  The migrations ask its per-context form,
  `inboxDedupes(ctx, contextReceivesDurable(ctx, sys))`.

Every backend renders the claim inside the transaction its handler already
runs in:

| Backend | Transaction |
|---|---|
| node | `db.transaction` (drizzle) / `em.transactional` (MikroORM), opened by the exported handler around `<handler>Apply` |
| .NET | `IConsumerInbox.ApplyOnceAsync` (workflow handlers) and `IReadModelStore.FoldOnceAsync` (folds): the `AppDbContext` transaction on EF, the Dapper unit of work's ambient transaction on Dapper, which every repository and store enlists in |
| python | the handler's `AsyncSession`, committed by the relay or consumer after dispatch |
| java | the dispatcher's `@Transactional` method, claiming through its `JdbcTemplate` |
| elixir | the handler's `Repo.transaction` |

**The purge.** One purge, started at boot wherever `deployableNeedsInbox`
holds.  It deletes claims older than `LOOM_OUTBOX_RETENTION_DAYS` (the window
in which the outbox can redeliver), once at start and then every purge
interval:
- node `http/inbox-purge.ts`;
- .NET `InboxPurgeService`;
- python `start_inbox_purge`;
- java `InboxPurgeService`;
- elixir `InboxPurge`.

The outbox relay purges only the outbox.

**What the claim does not cover.** A handler's external side effect runs
inside the claimed transaction but is not part of it.  That covers a resource
call (email, object store, a REST `api` call) and a broker publish of an
ephemeral event.  If the transaction rolls back after the side effect ran (a
later statement fails, the process crashes before commit), the redelivery
claims again and the side effect runs again.  An external side effect is
therefore delivered at least once, not once.  A side effect that must happen
exactly once needs the receiving system to dedupe it (for example an
idempotency key carrying the envelope id).

**Migrations.** The table is machinery, like `_outbox`: one per module,
no context schema.  A saga row carries no dedupe column.  A model whose
migration chain was recorded with the earlier fold inbox
(`__loom_fold_inbox (projection, event_id, received_at)`) or the saga
`last_event_id` column sees both dropped and `_inbox` created.  That is
a destructive step (`ddd migrate add --allow-destructive`).  Its consequence:
an event still inside the retention window and redelivered after the upgrade
applies once more, because the old claims are not carried over.  The new key
carries the event type, so the old keys could not be translated in any case.

**Why.** At-least-once delivery does redeliver, and no consumer is idempotent
by itself:
- a fold's `seen += 1` counts twice;
- a starter creates a second instance's effects;
- an event-sourced handler appends twice.

A check of a loaded row followed by a later save is check-then-apply: two
replicas receiving one envelope at the same time both pass the check and both
apply it.  A per-row "last event id" also cannot remember earlier ids, and
it is meaningless for a fold row fed by many producers.  A unique key, taken
in the effect's transaction, is the one claim that holds under concurrency
and across a crash.  One table and one key format mean one mechanism to
reason about, migrate and purge.

The redelivery witness runs on every `channels-e2e-rabbit*` leg: node, mikroorm, dotnet (EF, and Dapper with `LOOM_CHANNELS_PERSISTENCE=dapper`), python, java and elixir.  Its cases:
- one envelope id redelivered in sequence;
- twenty ids, each delivered to two replicas at once;
- an application that fails once inside its transaction beside a sibling handler that succeeds;
- the boot purge deleting an expired claim and keeping a live one.

Each case changes the state-based saga and the event-sourced stream exactly once per id.  The saga-redelivery leg forces a local-relay redelivery on every backend and persistence adapter.  The plan test pins the key format and its stability, checks that no corpus handler shares a key, and checks that the migrations create the inbox wherever a consumer claims.  The censuses refuse a hand-written inbox statement and a re-derived dedupe decision.

**Enforced by:** `test/e2e/channels-e2e-rabbit.test.ts`, `test/e2e/channels-e2e-rabbit-dotnet.test.ts`, `test/e2e/channels-e2e-rabbit-python.test.ts`, `test/e2e/channels-e2e-rabbit-java.test.ts`, `test/e2e/channels-e2e-rabbit-elixir.test.ts`, `test/e2e/saga-redelivery-e2e.test.ts`, `test/ir/plan/consumer-inbox.test.ts`, `test/system/projection-fold-census.test.ts`, `test/system/channel-plan-census.test.ts`
