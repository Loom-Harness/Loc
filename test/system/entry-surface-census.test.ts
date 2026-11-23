// Entry-surface census: every route a backend's generated tree mounts is an
// entry `entrySurface` lists, and every HTTP entry it lists is mounted.
//
// `entrySurface(deployable)` (`src/ir/plan/entry-surface.ts`) is the one list
// of the ways work enters generated code.  The promise probes range over it,
// so an entry missing from it is an entry no probe ever calls: a route a
// backend mounts that the plan does not name is exactly how a cross-tenant
// read reached `main` with every gate green.  This census reads what each
// backend ACTUALLY emits — its route declarations, the workers it starts at
// boot and the events its dispatchers handle, parsed per framework by
// `test/_helpers/mounted-entries.ts` — across the whole corpus (each corpus
// template on all five backends, every other tracked `.ddd` as written), and
// compares it with the plan, both ways:
//
//   unlisted  a mounted route or started entry the plan does not list.  A new entry kind lands
//             in the plan (with its row in `ENTRY_KINDS`) before any backend
//             mounts it.
//   unmounted a planned entry this backend does not mount or start.
//
// A backend that disagrees with the plan is a defect the plan surfaces.  It is
// waived only in `DISAGREEMENTS`, one route per entry, with the issue that
// tracks it; a waiver that no longer matches anything fails the census, so the
// fix deletes it.
//
// A gateway is held the same way: the paths its nginx answers itself (its
// compose project, and its in-cluster workload when it runs one) against the
// plan's gateway entries.  Whatever it proxies is a gathered part's entry.
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
import { kName } from "../../src/system/kubernetes.js";
import { serviceSlug } from "../../src/util/service-slug.js";
import { expectReach } from "../_helpers/census-reach.js";
import { dddSourceOf, REPO_ROOT, trackedDddFiles } from "../_helpers/ddd-corpus.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel } from "../_helpers/ir.js";
import {
  deployableFiles,
  gatewayRoutes,
  type MountedBackend,
  mountedRoutes,
  startedEntries,
} from "../_helpers/mounted-entries.js";

const BACKENDS: readonly MountedBackend[] = ["node", "dotnet", "java", "python", "elixir"];
const isBackend = (p: string): p is MountedBackend => (BACKENDS as readonly string[]).includes(p);

/** The entry kinds only a gateway has: the paths it answers itself under its
 *  reserved prefix.  A backend never reaches them; a gateway reaches only them. */
const GATEWAY_KINDS: readonly EntryKind[] = ["gatewayHealth", "gatewayApps"];

/** Where a gateway runs: its compose project, and its in-cluster workload. */
type GatewayPlace = "gateway" | "gateway-cluster";

/** Framework documentation pages, per backend (they render the OpenAPI
 *  document and read nothing else). */
const DOC_PAGES: Record<MountedBackend, readonly string[]> = {
  node: [],
  dotnet: ["swagger-ui"],
  java: ["swagger-ui"],
  python: ["docs", "redoc"],
  elixir: [],
};

/** A known backend defect: a route one backend mounts outside the plan, or a
 *  planned route it does not mount, with the issue that tracks it.  Keyed
 *  `<.ddd> [<backend>] <unlisted|unmounted> <slot>`, exactly as the census
 *  reports it, so a waiver covers one route and nothing else. */
const DISAGREEMENTS: Readonly<Record<string, string>> = {
  "test/fixtures/corpus/target-reserved-words.ddd [elixir] unmounted post /api/verbses/{}/get":
    "#6423",
  "test/fixtures/corpus/target-reserved-words.ddd [elixir] unmounted post /api/verbses/{}/list":
    "#6423",
  "test/fixtures/corpus/target-reserved-words.ddd [elixir] unmounted post /api/verbses/{}/delete":
    "#6423",
  "test/fixtures/corpus/channels-broker-projection.ddd [python] unlisted get /api/realtime/events":
    "#6424",
};

/** Narrows the sweep while iterating locally (a regex over the `.ddd` path);
 *  unset in CI. */
const ONLY = process.env.ENTRY_SURFACE_CENSUS_ONLY;

interface Cell {
  readonly ddd: string;
  readonly source: string;
  /** A corpus template instantiated on one backend (`ddd` carries it). */
  readonly templated: boolean;
}

/** Tracked sources the census also instantiates on every backend, swapping
 *  their one `platform:` clause: the entry kinds no corpus template reaches. */
const ALL_BACKEND_SOURCES: Readonly<Record<string, string>> = {
  // `timerSource` — the only `timer` entries in the tracked sources.
  "examples/timers.ddd": "platform: node",
};

