// ---------------------------------------------------------------------------
// NpmInstallBundleEngine — the npm-in-browser RuntimeEngine.
//
//   install (real tarballs) → makeVfsNpmPlugin esbuild-wasm bundle
//   (real node_modules, no CDN) → boot/dispatch on the PGlite+Hono
//   runtime client.
//
// The esbuild invocation is injected (`EsbuildRun`): in the browser
// it's the esbuild-wasm worker (which also owns install + the IDB
// cache); tests/spikes inject a node-esbuild runner.
// ---------------------------------------------------------------------------

import { LoomRuntimeClient } from "../runtime/client.js";
import { InfraClient } from "../runtime/infra-client.js";
import type { ResourceService } from "../runtime/infra-client.js";
import type { StorageSchemaPlan } from "../runtime/infra-protocol.js";
import type { BrokerInspectResult } from "../../../src/emulation/broker-protocol.js";
import type {
  BootFail,
  BootFailAt,
  BootPlan,
  BootResult,
  DispatchResult,
  QueryResult,
  SerializedRequest,
  StartResult,
  StorageBootInfo,
  WipeResult,
} from "../runtime/protocol.js";
import type { LogLine } from "../util/log-line.js";
import type { BundleResult } from "../bundle/protocol.js";
import {
  RUNTIME_VERSIONS,
  bootEntryFor,
  devStubEntryFor,
  makeEntryStdin,
  schemaPathFor,
} from "../bundle/plugin.js";
import { engineRegistry } from "./registry.js";
import type {
  BackendBundle,
  FrontendBundle,
  EngineCapabilities,
  EngineSnapshot,
  PrepareInput,
  PreparedBuild,
  RuntimeEngine,
  RuntimeEngineOptions,
} from "./runtime-engine.js";
import { postProcessNpmBundle } from "./npm/postprocess.js";
import { type CompiledFramework, frontendStdin } from "./npm/frontend-frameworks.js";
import type { PreviewFramework } from "../build/deployables.js";
import { VfsBundlerClient } from "./npm/vfs-bundler-client.js";

export interface EsbuildRunInput {
  /** The generated project files only (small).  The runner installs
   *  `rootDeps` into its own copy — node_modules never crosses the
   *  worker boundary. */
  generatedFiles: Map<string, string | Uint8Array>;
  rootDeps: Record<string, string>;
  /** Bundle a synthesised entry (Hono path: makeEntryStdin output). */
  stdinContents?: string;
  /** Bundle a real file entry by absolute VFS path (React path). */
  entry?: string;
  /** React build: keep react/react-dom external so the iframe
   *  importmap supplies a single instance — avoids the dual-React /
   *  "Invalid hook call" failure that bundling React per-frontend
   *  would cause. */
  externalReactRuntime?: boolean;
  /** Opt-in: emit an inline Source Map v3 for this bundle (see
   *  `PrepareInput.sourcemap`).  Off by default; only meaningful on
   *  the Hono run (the React bundle never sets this — frontend `.ddd`
   *  debugging is a separate, out-of-scope slice). */
  sourcemap?: boolean;
  /** A frontend a framework compiler builds (`npm/frontend-frameworks.ts`):
   *  `stdinContents` is then its synthesised entry. */
  framework?: CompiledFramework;
}

export type EsbuildRun = (
  input: EsbuildRunInput,
) => Promise<
  | {
      ok: true;
      code: string;
      css?: string;
      versions: Record<string, string>;
      /** C2: present when the runner externalised a prebuilt
       *  design-pack vendor — the iframe importmap + optional
       *  vendor.css url to forward to the preview. */
      vendorImportmap?: Record<string, string>;
      vendorCssUrl?: string;
    }
  | { ok: false; message: string }
>;


/** Nearest package.json to the entry → its `dependencies`, plus the
 *  runtime-layer PGlite pin (the bundle entry imports it even though
 *  the generated package.json doesn't). */
/** Dependencies declared in the nearest package.json to `entry`.
 *  Each deployable has its own (backend: hono/drizzle/zod; frontend:
 *  react/mantine/…), so the caller harvests per-bundle to install
 *  only what that bundle imports — not the union. */
