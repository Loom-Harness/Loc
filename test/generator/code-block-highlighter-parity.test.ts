// `CodeBlock { … }` — the highlighter must ship on EVERY static-bundle
// frontend, and must ship VENDORED.
//
// Two defects this pins, both live on `main` before the change:
//
//  1. PARITY.  `uiUsesCodeBlock` was computed by the React orchestrator only;
//     vue / svelte / angular hardcoded `usesCodeBlock: false` (svelte had no
//     shell gate at all).  A page rendering CodeBlock on those three emitted
//     `<pre><code class="language-typescript">` and loaded no highlighter —
//     silently unhighlighted, no diagnostic.
//  2. CDN.  The highlighter came from `cdn.jsdelivr.net` at RUNTIME, so the
//     generated app did not work air-gapped and needed a CSP allowance.  It is
//     now an ordinary `highlight.js` dependency, gated on `usesCodeBlock`
//     exactly as `decimal.js` is gated on `usesMoney` — so an app with no
//     CodeBlock gains neither the dependency nor the module.
//
// Each frontend's injection point differs because its entry does:
//   react / vue  → a second `<script type="module">` entry in index.html
//   svelte       → a side-effect import in the SvelteKit root layout
//                  (SvelteKit owns `src/app.html`; there is no index-html shell)
//   angular      → a side-effect import in `main.ts`, plus the theme stylesheet
//                  in `angular.json`'s `styles` (the Angular compiler rejects a
//                  side-effect CSS import from TypeScript — TS2882)

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const DOMAIN = `
    aggregate Snippet with crudish { title: string }
    repository Snippets for Snippet { }`;

/** One system, four frontends over one backend — so a single generate covers
 *  the whole parity claim. */
function sys(homeBody: string): string {
  return `
system CbDemo {
  subdomain Docs { context Snippets {${DOMAIN}
  } }
  api SnippetsApi from Docs
  ui WebApp {
    page Home {
      route: "/"
      title: "Home"
      body: Stack {${homeBody}}
    }
  }
  storage loomDb { type: postgres }
  resource snippetState { for: Snippets, kind: state, use: loomDb }
  deployable api { platform: node, contexts: [Snippets], dataSources: [snippetState], serves: SnippetsApi, port: 3000 }
  deployable webreact { platform: react, targets: api, ui: WebApp, port: 3001 }
  deployable webvue { platform: vue, targets: api, ui: WebApp, port: 3002 }
  deployable websvelte { platform: svelte, targets: api, ui: WebApp, port: 3003 }
  deployable webangular { platform: angular, targets: api, ui: WebApp, port: 3004 }
}`;
}

const WITH_CODE_BLOCK = sys(`
        Heading { "Snippets", level: 1 },
        CodeBlock { "const x = 1;", language: "typescript" }`);

const WITHOUT_CODE_BLOCK = sys(`
        Heading { "Snippets", level: 1 },
        Text { "no code here" }`);

const FRONTENDS = ["webreact", "webvue", "websvelte", "webangular"] as const;

const file = (files: Map<string, string>, path: string): string => files.get(path) ?? "";

/** Where each frontend keeps the emitted highlighter module. */
const MODULE_PATH: Record<(typeof FRONTENDS)[number], string> = {
  webreact: "webreact/src/lib/highlight.ts",
  webvue: "webvue/src/lib/highlight.ts",
  websvelte: "websvelte/src/lib/highlight.ts",
  webangular: "webangular/src/lib/highlight.ts",
};

/** The file that pulls the module into the bundle graph, per frontend. */
const INJECTION: Record<(typeof FRONTENDS)[number], { path: string; needle: string }> = {
  webreact: {
    path: "webreact/index.html",
    needle: '<script type="module" src="/src/lib/highlight.ts">',
  },
  webvue: {
    path: "webvue/index.html",
    needle: '<script type="module" src="/src/lib/highlight.ts">',
  },
  websvelte: { path: "websvelte/src/routes/+layout.svelte", needle: 'import "$lib/highlight";' },
  webangular: { path: "webangular/src/main.ts", needle: 'import "./lib/highlight";' },
};

