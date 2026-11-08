import type { EnrichedLoomModel } from "../ir/types/loom-ir.js";
import type { SchemaSnapshot } from "../ir/types/migrations-ir.js";
import {
  type ChainEntry,
  headSnapshots,
  type MigrationChain,
  recordGeneration,
} from "./migration-chain.js";
import {
  buildMigrations,
  type MigrationDelta,
  type MigrationDestructiveError,
  type MigrationShapeChangeError,
  type MigrationWarning,
} from "./migrations-builder.js";
import { memorySnapshotStore, type SnapshotStore } from "./snapshot.js";
import { buildWireSpec } from "./wire-spec.js";
import { diffWireSpec, type WireContractChange, type WireContractDiff } from "./wire-spec-diff.js";

// ---------------------------------------------------------------------------
// What a model change implies for the schema and the wire contract — the one
// derivation behind `ddd migrate add` / `status`, the toolkit's `diff`, and
// the playground's Migrations dock.  Pure and browser-safe: it reaches no
// generator, so the playground worker can import it statically.
// ---------------------------------------------------------------------------

type EnrichedSystemIR = EnrichedLoomModel["systems"][number];

/** The model's `migration { … }` intents, as `buildMigrations` takes them.
 *  Every diff of a model passes them, or a declared rename reads as a
 *  drop + add. */
export function migrationIntents(loom: EnrichedLoomModel) {
  return {
    renameIntents: loom.renameIntents,
    tableRenameIntents: loom.tableRenameIntents,
    backfillIntents: loom.backfillIntents,
    sqlSteps: loom.sqlMigrationSteps,
  };
}

/** The schema changes `loom` has made since `chain`'s head — one delta per
 *  owning module of every system, empty where nothing changed.  What
 *  `ddd migrate add` records, and what `generate system` refuses to render
 *  past.  Pure: the caller reads the chain and writes the entries. */
export function pendingMigrations(
  loom: EnrichedLoomModel,
  chain: MigrationChain,
  options: {
    allowDestructive?: boolean;
    warnings?: MigrationWarning[];
    destructiveRefusals?: (MigrationDestructiveError | MigrationShapeChangeError)[];
  } = {},
): MigrationDelta[] {
  return loom.systems.flatMap((sys) =>
    buildMigrations(sys, headSnapshots(chain), {
      ...migrationIntents(loom),
      allowDestructive: options.allowDestructive,
      warnings: options.warnings,
      destructiveRefusals: options.destructiveRefusals,
    }),
  );
}

/** Record `loom`'s schema changes since `chain`'s head as its next entries —
 *  `ddd migrate add`, the playground's Record migration and the
 *  `loom_migration_record` tool, on one core.  Throws the derivation's
 *  refusals (a destructive change without `allowDestructive`) and
 *  `recordGeneration`'s (a bad or taken name); the caller writes the
 *  entries.  Empty when nothing changed. */
export function recordPendingMigrations(
  loom: EnrichedLoomModel,
  chain: MigrationChain,
  options: { name: string; now: string; allowDestructive?: boolean; warnings?: MigrationWarning[] },
): ChainEntry[] {
  const deltas = pendingMigrations(loom, chain, {
    allowDestructive: options.allowDestructive,
    warnings: options.warnings,
  });
  return recordGeneration(chain, deltas, {
    name: options.name,
    now: options.now,
    allowDestructive: options.allowDestructive,
  });
}

/** One owning module's line in a migration status. */
export interface ModuleMigrationStatus {
  module: string;
  /** The module's newest recorded entry, if any. */
  head?: { version: string; name: string };
  /** Steps the model has that the chain does not record yet. */
  unrecordedSteps: number;
  /** The destructive gate refuses the unrecorded steps: recording them needs
   *  the explicit acknowledgement (`--allow-destructive`). */
  destructive: boolean;
  /** The gate's refusal message when `destructive`. */
  destructiveMessage?: string;
}

/** What the chain records against what the model describes. */
export interface MigrationStatus {
  /** One line per owning module of every system, in module order. */
  modules: ModuleMigrationStatus[];
  /** The `loom.migration-block-applied` advisories: `migration` blocks the
   *  chain has fully applied, which the source may drop. */
  spentBlocks: string[];
}

