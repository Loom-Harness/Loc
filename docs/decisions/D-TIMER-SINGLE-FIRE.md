# D-TIMER-SINGLE-FIRE — an `every:` timer fires once per period, claimed through one database row

**Status:** owner ruling, 2026-11-09.

**Decision.** An `every:` timerSource fires once per period across every
replica of its owning deployable and across deployables that share its
storage, on all five backends and in the playground. The period is
`floor(epoch_ms / everyMs)`. Each backend polls at half the period, and each
poll runs one statement (`timerClaimSql`, `src/util/timer.ts`) against the
timer's row in `__loom_timer`:

```sql
INSERT INTO __loom_timer AS t (timer, last_period, fired_at)
VALUES ('<timer>', floor(extract(epoch from clock_timestamp()) * 1000 / <everyMs>)::bigint, clock_timestamp())
ON CONFLICT (timer) DO UPDATE SET last_period = EXCLUDED.last_period, fired_at = clock_timestamp()
WHERE t.last_period < EXCLUDED.last_period RETURNING t.last_period
```

Only the poll whose upsert advanced the row gets a row back, and only that
poll dispatches the tick. `__loom_timer` is a companion table in the shared
`MigrationsIR` (`timerClaimTableShape`), added to the module whose context the
timer's event belongs to. On `persistence: mikroorm`, which owns its schema
through `schema.update()`, it is also an entity. `cron:` keeps its ecosystem
runner (pg-boss, Hangfire, procrastinate, JobRunr, Oban), which already fires
once per boundary.

**Semantics.**
- *Clock skew.* The period comes from the database clock, so replicas whose
  clocks disagree still compute the same period. A replica's own clock only
  decides when it polls.
- *A replica dies mid-tick.* The claim commits before the dispatch, so a
  replica that dies between the two loses that period's fire, and the next
  period fires normally. A failed dispatch is likewise not retried. A period
  fires at most once.
- *Missed periods* (every replica down, or a dispatch slower than a period)
  are skipped, not replayed: the claim always jumps to the current period.
  This keeps the earlier resume-at-next-tick behaviour.
- *Fire time.* A period fires on the first poll after its boundary, so up to
  half a period late.

**Why.** The transaction-scoped advisory lock it replaces only stopped two
replicas from firing *concurrently*; two replicas whose ticks were staggered
never contended and each fired every period (measured on node and Phoenix).
On the playground's single PGlite connection the lock's transaction also
deadlocked the tick's own writes, so the in-process mode skipped it. A
watermark row fixes both: a single autocommitted statement holds nothing
across the dispatch, and the conditional update is the only arbiter needed.
A lease row was rejected — it needs an expiry tuned against the period and a
renewal loop, and the per-period watermark already gives the guarantee.
