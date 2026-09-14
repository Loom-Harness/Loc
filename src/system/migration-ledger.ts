import * as fs from "node:fs";
import * as path from "node:path";

import type { MigrationsIR } from "../ir/types/migrations-ir.js";

// ---------------------------------------------------------------------------
// Source-side migration-history ledger (F-029).
//
// The migration BASELINE (`.loom/snapshots/<module>.snapshot.json`) and the
// migration FILES both live in the output tree, which is the only place they
// can live: the baseline describes the schema those files build up, and a
// delta is only meaningful next to the files it follows.  That works as long
// as `-o` points at the tree that carries them.
//
// It stops working the moment it doesn't.  A CLEAN output directory has no
// snapshot AND no migration files, which is indistinguishable — from inside
// the output tree — from a genuine first run: `buildMigrations` emits a fresh
// "Initial" carrying the CURRENT schema under the SAME base version, and the
// `migration-artifacts.ts` guards see nothing to object to.  Deploy that tree
// against a database the earlier tree already migrated and the migrator
// matches the tag, considers it applied, and skips the changed content: the
// new column never lands, the container reports healthy, and every query that
// names it fails.  `ddd generate system … -o ../build` in CI, a fresh clone
// that never committed the output tree, or a second environment all take this
// path.
//
// The missing fact is not in the output tree, so it is recorded next to the
// SOURCE: for every module, the migration versions this model has ever
// emitted.  Committed with the `.ddd` it describes, it travels with the model
// into any checkout, and makes "this module already has history" knowable in
// a tree that carries none of it.
//
// This file is deliberately NOT a second baseline: it records versions, not
// schema, and nothing diffs against it.  Re-emitting an earlier migration's
// FILE is impossible from it (the SQL is not here), so the ledger's only job
// is to let `checkMigrationBaseline` REFUSE — with `--allow-rebaseline` as
// the deliberate override — instead of silently re-baselining.
//
// Only `readMigrationLedger` / `writeMigrationLedger` touch `node:fs`, and
// only the CLI calls them: the browser playground has no source directory and
// simply omits the ledger, keeping its prior behaviour.
// ---------------------------------------------------------------------------

/** What the ledger records for one module. */
export interface ModuleHistoryRecord {
  /** Every migration version ever emitted for the module, ascending. */
  versions: string[];
}

export interface MigrationHistoryLedger {
  /** Bumped only for a shape change readers must branch on.  A reader that
   *  meets a HIGHER version than it knows ignores the file rather than
   *  mis-reading it (and says so). */
  schemaVersion: 1;
  /** Module name → its recorded history.  A module absent here has never
   *  emitted a migration from this model — which is what lets a brand-new
   *  module be told apart from a lost baseline. */
  modules: Record<string, ModuleHistoryRecord>;
}

/** Raised when the ledger file exists but cannot be read or parsed.  Like
 *  {@link SnapshotReadError}, deliberately NOT collapsed to "no ledger": a
 *  missing ledger disables the F-029 guard, so a corrupt one must fail
 *  loudly rather than quietly widening the window it closes. */
export class MigrationLedgerReadError extends Error {
  constructor(
    readonly filePath: string,
    reason: unknown,
  ) {
    const detail = reason instanceof Error ? reason.message : String(reason);
    super(
      `migration history ledger at ${filePath} exists but could not be read (${detail}). ` +
        "It is likely corrupted or truncated (e.g. an interrupted write or an unresolved " +
        "merge conflict). Restore it from version control, or delete it deliberately — " +
        "the next generate re-creates it from the migrations it emits.",
    );
    this.name = "MigrationLedgerReadError";
  }
}

/** Path of the ledger relative to the directory holding the `.ddd` source.
 *  Stable so the guard messages and the docs can both name it. */
export const LEDGER_REL_PATH = ".loom/migration-history.json";

/** Short prose carried INSIDE the file — it is a committed artifact whose
 *  first reader is usually someone who just hit the refusal that names it. */
const LEDGER_NOTE =
  "Migration history recorded by `ddd generate system`, kept beside the .ddd source and " +
  "meant to be committed with it. It records WHICH migration versions each module has " +
  "emitted — not the schema (that is .loom/snapshots/<module>.snapshot.json in the output " +
  "tree). Its only job is to stop a generate into an output tree with no migration history " +
  "from silently re-issuing an already-applied version. See docs/migrations.md.";

/** Build the ledger this run should record.  Pure.
 *
 *  A module built by this run is REPLACED by the history the run itself
 *  emitted (`next.migrationHistory` — already the merge of the baseline's
 *  history with anything appended), never unioned with what the ledger said
 *  before.  The ledger's claim is "this is the history of the tree this
 *  model last generated", and a deliberate `--allow-rebaseline` legitimately
 *  SHORTENS that history: unioning would leave the discarded versions
 *  recorded, and guard (e) would then refuse the very next delta in the
 *  freshly re-baselined tree (migration versions are derived from the
 *  baseline, so the new tree re-issues the same numbers).
 *
 *  Modules recorded by `previous` but absent from `migrations` are KEPT — a
 *  module dropped from the model (or hosted by a system this run didn't
 *  build) still has its tables in whatever database ran it, so forgetting
 *  its history would re-open exactly the window this file closes. */