describe("CodeBlock highlighter — cross-frontend parity", () => {
  it("every static-bundle frontend emits the module, the dependency and an injection point", async () => {
    const files = await generateSystemFiles(WITH_CODE_BLOCK);
    for (const fe of FRONTENDS) {
      const mod = file(files, MODULE_PATH[fe]);
      expect(mod, `${fe}: src/lib/highlight.ts`).toContain(
        'import hljs from "highlight.js/lib/common";',
      );
      expect(file(files, `${fe}/package.json`), `${fe}: package.json`).toContain('"highlight.js"');
      const { path, needle } = INJECTION[fe];
      expect(file(files, path), `${fe}: ${path}`).toContain(needle);
    }
  });

  it("the markup every frontend emits is actually the markup the module highlights", async () => {
    const files = await generateSystemFiles(WITH_CODE_BLOCK);
    // If the emitted class prefix ever diverges from what `highlight.ts` reads,
    // the highlighter ships and still does nothing — the exact silent shape
    // this file exists to stop.
    for (const [path, content] of files) {
      if (!/^web(react|vue|svelte|angular)\/.*(home|\+page)/i.test(path)) continue;
      if (!content.includes("language-typescript")) continue;
      expect(file(files, MODULE_PATH[path.split("/")[0] as (typeof FRONTENDS)[number]])).toContain(
        'const PREFIX = "language-";',
      );
    }
  });

  it("no frontend loads the highlighter from a CDN any more", async () => {
    const files = await generateSystemFiles(WITH_CODE_BLOCK);
    const offenders = [...files.entries()]
      .filter(([, c]) => c.includes("cdn.jsdelivr.net"))
      .map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it("an unknown `language:` degrades to plain text — getLanguage is consulted before highlight", async () => {
    const files = await generateSystemFiles(WITH_CODE_BLOCK);
    const mod = file(files, MODULE_PATH.webreact);
    // The guard must precede the call; `hljs.highlight` THROWS on an
    // unregistered language, which would blank the page for a `language:`
    // outside the 36-language common bundle.
    const guard = mod.indexOf("hljs.getLanguage(language)");
    const call = mod.indexOf("hljs.highlight(");
    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(guard);
    expect(mod).toContain("if (!language || !hljs.getLanguage(language)) return;");
    // The common bundle, not the ~190-language full build.
    expect(mod).not.toContain('from "highlight.js"');
  });

  it("Angular carries the theme in angular.json (its compiler rejects a CSS import from TS)", async () => {
    const files = await generateSystemFiles(WITH_CODE_BLOCK);
    expect(file(files, "webangular/angular.json")).toContain(
      "node_modules/highlight.js/styles/github-dark.css",
    );
    // …and the module itself must NOT import the CSS, or `ng build` fails TS2882.
    expect(file(files, MODULE_PATH.webangular)).not.toContain('import "highlight.js/styles');
    // The Vite frontends do the opposite — the bundler resolves it.
    expect(file(files, MODULE_PATH.webreact)).toContain(
      'import "highlight.js/styles/github-dark.css";',
    );
  });
});

describe("CodeBlock highlighter — an app without CodeBlock pays nothing", () => {
  it("emits no highlighter module, no dependency, no injection point, on any frontend", async () => {
    const files = await generateSystemFiles(WITHOUT_CODE_BLOCK);
    for (const fe of FRONTENDS) {
      expect(files.has(MODULE_PATH[fe]), `${fe}: src/lib/highlight.ts`).toBe(false);
      expect(file(files, `${fe}/package.json`), `${fe}: package.json`).not.toContain(
        "highlight.js",
      );
      const { path, needle } = INJECTION[fe];
      expect(file(files, path), `${fe}: ${path}`).not.toContain(needle);
    }
    expect(file(files, "webangular/angular.json")).not.toContain("highlight.js");
  });
});