function cells(): Cell[] {
  const out: Cell[] = [];
  for (const [ddd, clause] of Object.entries(ALL_BACKEND_SOURCES)) {
    if (ONLY && !new RegExp(ONLY).test(ddd)) continue;
    const source = readFileSync(resolve(REPO_ROOT, ddd), "utf8");
    for (const b of BACKENDS) {
      if (b === "node") continue; // the tracked source itself, swept below
      out.push({
        ddd: `${ddd} [${b}]`,
        source: source.replace(clause, `platform: ${b}`),
        templated: true,
      });
    }
  }
  for (const ddd of trackedDddFiles()) {
    if (ONLY && !new RegExp(ONLY).test(ddd)) continue;
    if (ddd.startsWith("test/fixtures/corpus/")) {
      const template = readFileSync(resolve(REPO_ROOT, ddd), "utf8");
      for (const b of BACKENDS) {
        out.push({
          ddd: `${ddd} [${b}]`,
          source: template.replaceAll("__PLATFORM__", b),
          templated: true,
        });
      }
    } else {
      out.push({ ddd, source: dddSourceOf(ddd), templated: false });
    }
  }
  return out;
}

interface Finding {
  readonly where: string;
  readonly backend: MountedBackend | GatewayPlace;
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
  /** Gateway deployables compared, and the entry kinds reached on them. */
  readonly gateways: number;
  readonly gatewayKindsSeen: Set<EntryKind>;
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
    const gatewayKindsSeen = new Set<EntryKind>();
    let deployables = 0;
    let gateways = 0;
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
      // A gateway's in-cluster workload is in the k8s output only, generated
      // on demand for the sources that declare a gateway.
      let k8s: Map<string, string> | undefined;
      for (const sys of loom.systems) {
        const contexts = sys.subdomains.flatMap((s) => s.contexts);
        for (const d of sys.deployables) {
          if (d.gathers !== undefined) {
            k8s ??= await generateSystemFiles(cell.source, { emitKubernetes: true });
            gateways++;
            const where = `${cell.ddd} → ${d.name}`;
            const ddd = cell.templated ? cell.ddd : `${cell.ddd} [gateway]`;
            const waived = (what: "unlisted" | "unmounted", slot: string): boolean => {
              const key = `${ddd} ${what} ${slot}`;
              if (!DISAGREEMENTS[key]) return false;
              waiverHits.add(key);
              return true;
            };
            const plan = httpEntries(entrySurface({ deployable: d, contexts: [], sys }));
            const planned = new Map(
              plan.map((e) => [routeSlot(e.trigger.method, e.trigger.path), e.kind]),
            );
            const mounted = gatewayRoutes(
              deployableFiles(files, serviceSlug(d.name)),
              k8s.get(`k8s/${kName(d.name)}-gateway.yaml`),
            );
            const places: [GatewayPlace, typeof mounted.compose][] = [["gateway", mounted.compose]];
            if (mounted.cluster) places.push(["gateway-cluster", mounted.cluster]);
            for (const [place, routes] of places) {
              const slots = new Map(routes.map((r) => [routeSlot(r.method, r.path), r.file]));
              for (const [slot, file] of slots) {
                if (planned.has(slot) || waived("unlisted", slot)) continue;
                unlisted.push({ where, backend: place, slot, file });
              }
              for (const [slot, kind] of planned) {
                if (slots.has(slot)) gatewayKindsSeen.add(kind);
                else if (!waived("unmounted", slot))
                  unmounted.push({ where, backend: place, slot, kind });
              }
            }
            continue;
          }
          if (!isBackend(d.platform)) continue;
          const own = deployableFiles(files, serviceSlug(d.name));
          if (own.size === 0) continue;
          deployables++;
          const backend = d.platform;
          const where = `${cell.ddd} → ${d.name}`;
          const hosted = contexts.filter((c) => d.contextNames.includes(c.name));
          const plan = entrySurface({ deployable: d, contexts: hosted, sys });
          const http = httpEntries(plan);
          const planned = new Map(
            http
              .filter((e) => !e.trigger.subtree)
              .map((e) => [routeSlot(e.trigger.method, e.trigger.path), e.kind]),
          );
          const subtrees = http.filter((e) => e.trigger.subtree);
          const mounted = mountedRoutes(backend, own);
          const mountedSlots = new Map(
            mounted.routes.filter((r) => !r.host).map((r) => [routeSlot(r.method, r.path), r.file]),
          );
          const seen = kindsSeen.get(backend) ?? new Set<EntryKind>();
          kindsSeen.set(backend, seen);
          const ddd = cell.templated ? cell.ddd : `${cell.ddd} [${backend}]`;
          const waived = (what: "unlisted" | "unmounted", slot: string): boolean => {
            const key = `${ddd} ${what} ${slot}`;
            if (!DISAGREEMENTS[key]) return false;
            waiverHits.add(key);
            return true;
          };
          for (const [slot, file] of mountedSlots) {
            if (planned.has(slot) || waived("unlisted", slot)) continue;
            unlisted.push({ where, backend, slot, file });
          }
          // A route serving the bound ui is covered by the plan's subtree
          // entry for it, and by nothing else.
          for (const r of mounted.routes.filter((r) => r.host)) {
            const slot = routeSlot(r.method, r.path);
            const under = subtrees.find(
              (e) => e.trigger.method === r.method && r.path.startsWith(e.trigger.path),
            );
            if (under) seen.add(under.kind);
            else if (!waived("unlisted", slot))
              unlisted.push({ where, backend, slot, file: r.file });
          }
          for (const [slot, kind] of planned) {
            if (mountedSlots.has(slot)) {
              seen.add(kind);
              continue;
            }
            if (waived("unmounted", slot)) continue;
            unmounted.push({ where, backend, slot, kind });
          }
          // Non-HTTP: the workers each backend starts and the events its
          // dispatchers handle, against the plan's internal entries.
          const started = startedEntries(backend, own);
          const internal = plan.entries.filter((e) => e.role === "internal");
          const plannedWorkers = new Set(
            internal.filter((e) => e.trigger.via !== "event").map((e) => e.kind),
          );
          const plannedEvents = new Set(
            internal.flatMap((e) => (e.trigger.via === "event" ? [e.trigger.event] : [])),
          );
          for (const k of started.workers) {
            if (plannedWorkers.has(k)) seen.add(k);
            else if (!waived("unlisted", `start ${k}`))
              unlisted.push({ where, backend, slot: `start ${k}` });
          }
          for (const k of plannedWorkers) {
            if (!started.workers.has(k as never) && !waived("unmounted", `start ${k}`)) {
              unmounted.push({ where, backend, slot: `start ${k}`, kind: k });
            }
          }
          for (const ev of started.events) {
            if (plannedEvents.has(ev)) continue;
            if (!waived("unlisted", `on ${ev}`))
              unlisted.push({ where, backend, slot: `on ${ev}` });
          }
          for (const e of internal) {
            if (e.trigger.via !== "event") continue;
            if (started.events.has(e.trigger.event)) {
              seen.add(e.kind);
              continue;
            }
            const slot = `on ${e.trigger.event}`;
            if (!waived("unmounted", slot)) unmounted.push({ where, backend, slot, kind: e.kind });
          }
          for (const page of mounted.docPages) {
            if (!DOC_PAGES[backend].includes(page)) badDocPages.push(`${where}: ${page}`);
          }
        }
      }
    }
    if (ONLY) console.log(`deployables: ${deployables}, gateways: ${gateways}`);
    return {
      unlisted,
      unmounted,
      badDocPages,
      deployables,
      kindsSeen,
      gateways,
      gatewayKindsSeen,
      waiverHits,
    };
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
  it("every mounted route and started entry is one the plan lists", {
    timeout: 1_800_000,
  }, async () => {
    const s = await sweep();
    expectReach("backend deployables", s.deployables, ONLY ? 1 : 1350);
    expect(s.unlisted, `routes mounted outside entrySurface:\n${render(s.unlisted)}`).toEqual([]);
  });

  it("every planned entry is mounted or started", {
    timeout: 1_800_000,
  }, async () => {
    const s = await sweep();
    expect(
      s.unmounted,
      `planned entries a backend does not mount:\n${render(s.unmounted)}`,
    ).toEqual([]);
  });

  it("every waiver still matches a disagreement", { timeout: 1_800_000 }, async () => {
    if (ONLY) return;
    const s = await sweep();
    const stale = Object.keys(DISAGREEMENTS).filter((k) => !s.waiverHits.has(k));
    expect(stale, "waivers that no longer match a disagreement — delete them").toEqual([]);
  });

  it("documentation pages are the framework's own", { timeout: 1_800_000 }, async () => {
    const s = await sweep();
    expect(s.badDocPages).toEqual([]);
  });

  it("every entry kind is reached on every backend", { timeout: 1_800_000 }, async () => {
    if (ONLY) return;
    const s = await sweep();
    // `uiHost` is served by static middleware, not a declared route, on node,
    // .NET and Java, so only the backends that declare it can reach it.
    const kinds = (Object.keys(ENTRY_KINDS) as EntryKind[]).filter(
      (k) => k !== "uiHost" && !GATEWAY_KINDS.includes(k),
    );
    const missing = BACKENDS.flatMap((b) =>
      kinds.filter((k) => !s.kindsSeen.get(b)?.has(k)).map((k) => `${b} ${k}`),
    );
    expect(missing, "entry kinds no fixture reaches on that backend").toEqual([]);
  });

  it("every gateway entry kind is reached on a gateway", { timeout: 1_800_000 }, async () => {
    if (ONLY) return;
    const s = await sweep();
    expectReach("gateway deployables", s.gateways, 1);
    const missing = GATEWAY_KINDS.filter((k) => !s.gatewayKindsSeen.has(k));
    expect(missing, "gateway entry kinds no fixture reaches").toEqual([]);
  });
});
