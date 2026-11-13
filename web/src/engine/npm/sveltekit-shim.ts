// SvelteKit in the preview: the `svelte` compiler builds every component and
// rune module, and a small client router stands in for the kit.
//
// The generated SvelteKit app is a pure client SPA (`ssr = false`, the static
// adapter's `index.html` fallback), so what the kit does for it at run time is
// narrow:
//   - route `src/routes/**/+page.svelte` by its folder (groups `(x)` add no
//     segment, `[id]` is a parameter), each page inside its `+layout.svelte`
//     chain;
//   - `$app/state` (`page.url`, `page.params`), `$app/navigation` (`goto`),
//     `$app/environment`, `$app/paths`;
//   - follow same-app `<a href>` clicks without a document load;
//   - resolve `$lib` to `src/lib`.
// The router serves those paths under the preview's basename
// (`window.__LOOM_BASENAME__`), as the React and Vue routers do.  `load`
// functions in `+page.ts` / `+layout.ts` are not run: the generator emits only
// the `ssr` / `prerender` flags there.

import type { PluginBuild } from "esbuild-wasm";

/** The router module's specifier; `?root=<app src dir>` names the app. */
export const SVELTEKIT_APP = "loom:sveltekit-app";

const VFS = "vfs";
const KIT_NS = "loom-sveltekit";

type SvelteCompiler = typeof import("svelte/compiler");
let svelteCompiler: Promise<SvelteCompiler> | null = null;
function loadSvelte(): Promise<SvelteCompiler> {
  svelteCompiler ??= import("svelte/compiler");
  return svelteCompiler;
}

/** One route: the page, its layouts (outermost first) and its matcher. */
interface RouteFile {
  id: string;
  pattern: string;
  keys: string[];
  page: string;
  layouts: string[];
  /** Sort key — static segments before parameters, longer before shorter. */
  rank: number[];
}

