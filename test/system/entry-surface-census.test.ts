// Entry-surface census: every route a backend's generated tree mounts is an
// entry `entrySurface` lists, and every HTTP entry it lists is mounted.
//
// `entrySurface(deployable)` (`src/ir/plan/entry-surface.ts`) is the one list
// of the ways work enters generated code.  The promise probes range over it,
// so an entry missing from it is an entry no probe ever calls: a route a
// backend mounts that the plan does not name is exactly how a cross-tenant
// read reached `main` with every gate green.  This census reads what each
// backend ACTUALLY emits — its route declarations, parsed per framework by
// `test/_helpers/mounted-entries.ts` — across the whole corpus (each corpus
// template on all five backends, every other tracked `.ddd` as written), and
// compares it with the plan, both ways:
//
//   unlisted  a mounted route the plan does not list.  Never waived: list it
//             in the plan (with its kind in `ENTRY_KINDS`), or stop mounting it.
//   unmounted a planned HTTP entry this backend does not mount.  A backend
//             that disagrees with the plan is a defect the plan surfaces; it
//             is waived only in `UNMOUNTED` with the issue that tracks it, and
//             a waiver that no longer matches anything fails the census.
//
// A framework page that documents the api and reads no data (Swagger UI,
// ReDoc) is not an entry; the readers report it apart and the census only
// checks it is one of `DOC_PAGES`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTRY_KINDS,
  type EntryKind,
  entrySurface,
  httpEntries,
} from "../../src/ir/plan/entry-surface.js";
import type { EnrichedLoomModel } from "../../src/ir/types/loom-ir.js";
import { routeSlot } from "../../src/ir/util/api-surface.js";
import { serviceSlug } from "../../src/util/service-slug.js";
import { expectReach } from "../_helpers/census-reach.js";
import { dddSourceOf, REPO_ROOT, trackedDddFiles } from "../_helpers/ddd-corpus.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel } from "../_helpers/ir.js";
import {
  deployableFiles,
  type MountedBackend,
  mountedRoutes,
} from "../_helpers/mounted-entries.js";

const BACKENDS: readonly MountedBackend[] = ["node", "dotnet", "java", "python", "elixir"];
const isBackend = (p: string): p is MountedBackend => (BACKENDS as readonly string[]).includes(p);

/** Framework documentation pages, per backend (they render the OpenAPI
 *  document and read nothing else). */
const DOC_PAGES: Record<MountedBackend, readonly string[]> = {
  node: [],
  dotnet: ["swagger-ui"],
  java: ["swagger-ui"],
  python: ["docs", "redoc"],
  elixir: [],
};

/** A planned HTTP entry a backend does not mount, with the issue that tracks
 *  the disagreement.  Keyed `<backend> <entry kind>`; `fixtures` narrows it
 *  when the gap is shape-specific. */
interface UnmountedWaiver {
  readonly issue: string;
  readonly why: string;
}
const UNMOUNTED: Readonly<Record<string, UnmountedWaiver>> = {};

/** Narrows the sweep while iterating locally (a regex over the `.ddd` path);
 *  unset in CI. */
const ONLY = process.env.ENTRY_SURFACE_CENSUS_ONLY;

interface Cell {
  readonly ddd: string;
  readonly source: string;
}

function cells(): Cell[] {
  const out: Cell[] = [];
  for (const ddd of trackedDddFiles()) {
    if (ONLY && !new RegExp(ONLY).test(ddd)) continue;
    if (ddd.startsWith("test/fixtures/corpus/")) {
      const template = readFileSync(resolve(REPO_ROOT, ddd), "utf8");
      for (const b of BACKENDS) {
        out.push({ ddd: `${ddd} [${b}]`, source: template.replaceAll("__PLATFORM__", b) });
      }
    } else {
      out.push({ ddd, source: dddSourceOf(ddd) });
    }
  }
  return out;
}

interface Finding {
  readonly where: string;
  readonly backend: MountedBackend;
  readonly slot: string;
  readonly kind?: EntryKind;
  readonly file?: string;
}

interface Sweep {
  readonly unlisted: Finding[];
  readonly unmounted: Finding[];
  readonly badDocPages: string[];
  readonly deployables: number;
  readonly kindsSeen: Map<MountedBackend, Set<EntryKind>>;
  readonly waiverHits: Set<string>;
}

let SWEEP: Promise<Sweep> | undefined;

