// Which generated deployables the playground can run, read off the generated
// file tree.
//
// The browser runtime boots every Hono backend (one worker each) and previews
// every React frontend, one at a time, each against the backend its `targets:`
// names.  Everything else in the tree is files-only, and is
// listed so the UI can say so by name: .NET (`Program.cs`), Phoenix LiveView
// (`mix.exs`), Spring Boot (`build.gradle.kts`) and FastAPI (`pyproject.toml`)
// backends, and the frontends the preview engine does not bundle (SvelteKit,
// Vue, Angular, Feliz, Flutter).
//
// Pure: no React, no DOM, no worker — the root vitest suite imports it.

import type { UnsupportedDeployable, UnsupportedPlatform } from "../layout/ctx.js";
import { serviceSlug } from "../../../src/util/service-slug.js";
import type { VirtualFile } from "./protocol.js";

/** One frontend deployable the preview renders. */
export interface PreviewFrontend {
  /** The deployable's slug — its generated folder. */
  slug: string;
  /** Its entry path (`<slug>/src/main.tsx`). */
  entry: string;
  /** The slug of the backend its `targets:` names (the compose
   *  `VITE_API_PROXY_TARGET`) — where the preview sends its API calls.  Null
   *  when the tree records none. */
  apiTarget: string | null;
}

export interface DeployableAnalysis {
  /** Hono entry paths to bundle + boot (the single-context root, or one per
   *  system-mode slug folder), the backend the first frontend talks to first —
   *  the default target of the console's requests.  Empty when the tree has
   *  none. */
  backends: string[];
  /** Every frontend the preview renders, sorted by slug. */
  frontends: PreviewFrontend[];
  /** Deployables the browser does not bundle/boot, sorted by slug. */
  unsupported: UnsupportedDeployable[];
}

const HONO_ENTRY = /^([^/]+)\/http\/index\.ts$/;
const REACT_ENTRY = /^([^/]+)\/src\/main\.tsx$/;

/** The lines of one compose service's block, or null when the file declares
 *  no such service.  Service names are the deployable slugs. */
function serviceBlock(compose: string, slug: string): string[] | null {
  const lines = compose.split("\n");
  const start = lines.findIndex((l) => l === `  ${slug}:`);
  if (start === -1) return null;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // The next top-level service (two-space indent) ends this block.
    if (/^ {2}\S/.test(line) || /^\S/.test(line)) break;
    out.push(line);
  }
  return out;
}

/** The compose service a frontend's API proxy points at — the backend its
 *  `targets:` names.  `docker-compose.yml` is the one generated file that
 *  records that binding (`VITE_API_PROXY_TARGET: "http://<slug>:<port>"`
 *  under the frontend's service), and its service names are the deployable
 *  slugs. */
export function frontendApiTarget(compose: string, frontendSlug: string): string | null {
  for (const line of serviceBlock(compose, frontendSlug) ?? []) {
    const m = line.match(/VITE_API_PROXY_TARGET:\s*"?https?:\/\/([^:/"]+)/);
    if (m) return m[1] ?? null;
  }
  return null;
}

/** The `environment:` of one compose service, as the process env its
 *  container would see.  The deployable's worker boots with exactly this
 *  (a service's `<X>_URL` api address, `LOG_LEVEL`, …), so the generated
 *  client reads the same variable it reads under compose.  Only the
 *  `KEY: "value"` map form the generator emits is read; infrastructure
 *  addresses that name a compose sidecar (`DATABASE_URL`) are left out —
 *  the playground's database is the storage connection, not a URL. */
export function composeServiceEnv(compose: string, slug: string): Record<string, string> {
  const block = serviceBlock(compose, slug);
  const env: Record<string, string> = {};
  if (!block) return env;
  const at = block.findIndex((l) => l === "    environment:");
  if (at === -1) return env;
  for (let i = at + 1; i < block.length; i++) {
    const line = block[i] ?? "";
    // Another key of the service (four-space indent) ends the map.
    if (!/^ {6}\S/.test(line)) break;
    const m = line.match(/^ {6}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m?.[1]) continue;
    let value = (m[2] ?? "").trim();
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        // keep the raw text
      }
    }
    if (m[1] === "DATABASE_URL") continue;
    env[m[1]] = value;
  }
  return env;
}

