# Playground E2E

Two specs, one binary:

```
npm run e2e            # both specs
npm run e2e:ui         # Playwright UI mode
npm run e2e:smoke      # node-only end-to-end (no browser)
```

## `editor.spec.ts` — local smoke (no network)

- The page renders.
- Langium LSP worker reports `0 errors` for the starter `sales.ddd`.
- Monaco's editor + LSP markers + readonly file viewer all mount.
- `Generate` produces a virtual file tree.

Runs in any CI / sandbox.  Useful as a fast regression check.

## `runtime.spec.ts` — full pipeline (requires network)

- Record the initial migration (`recordInitialMigration` in `_helpers.ts` — Boot creates the database only from recorded migrations, and an example ships none) → Generate → Bundle (Hono + React) → Boot → `GET /products` → `POST /products` → `GET /products` → switch to **Preview** tab and assert the iframe-hosted React app rendered the home page.
- The in-browser npm install fetches ~150 module tarballs from the npm registry (same-origin `npm-mirror/` when prebuilt) per kind (Hono + React); the runtime fetches PGlite's WASM + `.data` from `jsdelivr`.  Cold first run is ~30 s.
- Iframe `fetch()` calls to `http://localhost:*` are intercepted by the in-iframe shim and routed through `postMessage` to the parent, which dispatches them through the runtime worker — proving end-to-end React → Hono → PGlite under the same origin.
- The spec self-skips if the test browser can't reach the npm registry (some sandboxes block browser-context cross-origin fetches even when Node-side network works).

Runs cleanly on a developer laptop and on GitHub Actions.

## Underlying Node smoke

`scripts/smoke-runtime.mjs` (run via `npm run e2e:smoke`) drives the full pipeline outside the browser using real `esbuild` + Node's `fetch`.  It applies the same `postProcessBundle` transform the production bundler ships, then pre-fetches PGlite's WASM/data and constructs the in-process app.  System-mode cases migrate the way the runtime worker does: nothing is created before the initial migration is recorded, the recorded chain builds the schema, and a recorded evolution migrates the same database with its rows kept.  Useful as a network-connected sanity check that doesn't depend on a Chromium binary.

## Running these locally in the agent sandbox

The sandbox pre-installs Chromium and Playwright; try a bare `npx playwright test` first.
Only when `web/` pins a Playwright version whose expected browser build isn't installed
(*"Executable doesn't exist at …"*) point it at the stable `/opt/pw-browsers/chromium`
path with an untracked override (`web/playwright.local.config.ts` is gitignored; never
commit it):

```ts
// web/playwright.local.config.ts — local only, gitignored
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  use: {
    ...base.use,
    launchOptions: { executablePath: "/opt/pw-browsers/chromium" },
  },
});
```

then `npx playwright test -c playwright.local.config.ts --project=chromium <spec>`.

**One known local-only failure:** `editor.spec.ts` → *"playground loads with
Monaco editor and Langium LSP"* reports a bare `404 (Not Found)` console error
in this sandbox. It reproduces on unmodified `main`, so it is an egress
artifact, not a regression — verify that before spending time on it.
