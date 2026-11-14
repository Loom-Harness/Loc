# D-MIG-DSL-STEPS — data migrations are DSL steps, not emitted stub files

**Status:** PINNED.

**Problem.** The original M-T2.3 sketch was "an emitted, history-tracked stub
file the user fills (per backend's native mechanism)". A stub must survive
regeneration (write-once machinery), exists five times (a Drizzle `.sql`, an
EF class, an Ecto `.exs`, a Flyway file, a Python `.sql`) for one logical
change, and breaks the "generated tree is disposable" invariant.

**Decision.** Data migrations are **steps in the `migration` block** —
backfill (`Agg.field = <expr>`) and raw `sql "…"` — validated, printed, and
ledgered like every other step, rendered once through the two shared
renderers (`sql-pg.ts`, Ecto `execute/1`). No generated file is ever
user-edited. The raw step's exactly-once semantics live in the snapshot
(`appliedDataMigrations`), not in a new history file — the same "the snapshot
IS the applied-history record" property M-T2.1 pinned for renames.

**Rationale.**

- One source, five backends: the stub-file design duplicates the same DML per
  backend and drifts.
- The block already existed (M-T2.1) and was explicitly shaped for these
  steps; a second surface would be permanent tech debt.
- Procedural, app-level data migrations (beyond SQL) are a documented
  non-goal for v1; the pressure valve is the raw `sql` step's full Postgres
  expressiveness (CTEs, functions).

**Affects.** `../migrations.md` § Data migrations;
[`../new-plan/missions/M-T2.3-data-migration-surface-design.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/archive/missions/M-T2.3-data-migration-surface-design.md) (canonical);
`src/system/migrations-builder.ts`.