export function analyzeDeployables(files: readonly VirtualFile[]): DeployableAnalysis {
  // Legacy single-context mode puts Hono at the root with no slug, and emits
  // nothing else.
  if (files.some((f) => f.path === "http/index.ts")) {
    return { backends: ["http/index.ts"], frontends: [], unsupported: [] };
  }
  const honoSlugs: string[] = [];
  const reactEntries: string[] = [];
  let compose: string | null = null;
  const platformBySlug = new Map<string, UnsupportedPlatform>();
  const angularSlugs = new Set<string>();
  for (const f of files) {
    const hono = f.path.match(HONO_ENTRY);
    if (hono?.[1] && !honoSlugs.includes(hono[1])) honoSlugs.push(hono[1]);
    if (REACT_ENTRY.test(f.path)) reactEntries.push(f.path);
    if (f.path === "docker-compose.yml") compose = f.content;
    const dotnet = f.path.match(/^([^/]+)\/Program\.cs$/);
    if (dotnet?.[1]) platformBySlug.set(dotnet[1], "dotnet");
    const phoenix = f.path.match(/^([^/]+)\/mix\.exs$/);
    if (phoenix?.[1]) platformBySlug.set(phoenix[1], "elixir");
    // Frontend SPAs the preview engine doesn't bundle in-browser: SvelteKit
    // (`svelte.config.js`; its `$app/*` client + file routing aren't
    // reproduced), Vue (`src/main.ts` — the `.ts` entry, vs react's
    // `src/main.tsx`; the `.vue` SFC pipeline isn't wired), and Angular
    // (`angular.json`; its AOT/`ng build` toolchain isn't run in-browser).
    // Angular *also* emits `src/main.ts`, so `angular.json` is the
    // discriminator and takes precedence over the Vue match (applied after
    // the loop, independent of file order).
    const svelte = f.path.match(/^([^/]+)\/svelte\.config\.js$/);
    if (svelte?.[1]) platformBySlug.set(svelte[1], "svelte");
    const angular = f.path.match(/^([^/]+)\/angular\.json$/);
    if (angular?.[1]) angularSlugs.add(angular[1]);
    const vue = f.path.match(/^([^/]+)\/src\/main\.ts$/);
    if (vue?.[1]) platformBySlug.set(vue[1], "vue");
    // Backends and frontends with their own toolchain: Spring Boot
    // (`build.gradle.kts`), FastAPI (`pyproject.toml`), Feliz (`*.fsproj`,
    // built by Fable) and Flutter (`pubspec.yaml`).
    const java = f.path.match(/^([^/]+)\/build\.gradle(?:\.kts)?$/);
    if (java?.[1]) platformBySlug.set(java[1], "java");
    const python = f.path.match(/^([^/]+)\/pyproject\.toml$/);
    if (python?.[1]) platformBySlug.set(python[1], "python");
    const feliz = f.path.match(/^([^/]+)\/[^/]+\.fsproj$/);
    if (feliz?.[1]) platformBySlug.set(feliz[1], "feliz");
    const flutter = f.path.match(/^([^/]+)\/pubspec\.yaml$/);
    if (flutter?.[1]) platformBySlug.set(flutter[1], "flutter");
  }
  for (const slug of angularSlugs) platformBySlug.set(slug, "angular");

  const frontends: PreviewFrontend[] = reactEntries
    .map((entry) => {
      const slug = entry.match(REACT_ENTRY)?.[1] ?? "";
      return { slug, entry, apiTarget: compose ? frontendApiTarget(compose, slug) : null };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  // Every Hono backend boots.  The one the first frontend talks to leads, so
  // the console's default target serves the preview's pages; the rest follow
  // in path order.
  const targeted = frontends[0]?.apiTarget ?? null;
  const ordered =
    targeted && honoSlugs.includes(targeted)
      ? [targeted, ...honoSlugs.filter((slug) => slug !== targeted)]
      : honoSlugs;

  const unsupported: UnsupportedDeployable[] = [...platformBySlug]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, platform]) => ({ slug, platform }));
  return { backends: ordered.map((slug) => `${slug}/http/index.ts`), frontends, unsupported };
}

/** The files-only platform of the deployable a `.ddd` source names, or null
 *  when the browser runs it.  The analysis keys deployables by their
 *  generated folder (`catalog_api`); the source names them as declared
 *  (`catalogApi`), so the lookup goes through the same `serviceSlug` the
 *  generator uses for the folder. */
export function unsupportedPlatformOf(
  unsupported: readonly UnsupportedDeployable[],
  deployableName: string,
): UnsupportedPlatform | null {
  const slug = serviceSlug(deployableName);
  return unsupported.find((d) => d.slug === slug)?.platform ?? null;
}