export function buildMigrationLedger(
  migrations: readonly MigrationsIR[],
  previous: MigrationHistoryLedger | null = null,
): MigrationHistoryLedger {
  const modules: Record<string, ModuleHistoryRecord> = {};
  for (const [name, record] of Object.entries(previous?.modules ?? {})) {
    modules[name] = { versions: [...record.versions] };
  }
  for (const m of migrations) {
    // `next.migrationHistory` is the merged list (prior history + any entry
    // this run appended), so it is already the complete record.  A run that
    // emits nothing still re-records what was there.
    const versions = [...new Set((m.next.migrationHistory ?? []).map((e) => e.version))].sort();
    // A module that emitted nothing records nothing — and never ERASES an
    // existing record: "no history in this run" is not evidence that the
    // history the ledger remembers has gone away.  (Guard (d) refuses that
    // combination long before we get here, unless it was overridden.)
    if (versions.length === 0) continue;
    modules[m.module] = { versions };
  }
  return { schemaVersion: 1, modules };
}

/** Stable JSON — modules sorted by name, versions ascending, two-space
 *  indent.  Deterministic: the file is committed, so a regen that changes
 *  nothing must produce a byte-identical file. */
export function serializeMigrationLedger(ledger: MigrationHistoryLedger): string {
  const modules: Record<string, ModuleHistoryRecord> = {};
  for (const name of Object.keys(ledger.modules).sort()) {
    modules[name] = { versions: [...ledger.modules[name]!.versions].sort() };
  }
  return `${JSON.stringify({ schemaVersion: 1, _note: LEDGER_NOTE, modules }, null, 2)}\n`;
}

/** Parse ledger JSON, tolerating unknown keys (the `_note` above) and
 *  rejecting anything whose shape isn't the one we wrote.  `null` for a
 *  ledger written by a FUTURE schemaVersion — an unknown shape is not read
 *  as "no history", so the caller reports it rather than guessing. */
export function parseMigrationLedger(
  raw: string,
): { ledger: MigrationHistoryLedger } | { unsupportedVersion: number } {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) throw new Error("not a JSON object");
  const obj = parsed as { schemaVersion?: unknown; modules?: unknown };
  if (typeof obj.schemaVersion !== "number") throw new Error("missing `schemaVersion`");
  if (obj.schemaVersion > 1) return { unsupportedVersion: obj.schemaVersion };
  if (typeof obj.modules !== "object" || obj.modules === null) throw new Error("missing `modules`");
  const modules: Record<string, ModuleHistoryRecord> = {};
  for (const [name, value] of Object.entries(obj.modules as Record<string, unknown>)) {
    const versions = (value as { versions?: unknown })?.versions;
    if (!Array.isArray(versions) || versions.some((v) => typeof v !== "string")) {
      throw new Error(`module '${name}' has no string \`versions\` array`);
    }
    modules[name] = { versions: versions as string[] };
  }
  return { ledger: { schemaVersion: 1, modules } };
}

/** Read the ledger beside `sourceDir`.  `null` when there is none (a project
 *  that has never generated with this toolchain — the guard then falls back
 *  to the output-tree heuristic).  Throws {@link MigrationLedgerReadError}
 *  when a file IS present but unreadable. */
export function readMigrationLedger(sourceDir: string): MigrationHistoryLedger | null {
  const filePath = migrationLedgerPath(sourceDir);
  if (!fs.existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new MigrationLedgerReadError(filePath, err);
  }
  let result: ReturnType<typeof parseMigrationLedger>;
  try {
    result = parseMigrationLedger(raw);
  } catch (err) {
    throw new MigrationLedgerReadError(filePath, err);
  }
  if ("unsupportedVersion" in result) {
    throw new MigrationLedgerReadError(
      filePath,
      new Error(
        `it declares schemaVersion ${result.unsupportedVersion}, which this toolchain does not ` +
          "understand (it was written by a newer Loom). Upgrade the toolchain rather than " +
          "deleting the file — it records which migrations have already been emitted",
      ),
    );
  }
  return result.ledger;
}

/** Write the ledger beside `sourceDir`, creating `.loom/` if needed.  No-op
 *  when the content is unchanged, so a repeat generate leaves the file's
 *  mtime (and any VCS status) alone.  Returns whether anything was written.
 *
 *  Failure is reported to the caller rather than thrown: losing the detector
 *  must not fail a generate that otherwise succeeded (a read-only source
 *  checkout is a real setup), but it must not be silent either — the CLI
 *  prints a warning. */
export function writeMigrationLedger(
  sourceDir: string,
  ledger: MigrationHistoryLedger,
): { written: boolean; error?: Error } {
  const filePath = migrationLedgerPath(sourceDir);
  const content = serializeMigrationLedger(ledger);
  try {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) {
      return { written: false };
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
    return { written: true };
  } catch (err) {
    return { written: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/** Absolute path of the ledger for a source directory. */
export function migrationLedgerPath(sourceDir: string): string {
  return path.join(sourceDir, LEDGER_REL_PATH);
}
