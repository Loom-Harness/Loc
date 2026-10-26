// ---------------------------------------------------------------------------
// The playground's `migrations/` directory — the committed migration chain,
// held in the VFS in the same format the CLI keeps on disk (one JSON file per
// recorded generation, beside the entry `.ddd`).  `src/system/
// migration-chain.ts` owns the format and every rule; this file only finds
// the files.
// ---------------------------------------------------------------------------

import { MIGRATIONS_DIR } from "../../../src/system/migration-chain.js";

/** Read access the chain needs — `MemoryVfs` provides it. */
interface ReadableVfs {
  list(prefix: string): ReadonlyArray<string>;
  read(path: string): string | undefined;
}

/** `migrations/` beside `entryPath` — `/workspace/migrations` for
 *  `/workspace/main.ddd`. */
export function chainDir(entryPath: string): string {
  const slash = entryPath.lastIndexOf("/");
  return `${slash <= 0 ? "" : entryPath.slice(0, slash)}/${MIGRATIONS_DIR}`;
}

/** True when `path` is one chain file of `dir` — a `.json` directly inside it
 *  (the CLI reads no subdirectory either). */
export function isChainFile(dir: string, path: string): boolean {
  if (!path.startsWith(`${dir}/`) || !path.endsWith(".json")) return false;
  return !path.slice(dir.length + 1).includes("/");
}

/** The chain files beside `entryPath`, as `parseChain` takes them, sorted by
 *  name; `undefined` when there are none — no chain recorded yet, so every
 *  module gets its initial migration derived from the model. */
export function readChainFiles(
  vfs: ReadableVfs,
  entryPath: string,
): { name: string; content: string }[] | undefined {
  const dir = chainDir(entryPath);
  const files: { name: string; content: string }[] = [];
  for (const path of vfs.list(dir)) {
    if (!isChainFile(dir, path)) continue;
    const content = vfs.read(path);
    if (content !== undefined) files.push({ name: path.slice(dir.length + 1), content });
  }
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return files.length > 0 ? files : undefined;
}
