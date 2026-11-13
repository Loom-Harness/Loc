// The fake services one behavioural case needs, derived from its model.
//
// A case declares nothing: the `.ddd` is the declaration.  The case's model is
// lowered with the compiled toolchain, and every `resource` a deployable hosts
// whose `storage` type has a registered fake gets one — one fake per storage,
// handing the env of every resource routed to it.  The runner merges that env
// over the backend's boot env, runs the case, reads `effects()` once the fakes
// have quiesced, and stops them.
//
// A storage type with no registered fake is left alone (the backend falls back
// to its baked-in default address), which is exactly what happened before the
// kit existed.

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { quiesce } from "./quiesce.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Storage type → fake module loader.  A `null` entry is a type the kit knows
 * about but has no fake for yet; it is skipped like an unknown one.
 *
 * Every module exports `start({ storage, resources }) → { kind, env, observe(),
 * reset(), stop() }`; `kind` names the `effects` section its observations land
 * in, and `observe()` / `reset()` may be async.  A sidecar fronts a real,
 * digest-pinned service (`smtp` → Mailpit); an in-process fake serves an
 * emulation-core model for a service that cannot run (`restApi`).  `s3`,
 * `rabbitmq` and `redis` take their start options from the case's generated
 * tree, and are wired by the object-store / broker sidecars.
 */
export const STORAGE_FAKES = {
  smtp: () => import("./mailpit-sidecar.mjs"),
  restApi: () => import("./http.mjs"),
  s3: null,
  rabbitmq: null,
  redis: null,
};

/**
 * Fakes keyed off a whole-system fact rather than a storage — `oidc` stands in
 * for the issuer of a system that declares an `auth { … }` block.  Each entry is
 * `{ wants(system) → boolean, mayWant(source) → boolean, load() }` — `mayWant`
 * is the textual prefilter `mayNeedSidecars` reads; `null` until its fake lands.
 */
export const SYSTEM_FAKES = {
  oidc: null,
};

let projectModule = null;
async function loadModel(srcPath) {
  projectModule ??= await import(pathToFileURL(join(REPO, "out/cli/project.js")).href);
  const r = await projectModule.parseProject(srcPath);
  if (r.errorCount > 0) throw new Error(`sidecars: ${srcPath} does not parse:\n${r.diagnostics.join("\n")}`);
  return r.loom;
}

/**
 * The fakes a model needs: one `{ type, storage, resources }` per storage that
 * a deployable's resources route to and that has a registered fake, plus one
 * `{ type, system }` per wanted system fake.  Pure over the lowered model.
 */
export function plannedFakes(loom, storageFakes = STORAGE_FAKES, systemFakes = SYSTEM_FAKES) {
  const out = [];
  for (const sys of loom.systems ?? []) {
    const hosted = new Set(sys.deployables.flatMap((d) => d.dataSourceNames ?? []));
    for (const storage of sys.storages) {
      if (!storageFakes[storage.type]) continue;
      const resources = sys.dataSources.filter((ds) => ds.storageName === storage.name && hosted.has(ds.name));
      if (resources.length) out.push({ type: storage.type, storage, resources });
    }
    for (const [type, f] of Object.entries(systemFakes)) {
      if (f?.wants(sys)) out.push({ type, system: sys });
    }
  }
  return out;
}

/** Merge `NO_PROXY` so a loopback fake is never routed through the ambient
 *  HTTP(S)_PROXY (httpx and .NET's HttpClient both honour it). */
function withNoProxy(env, base) {
  const extra = ["127.0.0.1", "localhost"];
  const cur = (base.NO_PROXY ?? base.no_proxy ?? "").split(",").filter(Boolean);
  const merged = [...new Set([...cur, ...extra])].join(",");
  return { ...env, NO_PROXY: merged, no_proxy: merged };
}

const NONE = Object.freeze({
  env: {},
  kinds: [],
  effects: async () => ({}),
  async reset() {},
  stop: async () => {},
});

/** Whether a case's source can need a fake at all — a textual prefilter, so a
 *  case with no fakeable `storage` never pays for lowering its model. */
export function mayNeedSidecars(source) {
  const types = Object.keys(STORAGE_FAKES).filter((t) => STORAGE_FAKES[t]);
  if (new RegExp(`\\btype:\\s*(${types.join("|")})\\b`).test(source)) return true;
  return Object.values(SYSTEM_FAKES).some((f) => f?.mayWant?.(source));
}

/**
 * Start every fake the case's model needs.
 *
 * @param {string} srcPath  the case's `.ddd` on disk (platform-swapped)
 * @param {string} [source] its text — when given, a case with nothing to fake
 *   returns at once without lowering the model
 * @returns {Promise<{ env: Record<string,string>, effects(): Promise<Record<string, unknown[]>>, reset(): void, stop(): Promise<void>, kinds: string[] }>}
 */
export async function startSidecars(srcPath, source) {
  if (source !== undefined && !mayNeedSidecars(source)) return NONE;
  const plan = plannedFakes(await loadModel(srcPath));
  if (!plan.length) return NONE;
  const running = [];
  try {
    for (const p of plan) {
      const loader = p.storage ? STORAGE_FAKES[p.type] : SYSTEM_FAKES[p.type].load;
      const mod = await loader();
      running.push({ plan: p, fake: await mod.start(p) });
    }
  } catch (err) {
    await Promise.all(running.map((r) => r.fake.stop()));
    throw err;
  }
  let env = {};
  for (const r of running) env = { ...env, ...r.fake.env };
  if (running.length) env = withNoProxy(env, process.env);

  // `observe()` may be async (a sidecar reads its service's API), so every
  // fake is awaited.
  const snapshot = async () => {
    const byKind = {};
    const perKind = {};
    for (const r of running) perKind[r.fake.kind] = (perKind[r.fake.kind] ?? 0) + 1;
    for (const r of running) {
      const k = r.fake.kind;
      // Two storages of one kind are told apart by name; one needs no label.
      const tag = perKind[k] > 1 ? { storage: r.plan.storage?.name ?? r.plan.type } : {};
      const seen = await r.fake.observe();
      (byKind[k] ??= []).push(...seen.map((e) => ({ ...tag, ...e })));
    }
    return Object.fromEntries(
      Object.keys(byKind)
        .sort()
        .map((k) => [k, byKind[k]]),
    );
  };

  return {
    env,
    kinds: [...new Set(running.map((r) => r.fake.kind))].sort(),
    /** The case's effects, read once two consecutive snapshots agree. */
    async effects(opts) {
      if (!running.length) return {};
      return (await quiesce(snapshot, opts)).value;
    },
    async reset() {
      for (const r of running) await r.fake.reset();
    },
    async stop() {
      await Promise.all(running.map((r) => r.fake.stop()));
    },
  };
}
