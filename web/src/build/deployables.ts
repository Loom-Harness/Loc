// Which generated deployables the playground can run, read off the generated
// file tree.
//
// The browser runtime boots exactly ONE Hono backend and serves at most one
// React frontend.  Everything else in the tree is files-only, and is listed
// so the UI can say so by name: .NET (`Program.cs`) and Phoenix LiveView
// (`mix.exs`) backends, the frontends the preview engine does not bundle
// (SvelteKit, Vue, Angular), and every Hono backend beyond the one booted.
//
// Pure: no React, no DOM, no worker — the root vitest suite imports it.

import type { UnsupportedDeployable, UnsupportedPlatform } from "../layout/ctx.js";
import type { VirtualFile } from "./protocol.js";

export interface DeployableAnalysis {
  /** Hono entry path to bundle + boot (single-context root or system-mode
   *  slug folder), or null when the tree has none. */
  hono: string | null;
  /** React entry path (always under a system-mode slug folder). */
  react: string | null;
  /** Deployables the browser does not bundle/boot, sorted by slug. */
  unsupported: UnsupportedDeployable[];
}

const HONO_ENTRY = /^([^/]+)\/http\/index\.ts$/;
const REACT_ENTRY = /^([^/]+)\/src\/main\.tsx$/;

/** The compose service a frontend's API proxy points at — the backend its
 *  `targets:` names.  `docker-compose.yml` is the one generated file that
 *  records that binding (`VITE_API_PROXY_TARGET: "http://<slug>:<port>"`
 *  under the frontend's service), and its service names are the deployable
 *  slugs. */
export function frontendApiTarget(compose: string, frontendSlug: string): string | null {
  const lines = compose.split("\n");
  const start = lines.findIndex((l) => l === `  ${frontendSlug}:`);
  if (start === -1) return null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // The next top-level service (two-space indent) ends this block.
    if (/^ {2}\S/.test(line) || /^\S/.test(line)) break;
    const m = line.match(/VITE_API_PROXY_TARGET:\s*"?https?:\/\/([^:/"]+)/);
    if (m) return m[1] ?? null;
  }
  return null;
}

export function analyzeDeployables(files: readonly VirtualFile[]): DeployableAnalysis {
  // Legacy single-context mode puts Hono at the root with no slug, and emits
  // nothing else.
  if (files.some((f) => f.path === "http/index.ts")) {
    return { hono: "http/index.ts", react: null, unsupported: [] };
  }
  const honoSlugs: string[] = [];
  let react: string | null = null;
  let compose: string | null = null;
  const platformBySlug = new Map<string, UnsupportedPlatform>();
  const angularSlugs = new Set<string>();
  for (const f of files) {
    const hono = f.path.match(HONO_ENTRY);
    if (hono?.[1] && !honoSlugs.includes(hono[1])) honoSlugs.push(hono[1]);
    if (!react && REACT_ENTRY.test(f.path)) react = f.path;
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
  }
  for (const slug of angularSlugs) platformBySlug.set(slug, "angular");

  // One Hono backend boots.  Prefer the one the React frontend talks to, so
  // the preview's API calls land on a backend that serves them; otherwise
  // the first in path order.  The rest are listed, not silently dropped.
  const reactSlug = react?.match(REACT_ENTRY)?.[1] ?? null;
  const targeted = reactSlug && compose ? frontendApiTarget(compose, reactSlug) : null;
  const booted = targeted && honoSlugs.includes(targeted) ? targeted : (honoSlugs[0] ?? null);
  for (const slug of honoSlugs) {
    if (slug !== booted) platformBySlug.set(slug, "hono-extra");
  }

  const unsupported: UnsupportedDeployable[] = [...platformBySlug]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, platform]) => ({ slug, platform }));
  return { hono: booted ? `${booted}/http/index.ts` : null, react, unsupported };
}
