# D-WRITE-TX — one write transaction: state + outbox + audit + provenance; dispatch after commit

**Status:** applied — the proposed default took effect 2026-09-13 (merged to `main` 2026-09-11 in #2863; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).

**Question.** Which writes and which emits share a transaction, and what does a
write path with no enclosing transaction do instead?

**Options.** (a) one transaction per aggregate save carrying the outbox, audit
and provenance rows, with in-process dispatch after the commit; (b) a transaction
per statement, relying on the relay to repair; (c) leave it per adapter, as
today.

**Decision.** (a). **The rule, stated once:** an aggregate save opens exactly ONE
database transaction; the durable-event outbox rows, the audit rows and the
provenance rows written for that save commit INSIDE it; the remaining (ephemeral)
events are dispatched in-process AFTER the commit, never inside it. A write path
with no enclosing transaction — a workflow step, an `extern` handler, a timer —
opens one for the same set rather than inserting outside one.

**Rationale.**

- **The shape already exists and is proven; the ruling ratifies the majority
  rather than inventing a rule.** node/drizzle drains `aggregate.pullEvents()`
  BEFORE the write transaction, records the durable ones on that same `tx`
  handle, and dispatches only the remainder after commit
  (`src/generator/typescript/repository-save-builder.ts:247-255`). .NET's
  relational path does the same, with the reason written into the emitter:
  *"DispatchAsync AFTER the commit, on a second SaveChangesAsync, loses an
  event"* (`src/generator/dotnet/emit/repository.ts:455-463`).
- **Dispatch-inside-the-transaction is the worse failure.** A handler that throws
  rolls back a write that had already succeeded, and a handler that reads sees
  rows the caller can still roll back.
- **Implementers: half of M-T4.3 item 5's text is stale on this head.** The
  mikroorm save now wraps in
  `this.em.fork({ keepTransactionContext: true }).transactional(async (em) => …)`
  and records durable events on that callback's own `em`
  (`src/generator/typescript/emit/mikroorm.ts:1022-1067`,
  `MIKRO_OUTBOX_DRAIN_LINES` / `MIKRO_OUTBOX_RECORD_LINE`) — `G2667-C4` landed.
  What still reproduces: **.NET's document and event-sourced repositories**
  dispatch after `SaveChangesAsync` with no `RecordDurableAsync` at all
  (`dotnet/emit/repository.ts:909-921` and `:1155-1178`); node's workflow-step /
  extern-handler / timer emits are deliberately fenced outside any transaction
  (`src/platform/hono/v4/workflow-builder.ts:1239-1244`); and java's
  class-`@Transactional` command handlers against .NET/node's per-`SaveAsync`
  commit is the §D5 asymmetry. Verify each before fixing (RUNBOOK §1).

**Consequences.** `G2667-C4` / `G2667-C5` / `G2667-D5` close against a written
contract, so every remaining deviation is a defect rather than an undecided fork.
A cross-backend gate asserts the ORDER in the emitted source per adapter
(record-before-commit, dispatch-after-commit) and, wherever a runtime leg exists,
a booted-app proof of the crash window (rule 10) — a constant read back out of
the emitter proves consistency, not correctness (rule 12).

**Unblocks.** M-T4.3 item 5 → wave **C2 packets 2b / 2c**.

**Sources.** [`T4-eventing-temporal.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T4-eventing-temporal.md) M-T4.3
item 5; [`generator-code-review-2026-08-24.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/generator-code-review-2026-08-24.md)
§Follow-up register rows 2–3 and §D5; ledger rows `G2667-C4` / `G2667-C5` /
`G2667-D5`; [`dispatch-delivery-semantics.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/dispatch-delivery-semantics.md).
