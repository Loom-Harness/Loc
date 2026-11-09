// A freshly initialised PGlite cluster, cached per PGlite version.
//
// PGlite's real start-up on an empty data dir runs initdb (a separate WASM
// module) — 7–8 s in the browser, most of a cold Boot.  The cluster initdb
// produces is the same for every storage at one PGlite version, so the storage
// host dumps it once (`dumpDataDir`) and starts every later fresh storage from
// that dump (`loadDataDir`), which only unpacks it.
//
// Keyed by the PGlite version alone: a version bump misses and re-runs initdb,
// and writing a version's snapshot drops every other version's.  The dump is
// taken before any migration runs, so it holds no user schema — a storage
// started from it is as empty as one initdb made.
//
// Lives in IndexedDB, which the storage host (a worker) can reach.  Every
// failure reads as "no snapshot": the host then runs initdb as before.

export const SNAPSHOT_DB = "loom-pglite-snapshot";
export const SNAPSHOT_STORE = "snapshots";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SNAPSHOT_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(SNAPSHOT_STORE)) req.result.createObjectStore(SNAPSHOT_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("snapshot transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("snapshot transaction aborted"));
  });
}

/** The cached cluster for `version`, or null. */
export async function readSnapshot(version: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(SNAPSHOT_STORE, "readonly");
      const req = tx.objectStore(SNAPSHOT_STORE).get(version);
      await done(tx);
      const value: unknown = req.result;
      return value instanceof Blob && value.size > 0 ? value : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** Store `version`'s cluster and drop every other version's. */
export async function writeSnapshot(version: string, snapshot: Blob): Promise<void> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(SNAPSHOT_STORE, "readwrite");
      const store = tx.objectStore(SNAPSHOT_STORE);
      store.clear();
      store.put(snapshot, version);
      await done(tx);
    } finally {
      db.close();
    }
  } catch {
    // quota / private mode: the next fresh storage runs initdb again
  }
}

/** Drop `version`'s snapshot — one PGlite refused to start from. */
export async function dropSnapshot(version: string): Promise<void> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(SNAPSHOT_STORE, "readwrite");
      tx.objectStore(SNAPSHOT_STORE).delete(version);
      await done(tx);
    } finally {
      db.close();
    }
  } catch {
    // nothing to drop
  }
}

/** Whether an `opfs-ahp://<dir>` data dir already holds a cluster.  PGlite's
 *  OPFS filesystem keeps its file table in `<dir>/state.txt`; a dir without
 *  one (or no dir at all) has never been initialised, and only such a dir may
 *  be started from a snapshot — PGlite refuses `loadDataDir` over an existing
 *  cluster.  When OPFS cannot be read the answer is "exists", which keeps the
 *  boot on PGlite's own path. */
export async function opfsClusterExists(dataDir: string): Promise<boolean> {
  const dir = dataDir.replace(/^opfs-ahp:\/\//, "");
  try {
    let handle = await navigator.storage.getDirectory();
    for (const part of dir.split("/").filter(Boolean)) {
      handle = await handle.getDirectoryHandle(part);
    }
    const state = await (await handle.getFileHandle("state.txt")).getFile();
    return state.size > 0;
  } catch (err) {
    return !(err instanceof DOMException && err.name === "NotFoundError");
  }
}
