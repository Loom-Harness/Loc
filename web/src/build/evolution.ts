// ---------------------------------------------------------------------------
// Evolution diff core — the migration + wire-contract delta between a pinned
// baseline and the live edit, and the playground's `ddd migrate add`.  Kept
// out of the build worker so it's a pure, headless-testable module (the worker
// just serialises `runEvolution` / `recordMigration` over postMessage).  Both
// sides are whole `.ddd` source TREES, lowered through the project loader
// (`loadProjectFromVfs` → `lowerProject`) so multi-file / import baselines
// resolve exactly as `ddd generate system` would on disk.  A single-file source
// is just the one-entry case.  The diff itself is `evolveSystem`
// (`src/system/migration-diff.ts`), the one the toolkit's `diff` runs too.
//
// The current tree may carry the workspace's committed chain
// (`migrations/*.json` beside the entry).  When it reads as one list, the
// chain's heads are the SCHEMA baseline — the migrations shown are what
// recording would write — and the baseline source only drives the wire diff.
//
// CRUCIAL: each side loads on a FRESH, isolated `createDddServices` + VFS.  If
// an evolution tree were loaded into a workspace that ALSO held the generate
// flow's resident `/workspace/*` docs, a cross-aggregate `X id` reference would
// bind to the WRONG document's `X` (same name, different AST node), producing a
// spurious "expects 'Product id' but got 'Product id'" type-mismatch that fails
// the whole diff.  Per-tree isolation (mirroring `src/api/parseSource`) is the
// fix — no shared index, no cross-document contamination, and the two sides
// can't pollute each other either.  Regression-gated by `evolution-diff.test.ts`.
// ---------------------------------------------------------------------------

import { EmptyFileSystem } from "langium";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerProject } from "../../../src/ir/lower/lower.js";
import type { EnrichedLoomModel } from "../../../src/ir/types/loom-ir.js";
import type { MigrationStep, TableShape } from "../../../src/ir/types/migrations-ir.js";
import { createDddServices } from "../../../src/language/ddd-module.js";
import type { Model } from "../../../src/language/generated/ast.js";
import { diagMessage } from "../../../src/diagnostics/messages.js";
import { renderPgStep } from "../../../src/generator/sql-pg.js";
import {
  EMPTY_CHAIN,
  entryFileName,
  headSnapshots,
  type MigrationChain,
  MigrationChainError,
  parseChain,
  parseForkedChain,
  recordGeneration,
  serializeEntry,
} from "../../../src/system/migration-chain.js";
import {
  evolveSystem,
  pendingMigrations,
  wireChangeEntity,
} from "../../../src/system/migration-diff.js";
import { MigrationDestructiveError } from "../../../src/system/migrations-builder.js";
import type { SnapshotStore } from "../../../src/system/snapshot.js";
import { MemoryVfs } from "../vfs/memory-vfs.js";
import { chainDir, readChainFiles } from "./chain-files.js";
import { loadProjectFromVfs } from "./project-loader.js";
import type {
  BuildDiagnostic,
  ChainStatusView,
  EvolutionParams,
  EvolutionResult,
  EvolutionTree,
  MigrationView,
  RecordMigrationParams,
  RecordMigrationResult,
  SchemaTableView,
  WireChangeView,
} from "./protocol.js";

/** Minimal Langium-diagnostic → `BuildDiagnostic` projection (the slice the
 *  evolution flow needs; the worker's generate path has its own copy). */
function collectDiagnostics(
  docs: {
    diagnostics?: { severity?: number; message: string | { value: string }; source?: string }[];
  }[],
): BuildDiagnostic[] {
  const out: BuildDiagnostic[] = [];
  for (const doc of docs) {
    for (const d of doc.diagnostics ?? []) {
      out.push({
        severity: d.severity === 1 ? "error" : "warning",
        message: typeof d.message === "string" ? d.message : d.message.value,
        source: typeof d.source === "string" ? d.source : "loom",
      });
    }
  }
  return out;
}

function loweringDiag(err: unknown): BuildDiagnostic {
  return {
    severity: "error",
    message: `Lowering failed: ${err instanceof Error ? err.message : String(err)}`,
    source: "loom-ir",
  };
}

function migrationDiag(err: unknown): BuildDiagnostic {
  return {
    severity: "error",
    message: `Migration derivation failed: ${err instanceof Error ? err.message : String(err)}`,
    source: "loom-evolve",
  };
}

function chainDiag(err: MigrationChainError): BuildDiagnostic {
  return {
    severity: "error",
    code: "loom.migration-chain-invalid",
    message: diagMessage("loom.migration-chain-invalid", { detail: err.message }),
    source: "loom-migrations",
  };
}

