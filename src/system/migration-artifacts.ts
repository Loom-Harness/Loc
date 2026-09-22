import * as fs from "node:fs";
import * as path from "node:path";

import type { EnrichedLoomModel } from "../ir/types/loom-ir.js";
import type { MigrationsIR } from "../ir/types/migrations-ir.js";
import type { MigrationHistoryLedger, ModuleHistoryRecord } from "./migration-ledger.js";
import { LEDGER_REL_DIR, schemaFingerprint } from "./migration-ledger.js";
import { BASE_TIMESTAMP, MODULE_VERSION_STRIDE } from "./migrations-builder.js";

// ---------------------------------------------------------------------------
// Migration-baseline safety guards (M-T2.2).
//
// The snapshot store (`snapshot.ts`) reads the last-checked-in schema
// baseline.  When that file is ABSENT, `buildMigrations` treats it as a
// first run and re-emits a full "Initial" migration that re-CREATEs every
// table and resets the version / history chain — silently re-baselining
// against a database that already has migrations applied.  A *corrupt*
// snapshot already fails loudly (`SnapshotReadError`); a *missing* one does
// not, and neither does a snapshot whose recorded history has drifted from
// the migration files actually on disk.
//
// This module closes that window at generate time, before any file is
// written.  It answers one question — "what migration files already exist
// on disk, and at what versions?" — behind an injectable interface (the
// same pattern as `SnapshotStore`), then runs three pure checks against the
// freshly-built `MigrationsIR[]`:
//
//   (a) refuse "Initial" when migration files already exist IN THIS
//       MODULE'S VERSION BLOCK but the snapshot is missing;
//   (b) verify `baseline.migrationHistory` ⊆ the on-disk files (a history
//       entry with no file is drift the operator must resolve; the converse
//       is deliberately NOT checked — see the comment at the check);
//   (c) reject a version number that already exists on disk (the tell of a
//       stale baseline reissuing a used version);
//   (d) refuse "Initial" when the SOURCE-SIDE LEDGER records history for the
//       module that this run would NOT reproduce, whatever the output tree
//       holds — the F-029 case, where a CLEAN `-o` has no snapshot and no
//       files and so reads as a first run.  (d) is deliberately CONTENT-aware
//       rather than presence-aware: see `reproducesRecordedHistory`;
//   (e) refuse a version the ledger records but this output tree lacks — an
//       older copy of the tree, internally consistent but behind the model.
//
// (a), (d) and (e) are overridden by `allowRebaseline`.
//
// Guards (a)–(c) read only the output tree, so they are blind to the case
// where the output tree is the thing that is missing; (d)/(e) read the
// ledger beside the `.ddd` (see `migration-ledger.ts`) and close that gap.
// The per-module VERSION BLOCK narrowing on (a) matters independently: the
// index can only answer per DEPLOYABLE, and one deployable hosts many
// modules, so before the narrowing a brand-new module saw a sibling's files
// and was refused — prescribing `--allow-rebaseline`, which would have
// discarded the SIBLING's history.  That false positive also trained
// operators to pass the one flag that switches (d) off.
//
// The interface is fs-free so tests inject an in-memory index and the web
// playground (which never scans a real output tree) simply omits it.  Only
// `fsMigrationArtifactIndex` touches `node:fs`, and only the CLI constructs
// it — mirroring how `fsSnapshotStore` is built in `src/cli/main.ts`.
// ---------------------------------------------------------------------------

export interface MigrationArtifactIndex {
  /** Versions of the migration files currently on disk for `module`, in no
   *  particular order.  Empty when the module has no migration files yet
   *  (a genuine first run). */
  versions(module: string): readonly string[];
}

/**
 * Raised when the migration files already on disk are inconsistent with the
 * snapshot baseline the current generate run read (or didn't).  Deliberately
 * recoverable — like {@link SnapshotReadError}, this is an operator problem
 * (a lost/stale snapshot, a partially-applied history) that must be resolved
 * deliberately, not a compiler crash.  The CLI catches it and exits non-zero
 * with the message's recovery hint.
 */
export class MigrationBaselineError extends Error {
  constructor(
    readonly module: string,
    message: string,
  ) {
    super(message);
    this.name = "MigrationBaselineError";
  }
}

