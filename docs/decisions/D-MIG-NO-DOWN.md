# D-MIG-NO-DOWN — down migrations are no-op everywhere, by decision

**Status:** PINNED.

**Problem.** Every backend's migration mechanism has a down/rollback slot
(EF `Down()`, Ecto `change/0` reversibility, Drizzle/Flyway/Python file
pairs). Loom has always emitted no-op downs de facto; M-T2.3's data steps
(backfills, raw SQL) forced the question, because a "down" of a backfill is
a data-destroying drop.

**Decision.** Down migrations are **no-op on every backend, permanently**.
Operators roll forward; recovery is backup + roll-forward. The snapshot
ledger re-derives forward state deterministically, so a bad migration is
corrected by the *next* migration, not by rewinding.

**Rationale.**

- Down paths are untested-by-construction — nothing in the pipeline ever
  executes them, so shipping them is shipping unverified code.
- The "down" of a data step is destructive by definition (un-backfilling a
  column is dropping its values), which contradicts the destructive gate's
  whole posture.
- Forward-only matches the seeding stance (D-SEED-IDEMPOTENCY) and the
  documented practice of every backend's own community for production data.

**Affects.** `../migrations.md` § Data migrations; `dotnet/emit/migrations.ts`
(`Down()` comment); every backend's migration emitter.
