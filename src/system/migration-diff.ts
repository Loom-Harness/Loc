import type { EnrichedLoomModel } from "../ir/types/loom-ir.js";
import type { SchemaSnapshot } from "../ir/types/migrations-ir.js";
import { headSnapshots, type MigrationChain } from "./migration-chain.js";
import {
  buildMigrations,
  type MigrationDelta,
  MigrationDestructiveError,
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
  options: { allowDestructive?: boolean; warnings?: MigrationWarning[] } = {},
): MigrationDelta[] {
  return loom.systems.flatMap((sys) =>
    buildMigrations(sys, headSnapshots(chain), {
      ...migrationIntents(loom),
      allowDestructive: options.allowDestructive,
      warnings: options.warnings,
    }),
  );
}

/** One system's evolution from a baseline to the current model. */
export interface SystemEvolution {
  /** Every owning module's delta, in module order — a module with nothing to
   *  migrate carries an empty `steps`. */
  deltas: MigrationDelta[];
  /** Module → the `MigrationDestructiveError` message, for the module whose
   *  delta the destructive gate refused.  Its delta is the one derived with
   *  the gate off, so the caller still shows the steps the change implies. */
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
  const intents = migrationIntents(loom);
  const destructive = new Map<string, string>();
  let deltas: MigrationDelta[];
  try {
    deltas = buildMigrations(curSys, store, intents);
  } catch (err) {
    if (!(err instanceof MigrationDestructiveError)) throw err;
    destructive.set(err.module, err.message);
    deltas = buildMigrations(curSys, store, { ...intents, allowDestructive: true });
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
