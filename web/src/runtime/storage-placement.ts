// Where a desktop Boot puts each storage's PGlite cluster.
//
// Desktop defaults to an OPFS data dir (`opfs-ahp://…`), so rows survive a
// reload.  A fresh OPFS cluster pays PGlite's access-handle-pool creation
// (~3 s, CPU-bound), which a test that never reloads has no use for.  Setting
// `localStorage["loom.storage"] = "memory"` keeps every storage in memory —
// the placement mobile always uses.  The e2e fixture sets it for every spec
// that is not about persistence (`web/e2e/_test.ts`).

export const STORAGE_PLACEMENT_KEY = "loom.storage";

/** Whether this browser profile asked for in-memory storages. */
export function memoryStorageRequested(): boolean {
  try {
    return localStorage.getItem(STORAGE_PLACEMENT_KEY) === "memory";
  } catch {
    return false;
  }
}
