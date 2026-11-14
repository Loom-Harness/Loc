# D-PROJECTION-FOLD-INBOX — a redelivered event changes a folded read model once

**Status:** owner ruling, 2026-11-13.

**Decision.** A fold dedupes durably delivered events through a transactional
inbox, `__loom_fold_inbox (projection, event_id)`. When the delivering frame
carries an event id (the outbox relay, or a broker consumer of a durable
channel), the fold first claims `(projection, event_id)` with
`insert … on conflict do nothing`, in the same transaction that saves the row.
If the claim affects no row, the event was already applied and the fold does
nothing. A failed fold rolls its claim back with it, so the redelivery folds
again. An event dispatched inline has no id and is never redelivered, so it
folds without a claim.

`foldsDedupe` (`src/ir/plan/projection-fold.ts`) decides where folds claim: a
context with a materialized projection that folds, in a deployable that
delivers durably. The migrations create the table on the same answer.
`foldInboxClaimSql` and `foldInboxPurgeSql` are the one spelling of the claim
and of the prune. The relay's retention purge deletes claims older than
`LOOM_OUTBOX_RETENTION_DAYS`, the window in which the outbox can redeliver.
The inbox is a schema change like any other: a module whose migration chain
is already recorded gains the table when a fold starts deduping, and
`generate system` refuses the model until `ddd migrate add` records it.

**Why.** A fold is not idempotent: `seen += 1` applied twice counts twice, and
at-least-once delivery does redeliver. A per-row `last_event_id`, the saga
marker, cannot work for folds: one row receives events from many producers,
and there is no total order across them, so "the last id" does not say which
earlier ids were applied.

**Enforced by** `test/e2e/saga-redelivery-e2e.test.ts`: on every backend and
persistence adapter, a forced redelivery of the same outbox row leaves the
fold's count at 1. `test/system/projection-fold-census.test.ts` refuses a
hand-written inbox statement outside `src/ir/plan/`.
