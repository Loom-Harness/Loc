import type { MigrationStep, MigrationsIR, SchemaSnapshot } from "../ir/types/migrations-ir.js";
import { snake, upperFirst } from "../util/naming.js";
import type { MigrationDelta } from "./migrations-builder.js";
import { canonicalSnapshot, memorySnapshotStore, type SnapshotStore } from "./snapshot.js";

// ---------------------------------------------------------------------------
// The migration chain — the committed record of every schema generation
// (D-MIGRATE-WORKFLOW).
//
// It lives beside the `.ddd` source in `migrations/`, one JSON file per
// (generation, module): the backend-neutral steps plus the module's schema
// AFTER them.  `ddd migrate add` appends to it; `ddd generate system` only
// reads it, rendering every backend's migration files from the whole chain,
// so the output tree carries no state of its own and can be thrown away.
//
// The chain is ONE linear list across all modules.  Every entry names the
// entry before it; two entries naming the same parent are two heads — what two
// branches that each recorded a migration look like after a merge — and the
// chain refuses to be read until one is re-recorded on top of the other.
//
// This module is pure (no `fs`): the CLI reads and writes the directory, the
// playground keeps the same files in its VFS.
// ---------------------------------------------------------------------------

/** Directory, beside the entry `.ddd`, that holds the chain. */
export const MIGRATIONS_DIR = "migrations";

/** Version every generation is numbered from when no chain exists yet — the
 *  number an unrecorded model's initial migrations carry. */
export const BASE_VERSION = "20260101000000";

/** Version numbers reserved after a module's INITIAL generation.  One initial
 *  can expand into many files on one backend — the Elixir emitter writes one
 *  migration per table at `version + i`, `version + N*10 + i`,
 *  `version + N*100 + i` — so the next generation is numbered above that
 *  span, never at `version + 1`, which would alias the second table.  1e6 is
 *  one day in the `YYYYMMDDHHMMSS` shape, so a reserved version still reads
 *  as a timestamp. */
export const INITIAL_RESERVATION = 1_000_000n;

const CHAIN_FORMAT = 1;

/** One recorded generation of one module. */
export interface ChainEntry {
  format: typeof CHAIN_FORMAT;
  /** Decimal integer; strictly greater than the parent's. */
  version: string;
  /** Id ({@link entryId}) of the entry recorded immediately before this one
   *  (any module); `null` for the first entry of the chain.  An id, not a
   *  version: two branches recording on top of the same head can draw the
   *  same version, and the link still has to say which entry it follows. */
  parent: string | null;
  module: string;
  /** PascalCase migration name — `Initial` for the module's first entry. */
  name: string;
  storageName: string;
  /** Present when `migrate add --allow-destructive` let a destructive step
   *  into this generation. */
  allowDestructive?: true;
  steps: MigrationStep[];
  /** The module's schema after this generation. */
  schema: SchemaSnapshot;
}

/** The chain in order, root first. */
export interface MigrationChain {
  entries: readonly ChainEntry[];
}

export const EMPTY_CHAIN: MigrationChain = { entries: [] };

/** Raised when the `migrations/` directory cannot be read as one chain. */
export class MigrationChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationChainError";
  }
}

/** Raised by `generate system` when the model has changed since the chain's
 *  head and the change has not been recorded. */
export class MigrationDriftError extends Error {
  constructor(readonly modules: readonly string[]) {
    super(
      `the model has schema changes not recorded in ${MIGRATIONS_DIR}/ (module${modules.length > 1 ? "s" : ""} ${modules.join(", ")}). ` +
        "Record them with `ddd migrate add <name> <file.ddd>`, then generate again.",
    );
    this.name = "MigrationDriftError";
  }
}

/** An entry's identity: `<version>_<module>_<name>`, its file name without
 *  `.json`. */
export function entryId(e: Pick<ChainEntry, "version" | "module" | "name">): string {
  return `${e.version}_${snake(e.module)}_${snake(e.name)}`;
}

/** File name of an entry inside `migrations/`. */
export function entryFileName(e: Pick<ChainEntry, "version" | "module" | "name">): string {
  return `${entryId(e)}.json`;
}

export function serializeEntry(e: ChainEntry): string {
  const payload: ChainEntry = {
    format: e.format,
    version: e.version,
    parent: e.parent,
    module: e.module,
    name: e.name,
    storageName: e.storageName,
    ...(e.allowDestructive ? { allowDestructive: true as const } : {}),
    steps: e.steps,
    schema: canonicalSnapshot(e.schema),
  };
  return JSON.stringify(payload, null, 2) + "\n";
}

/** Parse and validate the files of a `migrations/` directory.  `files` are
 *  (file name, content) pairs; files that are not `.json` are ignored. */
export function parseChain(
  files: ReadonlyArray<{ name: string; content: string }>,
): MigrationChain {
  return { entries: orderChain(readEntries(files)) };
}

