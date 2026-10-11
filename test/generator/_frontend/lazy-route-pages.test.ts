import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Route-level code splitting on every static-bundle frontend.
//
// A generated SPA must not ship one chunk holding every page: it grows with
// each page the model adds, and vite warns past 500 kB on a three-aggregate
// model.  So every ROUTED PAGE is a lazy module and only the shell (layouts,
// NotFound, the synthetic Home on Angular) is eager:
//
//   React    `const X = React.lazy(() => import("./pages/…"))`, each layout's
//            `<Outlet />` inside a `Suspense` whose fallback is the pack's own
//            loader (`data-testid="route-loading"`), plus an outer one for the
//            `layout: none` routes that mount outside every layout.
//   Vue      `component: () => import("./pages/….vue")`
//   Angular  `loadComponent: () => import("./pages/….component").then(…)`
//   Svelte   SvelteKit's filesystem router already splits per `+page.svelte`;
//            pinned here so nothing starts importing pages into one module.
//
// The fixture covers all three React mount channels (in-shell scaffold pages,
// a named layout, `layout: none`).
// ---------------------------------------------------------------------------

const SRC = (frontend: string) => `
  system S {
    subdomain Shop { context Cart {
      aggregate Item with crudish { name: string  derived display: string = name }
      aggregate Order with crudish { code: string  derived display: string = code }
      repository Items for Item { }
      repository Orders for Order { }
    } }
    api ShopApi from Shop
    layout Marketing {
      header { Heading { "Acme", level: 3 } }
      main
      footer { Text { "© Acme" } }
    }
    ui Web with scaffold(aggregates: [Item, Order]) {
      api Cart: ShopApi
      page Landing { route: "/landing" layout: Marketing body: Stack { Heading { "Welcome" } } }
      page Kiosk { route: "/kiosk" layout: none body: Heading { "Kiosk" } }
    }
    storage loomDb { type: postgres }
    resource cartState { for: Cart, kind: state, use: loomDb }
    deployable api { platform: node, contexts: [Cart], dataSources: [cartState], serves: ShopApi, port: 3000 }
    deployable web { ${frontend}, targets: api, ui: Web { Cart: api }, port: 3001 }
  }
`;

async function webFiles(frontend: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [p, c] of await generateSystemFiles(SRC(frontend))) {
    if (p.startsWith("web/")) out.set(p.slice("web/".length), c);
  }
  return out;
}

/** Each React pack and the element its own `Loader()` primitive renders. */
const REACT_PACKS: ReadonlyArray<{ pack: string; loader: string }> = [
  { pack: "mantine@v7", loader: "<Loader />" },
  { pack: "mantine@v9", loader: "<Loader />" },
  { pack: "mui@v5", loader: "<CircularProgress />" },
  { pack: "mui@v7", loader: "<CircularProgress />" },
  { pack: "chakra@v2", loader: "<Spinner />" },
  { pack: "chakra@v3", loader: "<Spinner />" },
  { pack: "shadcn@v3", loader: "<Loader2 " },
  { pack: "shadcn@v4", loader: "<Loader2 " },
];

