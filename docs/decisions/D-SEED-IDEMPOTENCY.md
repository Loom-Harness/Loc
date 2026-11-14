# D-SEED-IDEMPOTENCY — v1 is ship-once via a dataset marker

**Status:** PINNED.

**Problem.** Re-running a seed must not duplicate rows. Two mechanisms
were on the table: (a) an applied-**marker** table; (b) per-row
**upsert** by a declared natural key.

**Decision.** v1 is **ship-once via an applied-marker**: a `__loom_seed`
table holds one row per applied `(module, dataset)`; the seeder skips
the whole set on boot if the marker is present. This matches the Rails
`db:seed` / Ecto `seeds.exs` contract, needs no natural key on the
rows, and covers the quick-start demo entirely. Editing an
already-applied seed has no effect until the marker is cleared
(`ddd seed --reset <dataset>`); seeding is forward-only, mirroring the
migrations stance.

Per-row **upsert by a declared natural key** (`key Aggregate.field`),
for *reference* data corrected in place over time, is **deferred** — it
adds a second idempotency mechanism, a grammar clause, a validation
rule, and a per-backend upsert branch, and earns its keep only once a
model actually has evolving lookup data. The grammar reserves the slot
(`seed <dataset> key Aggregate.field`) so it lands additively later.

**Rationale.**

- The driving use case (first-boot demo content) is served by the
  marker alone; the marker is the smaller, simpler mechanism.
- Marker-by-content-hash was rejected: re-applying forward-only
  `create`s on a changed set just collides on existing rows — the very
  thing upsert would fix — so hashing buys nothing without also buying
  upsert. Keying the marker by *dataset name* sidesteps it.

**Consequences.** No `key`/`contentHash` in `SeedIR` for v1; the marker
table is emitted as a synthetic `createTable` step by the owning
module's migration pass. `LOOM_SEED` gates which datasets run.

**Affects.** `database-seeding.md` §2 (D-SEED-IDEMPOTENCY), §7, §10
(deferred upsert), build-order §11 phase 6.
