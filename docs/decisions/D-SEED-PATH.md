# D-SEED-PATH — seed rows go through the domain `create`

**Status:** PINNED.

**Problem.** `database-seeding.md` must pick how a declarative seed row
reaches the database. Target frameworks split: EF `HasData` and Drizzle
`insert` go *straight to tables*; Ash goes *through actions* (enforcing
changesets). Loom needs one default.

**Decision.** Seed rows lower through the aggregate's **canonical
`create`** by default — the same path a real request takes — so
invariants and create-time logic run, and a seed that violates an
invariant is caught at boot rather than producing a corrupt row. A
`seed raw { … }` modifier opts a block into table-level inserts for
bulk fixtures where the domain pass is deliberately bypassed (or too
slow); `raw` carries a `loom.seed-raw-unchecked` warning when a value
would fail an invariant.

**Rationale.**

- The domain `create` already encodes the invariants; bypassing it to
  insert rows is the same mistake as letting an API skip validation.
- Ash's native seed idiom is `Ash.create!`; routing through `create`
  makes the Loom surface map cleanly onto the most-opinionated backend
  rather than the least.
- `raw` keeps the escape hatch explicit and visible, not the default.

**Consequences.** `SeedIR.path: "domain" | "raw"`; the declarative
record shape is the aggregate's **`create`-parameter shape** (no `id`
field — the framework mints ids). Object graphs built by *operations*
(not create params) are the imperative-body's job, not the declarative
form's.

**Affects.** `database-seeding.md` §2 (D-SEED-PATH), §3.2, §6 (per-
backend emitters), §8 (`loom.seed-raw-unchecked`).