/** Extract the migration *version* token from a migration filename.  All
 *  five backends prefix the version onto the filename, in one of two shapes:
 *    - `<version>_<…>.{sql,exs,cs}`  (Drizzle / Ecto / EF / Alembic)
 *    - `V<version>.<n>__<…>.sql`     (Java / Flyway)
 *  Returns `null` for a file that matches neither (a `.gitkeep`, a
 *  `meta/_journal.json`, an editor temp file) so it's simply ignored. */
export function migrationFileVersion(fileName: string): string | null {
  const flyway = /^V(\d+)\.\d+__/.exec(fileName);
  if (flyway) return flyway[1];
  const prefixed = /^(\d+)_/.exec(fileName);
  if (prefixed) return prefixed[1];
  return null;
}

/** True when `dirName` is a directory a backend lands migration files in.
 *  Matched case-insensitively on the segment itself so `migrations`,
 *  `Migrations`, and Flyway's singular `migration` (under
 *  `src/main/resources/db/migration/`) all count, wherever the layout
 *  adapter nests them. */
function isMigrationDirSegment(dirName: string): boolean {
  const lower = dirName.toLowerCase();
  return lower === "migrations" || lower === "migration";
}

/** Recursively collect migration-file versions found anywhere under `root`
 *  that live inside a migration directory segment.  Missing `root` ⇒ []. */
function scanMigrationVersions(root: string): string[] {
  const versions: string[] = [];
  const walk = (dir: string, insideMigrationDir: boolean): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable / absent — treat as no artifacts
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, insideMigrationDir || isMigrationDirSegment(entry.name));
      } else if (insideMigrationDir && entry.isFile()) {
        const v = migrationFileVersion(entry.name);
        if (v !== null) versions.push(v);
      }
    }
  };
  walk(root, false);
  return versions;
}

/** Docker-compose-safe slug — the per-deployable output subdirectory name.
 *  Kept in sync with `serviceSlug` in `system/index.ts` (the repo already
 *  carries this one-liner in two other places; a local copy avoids an
 *  import cycle with the orchestrator). */
