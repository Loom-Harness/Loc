// ---------------------------------------------------------------------------
// OPFS data-island garbage collection.
//
// Each workspace entry boots its PGlite into its own OPFS island
// (`opfs-ahp://loom-<hash of workspace id + entry path>`, see App.runBootStep)
// so switching workspaces never clobbers another's data.  Nothing else removes
// them, so islands accumulate — one per workspace a user boots.  Beyond wasted
// space, unbounded OPFS growth pushes the origin
// toward the browser's storage quota, and quota pressure is exactly what makes
// mobile browsers evict storage and reload tabs — the "refreshed during work"
// event we're hardening against.
//
// This keeps a small most-recently-used set and drops the rest on each boot.
// The active island is always in the keep set (we just recorded it), so we
// never try to remove a DB with open access handles.  Best-effort throughout:
// OPFS access can be unavailable (private mode) or an individual remove can
// fail (locked) — neither is fatal.
// ---------------------------------------------------------------------------

const LRU_KEY = "loom.opfs.lru";
/** How many islands to retain (the current workspace + recent ones, so
 *  switching back to a recent workspace still finds its data). */
const KEEP = 4;
/** Cap on the persisted LRU list so it can't grow without bound itself. */
const LRU_MAX = 30;
const PREFIX = "loom-";
/** The resource fakes' islands (`runtime/infra/persist.ts` `RESOURCE_DIR_PREFIX`). */
const RESOURCE_PREFIX = "loomres-";

function readLru(): string[] {
  try {
    const raw = localStorage.getItem(LRU_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as string[]).filter((h) => typeof h === "string") : [];
  } catch {
    return [];
  }
}

function writeLru(list: string[]): void {
  try {
    localStorage.setItem(LRU_KEY, JSON.stringify(list.slice(-LRU_MAX)));
  } catch {
    // storage disabled — GC still runs against the in-memory keep set.
  }
}

/** Record `hash` as most-recently-used and return the ordered LRU list. */
function recordHash(hash: string): string[] {
  const list = readLru().filter((h) => h !== hash);
  list.push(hash);
  const capped = list.slice(-LRU_MAX);
  writeLru(capped);
  return capped;
}

/** Minimal OPFS shape — lib.dom's FileSystemDirectoryHandle typings for
 *  `entries()` / `removeEntry(recursive)` are uneven across TS versions, so we
 *  pin just what we use. */
interface OpfsHandle {
  kind: "file" | "directory";
}
interface OpfsDir extends OpfsHandle {
  entries(): AsyncIterableIterator<[string, OpfsHandle]>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

async function getOpfsRoot(): Promise<OpfsDir | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
      return null;
    }
    return (await navigator.storage.getDirectory()) as unknown as OpfsDir;
  } catch {
    return null;
  }
}

/** Remove every `loom-*` OPFS directory whose hash isn't in `keepHashes`.
 *  Returns the number of islands removed. */
async function gcIslands(keepHashes: Iterable<string>): Promise<number> {
  const root = await getOpfsRoot();
  if (!root) return 0;
  const keep = new Set<string>();
  for (const h of keepHashes) {
    keep.add(`${PREFIX}${h}`);
    keep.add(`${RESOURCE_PREFIX}${h}`);
  }

  const stale: string[] = [];
  try {
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === "directory" && (name.startsWith(PREFIX) || name.startsWith(RESOURCE_PREFIX)) && !keep.has(name)) {
        stale.push(name);
      }
    }
  } catch {
    // entries() iteration unsupported / failed — nothing safe to remove.
    return 0;
  }

  let removed = 0;
  for (const name of stale) {
    try {
      await root.removeEntry(name, { recursive: true });
      removed++;
    } catch {
      // In use / locked / racing another tab — skip it; next boot retries.
    }
  }
  return removed;
}

/** GC on STARTUP, independent of whether any boot succeeds.
 *
 *  `recordAndGcOpfs` runs only after a successful persistent boot, so a user
 *  whose boot keeps failing never sheds a single island — storage climbs
 *  monotonically across attempts (observed in the wild: 80 → 313 → 400 MB in
 *  one session), which feeds the very quota pressure this module's header
 *  describes, which makes the next attempt likelier to be killed.  A failing
 *  boot could not previously break that loop.  This can.
 *
 *  Deliberately does NOT record a hash: it reuses whatever the LRU already
 *  holds, so it can't evict the island the next boot is about to open.  And it
 *  no-ops on an empty LRU — an empty list is "we don't know", not "keep
 *  nothing", and treating it as the latter would delete a user's persisted
 *  data (e.g. after localStorage alone is cleared). */
export async function gcOpfsAtStartup(): Promise<void> {
  try {
    const lru = readLru();
    if (lru.length === 0) return;
    await gcIslands(lru.slice(-KEEP));
  } catch {
    // best-effort housekeeping — never let it affect startup
  }
}

/** Record the just-booted source hash and GC every island outside the
 *  most-recent `KEEP`.  Fire-and-forget from the boot path; never throws. */
export async function recordAndGcOpfs(hash: string): Promise<void> {
  try {
    const lru = recordHash(hash);
    const keep = lru.slice(-KEEP); // includes `hash` (just pushed)
    await gcIslands(keep);
  } catch {
    // best-effort housekeeping — never let it affect a successful boot
  }
}