function harvestDeps(
  files: Map<string, string | Uint8Array>,
  entry: string,
): Record<string, string> {
  const td = new TextDecoder();
  const parts = entry.split("/");
  for (let i = parts.length; i > 0; i--) {
    const p = "/" + [...parts.slice(0, i - 1), "package.json"].join("/");
    const raw = files.get(p);
    if (raw == null) continue;
    try {
      const pkg = JSON.parse(typeof raw === "string" ? raw : td.decode(raw));
      return { ...(pkg.dependencies ?? {}) };
    } catch {
      /* keep walking up */
    }
  }
  return {};
}

/** The framework runtime a compiled frontend's components import, when its
 *  package.json lists it as a build-time dependency: SvelteKit's components
 *  import `svelte/internal/client`, which ships in the `svelte` devDependency. */
function compilerRuntimeDeps(
  files: Map<string, string | Uint8Array>,
  entry: string,
  framework: CompiledFramework,
): Record<string, string> {
  if (framework !== "svelte") return {};
  const raw = files.get(`/${entry.split("/")[0]}/package.json`);
  if (raw == null) return {};
  try {
    const pkg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    const v = pkg.devDependencies?.svelte ?? pkg.dependencies?.svelte;
    return typeof v === "string" ? { svelte: v } : {};
  } catch {
    return {};
  }
}

export class NpmInstallBundleEngine implements RuntimeEngine {
  readonly capabilities: EngineCapabilities = {
    id: "npm-install-bundle",
    realNode: false,
    npmInstall: true,
    database: "pglite",
    // Real node_modules → the whole public-package long tail works,
    // not just the common-package subset a CDN resolver would cover.
    customPackages: "full",
  };

  /** One runtime worker per Node deployable, by slug. */
  private readonly runtimes = new Map<string, LoomRuntimeClient>();
  /** The shared infrastructure (storages) — created on first boot. */
  private infra: InfraClient | null = null;
  /** The booted plan: which backend is the default target, which storage is
   *  first — and what tab-suspension recovery re-boots. */
  private booted: BootPlan | null = null;
  private readonly onLost?: () => void;
  private readonly onLog?: (lines: LogLine[]) => void;
  private readonly injectedRun?: EsbuildRun;
  private vfsBundler: VfsBundlerClient | null = null;
  private lastBoot: { plan: BootPlan; persistent: boolean } | null = null;

  constructor(
    opts: RuntimeEngineOptions & { esbuildRun?: EsbuildRun } = {},
  ) {
    this.onLost = opts.onLost;
    this.onLog = opts.onLog;
    this.injectedRun = opts.esbuildRun;
  }

  /** Injected runner (spikes / tests) wins; otherwise the in-browser
   *  esbuild-wasm worker, created lazily so non-browser callers that
   *  inject never construct a Worker.  The worker now owns install
   *  + the IDB cache, so node_modules never crosses the boundary. */
  private esbuildRun(): EsbuildRun {
    if (this.injectedRun) return this.injectedRun;
    this.vfsBundler ??= new VfsBundlerClient();
    return this.vfsBundler.run;
  }

  /** Workers are created lazily on first boot — `prepare` (install +
   *  bundle) needs none, which also keeps the class unit-testable outside a
   *  Worker host. */
  private rt(slug: string): LoomRuntimeClient {
    let rt = this.runtimes.get(slug);
    if (!rt) {
      rt = new LoomRuntimeClient({
        onLog: this.onLog,
        source: slug || undefined,
        // Backend→backend HTTP: a deployable's request to another's compose
        // address runs through that deployable's app, in its own worker.
        onHttpCall: (host, request) => this.dispatch(request, host),
        // The worker is gone: drop its storage clients now rather than when
        // the browser releases its liveness lock.
        onTerminate: () => void this.infra?.disconnect(slug).catch(() => undefined),
      });
      this.runtimes.set(slug, rt);
    }
    return rt;
  }

