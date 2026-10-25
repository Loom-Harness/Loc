import * as fs from "node:fs";
import * as path from "node:path";

import {
  type ChainEntry,
  EMPTY_CHAIN,
  entryFileName,
  MIGRATIONS_DIR,
  type MigrationChain,
  parseChain,
  serializeEntry,
} from "../system/migration-chain.js";

// ---------------------------------------------------------------------------
// The filesystem side of the migration chain: `<source-dir>/migrations/`.
// `src/system/migration-chain.ts` owns the format and every rule; this file
// only moves its files on and off disk.
// ---------------------------------------------------------------------------

/** `migrations/` beside the entry `.ddd`. */
function migrationsDir(sourceFile: string): string {
  return path.join(path.dirname(path.resolve(sourceFile)), MIGRATIONS_DIR);
}

/** The committed chain for `sourceFile`, or `undefined` when the source has
 *  no `migrations/` directory (nothing recorded yet).  Throws
 *  `MigrationChainError` when the directory cannot be read as one chain. */
export function readMigrationChain(sourceFile: string): MigrationChain | undefined {
  const dir = migrationsDir(sourceFile);
  if (!fs.existsSync(dir)) return undefined;
  return readChainDir(dir);
}

/** Like {@link readMigrationChain}, but a missing directory is an empty chain
 *  — what `migrate add` appends to. */
export function readMigrationChainOrEmpty(sourceFile: string): MigrationChain {
  return readMigrationChain(sourceFile) ?? EMPTY_CHAIN;
}

function readChainDir(dir: string): MigrationChain {
  return parseChain(readDirFiles(dir));
}

/** The `.json` files of `sourceFile`'s `migrations/`, as `parseChain` /
 *  `parseForkedChain` take them; `undefined` when the directory is absent. */
export function readChainFiles(
  sourceFile: string,
): { name: string; content: string }[] | undefined {
  const dir = migrationsDir(sourceFile);
  return fs.existsSync(dir) ? readDirFiles(dir) : undefined;
}

function readDirFiles(dir: string): { name: string; content: string }[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, content: fs.readFileSync(path.join(dir, name), "utf8") }));
}

/** Delete `entries`' files from `sourceFile`'s `migrations/`.  Returns the
 *  deleted paths. */
export function deleteChainEntries(sourceFile: string, entries: readonly ChainEntry[]): string[] {
  const dir = migrationsDir(sourceFile);
  return entries.map((e) => {
    const file = path.join(dir, entryFileName(e));
    fs.rmSync(file);
    return file;
  });
}

/** Write `entries` into `sourceFile`'s `migrations/`, creating it.  Returns
 *  the written paths. */
export function writeChainEntries(sourceFile: string, entries: readonly ChainEntry[]): string[] {
  const dir = migrationsDir(sourceFile);
  fs.mkdirSync(dir, { recursive: true });
  return entries.map((e) => {
    const file = path.join(dir, entryFileName(e));
    fs.writeFileSync(file, serializeEntry(e));
    return file;
  });
}

/** The current UTC instant as `YYYYMMDDHHMMSS` — the clock `migrate add`
 *  numbers a generation from. */
export function utcVersionNow(date: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    p(date.getUTCFullYear(), 4) +
    p(date.getUTCMonth() + 1) +
    p(date.getUTCDate()) +
    p(date.getUTCHours()) +
    p(date.getUTCMinutes()) +
    p(date.getUTCSeconds())
  );
}
