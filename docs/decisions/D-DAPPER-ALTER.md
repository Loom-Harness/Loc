# D-DAPPER-ALTER — dapper and mikroorm get a real ALTER path in phase ⑨; the widened refusal lands first

**Status:** applied — the proposed default took effect 2026-09-13 (merged to `main` 2026-09-11 in #2863; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).

**Question.** `persistence: dapper` (and its mikroorm twin) has no ALTER path at
all — is that a permanent `scope` row, or a phase-⑨ build?

**Options.** (a) a permanent `scope` row with a D-tag: "self-provisioning
adapters are CREATE-only by design"; (b) widen the honest gate so any
post-baseline schema change refuses; (c) render the `MigrationsIR` chain for
these adapters.

**Decision.** (c) — **build it** — with (b) landing FIRST, in the same wave, as
the interim.

**Rationale.**

- **(a) is not honest for a shipping adapter.** `renderDapperSchema`
  (`src/generator/dotnet/emit/dapper.ts:2229-2233`) is documented as "a
  self-applied CREATE TABLE IF NOT EXISTS per aggregate", and
  `grep -c 'ALTER TABLE|ADD COLUMN' src/generator/dotnet/emit/dapper.ts` is
  **0**. So on a dapper deployable: add a field to a live database and the column
  is never created (the app 500s); drop one and it lingers; change a type and
  nothing happens.
- **And the existing gate mostly does not fire.**
  `validateMigrationAdapterSupport`
  (`src/ir/validate/checks/migration-checks.ts:203-260`) raises
  `loom.dapper-unsupported#migrations` only when the model DECLARES a `migration`
  block — it indexes the rename/backfill/SQL-step intents and returns early when
  they are all empty. The common case is silent.
- **The build is bounded.** `emitDotnetMigrations` already produces
  platform-neutral Postgres through `src/generator/sql-pg.ts`. What is missing is
  emitting it as an ordered `.sql` set applied by `DbSchema.EnsureAsync` behind a
  `__loom_migrations` ledger, then flipping
  `const hasMigrations = !usingDapper && …` (`src/generator/dotnet/index.ts:990`).
  The mikroorm twin is `!usingMikro` at `src/platform/hono/v4/emit.ts:1067` and
  is ruled the same way here.
- **(b) first because (c) is L and a user can lose a column today.** The widened
  gate fires when a self-provisioning deployable is regenerated against an
  existing baseline whose derived diff is non-empty — the snapshot store is
  already threaded into phase ⑨ via `fsSnapshotStore(outDir)`.

**Consequences.** A named **T2 mission** owns the build, with a
`test:migration-evolution-dapper` (and `-mikroorm`) leg added to
`migration-evolution-e2e.yml` — today all five legs run on the default
efcore/drizzle adapters. `loom.dapper-unsupported#migrations`,
`loom.mikroorm-unsupported#migrations` and the ledger row
`dapper-no-schema-evolution` close when that leg is green, **not** when the gate
widens. Note what the widened gate replaces: today a second generate exits 1 on
snapshot drift with an error that names neither the adapter limitation nor a
remedy, and `--allow-rebaseline` does not clear it.

**Unblocks.** `dapper-no-schema-evolution` → wave **C2 packet 2b** (the mikroorm
arm in **2c**); M-T6.35's `#migrations` sub-code.

**Sources.** [`targets-completeness-2026-08-30.ledger.json`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/targets-completeness-2026-08-30.ledger.json)
row `dapper-no-schema-evolution` (fix field: both options, sized);
[`T6-backend-parity.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T6-backend-parity.md) M-T6.35;
`src/ir/validate/checks/migration-checks.ts`, `src/generator/dotnet/emit/dapper.ts`,
`src/generator/dotnet/index.ts`, `src/platform/hono/v4/emit.ts`.