/** A chain whose list splits in two after `base`: what a merge of two
 *  branches that each recorded migrations leaves in `migrations/`.  Each tail
 *  is in chain order; `tails[1]` is the one whose first entry was recorded
 *  later (the higher version). */
export interface ForkedChain {
  base: ChainEntry[];
  tails: [ChainEntry[], ChainEntry[]];
}

/** Read `migrations/` as a fork: the files split into one shared list and two
 *  tails after it.  `null` when they form one list (no fork).  Throws
 *  `MigrationChainError` on anything else — a broken file, a missing parent,
 *  or more than one fork. */
export function parseForkedChain(
  files: ReadonlyArray<{ name: string; content: string }>,
): ForkedChain | null {
  const entries = readEntries(files);
  const children = linkEntries(entries);
  const forks = [...children].filter(([, kids]) => kids.length > 1);
  if (forks.length === 0) return null;
  const [forkParent, kids] = forks[0]!;
  if (forks.length > 1 || kids.length > 2) {
    throw new MigrationChainError(
      `the chain in ${MIGRATIONS_DIR}/ splits more than two ways; resolve it by hand, keeping one list.`,
    );
  }
  const walk = (from: ChainEntry | undefined): ChainEntry[] => {
    const out: ChainEntry[] = [];
    for (let e = from; e; e = children.get(entryId(e))?.[0]) out.push(e);
    return out;
  };
  const base: ChainEntry[] = [];
  for (let e = children.get(null)?.[0]; e; e = children.get(entryId(e))?.[0]) {
    base.push(e);
    if (entryId(e) === forkParent) break;
  }
  const [a, b] = [...kids].sort((x, y) =>
    x.version !== y.version
      ? BigInt(x.version) < BigInt(y.version)
        ? -1
        : 1
      : entryId(x) < entryId(y)
        ? -1
        : 1,
  );
  const tails: [ChainEntry[], ChainEntry[]] = [walk(a), walk(b)];
  if (base.length + tails[0].length + tails[1].length !== entries.length) {
    throw new MigrationChainError(`the chain in ${MIGRATIONS_DIR}/ does not form one list.`);
  }
  return { base, tails };
}

function readEntries(files: ReadonlyArray<{ name: string; content: string }>): ChainEntry[] {
  const entries: ChainEntry[] = [];
  for (const f of files) {
    if (!f.name.endsWith(".json")) continue;
    let e: ChainEntry;
    try {
      e = JSON.parse(f.content) as ChainEntry;
    } catch (err) {
      throw new MigrationChainError(
        `${MIGRATIONS_DIR}/${f.name} is not valid JSON (${err instanceof Error ? err.message : String(err)}) — an unresolved merge conflict, or a truncated write.`,
      );
    }
    if (e?.format !== CHAIN_FORMAT || typeof e.version !== "string" || !/^\d+$/.test(e.version)) {
      throw new MigrationChainError(`${MIGRATIONS_DIR}/${f.name} is not a Loom migration entry.`);
    }
    if (entryFileName(e) !== f.name) {
      throw new MigrationChainError(
        `${MIGRATIONS_DIR}/${f.name} records version ${e.version} of ${e.module}; its file name must be ${entryFileName(e)}.`,
      );
    }
    entries.push(e);
  }
  return entries;
}

/** Check every entry's parent link and numbering; return each entry id's
 *  children (`null` keys the root). */
function linkEntries(entries: readonly ChainEntry[]): Map<string | null, ChainEntry[]> {
  const byId = new Map<string, ChainEntry>();
  for (const e of entries) byId.set(entryId(e), e);
  const children = new Map<string | null, ChainEntry[]>();
  for (const e of entries) {
    const parent = e.parent === null ? null : byId.get(e.parent);
    if (parent === undefined) {
      throw new MigrationChainError(
        `${entryFileName(e)} follows ${e.parent}, which is not in ${MIGRATIONS_DIR}/.`,
      );
    }
    if (parent !== null && BigInt(parent.version) >= BigInt(e.version)) {
      throw new MigrationChainError(
        `${entryFileName(e)} is numbered ${e.version}, not above ${entryFileName(parent)}.`,
      );
    }
    (children.get(e.parent) ?? children.set(e.parent, []).get(e.parent)!).push(e);
  }
  return children;
}

