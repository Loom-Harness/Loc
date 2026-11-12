// Where a worker's npm install reads tarballs from: the IndexedDB install
// cache and the deployed local tarball mirror.  Shared by every worker that
// installs (the project bundler and the test-suite builder), so a dependency
// set one of them installed replays from the cache in the other.

import { IdbInstallCache } from "./install-cache-idb.js";

// IDB-backed install cache, worker-scoped (IndexedDB is available in
// DedicatedWorkerGlobalScope).  Opened once; memory-only no-op when IDB is
// unavailable.  This is why a dep set installs once and replays across
// prepares/reloads.
let cachePromise: Promise<IdbInstallCache> | null = null;
export function getInstallCache(): Promise<IdbInstallCache> {
  if (!cachePromise) {
    cachePromise = (async () => {
      const c = new IdbInstallCache();
      await c.open();
      return c;
    })();
  }
  return cachePromise;
}

// Local tarball mirror: name@version → same-origin asset URL, loaded once
// from the manifest the build step ships under <deployBase>/npm-mirror/.
// Missing/404 (dev, or no mirror built) → empty map → install falls back to
// the registry.  `deployBase` is the absolute deploy base (origin + base
// path, trailing slash) the main thread resolves from its document url — a
// relative fetch in a worker would resolve against the worker's own url.
let mirrorPromise: Promise<Map<string, string>> | null = null;
export function getNpmMirror(deployBase: string): Promise<Map<string, string>> {
  if (!mirrorPromise) {
    mirrorPromise = (async () => {
      const map = new Map<string, string>();
      try {
        const base = deployBase + "npm-mirror/";
        const res = await fetch(base + "manifest.json");
        if (res.ok) {
          const manifest = (await res.json()) as Record<string, string>;
          for (const [k, file] of Object.entries(manifest)) {
            map.set(k, base + file);
          }
        }
      } catch {
        /* no mirror → registry fallback */
      }
      return map;
    })();
  }
  return mirrorPromise;
}