function sweep(): Promise<Sweep> {
  SWEEP ??= (async () => {
    const unlisted: Finding[] = [];
    const unmounted: Finding[] = [];
    const badDocPages: string[] = [];
    const kindsSeen = new Map<MountedBackend, Set<EntryKind>>();
    const waiverHits = new Set<string>();
    let deployables = 0;
    for (const cell of cells()) {
      let files: Map<string, string>;
      let loom: EnrichedLoomModel;
      try {
        files = await generateSystemFiles(cell.source);
        loom = await buildLoomModel(cell.source);
      } catch (e) {
        if (ONLY) console.log(`skip ${cell.ddd}: ${String(e).slice(0, 300)}`);
        // Not generatable standalone — `ddd-source-census.test.ts` owns that.
        continue;
      }
      for (const sys of loom.systems) {
        const contexts = sys.subdomains.flatMap((s) => s.contexts);
        for (const d of sys.deployables) {
          if (!isBackend(d.platform)) continue;
          const own = deployableFiles(files, serviceSlug(d.name));
          if (own.size === 0) continue;
          deployables++;
          const backend = d.platform;
          const where = `${cell.ddd} → ${d.name}`;
          const hosted = contexts.filter((c) => d.contextNames.includes(c.name));
          const plan = entrySurface({ deployable: d, contexts: hosted, sys });
          const planned = new Map(
            httpEntries(plan).map((e) => [routeSlot(e.trigger.method, e.trigger.path), e.kind]),
          );
          const mounted = mountedRoutes(backend, own);
          const mountedSlots = new Map(
            mounted.routes.map((r) => [routeSlot(r.method, r.path), r.file]),
          );
          for (const [slot, file] of mountedSlots) {
            if (!planned.has(slot)) unlisted.push({ where, backend, slot, file });
          }
          const seen = kindsSeen.get(backend) ?? new Set<EntryKind>();
          kindsSeen.set(backend, seen);
          for (const [slot, kind] of planned) {
            if (mountedSlots.has(slot)) {
              seen.add(kind);
              continue;
            }
            const key = `${backend} ${kind}`;
            if (UNMOUNTED[key]) {
              waiverHits.add(key);
              continue;
            }
            unmounted.push({ where, backend, slot, kind });
          }
          for (const page of mounted.docPages) {
            if (!DOC_PAGES[backend].includes(page)) badDocPages.push(`${where}: ${page}`);
          }
        }
      }
    }
    if (ONLY) console.log(`deployables: ${deployables}`);
    return { unlisted, unmounted, badDocPages, deployables, kindsSeen, waiverHits };
  })();
  return SWEEP;
}

const render = (fs: readonly Finding[]): string =>
  fs
    .map(
      (f) =>
        `  ${f.where} [${f.backend}] ${f.slot}${f.kind ? ` (${f.kind})` : ""}${f.file ? `  ← ${f.file}` : ""}`,
    )
    .join("\n");

describe("entry-surface census", () => {
  it("every mounted route is an entry the plan lists", { timeout: 1_800_000 }, async () => {
    const s = await sweep();
    if (!ONLY) expectReach("backend deployables", s.deployables, 900);
    expect(s.unlisted, `routes mounted outside entrySurface:\n${render(s.unlisted)}`).toEqual([]);
  });

  it("every planned HTTP entry is mounted, or waived with its issue", {
    timeout: 1_800_000,
  }, async () => {
    const s = await sweep();
    expect(
      s.unmounted,
      `planned entries a backend does not mount:\n${render(s.unmounted)}`,
    ).toEqual([]);
    if (!ONLY) {
      const stale = Object.keys(UNMOUNTED).filter((k) => !s.waiverHits.has(k));
      expect(stale, "waivers that no longer match a gap — delete them").toEqual([]);
    }
  });

  it("documentation pages are the framework's own", { timeout: 1_800_000 }, async () => {
    const s = await sweep();
    expect(s.badDocPages).toEqual([]);
  });

  it("every HTTP entry kind is reached on every backend", { timeout: 1_800_000 }, async () => {
    if (ONLY) return;
    const s = await sweep();
    const httpKinds = (Object.keys(ENTRY_KINDS) as EntryKind[]).filter(
      (k) => ENTRY_KINDS[k].via === "http",
    );
    const missing = BACKENDS.flatMap((b) =>
      httpKinds.filter((k) => !s.kindsSeen.get(b)?.has(k)).map((k) => `${b} ${k}`),
    );
    expect(missing, "entry kinds no corpus fixture mounts on that backend").toEqual([]);
  });
});