/** Load one diff side on its OWN isolated Langium services + VFS and lower it
 *  to an enriched IR.  Returns either the lowered model or the parse/import/
 *  lowering diagnostics that stopped it — never throws.  Isolation is the
 *  whole point (see the module header): the fresh services' workspace holds
 *  only this tree's docs, so name resolution can't reach a resident
 *  `/workspace/*` doc (or the other diff side). */
async function loadEvolutionTree(
  tree: EvolutionTree,
): Promise<
  | {
      loom: EnrichedLoomModel;
      diagnostics: BuildDiagnostic[];
      chainFiles: { name: string; content: string }[] | undefined;
    }
  | { error: BuildDiagnostic[] }
> {
  const svc = createDddServices(EmptyFileSystem);
  const vfs = new MemoryVfs();
  vfs.hydrate(tree.files);
  try {
    const { all } = await loadProjectFromVfs(tree.entryPath, svc.shared, vfs);
    const diagnostics = collectDiagnostics(all);
    if (diagnostics.some((d) => d.severity === "error")) return { error: diagnostics };
    const loom = enrichLoomModel(lowerProject(all.map((d) => d.parseResult?.value as Model)));
    return { loom, diagnostics, chainFiles: readChainFiles(vfs, tree.entryPath) };
  } catch (err) {
    // Missing import / cycle (from the loader) or a lowering throw.
    return { error: [loweringDiag(err)] };
  }
}

/** Derive the migration + wire-contract delta a source change implies, between
 *  a pinned baseline tree and the live edit tree.  Pure (no worker globals) so
 *  it's directly unit-testable. */
export async function runEvolution(params: EvolutionParams): Promise<EvolutionResult> {
  // Load the CURRENT tree — its diagnostics are what the user acts on, and a
  // broken current source can't be diffed.  Each side is fully isolated (own
  // services + VFS), so ordering / disposal between sides is moot.
  const curLoaded = await loadEvolutionTree(params.current);
  if ("error" in curLoaded) return { ok: false, diagnostics: curLoaded.error };
  const curLoom = curLoaded.loom;
  const curDiags = curLoaded.diagnostics;
  if (curLoom.systems.length === 0) {
    return {
      ok: true,
      hasBaseline: false,
      chain: null,
      migrations: [],
      tables: [],
      wireChanges: [],
      breaking: false,
      diagnostics: [
        {
          severity: "warning",
          message:
            "Source has no `system` block — schema migrations and the wire contract are derived per system, so there is nothing to evolve yet.",
          source: "loom-evolve",
        },
      ],
    };
  }

  let baseSystemsByName = new Map<string, EnrichedLoomModel["systems"][number]>();
  if (params.baseline && params.baseline.files.length > 0) {
    const baseLoaded = await loadEvolutionTree(params.baseline);
    // A baseline that no longer loads/lowers (a since-removed feature, a
    // missing import at that ref) is treated as absent rather than failing
    // the whole diff — everything then reads Initial.
    if (!("error" in baseLoaded)) {
      baseSystemsByName = new Map(baseLoaded.loom.systems.map((s) => [s.name, s]));
    }
  }
  // The committed chain.  One that reads as one list is the schema baseline;
  // two heads are reported (nothing can read them until a rebase) and the
  // schema falls back to the baseline source; anything else is an error —
  // a diff against a chain that does not read would say nothing true.
  let chain: MigrationChain | null = null;
  let forkHeads: [string, string] | undefined;
  let chainEntries = 0;
  if (curLoaded.chainFiles) {
    try {
      const fork = parseForkedChain(curLoaded.chainFiles);
      if (fork) {
        forkHeads = [entryFileName(fork.tails[0].at(-1)!), entryFileName(fork.tails[1].at(-1)!)];
        chainEntries = curLoaded.chainFiles.length;
      } else {
        chain = parseChain(curLoaded.chainFiles);
        chainEntries = chain.entries.length;
      }
    } catch (err) {
      if (!(err instanceof MigrationChainError)) throw err;
      return { ok: false, diagnostics: [...curDiags, chainDiag(err)] };
    }
  }
  const chainHeads: SnapshotStore | null = chain ? headSnapshots(chain) : null;
  const hasBaseline = baseSystemsByName.size > 0 || chainHeads !== null;

  const migrations: MigrationView[] = [];
  const tables: SchemaTableView[] = [];
  const wireChanges: WireChangeView[] = [];
  let breaking = false;

  for (const curSys of curLoom.systems) {
    const baseSys = baseSystemsByName.get(curSys.name) ?? null;
    let evo: ReturnType<typeof evolveSystem>;
    try {
      evo = evolveSystem(curLoom, curSys, baseSys, chainHeads);
    } catch (err) {
      return { ok: false, diagnostics: [...curDiags, migrationDiag(err)] };
    }
    if (evo.breaking) breaking = true;
    for (const mig of evo.deltas) {
      // The diagram wants EVERY current table, touched or not — a module
      // with no steps still contributes its (untouched) tables.
      for (const t of mig.next.tables) tables.push(tableView(mig.module, t));
      if (mig.steps.length === 0) continue; // clean regen ⇒ no-op, don't list
      migrations.push({
        module: mig.module,
        name: mig.name,
        steps: mig.steps.map((s) => ({ op: s.op, sql: renderPgStep(s), table: stepTable(s) })),
        destructive: evo.destructive.has(mig.module),
        destructiveMessage: evo.destructive.get(mig.module),
      });
    }
    for (const c of evo.wire?.changes ?? []) {
      wireChanges.push({
        entity: wireChangeEntity(c),
        field: c.field,
        kind: c.kind,
        breaking: c.breaking,
        detail: c.detail,
      });
    }
  }

  let chainStatus: ChainStatusView | null = null;
  if (curLoaded.chainFiles) {
    const last = chain?.entries.at(-1);
    chainStatus = {
      entries: chainEntries,
      head: last ? { version: last.version, module: last.module, name: last.name } : null,
      unrecordedSteps: chain ? migrations.reduce((n, m) => n + m.steps.length, 0) : 0,
      ...(forkHeads ? { forkHeads } : {}),
    };
  }

  return {
    ok: true,
    hasBaseline,
    chain: chainStatus,
    migrations,
    tables,
    wireChanges,
    breaking,
    diagnostics: curDiags,
  };
}