function orderChain(entries: ChainEntry[]): ChainEntry[] {
  if (entries.length === 0) return [];
  const children = linkEntries(entries);
  for (const [parent, kids] of children) {
    if (kids.length > 1) {
      throw new MigrationChainError(
        `the chain has two heads: ${kids.map(entryFileName).join(" and ")} both follow ${parent === null ? "the start of the chain" : `${parent}.json`}. ` +
          "Two branches each recorded a migration; run `ddd migrate rebase <file.ddd>` to record the later one again on top of the other.",
      );
    }
  }
  const ordered: ChainEntry[] = [];
  let next = children.get(null)?.[0];
  while (next) {
    ordered.push(next);
    next = children.get(entryId(next))?.[0];
  }
  // Every parent resolves and no entry has two children, so a shortfall here
  // can only be a cycle the version ordering already rules out.
  if (ordered.length !== entries.length) {
    throw new MigrationChainError(`the chain in ${MIGRATIONS_DIR}/ does not form one list.`);
  }
  // One list, so every entry is above the one before it and no two can share
  // a version — which the files in one backend migration directory rely on.
  const names = new Set<string>();
  for (const e of ordered) {
    const key = `${e.module}\u0000${e.name}`;
    if (names.has(key)) {
      throw new MigrationChainError(`module ${e.module} has two migrations named ${e.name}.`);
    }
    names.add(key);
  }
  return ordered;
}

/** The kebab-case `migrate add` name a recorded PascalCase name came from. */
export function kebabName(pascal: string): string {
  return snake(pascal).replaceAll("_", "-");
}

/** Each module's schema at the chain's head — the baseline the next
 *  generation is diffed against. */
export function headSnapshots(chain: MigrationChain): SnapshotStore {
  const head: Record<string, SchemaSnapshot> = {};
  for (const e of chain.entries) head[e.module] = e.schema;
  return memorySnapshotStore(head);
}

/** The chain as the backends consume it: one `MigrationsIR` per entry, in
 *  chain order, each carrying the module's schema before and after it. */
export function chainMigrations(chain: MigrationChain): MigrationsIR[] {
  const before = new Map<string, SchemaSnapshot>();
  return chain.entries.map((e) => {
    const baseline = before.get(e.module) ?? null;
    before.set(e.module, e.schema);
    return {
      module: e.module,
      storageName: e.storageName,
      baseline,
      next: e.schema,
      steps: e.steps,
      version: e.version,
      name: e.name,
    };
  });
}

/** A kebab-case `migrate add` name: lower-case words joined by `-`. */
function isMigrationName(name: string): boolean {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name);
}

/** Number this run's non-empty deltas as the next entries of `chain`.
 *  `now` is the caller's clock as `YYYYMMDDHHMMSS`; a number at or below the
 *  head's is moved above it, so the chain stays strictly increasing whatever
 *  the clock says.  A module's first entry is named `Initial`, every other
 *  one `name` in PascalCase. */
export function recordGeneration(
  chain: MigrationChain,
  deltas: readonly MigrationDelta[],
  opts: { name: string; now: string; allowDestructive?: boolean },
): ChainEntry[] {
  if (!isMigrationName(opts.name)) {
    throw new MigrationChainError(
      `migration name "${opts.name}" must be kebab-case — lower-case words joined by "-", e.g. rename-order-qty.`,
    );
  }
  const taken = new Set(chain.entries.map((e) => `${e.module}\u0000${e.name}`));
  const recorded: ChainEntry[] = [];
  let prev = chain.entries.at(-1) ?? null;
  let prevInitial = prev !== null && isInitialEntry(chain.entries, prev);
  for (const d of deltas) {
    if (d.steps.length === 0) continue;
    const name = d.baseline === null ? "Initial" : pascalName(opts.name);
    if (taken.has(`${d.module}\u0000${name}`)) {
      throw new MigrationChainError(
        `module ${d.module} already has a migration named ${name}; choose another name.`,
      );
    }
    const version = nextVersion(prev?.version ?? null, prevInitial, opts.now);
    const entry: ChainEntry = {
      format: CHAIN_FORMAT,
      version,
      parent: prev ? entryId(prev) : null,
      module: d.module,
      name,
      storageName: d.storageName,
      ...(opts.allowDestructive ? { allowDestructive: true as const } : {}),
      steps: d.steps,
      schema: d.next,
    };
    recorded.push(entry);
    prev = entry;
    prevInitial = d.baseline === null;
  }
  return recorded;
}

/** The migrations of a model that has no chain yet: every module's initial
 *  generation, numbered from {@link BASE_VERSION} the way a first
 *  `migrate add` at that instant would number them. */
export function unrecordedMigrations(deltas: readonly MigrationDelta[]): MigrationsIR[] {
  return chainMigrations({
    entries: recordGeneration(EMPTY_CHAIN, deltas, { name: "initial", now: BASE_VERSION }),
  });
}

function isInitialEntry(entries: readonly ChainEntry[], e: ChainEntry): boolean {
  return entries.find((x) => x.module === e.module) === e;
}

function nextVersion(prev: string | null, prevInitial: boolean, now: string): string {
  const floor = prev === null ? 0n : BigInt(prev) + (prevInitial ? INITIAL_RESERVATION : 1n);
  const clock = BigInt(now);
  return String(clock > floor ? clock : floor);
}

function pascalName(kebab: string): string {
  return kebab.split("-").map(upperFirst).join("");
}