/** The routes under `<root>/routes`, most specific first. */
export function sveltekitRoutes(root: string, paths: Iterable<string>): RouteFile[] {
  const base = `${root}/routes`;
  const layouts = new Set<string>();
  const pages: string[] = [];
  for (const p of paths) {
    if (!p.startsWith(`${base}/`)) continue;
    if (p.endsWith("/+layout.svelte")) layouts.add(p.slice(0, -"/+layout.svelte".length));
    if (p.endsWith("/+page.svelte")) pages.push(p);
  }
  const routes = pages.map((page): RouteFile => {
    const dir = page.slice(0, -"/+page.svelte".length);
    const segments = dir.slice(base.length).split("/").filter(Boolean);
    const chain = [base];
    for (let i = 0; i < segments.length; i++) chain.push(`${base}/${segments.slice(0, i + 1).join("/")}`);
    const keys: string[] = [];
    const rank: number[] = [];
    let pattern = "";
    for (const seg of segments) {
      if (/^\(.*\)$/.test(seg)) continue;
      const rest = seg.match(/^\[\.\.\.(\w+)\]$/);
      const param = seg.match(/^\[(\w+)\]$/);
      if (rest?.[1]) {
        keys.push(rest[1]);
        pattern += "(?:/(.*))?";
        rank.push(2);
      } else if (param?.[1]) {
        keys.push(param[1]);
        pattern += "/([^/]+)";
        rank.push(1);
      } else {
        pattern += `/${seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
        rank.push(0);
      }
    }
    return {
      id: `/${segments.join("/")}`,
      pattern: `^${pattern || ""}/?$`,
      keys,
      page,
      layouts: chain.filter((d) => layouts.has(d)).map((d) => `${d}/+layout.svelte`),
      rank,
    };
  });
  return routes.sort((a, b) => {
    for (let i = 0; i < Math.min(a.rank.length, b.rank.length); i++) {
      if (a.rank[i] !== b.rank[i]) return (a.rank[i] ?? 0) - (b.rank[i] ?? 0);
    }
    return b.rank.length - a.rank.length;
  });
}

/** The router module: every route's components, then start + mount. */
function appModule(root: string, paths: Iterable<string>): string {
  const routes = sveltekitRoutes(root, paths);
  const ids = new Map<string, string>();
  const imports: string[] = [];
  const ref = (path: string): string => {
    let id = ids.get(path);
    if (!id) {
      id = `C${ids.size}`;
      ids.set(path, id);
      imports.push(`import ${id} from ${JSON.stringify(path)};`);
    }
    return id;
  };
  const table = routes.map(
    (r) =>
      `  { id: ${JSON.stringify(r.id)}, re: new RegExp(${JSON.stringify(r.pattern)}), keys: ${JSON.stringify(r.keys)}, layouts: [${r.layouts.map(ref).join(", ")}], page: ${ref(r.page)} },`,
  );
  return [
    `import { mount } from "svelte";`,
    `import { start } from "loom:sveltekit/runtime";`,
    `import App from "loom:sveltekit/App.svelte";`,
    ...imports,
    "start([",
    ...table,
    "]);",
    `mount(App, { target: document.getElementById("app") });`,
    "",
  ].join("\n");
}

// The kit's run-time state, a rune module (`$state`).
const RUNTIME = `
const base = () => (window.__LOOM_BASENAME__ ?? "").replace(/\\/$/, "");
function appUrl() {
  const url = new URL(location.href);
  const b = base();
  if (b && url.pathname.startsWith(b)) url.pathname = url.pathname.slice(b.length) || "/";
  return url;
}
let routes = [];
export const page = $state({ url: appUrl(), params: {}, route: { id: null }, status: 200, error: null, data: {}, form: undefined, state: {} });
export const current = $state({ route: null });
export const navigating = $state({ from: null, to: null, type: null, complete: null });
export const updated = { current: false, check: async () => false };
function sync() {
  const url = appUrl();
  let hit = null;
  for (const r of routes) {
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = m[i + 1] === undefined ? "" : decodeURIComponent(m[i + 1]); });
    hit = { route: r, params };
    break;
  }
  page.url = url;
  page.params = hit ? hit.params : {};
  page.route = { id: hit ? hit.route.id : null };
  page.status = hit ? 200 : 404;
  current.route = hit ? hit.route : null;
}
export async function goto(href, opts = {}) {
  const url = new URL(String(href), location.origin + base() + "/");
  let path = url.pathname;
  const b = base();
  if (b && !path.startsWith(b + "/") && path !== b) path = b + path;
  history[opts.replaceState ? "replaceState" : "pushState"](opts.state ?? {}, "", path + url.search + url.hash);
  sync();
  if (!opts.noScroll) scrollTo(0, 0);
}
export function start(table) {
  routes = table;
  sync();
  addEventListener("popstate", sync);
  document.addEventListener("click", (ev) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const a = ev.target instanceof Element ? ev.target.closest("a[href]") : null;
    if (!a || a.target || a.hasAttribute("download") || a.getAttribute("rel") === "external") return;
    const href = a.getAttribute("href") ?? "";
    // Only the app's own paths; the backend's (\`/api/…\`, the sign-in
    // redirect) stay with the preview's navigation controller.
    if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/")) return;
    ev.preventDefault();
    void goto(href);
  });
}
export const invalidate = async () => {};
export const invalidateAll = async () => {};
export const preloadData = async () => ({ type: "loaded", status: 200, data: {} });
export const preloadCode = async () => {};
export const beforeNavigate = () => {};
export const afterNavigate = () => {};
export const onNavigate = () => {};
export const disableScrollHandling = () => {};
export function pushState(url, state) { history.pushState(state, "", url); sync(); }
export function replaceState(url, state) { history.replaceState(state, "", url); sync(); }
`;

const APP = `<script>
  import { current } from "loom:sveltekit/runtime";
  import Chain from "loom:sveltekit/Chain.svelte";
</script>
{#if current.route}
  <Chain layouts={current.route.layouts} page={current.route.page} />
{:else}
  <p data-testid="not-found">Not found</p>
{/if}
`;

const CHAIN = `<script>
  import Chain from "loom:sveltekit/Chain.svelte";
  let { layouts, page } = $props();
</script>
{#if layouts.length > 0}
  {@const Layout = layouts[0]}
  <Layout>
    {#snippet children()}<Chain layouts={layouts.slice(1)} {page} />{/snippet}
  </Layout>
{:else}
  {@const Page = page}
  <Page />
{/if}
`;

/** The `$app/*` modules, re-exported from the one runtime. */
const APP_MODULES: Record<string, string> = {
  "$app/state": `export { page, navigating, updated } from "loom:sveltekit/runtime";`,
  "$app/navigation": `export { goto, invalidate, invalidateAll, preloadData, preloadCode, beforeNavigate, afterNavigate, onNavigate, disableScrollHandling, pushState, replaceState } from "loom:sveltekit/runtime";`,
  "$app/environment": `export const browser = true; export const dev = true; export const building = false; export const version = "";`,
  "$app/paths": `export const base = ""; export const assets = ""; export const resolve = (p) => p;`,
};

/** The app's `src` folder an importer lives under (`/web_app/src`). */
function srcRootOf(importer: string): string | null {
  const at = importer.indexOf("/src/");
  return at === -1 ? null : importer.slice(0, at + 4);
}

export function setupSvelte(
  build: PluginBuild,
  files: Map<string, string | Uint8Array>,
  read: (p: string) => string | undefined,
): void {
  build.onResolve({ filter: /^loom:sveltekit/ }, (args) => ({ path: args.path, namespace: KIT_NS }));
  build.onResolve({ filter: /^\$app\// }, (args) =>
    Object.hasOwn(APP_MODULES, args.path)
      ? { path: args.path, namespace: KIT_NS }
      : { errors: [{ text: `${args.path} is not available in the playground preview` }] },
  );
  build.onResolve({ filter: /^\$lib(\/|$)/ }, async (args) => {
    const root = srcRootOf(args.importer);
    if (!root) return { errors: [{ text: `cannot resolve ${args.path} outside an app's src/` }] };
    return build.resolve(`${root}/lib${args.path.slice("$lib".length)}`, {
      kind: args.kind,
      resolveDir: args.resolveDir,
      importer: args.importer,
    });
  });

  build.onLoad({ filter: /.*/, namespace: KIT_NS }, async (args) => {
    if (args.path.startsWith(SVELTEKIT_APP)) {
      const root = new URLSearchParams(args.path.slice(args.path.indexOf("?") + 1)).get("root") ?? "";
      return { contents: appModule(root, files.keys()), loader: "js", resolveDir: "/" };
    }
    const app = APP_MODULES[args.path];
    if (app !== undefined) return { contents: app, loader: "js", resolveDir: "/" };
    const svelte = await loadSvelte();
    if (args.path === "loom:sveltekit/runtime") {
      const out = svelte.compileModule(RUNTIME, { filename: "sveltekit-runtime.svelte.js", generate: "client" });
      return { contents: out.js.code, loader: "js", resolveDir: "/" };
    }
    const source = args.path === "loom:sveltekit/App.svelte" ? APP : CHAIN;
    const out = svelte.compile(source, { filename: args.path, generate: "client", css: "injected" });
    return { contents: out.js.code, loader: "js", resolveDir: "/" };
  });

  // Components, and rune modules (`*.svelte.ts` / `*.svelte.js`).
  build.onLoad({ filter: /\.svelte(\.[jt]s)?$/, namespace: VFS }, async (args) => {
    const source = read(args.path);
    if (source == null) return { errors: [{ text: `vfs: missing ${args.path}` }] };
    const svelte = await loadSvelte();
    const resolveDir = args.path.slice(0, args.path.lastIndexOf("/")) || "/";
    try {
      if (args.path.endsWith(".svelte")) {
        const out = svelte.compile(source, { filename: args.path, generate: "client", css: "injected" });
        return { contents: out.js.code, loader: "js", resolveDir };
      }
      const js = args.path.endsWith(".ts")
        ? (await build.esbuild.transform(source, { loader: "ts", format: "esm" })).code
        : source;
      const out = svelte.compileModule(js, { filename: args.path, generate: "client" });
      return { contents: out.js.code, loader: "js", resolveDir };
    } catch (err) {
      return { errors: [{ text: `${args.path}: ${err instanceof Error ? err.message : String(err)}` }] };
    }
  });
}