/** Record the live edit's schema changes as the next entries of the chain
 *  its tree carries — the playground's `ddd migrate add`, on the same pure
 *  cores (`pendingMigrations` + `recordGeneration`).  Returns the new chain
 *  files for the caller to write; never throws on a refusal (an invalid or
 *  forked chain, a destructive change not allowed, a bad or taken name). */
export async function recordMigration(
  params: RecordMigrationParams,
): Promise<RecordMigrationResult> {
  const loaded = await loadEvolutionTree(params.current);
  if ("error" in loaded) return { ok: false, diagnostics: loaded.error };
  const refuse = (message: string): RecordMigrationResult => ({
    ok: false,
    diagnostics: [
      ...loaded.diagnostics,
      { severity: "error", message, source: "loom-migrations" },
    ],
  });
  if (loaded.loom.systems.length === 0) return refuse(diagMessage("loom.no-system"));
  try {
    const chain = loaded.chainFiles ? parseChain(loaded.chainFiles) : EMPTY_CHAIN;
    const deltas = pendingMigrations(loaded.loom, chain, {
      allowDestructive: params.allowDestructive,
    });
    const entries = recordGeneration(chain, deltas, {
      name: params.name,
      now: params.now,
      allowDestructive: params.allowDestructive,
    });
    const dir = chainDir(params.current.entryPath);
    return {
      ok: true,
      files: entries.map((e) => ({ path: `${dir}/${entryFileName(e)}`, content: serializeEntry(e) })),
      diagnostics: loaded.diagnostics,
    };
  } catch (err) {
    if (err instanceof MigrationChainError) {
      return { ok: false, diagnostics: [...loaded.diagnostics, chainDiag(err)] };
    }
    if (err instanceof MigrationDestructiveError) return refuse(err.message);
    return { ok: false, diagnostics: [...loaded.diagnostics, migrationDiag(err)] };
  }
}

/** The bare table a migration step targets, or `undefined` for the ops that
 *  have none (`sqlComment`, `sqlExec`) or target an index by name only
 *  (`renameIndex`).  `renameTable` reports the NEW name — that's the node the
 *  diagram draws. */
export function stepTable(step: MigrationStep): string | undefined {
  switch (step.op) {
    case "createTable":
      return step.table.name;
    case "dropTable":
      return step.name;
    case "renameTable":
      return step.to;
    case "addIndex":
      return step.index.table;
    case "addCheck":
      return step.check.table;
    case "addColumn":
    case "dropColumn":
    case "renameColumn":
    case "alterColumnNullable":
    case "alterColumnType":
    case "alterColumnDefault":
    case "dropIndex":
    case "dropCheck":
    case "backfillColumn":
      return step.table;
    case "renameIndex":
    case "sqlComment":
    case "sqlExec":
      return undefined;
    default: {
      // Exhaustive: a new `MigrationStep.op` fails HERE with the missing kind
      // named, instead of as a bare "not all code paths return a value" on the
      // signature (this file is typechecked only by `web/`'s tsc, so the root
      // build never sees it).
      const _exhaustive: never = step;
      return undefined;
    }
  }
}

function tableView(module: string, t: TableShape): SchemaTableView {
  return {
    module,
    name: t.name,
    schema: t.schema,
    columns: t.columns.map((c) => c.name),
    refs: [...new Set(t.foreignKeys.map((fk) => fk.refTable))],
  };
}
