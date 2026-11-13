# D-PROJECTION-NOT-AGGREGATE — a folded projection is its own construct, not an event-sourced aggregate without operations

**Status:** design ruling.

**Decision.** `projection` stays separate from `aggregate`, and gets no
operations.

**Why.**
1. It folds FOREIGN events. An aggregate's `apply` folds only events it emitted
   itself (aggregates have appliers, no subscriptions); only workflows and
   projections subscribe to someone else's stream, which is why the projection
   fold rides the workflow dispatch path.
2. It is derived, not a source of truth. It changes only when the upstream
   events change, so it has no `emit` and therefore no operations.
3. The fold is therefore PURE — event-only input, no repository reads,
   deterministic — which keeps the read model disposable and rebuildable by
   re-folding.

**Consequence.** Do not "unify" projections with aggregates or add operations
to them. Query-time projections are the other flavour: computed on every read,
no replay, so reading current state there is correct by definition.
