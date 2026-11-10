// Dependency-tree planner (Phase B3).
//
// Pragmatic, flat install: BFS from the generated package.json's
// `dependencies`, pick the highest version satisfying each range,
// dedupe by name (flat — highest wins).  Sufficient for the curated
// stacks Loom emits (hono / drizzle / zod / pglite / react /
// mantine), which don't have conflicting nested trees.
//
// Deliberately out of scope for B3 (documented, revisited in B4 if a
// real dep needs it): nested version conflicts, peerDependencies
// auto-install (curated stacks carry their peers as top-level deps;
// drizzle's 28 peers are optional DB drivers we don't use).

import { fetchPackument, type Packument, type VersionMeta } from "./registry.js";
import { cmp, maxSatisfying, parse } from "./semver.js";

export interface PlannedPackage {
  name: string;
  version: string;
  meta: VersionMeta;
}

/** Packuments fetched by this realm, by name.  A packument is the registry's
 *  answer for one package at one moment, so an entry is reused only within
 *  `PACKUMENT_TTL_MS` — long enough for the hono + react installs of one
 *  Boot (and a re-Boot) to share, short enough that a long-lived worker
 *  still sees a newly published version. */
const PACKUMENT_TTL_MS = 5 * 60_000;
const packumentMemo = new Map<string, { at: number; p: Promise<Packument> }>();

function packumentFor(name: string): Promise<Packument> {
  const hit = packumentMemo.get(name);
  if (hit && Date.now() - hit.at < PACKUMENT_TTL_MS) return hit.p;
  const p = fetchPackument(name);
  packumentMemo.set(name, { at: Date.now(), p });
  // A failed fetch must not poison later installs.
  p.catch(() => {
    if (packumentMemo.get(name)?.p === p) packumentMemo.delete(name);
  });
  return p;
}

export async function planInstall(
  rootDeps: Record<string, string>,
): Promise<Map<string, PlannedPackage>> {
  const chosen = new Map<string, PlannedPackage>();
  const queue: Array<[string, string]> = Object.entries(rootDeps);
  // Start every packument fetch the moment its name is queued; the loop
  // below still decides versions one requirement at a time, in queue order,
  // so the resolution is exactly the serial one — only the registry round
  // trips overlap.
  for (const [name] of queue) void packumentFor(name).catch(() => {});

  while (queue.length) {
    const [name, range] = queue.shift()!;
    const pack = await packumentFor(name);
    const version = maxSatisfying(Object.keys(pack.versions), range);
    if (!version) {
      throw new Error(
        `[npm-in-browser] no version of "${name}" satisfies "${range}"`,
      );
    }
    const prev = chosen.get(name);
    if (prev) {
      // Flat dedupe, highest-wins: skip (keep prev, don't re-descend)
      // unless this requirement resolves to a strictly newer version.
      const a = parse(prev.version);
      const b = parse(version);
      if (!b || (a && cmp(b, a) <= 0)) continue;
    }
    const meta = pack.versions[version];
    chosen.set(name, { name, version, meta });
    for (const [dn, dr] of Object.entries(meta.dependencies ?? {})) {
      queue.push([dn, dr]);
      void packumentFor(dn).catch(() => {});
    }
  }
  return chosen;
}
