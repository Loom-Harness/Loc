// Install orchestrator (Phase B3).
//
// rootDeps → plan → fetch+extract every package into a flat
// node_modules under `nmRoot`, via a caller-supplied byte sink (the
// playground VFS in the engine; an in-memory Map in the spike).
//
// The optional cache lets a name@version that was extracted once be
// replayed without re-fetching — the hook the IDB/snapshot warm-boot
// (B3c / P4) plugs into.  Tarball fetches run with bounded
// concurrency so a big stack doesn't open 100+ sockets at once.

import { fetchTarball } from "./registry.js";
import { planInstall, type PlannedPackage } from "./resolve-tree.js";
import { gunzip, untar, type TarEntry } from "./targz.js";

export interface InstallCache {
  get(key: string): TarEntry[] | undefined;
  set(key: string, entries: TarEntry[]): void;
}

export interface InstallResult {
  /** name → resolved version actually written. */
  versions: Map<string, string>;
  fileCount: number;
  /** Where the time went, summed across the concurrent workers (so
   *  fetch/extract can exceed wall clock). */
  timings: { planMs: number; fetchMs: number; extractMs: number; writeMs: number; cacheHits: number };
}

async function extract(
  pkg: PlannedPackage,
  mirror?: Map<string, string>,
  timings?: InstallResult["timings"],
): Promise<TarEntry[]> {
  const key = `${pkg.name}@${pkg.version}`;
  // Prefer the local mirror (same-origin asset) over the registry —
  // this is what makes a cold install fast and keeps the e2e from
  // saturating the network with concurrent registry fetches (C1).
  const url = mirror?.get(key) ?? pkg.meta.dist.tarball;
  const t0 = performance.now();
  const tgz = await fetchTarball(url);
  const t1 = performance.now();
  const entries = untar(await gunzip(tgz));
  if (timings) {
    timings.fetchMs += t1 - t0;
    timings.extractMs += performance.now() - t1;
  }
  return entries;
}

export async function install(
  rootDeps: Record<string, string>,
  write: (path: string, data: Uint8Array) => void,
  opts: {
    nmRoot?: string;
    cache?: InstallCache;
    concurrency?: number;
    /** name@version → local tarball URL.  Overrides the registry
     *  tarball when present (C1 local mirror). */
    mirror?: Map<string, string>;
  } = {},
): Promise<InstallResult> {
  const nmRoot = opts.nmRoot ?? "/node_modules";
  const concurrency = opts.concurrency ?? 8;
  const timings = { planMs: 0, fetchMs: 0, extractMs: 0, writeMs: 0, cacheHits: 0 };
  const tPlan = performance.now();
  const plan = [...(await planInstall(rootDeps)).values()];
  timings.planMs = performance.now() - tPlan;
  const versions = new Map<string, string>();
  let fileCount = 0;

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < plan.length) {
      const pkg = plan[cursor++];
      const key = `${pkg.name}@${pkg.version}`;
      let entries = opts.cache?.get(key);
      if (!entries) {
        entries = await extract(pkg, opts.mirror, timings);
        opts.cache?.set(key, entries);
      } else timings.cacheHits++;
      const tw = performance.now();
      for (const e of entries) {
        write(`${nmRoot}/${pkg.name}/${e.name}`, e.data);
        fileCount++;
      }
      timings.writeMs += performance.now() - tw;
      versions.set(pkg.name, pkg.version);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, plan.length) }, worker),
  );
  return { versions, fileCount, timings };
}