  private infraClient(): InfraClient {
    if (!this.infra) {
      const infra = (this.infra = new InfraClient());
      // Automation seam (like `__loomSetRequestBody`): lets a test read what
      // the resource fakes captured — the Mailbox, stored objects, disk files.
      // The Mailbox panel (#4780) replaces the need for it in the UI.
      (window as unknown as { __loomInfraService?: unknown }).__loomInfraService = (
        service: ResourceService,
        op: string,
        params?: unknown,
      ) => infra.service(service, op, params);
    }
    return this.infra;
  }

  async prepare(input: PrepareInput): Promise<PreparedBuild> {
    const generatedFiles = new Map<string, string | Uint8Array>();
    for (const f of input.files) generatedFiles.set("/" + f.path, f.content);
    const run = this.esbuildRun();

    // One bundle per Node deployable, in order.  Each gets its own deps + the
    // runtime PGlite pin (the entry imports it though the package.json
    // doesn't); the deployables of one system share a dependency set, so
    // every install after the first is served from the install cache.
    const backends: BackendBundle[] = [];
    for (const entry of input.backendEntries) {
      backends.push({
        slug: entry.split("/").slice(0, -2).join("/"),
        entry,
        bundle: await this.bundleBackend(run, generatedFiles, entry, input.sourcemap),
      });
    }

    const frontends: FrontendBundle[] = [];
    if (backends.every((b) => b.bundle.ok)) {
      for (const entry of input.frontendEntries ?? []) {
        frontends.push({
          slug: entry.slug,
          entry: entry.entry,
          bundle: await this.bundleFrontend(run, generatedFiles, entry.entry, entry.framework),
        });
      }
    }
    return { backends, frontends };
  }

  private async bundleFrontend(
    run: EsbuildRun,
    generatedFiles: Map<string, string | Uint8Array>,
    entry: string,
    framework: PreviewFramework,
  ): Promise<BundleResult> {
    // C2: the worker externalises the prebuilt design-pack vendor when one is
    // shipped (app-only bundle + iframe importmap), and otherwise bundles the
    // frontend self-contained (react from the single deduped node_modules —
    // one instance, no importmap).  Either way the engine forwards the
    // worker's vendorImportmap / vendorCssUrl (set only on the externalised
    // path) onto the BundleResult for the preview.  Installing only what each
    // bundle imports keeps the Mantine tree out of the backend install (and
    // vice-versa); the frontends of one system share their install cache.
    const r = await run(
      framework === "react"
        ? { generatedFiles, rootDeps: harvestDeps(generatedFiles, entry), entry: "/" + entry }
        : {
            generatedFiles,
            rootDeps: { ...harvestDeps(generatedFiles, entry), ...compilerRuntimeDeps(generatedFiles, entry, framework) },
            entry: "/" + entry,
            stdinContents: frontendStdin("/" + entry, framework),
            framework,
          },
    );
    return r.ok
      ? {
          ok: true,
          kind: "react",
          code: r.code,
          css: r.css,
          size: r.code.length,
          durationMs: 0,
          fetchedUrls: [],
          versions: r.versions,
          vendorImportmap: r.vendorImportmap,
          vendorCssUrl: r.vendorCssUrl,
          diagnostics: [],
        }
      : { ok: false, diagnostics: [{ severity: "error", message: r.message }] };
  }