/** `ddd migrate status` and the `loom_migration_status` tool, on one core:
 *  each owning module's head and the steps recording would write, with the
 *  destructive gate's verdict on them.  Throws any derivation refusal other
 *  than the destructive gate. */
export function migrationStatus(loom: EnrichedLoomModel, chain: MigrationChain): MigrationStatus {
  const warnings: MigrationWarning[] = [];
  const refusals: (MigrationDestructiveError | MigrationShapeChangeError)[] = [];
  const deltas = pendingMigrations(loom, chain, { warnings, destructiveRefusals: refusals });
  const modules = deltas.map((d): ModuleMigrationStatus => {
    const head = chain.entries.filter((e) => e.module === d.module).at(-1);
    const messages = refusals.filter((r) => r.module === d.module).map((r) => r.message);
    return {
      module: d.module,
      ...(head ? { head: { version: head.version, name: head.name } } : {}),
      unrecordedSteps: d.steps.length,
      destructive: messages.length > 0,
      ...(messages.length > 0 ? { destructiveMessage: messages.join("\n") } : {}),
    };
  });
  const spentBlocks = warnings
    .filter((w) => w.code === "loom.migration-block-applied")
    .map((w) => w.message);
  return { modules, spentBlocks };
}

/** One system's evolution from a baseline to the current model. */
export interface SystemEvolution {
  /** Every owning module's delta, in module order — a module with nothing to
   *  migrate carries an empty `steps`. */
  deltas: MigrationDelta[];
  /** Module → the destructive gate's refusal message(s), for every module
   *  whose delta it refused.  Those deltas are derived with the gate off, so
   *  the caller still shows the steps the change implies. */
  destructive: ReadonlyMap<string, string>;
  /** The wire-contract diff; `null` without a baseline system, where every
   *  shape is new and the diff would be noise. */
  wire: WireContractDiff | null;
  /** A destructive delta or a breaking wire change. */
  breaking: boolean;
}

/** Diff `curSys` against a baseline.  The schema baseline is `chainHeads`
 *  when the model has a committed chain — the migrations then are exactly
 *  what `ddd migrate add` would record — and otherwise the baseline system's
 *  own schema (none ⇒ every module reads `Initial`).  The wire contract is
 *  always diffed against `baseSys`.  Throws any derivation refusal other than
 *  the destructive gate. */
export function evolveSystem(
  loom: EnrichedLoomModel,
  curSys: EnrichedSystemIR,
  baseSys: EnrichedSystemIR | null,
  chainHeads: SnapshotStore | null,
): SystemEvolution {
  let store = chainHeads;
  if (!store) {
    const seed: Record<string, SchemaSnapshot> = {};
    if (baseSys) {
      for (const bm of buildMigrations(baseSys, memorySnapshotStore())) seed[bm.module] = bm.next;
    }
    store = memorySnapshotStore(seed);
  }
  // The destructive gate decides what is breaking-for-data: every module it
  // refuses lands in `refusals` and is derived as under `--allow-destructive`,
  // so the caller still sees the steps the change implies.
  const refusals: (MigrationDestructiveError | MigrationShapeChangeError)[] = [];
  const deltas = buildMigrations(curSys, store, {
    ...migrationIntents(loom),
    destructiveRefusals: refusals,
  });
  const destructive = new Map<string, string>();
  for (const r of refusals) {
    const prior = destructive.get(r.module);
    destructive.set(r.module, prior ? `${prior}\n${r.message}` : r.message);
  }
  const wire = baseSys ? diffWireSpec(buildWireSpec(baseSys), buildWireSpec(curSys)) : null;
  return {
    deltas,
    destructive,
    wire,
    breaking: destructive.size > 0 || (wire?.breaking ?? false),
  };
}

const BUCKET_LABEL: Record<WireContractChange["bucket"], string> = {
  aggregates: "aggregate",
  parts: "part",
  valueObjects: "value object",
};

/** `aggregate Order` / `value object Money` — how a wire change names the
 *  shape it touches. */
export function wireChangeEntity(c: WireContractChange): string {
  return `${BUCKET_LABEL[c.bucket]} ${c.entity}`;
}
