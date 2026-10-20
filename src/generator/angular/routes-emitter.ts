// ---------------------------------------------------------------------------
// Angular route-table emitter (angular-frontend-plan.md).
//
// Hand-renders `src/app/app.routes.ts` — the standalone `Routes` array
// `provideRouter` consumes: one entry per declared ui page, a synthetic Home
// when no page owns the index route, and a wildcard NotFound.
//
// Every declared page is a LAZY route (`loadComponent: () => import(...)`), so
// the builder splits each page into its own chunk and the initial bundle holds
// only the shell.  The synthetic Home and NotFound are a few lines of shell
// chrome and stay eager.  Route-param input binding is not emitted.
// ---------------------------------------------------------------------------

export interface AngularRouteDesc {
  /** The page's declared route, with leading slash (`/`, `/orders/:id`). */
  route: string;
  /** The page component class name (`CustomerHomeComponent`). */
  component: string;
  /** The page file slug under `src/app/pages/` (`customer-home`). */
  slug: string;
}

/** Convert a Loom route to an Angular route-table path: drop the leading
 *  slash and map the index route to `""`. */
export function routePath(route: string): string {
  return route === "/" ? "" : route.replace(/^\//, "");
}

export function renderAngularRoutes(
  pages: readonly AngularRouteDesc[],
  includeHome: boolean,
): string {
  const lines: string[] = ["// Auto-generated.", 'import type { Routes } from "@angular/router";'];
  if (includeHome) lines.push('import { HomeComponent } from "./home.component";');
  lines.push('import { NotFoundComponent } from "./not-found.component";', "");
  lines.push("export const routes: Routes = [");
  if (includeHome) lines.push('  { path: "", component: HomeComponent },');
  for (const p of pages) {
    lines.push(
      `  { path: ${JSON.stringify(routePath(p.route))}, loadComponent: () => import("./pages/${p.slug}.component").then((m) => m.${p.component}) },`,
    );
  }
  lines.push('  { path: "**", component: NotFoundComponent },', "];", "");
  return lines.join("\n");
}