  private async bundleBackend(
    run: EsbuildRun,
    generatedFiles: Map<string, string | Uint8Array>,
    entry: string,
    sourcemap: boolean | undefined,
  ): Promise<BundleResult> {
    const honoRun = await run({
      generatedFiles,
      rootDeps: {
        ...harvestDeps(generatedFiles, entry),
        "@electric-sql/pglite": RUNTIME_VERSIONS["@electric-sql/pglite"],
      },
      stdinContents: makeEntryStdin(
        entry,
        schemaPathFor(entry),
        // Registered by the entry only when there is no `boot.ts` (whose
        // `bootApp` registers the verifier itself).
        devStubEntryFor(generatedFiles, entry),
        bootEntryFor(generatedFiles, entry),
      ),
      // Backend-only: the React run never sets this.
      sourcemap,
    });
    // Apply the npm-pglite postprocess HERE — the runtime worker boots the
    // code verbatim, so nothing else would.  Failure → a bundle diagnostic,
    // not a thrown rejection that skips BUNDLE_DONE.
    if (!honoRun.ok) {
      return { ok: false, diagnostics: [{ severity: "error", message: honoRun.message }] };
    }
    try {
      const code = postProcessNpmBundle(honoRun.code);
      return {
        ok: true,
        kind: "hono",
        code,
        size: code.length,
        durationMs: 0,
        fetchedUrls: [],
        versions: honoRun.versions,
        diagnostics: [],
      };
    } catch (err) {
      return {
        ok: false,
        diagnostics: [{ severity: "error", message: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  // Boot order mirrors `docker compose up`: the storages come up first, the
  // deployables start once their database is migrated.
  async boot(plan: BootPlan, opts?: { fresh?: boolean }): Promise<BootResult> {
    const start = performance.now();
    const infra = this.infraClient();
    this.booted = null;
    await infra.reset();
    // Objects, files and mail follow the first storage's island (workspace +
    // entry), so they survive a reload with the database; `:memory:` (mobile)
    // keeps them in memory.
    const island = plan.storages
      .map((s) => /^opfs-ahp:\/\/loom-(.+)$/.exec(s.dataDir ?? "")?.[1])
      .find((i) => i !== undefined);
    await infra.configureResources(island ?? null, opts?.fresh);
    // The identity provider serves the realm the generated config names.
    if (plan.oidc) await infra.service("oidc", "configure", plan.oidc);
    // The external-API mocks answer from the specs the storages declare.
    for (const { origin, spec } of plan.restSpecs ?? []) await infra.service("httpMock", "registerSpec", { origin, spec });
    // A deployable that left the system takes its worker with it.
    const slugs = new Set(plan.backends.map((b) => b.slug));
    for (const [slug, rt] of this.runtimes) {
      if (slugs.has(slug)) continue;
      rt.dispose();
      this.runtimes.delete(slug);
    }

    const opened = new Map<string, { persistent: boolean }>();
    for (const st of plan.storages) {
      const res = await infra.openStorage({ key: st.key, dataDir: st.dataDir, fresh: opts?.fresh });
      if (!res.ok) return this.failed(res);
      opened.set(st.key, { persistent: res.persistent });
    }

    // Import every bundle.  A storage without a recorded chain (a source
    // without a system: one deployable) takes its schema from that
    // deployable's Drizzle tables.
    const synthDdl = new Map<string, string>();
    for (const b of plan.backends) {
      const st = plan.storages.find((s) => s.key === b.storage);
      if (!st) return this.failed({ ok: false, message: `Deployable "${b.slug}" binds no booted storage.` });
      const wantsDdl = st.migrations.kind === "unversioned" && !synthDdl.has(st.key);
      const res = await this.rt(b.slug).load({
        bundleCode: b.bundleCode,
        synthDdl: wantsDdl,
        env: b.env,
        serviceHosts: serviceHostsOf(plan, b.slug),
        ...(b.verifier ? { verifier: b.verifier } : {}),
      });
      if (!res.ok) return this.failed(res, b.slug);
      if (wantsDdl) synthDdl.set(st.key, res.ddl ?? "");
    }

    const storages: StorageBootInfo[] = [];
    for (const st of plan.storages) {
      const schema: StorageSchemaPlan =
        st.migrations.kind === "chain" ? st.migrations : { kind: "ddl", ddl: synthDdl.get(st.key) ?? "" };
      const res = await infra.migrateStorage(st.key, schema);
      if (!res.ok) return this.failed(res, null, plan.storages.length > 1 ? st.key : null);
      storages.push({
        key: st.key,
        persistent: opened.get(st.key)?.persistent ?? false,
        applied: res.applied,
        ddl: res.ddl,
      });
    }

    for (const b of plan.backends) {
      // The deployable's storage port, and its line to the infra services
      // (its channel bindings ride the emulated broker over it).
      const storagePort = await infra.attachStorage(b.storage, b.slug);
      const port = await infra.connect(b.slug);
      const res = await this.rt(b.slug).start(storagePort, port);
      if (!res.ok) return this.failed(res, b.slug);
    }

    this.booted = plan;
    const persistent = storages.every((s) => s.persistent);
    this.lastBoot = { plan, persistent };
    return {
      ok: true,
      ddl:
        storages.length === 1
          ? (storages[0]?.ddl ?? "")
          : storages.map((s) => `-- storage: ${s.key}\n${s.ddl}`).join("\n\n"),
      durationMs: Math.round(performance.now() - start),
      persistent,
      applied: storages.flatMap((s) => s.applied),
      storages,
      backends: plan.backends.map((b) => b.slug),
      deployables: plan.backends.map((b) => ({ slug: b.slug, storage: b.storage })),
    };
  }

  /** Stop one booted deployable, as `docker compose stop <svc>` does: its
   *  timers, relay and consumers stop and it leaves the broker, while the
   *  storages, the broker state and the other deployables run on. */
  async stopDeployable(slug: string): Promise<StartResult> {
    const rt = this.runtimes.get(slug);
    if (!this.booted || !this.infra || !rt) return { ok: false, message: `No booted deployable "${slug}".` };
    await rt.reset();
    await this.infra.disconnect(slug);
    return { ok: true };
  }

  /** Start a deployable `stopDeployable` stopped, on the same storage and
   *  broker — it resumes its consumer groups where they stopped. */
  async startDeployable(slug: string): Promise<StartResult> {
    const b = this.booted?.backends.find((x) => x.slug === slug);
    if (!b || !this.infra) return { ok: false, message: `No booted deployable "${slug}".` };
    const rt = this.rt(slug);
    const loaded = await rt.load({
      bundleCode: b.bundleCode,
      synthDdl: false,
      env: b.env,
      serviceHosts: this.booted ? serviceHostsOf(this.booted, slug) : [],
      ...(b.verifier ? { verifier: b.verifier } : {}),
    });
    if (!loaded.ok) return loaded;
    return rt.start(await this.infra.attachStorage(b.storage, slug), await this.infra.connect(slug));
  }

  /** A boot that stopped: name the deployable or storage it stopped at when
   *  the system has more than one, and leave nothing half-started. */
  private failed(fail: BootFail, slug?: string | null, storage?: string | null): BootFail {
    const where =
      slug && this.runtimes.size > 1 ? `${slug}: ` : storage ? `storage ${storage}: ` : "";
    const at: BootFailAt | undefined = slug
      ? { deployable: slug }
      : storage
        ? { storage }
        : undefined;
    return { ...fail, message: `${where}${fail.message}`, ...(at ? { at } : {}) };
  }

  private target(target?: string): LoomRuntimeClient | null {
    const slug = target ?? this.booted?.backends[0]?.slug;
    return slug === undefined ? null : (this.runtimes.get(slug) ?? null);
  }

  infraService<T = unknown>(service: ResourceService, op: string, params: unknown = {}): Promise<T> {
    if (!this.infra) return Promise.reject(new Error("Runtime not booted — boot first."));
    return this.infra.service<T>(service, op, params);
  }

  serveInfraHttp: NonNullable<RuntimeEngine["serveInfraHttp"]> = async ({ service, ...http }) => {
    if (!this.infra) throw new Error("Runtime not booted — boot first.");
    return (await this.infra.service(service, "http", http)) as Awaited<ReturnType<NonNullable<RuntimeEngine["serveInfraHttp"]>>>;
  };

  dispatch(req: SerializedRequest, target?: string): Promise<DispatchResult> {
    const away = target === undefined ? undefined : this.booted?.unavailable?.find((d) => d.slug === target);
    if (away) {
      return Promise.resolve({
        ok: false,
        message: `Deployable "${away.slug}" is not running in the playground: ${away.reason}.`,
      });
    }
    const rt = this.target(target);
    if (!rt) {
      return Promise.resolve({
        ok: false,
        message: target ? `No booted deployable "${target}".` : "Runtime not booted — call /boot first.",
      });
    }
    return rt.dispatch(req);
  }
  /** The emulated message broker's state and journal. */
  inspectBroker(): Promise<BrokerInspectResult | null> {
    return this.infra ? this.infra.inspectBroker() : Promise.resolve(null);
  }
  query(sql: string, storage?: string): Promise<QueryResult> {
    const key = storage ?? this.booted?.storages[0]?.key;
    if (!key || !this.infra) return Promise.resolve({ ok: false, message: "Runtime not booted — boot first." });
    return this.infra.query(key, sql);
  }
  async wipe(storage?: string): Promise<WipeResult> {
    if (!this.booted || !this.infra) return { ok: false, message: "Runtime not booted — nothing to wipe." };
    const keys = storage ? [storage] : this.booted.storages.map((s) => s.key);
    if (!storage) await this.infra.wipeResources();
    for (const key of keys) {
      const res = await this.infra.wipe(key);
      if (!res.ok) return keys.length > 1 ? { ok: false, message: `storage ${key}: ${res.message}` } : res;
    }
    return { ok: true };
  }
  async reset(): Promise<{ ok: true }> {
    this.booted = null;
    await Promise.all([...this.runtimes.values()].map((rt) => rt.reset()));
    await this.infra?.reset();
    return { ok: true };
  }
  /** The browser killed (or may have killed) a backgrounded worker: every
   *  worker is replaced, so the booted state is gone — `onLost` says so. */
  respawn(): void {
    this.respawnAll();
    this.onLost?.();
  }
  private respawnAll(): void {
    this.booted = null;
    this.infra?.respawn();
    for (const rt of this.runtimes.values()) rt.respawn(true);
  }
  /** Drop the bundler worker, releasing everything it holds.
   *
   *  That worker caches an esbuild context per build key, and each context
   *  keeps the ENTIRE installed npm VFS alive (≈8.8k files for a backend
   *  bundle) so incremental rebuilds stay fast — plus esbuild-wasm itself.
   *  Excellent on desktop, and exactly the wrong thing to be holding on a
   *  phone at boot time: PGlite's real startup (WASM instantiation + initdb,
   *  measured at ~5.5s and deferred to the first SQL statement) needs that
   *  headroom, and iOS kills the tab rather than paging.
   *
   *  Costs the next bundle a cold context and a re-install — the latter is
   *  mostly served by the IDB install cache.  A slower second Run beats a
   *  first Run that never completes.  The worker is recreated lazily by
   *  `esbuildRun()`, so callers need do nothing else. */
  releaseBundler(): void {
    this.vfsBundler?.dispose();
    this.vfsBundler = null;
  }
  // Tab-suspension recovery: re-boot the retained plan into fresh workers;
  // the OPFS islands reattach.
  async snapshot(): Promise<EngineSnapshot | null> {
    return this.lastBoot?.persistent
      ? { engineId: this.capabilities.id, version: 2, blob: this.lastBoot.plan }
      : null;
  }
  async restore(snap: EngineSnapshot): Promise<boolean> {
    // Version 1 snapshots held one bundle and one data dir; a cold boot
    // replaces them.
    if (snap.engineId !== this.capabilities.id || snap.version !== 2) return false;
    const plan = snap.blob as BootPlan | null;
    if (!plan?.backends?.length || !plan.storages) return false;
    this.respawnAll();
    const res = await this.boot(plan);
    return res.ok;
  }
  dispose(): void {
    for (const rt of this.runtimes.values()) rt.dispose();
    this.runtimes.clear();
    this.infra?.dispose();
    this.vfsBundler?.dispose();
  }
}

// Selectable by config; NOT the default (esbuild-pglite registered
// first with asDefault=true keeps that crown until B4 parity).
engineRegistry.register(
  "npm-install-bundle",
  (opts) => new NpmInstallBundleEngine(opts),
);

/** The compose hosts a deployable's `fetch` routes inside the playground: the
 *  other booted deployables, and the ones that do not run here — a call to
 *  one of those fails with its reason rather than leaving for the network. */
function serviceHostsOf(plan: BootPlan, self: string): string[] {
  return [...plan.backends.map((o) => o.slug), ...(plan.unavailable ?? []).map((d) => d.slug)].filter(
    (h) => h !== self,
  );
}
