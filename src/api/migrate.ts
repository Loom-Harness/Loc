// ---------------------------------------------------------------------------
// The MIGRATION family of the toolkit — `ddd migrate status` and
// `ddd migrate add` as pure functions of a `.ddd` source plus the files of its
// committed `migrations/` directory.  The transport-neutral core behind the
// `loom_migration_status` and `loom_migration_record` agent tools.
//
// Both ride the cores the CLI runs (`migrationStatus`, `recordPendingMigrations`
// in `src/system/migration-diff.ts`, over `parseChain`), so a status or a
// recorded entry here is byte-for-byte what the CLI would print or write for
// the same model and chain.  Nothing is written: `recordMigration` RETURNS the
// new chain files, and the host decides where they land (a `migrations/`
// directory, the playground's workspace).  Browser-safe like the rest of the
// toolkit.
// ---------------------------------------------------------------------------

import type { JsonDiagnostic } from "../diagnostics/contract.js";
import { diagMessage } from "../diagnostics/messages.js";
import type { EnrichedLoomModel } from "../ir/types/loom-ir.js";
import {
  entryFileName,
  MIGRATIONS_DIR,
  type MigrationChain,
  MigrationChainError,
  parseChain,
  serializeEntry,
  utcVersionNow,
} from "../system/migration-chain.js";
import {
  type ModuleMigrationStatus,
  recordPendingMigrations,
  migrationStatus as statusCore,
} from "../system/migration-diff.js";
import {
  MigrationDestructiveError,
  MigrationShapeChangeError,
} from "../system/migrations-builder.js";
import { loadMigratableSource } from "./evolve.js";

export type { ModuleMigrationStatus } from "../system/migration-diff.js";

/** One file of a `migrations/` directory: its file name and JSON content. */
export interface ChainFile {
  name: string;
  content: string;
}

/** `ddd migrate status` as data. */
export interface MigrationStatusReport {
  ok: boolean;
  /** A chain was supplied (the model has a `migrations/` directory).  Without
   *  one every module's schema is unrecorded and starts with its `Initial`. */
  recorded: boolean;
  /** Recorded entries in the chain. */
  entries: number;
  /** The chain's newest entry, if any. */
  head: { version: string; module: string; name: string } | null;
  /** Each owning module's head, unrecorded steps and destructive verdict. */
  modules: ModuleMigrationStatus[];
  /** Some module has steps the chain does not record — recording is due
   *  before a boot can bring a database to the model. */
  unrecorded: boolean;
  /** Recording the unrecorded steps needs the explicit destructive
   *  acknowledgement (`allowDestructive`, the CLI's `--allow-destructive`). */
  destructive: boolean;
  /** `migration` blocks the chain has fully applied, which the source may
   *  drop. */
  spentBlocks: string[];
  diagnostics: JsonDiagnostic[];
}

/** One chain file a recording wrote. */
export interface RecordedFile {
  /** The file name inside `migrations/` — what the `migrations` input of the
   *  next call takes. */
  name: string;
  /** `migrations/<name>`, relative to the directory holding the `.ddd`. */
  path: string;
  content: string;
}

/** `ddd migrate add` as data. */
export interface RecordMigrationReport {
  ok: boolean;
  /** The new chain entries, in chain order; empty (still `ok`) when the model
   *  has no schema change since the chain's head. */
  files: RecordedFile[];
  /** The refusal is the destructive gate's: recording needs
   *  `allowDestructive: true`. */
  needsAcknowledgement: boolean;
  diagnostics: JsonDiagnostic[];
}

/** Options for {@link recordMigration}. */
export interface RecordMigrationOptions {
  /** kebab-case migration name (`add-order-note`). */
  name: string;
  /** Let destructive steps into the entry — the `--allow-destructive`
   *  acknowledgement.  Default false: a destructive change is refused. */
  allowDestructive?: boolean;
  /** The clock the entries are numbered from, `YYYYMMDDHHMMSS` (UTC).
   *  Default: now. */
  now?: string;
}

function chainInvalid(err: MigrationChainError): JsonDiagnostic {
  return {
    code: "loom.migration-chain-invalid",
    severity: "error",
    phase: "ir-validate",
    message: diagMessage("loom.migration-chain-invalid", { detail: err.message }),
  };
}

function derivationFailed(err: unknown): JsonDiagnostic {
  return {
    code: "loom.ir-internal",
    severity: "error",
    phase: "ir-validate",
    message: diagMessage("loom.ir-internal#migration-derivation", {
      message: err instanceof Error ? err.message : String(err),
    }),
  };
}

/** A derivation refusal that carries its own `loom.*` code and wording (the
 *  destructive gate, a discarded backfill, a mis-scoped sql step). */
function refusal(err: Error & { code?: unknown }): JsonDiagnostic {
  return {
    code: typeof err.code === "string" ? err.code : "loom.ir-internal",
    severity: "error",
    phase: "ir-validate",
    message: err.message,
  };
}

function readChain(
  files: readonly ChainFile[] | undefined,
): { chain: MigrationChain } | { error: JsonDiagnostic } {
  try {
    return { chain: parseChain(files ?? []) };
  } catch (err) {
    if (!(err instanceof MigrationChainError)) throw err;
    return { error: chainInvalid(err) };
  }
}