function serviceSlug(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * Filesystem-backed index over a real generated output tree.  For every
 * module with a migration owner, scans that owner deployable's output
 * subdirectory (`<outDir>/<serviceSlug(owner)>/`) for migration files and
 * records their versions.  Built once (eager) so repeated `versions(...)`
 * lookups don't re-walk the tree.
 *
 * Only this function reaches for `node:fs`; the CLI is the sole caller.
 */
export function fsMigrationArtifactIndex(
  outDir: string,
  loom: EnrichedLoomModel,
): MigrationArtifactIndex {
  const byModule = new Map<string, string[]>();
  for (const sys of loom.systems) {
    for (const sub of sys.subdomains) {
      if (!sub.migrationsOwner) continue;
      const ownerDir = path.join(outDir, serviceSlug(sub.migrationsOwner));
      byModule.set(sub.name, scanMigrationVersions(ownerDir));
    }
  }
  return {
    versions: (module) => byModule.get(module) ?? [],
  };
}

/** In-memory index for tests and callers with no real output tree.  Keyed
 *  module → version list. */
export function memoryMigrationArtifactIndex(
  byModule: Record<string, readonly string[]> = {},
): MigrationArtifactIndex {
  return {
    versions: (module) => byModule[module] ?? [],
  };
}

export interface CheckMigrationBaselineOptions {
  /** Override guards (a), (d) and (e): permit re-emitting "Initial" (or
   *  re-issuing a recorded version) even though the module demonstrably has
   *  migration history.  The escape hatch for a deliberate re-baseline (the
   *  CLI `--allow-rebaseline` flag). */
  allowRebaseline?: boolean;
  /** The source-side migration-history ledger
   *  (`<source-dir>/.loom/migration-history.json`), when the caller could
   *  read one.  `null`/omitted for a project that has never generated with a
   *  ledger-aware toolchain, or a caller with no source directory (the web
   *  playground) — guards (d)/(e) are then skipped and (a) falls back to
   *  the output tree alone.  See {@link MigrationHistoryLedger}. */
  recordedHistory?: MigrationHistoryLedger | null;
  /** Path to name in the refusal messages, so the operator can go look at
   *  the file that made the claim.  Defaults to a generic name under
   *  {@link LEDGER_REL_DIR} — the CLI always passes the real one. */
  ledgerPath?: string;
}

/** Lowest version in the same per-module block as `version`.
 *
 *  Migration versions are allocated in disjoint per-module BLOCKS
 *  (`BASE_TIMESTAMP + block * MODULE_VERSION_STRIDE`, see
 *  `migrations-builder.ts`), which is what lets several modules share one
 *  backend's migrations directory.  That same arithmetic is the only
 *  per-module attribution available to a guard looking at a flat directory,
 *  because `MigrationArtifactIndex` can see a DEPLOYABLE's files but not
 *  which module emitted each one — and the Ecto emitter's filenames
 *  (`<version>_create_<table>.exs`) don't carry the module either, so
 *  filename matching would only work on four of the five backends.
 *
 *  `null` for a version below the base (not block-allocated at all). */
function versionBlockFloor(version: string): bigint | null {
  if (!/^\d+$/.test(version)) return null;
  const v = BigInt(version);
  const base = BigInt(BASE_TIMESTAMP);
  if (v < base) return null;
  const stride = BigInt(MODULE_VERSION_STRIDE);
  return base + ((v - base) / stride) * stride;
}

/** The subset of `onDisk` that belongs to the module whose next version is
 *  `version` — i.e. the files inside that module's own version block.
 *
 *  This is what stops guard (a) from refusing a BRAND-NEW module because a
 *  SIBLING module hosted by the same deployable has migration files: the new
 *  module is allocated a fresh block above every block in use, so nothing on
 *  disk falls inside it.  Files outside every real block (the far-future
 *  `2999…` provenance/audit migrations, which every backend emits for every
 *  module) are attributed to no module at all — reading those as "this module
 *  has history" is the same false positive one block further out.
 *
 *  ONLY guard (a) reads this.  Guards (b)/(c) ask whether a particular version
 *  NUMBER is on disk, which is a question about the directory rather than
 *  about ownership, so they read the unnarrowed list. */
function versionsInBlockOf(onDisk: readonly string[], version: string): string[] {
  const floor = versionBlockFloor(version);
  if (floor === null) return [...onDisk];
  const ceiling = floor + BigInt(MODULE_VERSION_STRIDE);
  return onDisk.filter((v) => {
    if (!/^\d+$/.test(v)) return false;
    const n = BigInt(v);
    return n >= floor && n < ceiling;
  });
}

/** Does the "Initial" this run is about to emit REPRODUCE the history the
 *  ledger records — byte for byte — rather than replace it?
 *
 *  This is the difference between the two things that reach guard (d) looking
 *  identical from inside the output tree, and it is why the guard compares
 *  CONTENT, not presence:
 *
 *   - **Legitimate determinism.**  Generating an UNCHANGED model into a fresh
 *     directory is a reproducible build (CI, a second environment, a clone
 *     that never committed the output tree).  The tree it produces is the tree
 *     that already exists, so nothing anywhere can be made wrong by it, and it
 *     must stay silent — refusing here would make `-o` a one-directory lock
 *     and break every build that does not carry its output.
 *   - **A silent re-baseline (F-029).**  The model MOVED, so the re-issued
 *     "Initial" carries different SQL under a version a database has already
 *     applied.  The migrator matches the version, considers it applied, skips
 *     the changed contents, and every query naming the new column 500s.
 *
 *  The emitted "Initial" is a pure function of (schema, version), so it
 *  reproduces the record exactly when all three hold:
 *
 *   1. the record is a SINGLE version — a longer history cannot be reproduced
 *      by one migration at all.  A fresh generate COLLAPSES `Initial + delta`
 *      into one file: the end state matches, but a database that applied only
 *      the Initial would never receive the delta, and the delta's file is gone
 *      from the tree that would have delivered it;
 *   2. that version is the one this run would emit — a module whose version
 *      BLOCK has shifted is not reproducing anything;
 *   3. the recorded schema fingerprint is this run's schema.  A record with no
 *      fingerprint (written by an older toolchain) cannot PROVE reproduction,
 *      and an unproven reproduction is read conservatively: refuse, and let
 *      `--allow-rebaseline` be the deliberate way through. */
function reproducesRecordedHistory(m: MigrationsIR, record: ModuleHistoryRecord): boolean {
  if (record.versions.length !== 1) return false;
  if (record.versions[0] !== m.version) return false;
  if (record.schemaHash === undefined) return false;
  return record.schemaHash === schemaFingerprint(m.next);
}

/**
 * Run the baseline-safety checks over freshly-built migrations.  Pure (no
 * fs) — the on-disk state arrives through `index` and the recorded history
 * through `options.recordedHistory`.  Throws {@link MigrationBaselineError}
 * on the first violation.
 */
export function checkMigrationBaseline(
  migrations: readonly MigrationsIR[],
  index: MigrationArtifactIndex,
  options: CheckMigrationBaselineOptions = {},
): void {
  const allowRebaseline = options.allowRebaseline ?? false;
  const ledgerPath = options.ledgerPath ?? `${LEDGER_REL_DIR}/<source>.migration-history.json`;
  for (const m of migrations) {
    // Two views of the same directory, and the difference matters.
    //
    // `onDiskSet` is EVERY migration file the deployable holds.  Guards (b)
    // and (c) ask about a specific version number — "does the file the
    // history claims exist?", "is the number I am about to emit taken?" — and
    // those questions are about the DIRECTORY, not about attribution: a file
    // is present wherever it came from, and a collision is a collision.
    //
    // `ownBlock` is the subset inside THIS module's version block (see
    // `versionsInBlockOf`), which is the only per-module attribution a flat
    // directory supports.  Guard (a) asks "does this module already have
    // history here?", and that one needs attribution — a sibling module's
    // files, and the block-less far-future audit/provenance migrations, are
    // not this module's history.
    const onDiskSet = new Set(index.versions(m.module));
    const ownBlock = versionsInBlockOf(index.versions(m.module), m.version);
    const record = options.recordedHistory?.modules[m.module];
    const recorded = record?.versions ?? [];

    if (m.baseline === null) {
      // An explicit re-baseline overrides every "this module has history"
      // signal; that is the whole point of the flag.
      if (allowRebaseline) continue;

      // (d) The output tree says nothing, but the LEDGER — which travels
      //     with the `.ddd` rather than with `-o` — records migrations this
      //     module has already emitted.  This is F-029: generating into a
      //     CLEAN directory has no snapshot AND no files, so guard (a) below
      //     sees a first run and `buildMigrations` re-issues "Initial" under
      //     the SAME base version as the migration a database has already
      //     applied.  The migrator matches the tag, considers it applied, and
      //     skips the changed content — the new column never lands, the
      //     container reports healthy, and every query naming it fails.
      if (record !== undefined && recorded.length > 0 && !reproducesRecordedHistory(m, record)) {
        const latest = [...recorded].sort().at(-1);
        throw new MigrationBaselineError(
          m.module,
          `refusing to re-baseline module '${m.module}': this run would emit a fresh ` +
            `"Initial" migration, but ${ledgerPath} records that the module has already ` +
            `emitted ${recorded.length} migration(s), up to version ${latest}. The output ` +
            `tree at -o carries neither those migration files nor the baseline snapshot ` +
            `(.loom/snapshots/${m.module}.snapshot.json), so the "Initial" would re-use a ` +
            `version number that has already been applied: a database that ran the earlier ` +
            `migration will match the version, consider it applied, and SKIP the new ` +
            `contents — leaving the schema silently behind the model. Recover either way:\n` +
            `  - point -o at the output tree that holds this module's migration history ` +
            `(the one you generated before), and re-run to get an incremental delta; or\n` +
            `  - re-run with --allow-rebaseline to discard the recorded history and start ` +
            `over from a single "Initial". Only safe against a database you can also ` +
            `recreate — an existing one still has the old migrations applied.`,
        );
      }

      // (a) Missing snapshot + existing migration files IN THIS MODULE'S
      //     version block ⇒ this run would emit a fresh "Initial" and reset
      //     the version/history chain against a database that already has
      //     migrations.  Refuse.  (The block narrowing is what keeps a
      //     brand-new module from being refused for a sibling's files.)
      if (ownBlock.length > 0) {
        throw new MigrationBaselineError(
          m.module,
          `refusing to re-baseline module '${m.module}': its migration snapshot ` +
            `(.loom/snapshots/${m.module}.snapshot.json) is missing, but ${ownBlock.length} ` +
            `migration file(s) already exist in the output tree. Emitting a fresh "Initial" ` +
            `migration here would reset the version history and re-CREATE tables against a ` +
            `database that already has these migrations applied. Restore the snapshot from ` +
            `version control, or pass --allow-rebaseline to overwrite the migration history ` +
            `deliberately.`,
        );
      }
      // Fresh module (no snapshot, no recorded history, no files in its own
      // block) — a genuine first run for this module.  Stay SILENT: `ddd
      // new` → first generate is the most-travelled path in the toolchain,
      // and adding a subdomain to an existing model takes this branch too.
      continue;
    }

    // (b) Snapshot present: every migration the recorded history claims must
    //     have a file on disk.  A history entry with no file means the
    //     snapshot and the output tree have drifted — the next delta would be
    //     computed against a baseline the disk doesn't agree with.
    //
    //     This is a one-directional check (history ⊆ files), NOT files ⊆
    //     history.  Backends legitimately emit migration files the version
    //     chain never records: the feature-local audit/provenance late
    //     migrations (fixed far-future `2999…` versions, deliberately sorted
    //     after every real migration — see dotnet/elixir/java emitters) are
    //     never in `migrationHistory`.  Flagging "extra" files would false-
    //     positive on every audited/provenanced system; the stale-baseline
    //     case it would otherwise catch is caught instead by guard (c) on the
    //     next real delta (the reissued version collides with the file).
    const history = m.baseline.migrationHistory ?? [];
    const missing = history.map((h) => h.version).filter((v) => !onDiskSet.has(v));
    if (missing.length > 0) {
      throw new MigrationBaselineError(
        m.module,
        `migration files for module '${m.module}' are inconsistent with the snapshot ` +
          `(.loom/snapshots/${m.module}.snapshot.json): migration file(s) for version(s) ` +
          `${missing.join(", ")} are recorded in the snapshot history but absent from the output ` +
          `tree. The snapshot and the generated migrations have drifted (deleting part of the ` +
          `output tree by hand does this). Recover either way:\n` +
          `  - keep the history: restore the missing migration file(s) and the snapshot from ` +
          `version control together, then re-run; or\n` +
          `  - start the history over: delete .loom/snapshots/${m.module}.snapshot.json and ` +
          `re-run with --allow-rebaseline, which re-emits a single "Initial" migration for the ` +
          `module's current schema and discards the recorded history. Only safe against a ` +
          `database you can also recreate — an existing database still has the old migrations ` +
          `applied.`,
      );
    }

    // (c) The version this run is about to emit must not already exist on
    //     disk.  It only assigns a new version when there are steps to emit;
    //     a no-op regen reuses the last version and writes no new file.  A
    //     collision here is the tell of a stale baseline whose `lastVersion`
    //     lags the files, reissuing a number already taken.
    if (m.steps.length > 0 && onDiskSet.has(m.version)) {
      throw new MigrationBaselineError(
        m.module,
        `migration version '${m.version}' for module '${m.module}' is already present in the ` +
          `output tree, but this run would emit a new migration under the same version. The ` +
          `snapshot's baseline is stale (its lastVersion lags the migration files on disk). ` +
          `Restore the snapshot from version control so the next version is assigned after the ` +
          `latest file.`,
      );
    }

    // (e) The snapshot and the files in this tree agree with each other — so
    //     (b) and (c) both pass — but the LEDGER records a version this run
    //     is about to emit.  That is an OLDER COPY of the output tree (a
    //     stale checkout, a `-o` pointed at last week's build): internally
    //     consistent, behind the model's real history, and about to re-issue
    //     a version number some database has already applied.  Same failure
    //     mode as (d), reached from the other side.
    if (m.steps.length > 0 && recorded.includes(m.version) && !allowRebaseline) {
      throw new MigrationBaselineError(
        m.module,
        `refusing to re-issue migration version '${m.version}' for module '${m.module}': it ` +
          `is already recorded in ${ledgerPath}, but the output tree at -o does not contain ` +
          `it. That tree is behind this model's real migration history — an older copy, or a ` +
          `different output directory than the one the recorded migrations were written to. ` +
          `Re-issuing the version would produce a DIFFERENT migration under a number a ` +
          `database may already have applied, and the migrator would skip it. Point -o at the ` +
          `output tree that holds the recorded history, or re-run with --allow-rebaseline to ` +
          `discard that history deliberately.`,
      );
    }
  }
}