describe("route-level code splitting — React", () => {
  it.each(REACT_PACKS)("$pack: every routed page is React.lazy behind a Suspense", async ({
    pack,
    loader,
  }) => {
    const app = (await webFiles(`platform: react, design: "${pack}"`)).get("src/App.tsx")!;

    // No page module is imported statically — that is what put every page in
    // the entry chunk.
    expect(app).not.toMatch(/^import \w+ from "\.\/pages\//m);

    // Every routed component except the shell's own NotFound is a lazy binding.
    const routed = [...app.matchAll(/element=\{<(\w+) \/>\}/g)]
      .map((m) => m[1]!)
      .filter((c) => c !== "NotFound" && !c.endsWith("Layout") && c !== "RouteLoading");
    expect(routed).toEqual(
      expect.arrayContaining(["ItemList", "ItemDetail", "OrderList", "Landing", "Kiosk"]),
    );
    for (const c of routed) {
      expect(app).toMatch(
        new RegExp(`^const ${c} = React\\.lazy\\(\\(\\) => import\\("\\./pages/`, "m"),
      );
    }

    // Each layout's outlet sits directly inside a Suspense (the default shell +
    // the Marketing layout), and one more wraps <Routes> for `layout: none`.
    const outlets = app.match(/<Outlet \/>/g) ?? [];
    expect(outlets).toHaveLength(2);
    expect(
      app.match(/<React\.Suspense fallback=\{<RouteLoading \/>\}>\n\s*<Outlet \/>/g),
    ).toHaveLength(2);
    expect(app).toMatch(/<React\.Suspense fallback=\{<RouteLoading \/>\}>\n\s*<Routes>/);

    // The fallback is the pack's own loader, findable by the smoke spec.
    const fallback = app.slice(
      app.indexOf("function RouteLoading()"),
      app.indexOf("function NotFound()"),
    );
    expect(fallback).toContain('data-testid="route-loading"');
    expect(fallback).toContain('role="status"');
    expect(fallback).toContain(loader);
  });
});

describe("route-level code splitting — Vue", () => {
  it.each([
    "vuetify@v3",
    "shadcnVue@v1",
  ])("%s: every page route is a lazy component", async (pack) => {
    const router = (await webFiles(`platform: vue, design: "${pack}"`)).get("src/router.ts")!;
    // Only the shell's NotFound and layouts are static imports.
    const staticPages = [...router.matchAll(/^import \w+ from "(\.\/pages\/[^"]+)";$/gm)].map(
      (m) => m[1],
    );
    expect(staticPages).toEqual(["./pages/NotFound.vue"]);
    const lazy = router.match(/component: \(\) => import\("\.\/pages\/[^"]+\.vue"\)/g) ?? [];
    // 2 aggregates × list/new/detail + Landing + Kiosk + the scaffold Home.
    expect(lazy.length).toBeGreaterThanOrEqual(9);
    expect(router).not.toMatch(/component: (?!\(\) => import|NotFound|DefaultLayout|\w+Layout)\w+/);
  });
});

describe("route-level code splitting — Angular", () => {
  it.each([
    "angularMaterial@v1",
    "primeng@v1",
    "spartanNg@v1",
  ])("%s: every page route uses loadComponent", async (pack) => {
    const routes = (await webFiles(`platform: angular, design: "${pack}"`)).get(
      "src/app/app.routes.ts",
    )!;
    expect(routes).not.toMatch(/^import .* from "\.\/pages\//m);
    const lazy =
      routes.match(
        /loadComponent: \(\) => import\("\.\/pages\/[\w-]+\.component"\)\.then\(\(m\) => m\.\w+Component\)/g,
      ) ?? [];
    expect(lazy.length).toBeGreaterThanOrEqual(8);
    // Only the shell's own NotFound (and a synthetic Home) stay eager.
    const eager = [...routes.matchAll(/component: (\w+)/g)].map((m) => m[1]);
    expect(eager.every((c) => c === "NotFoundComponent" || c === "HomeComponent")).toBe(true);
  });
});

describe("route-level code splitting — Svelte", () => {
  it.each([
    "shadcnSvelte@v1",
    "flowbite@v1",
  ])("%s: pages are SvelteKit filesystem routes, never imported into one module", async (pack) => {
    const files = await webFiles(`platform: svelte, design: "${pack}"`);
    const pages = [...files.keys()].filter((p) => /^src\/routes\/.*\+page\.svelte$/.test(p));
    expect(pages.length).toBeGreaterThanOrEqual(8);
    for (const [p, c] of files) {
      expect(c, `${p} imports a +page.svelte`).not.toMatch(/from ["'][^"']*\+page\.svelte["']/);
    }
  });
});