function emptyStatus(diagnostics: JsonDiagnostic[]): MigrationStatusReport {
  return {
    ok: false,
    recorded: false,
    entries: 0,
    head: null,
    modules: [],
    unrecorded: false,
    destructive: false,
    spentBlocks: [],
    diagnostics,
  };
}

/** {@link migrationStatus} over a model the caller already loaded and
 *  validated.  `chainFiles` undefined ⇒ no `migrations/` directory. */
export function migrationStatusModels(
  loom: EnrichedLoomModel,
  chainFiles: readonly ChainFile[] | undefined,
): MigrationStatusReport {
  const read = readChain(chainFiles);
  if ("error" in read) return emptyStatus([read.error]);
  const { chain } = read;
  let status: ReturnType<typeof statusCore>;
  try {
    status = statusCore(loom, chain);
  } catch (err) {
    return emptyStatus([
      err instanceof Error && "code" in err ? refusal(err) : derivationFailed(err),
    ]);
  }
  const head = chain.entries.at(-1);
  return {
    ok: true,
    recorded: chainFiles !== undefined,
    entries: chain.entries.length,
    head: head ? { version: head.version, module: head.module, name: head.name } : null,
    modules: status.modules,
    unrecorded: status.modules.some((m) => m.unrecordedSteps > 0),
    destructive: status.modules.some((m) => m.destructive),
    spentBlocks: status.spentBlocks,
    diagnostics: loom.systems.length === 0 ? [noSystem("warning")] : [],
  };
}

/** A source without a `system` block derives no schema, so it has nothing to
 *  record. */
function noSystem(severity: "error" | "warning"): JsonDiagnostic {
  return {
    code: "loom.no-system",
    severity,
    phase: "ir-validate",
    message: diagMessage("loom.no-system"),
  };
}

/**
 * What the migration chain records against what the model describes — the
 * toolkit twin of `ddd migrate status`.  `migrations` are the files of the
 * model's committed `migrations/` directory; omit them when it has none.
 * A source that does not validate, or a chain that does not read as one
 * list, returns `ok: false` with diagnostics.
 */
export async function migrationStatus(
  source: string,
  migrations?: readonly ChainFile[],
): Promise<MigrationStatusReport> {
  const loaded = await loadMigratableSource(source);
  if ("error" in loaded) return emptyStatus(loaded.error);
  const report = migrationStatusModels(loaded.loom, migrations);
  return { ...report, diagnostics: [...loaded.diagnostics, ...report.diagnostics] };
}

/** {@link recordMigration} over a model the caller already loaded and
 *  validated. */
export function recordMigrationModels(
  loom: EnrichedLoomModel,
  chainFiles: readonly ChainFile[] | undefined,
  options: RecordMigrationOptions,
): RecordMigrationReport {
  const refused = (d: JsonDiagnostic, needsAcknowledgement = false): RecordMigrationReport => ({
    ok: false,
    files: [],
    needsAcknowledgement,
    diagnostics: [d],
  });
  if (loom.systems.length === 0) return refused(noSystem("error"));
  const read = readChain(chainFiles);
  if ("error" in read) return refused(read.error);
  try {
    const entries = recordPendingMigrations(loom, read.chain, {
      name: options.name,
      now: options.now ?? utcVersionNow(),
      allowDestructive: options.allowDestructive,
    });
    return {
      ok: true,
      files: entries.map((e) => ({
        name: entryFileName(e),
        path: `${MIGRATIONS_DIR}/${entryFileName(e)}`,
        content: serializeEntry(e),
      })),
      needsAcknowledgement: false,
      diagnostics: [],
    };
  } catch (err) {
    if (err instanceof MigrationChainError) {
      return refused({
        code: "loom.migration-name-invalid",
        severity: "error",
        phase: "ir-validate",
        message: diagMessage("loom.migration-name-invalid", { detail: err.message }),
      });
    }
    if (err instanceof MigrationDestructiveError || err instanceof MigrationShapeChangeError) {
      return refused(refusal(err), true);
    }
    if (err instanceof Error && "code" in err) return refused(refusal(err));
    return refused(derivationFailed(err));
  }
}

/**
 * Record the model's schema changes since the chain's head as the next chain
 * entries — the toolkit twin of `ddd migrate add <name> [--allow-destructive]`.
 * Returns the new `migrations/` files for the host to write; writes nothing.
 * A destructive change is refused (`needsAcknowledgement: true`) unless
 * `allowDestructive` is set.  A name that is not kebab-case or is already
 * taken by the module is refused with `loom.migration-name-invalid`.
 */
export async function recordMigration(
  source: string,
  migrations: readonly ChainFile[] | undefined,
  options: RecordMigrationOptions,
): Promise<RecordMigrationReport> {
  const loaded = await loadMigratableSource(source);
  if ("error" in loaded) {
    return { ok: false, files: [], needsAcknowledgement: false, diagnostics: loaded.error };
  }
  const report = recordMigrationModels(loaded.loom, migrations, options);
  return { ...report, diagnostics: [...loaded.diagnostics, ...report.diagnostics] };
}
