# D-MIGRATE-WORKFLOW — the migration history is a committed chain beside the source; `generate` only renders it

**Status:** PINNED (owner ruling 2026-10-25, #4065).

**Question.** Where does the state a schema migration is diffed against live,
and who decides when a generation is cut? `generate system` used to do both:
it diffed the model against `.loom/snapshots/` *under `-o`* and minted the next
version as a side effect. The output tree is exactly the thing that gets lost
(CI building into a scratch dir, a fresh clone, a second environment), so five
generate-time guards and a fingerprinted side ledger beside the `.ddd` existed
only to *detect* a lost or stale baseline — and the ledger, re-recorded by
every PR that touched Initial DDL, was itself a source of churn.

**Decision.**

1. **The chain.** `migrations/` beside the entry `.ddd` holds one JSON file per
   (generation, module): its backend-neutral `MigrationsIR` steps and the
   module's schema after them (`src/system/migration-chain.ts`). Each backend's
   migration files are rendered from the whole chain on every
   `generate system`; nothing migration-related is written under `-o`, which is
   fully disposable. Committed with the model.
2. **Recording is explicit.** `ddd migrate add <name> <file.ddd>` diffs the
   model against the chain's head and appends. `generate system` refuses a
   model with an unrecorded schema change (`MigrationDriftError`). A source
   with **no** `migrations/` has nothing recorded: `generate` emits each
   module's initial migration from the model, with no drift check — so
   examples and fixtures carry no migration state.
3. **Versions** are the UTC clock at `migrate add`, moved above the head (and
   above `head + INITIAL_RESERVATION` after an `Initial`, which expands into
   many Ecto files) — unique across modules and strictly increasing, which is
   what Drizzle's watermark, Flyway's out-of-order refusal and Ecto's file
   versions each need. Every entry names its parent; **two heads** (two
   branches that each recorded a migration) refuse to be read until one is
   re-recorded on top of the other.
4. **The destructive decision is made once, at `migrate add`**
   (`--allow-destructive`), and recorded in the entry; `generate` has no such
   flag.
5. **Clean break.** Loom has no external consumers, so there is no import path
   from output-tree snapshots: the guards, the side ledger,
   `--allow-rebaseline`, per-module version blocks and the Dapper tree
   re-rooting are deleted outright.

**Affects.** `docs/migrations.md` § The migration chain; `docs/tools.md`
§ Migrations workflow. `migrate status` / `remove` / `rebase` are #4083.
