# Wave C3 · packet 3b (test half) — Vue per-PR (M-T9.15) + the M-T9.14 residue

Branch `claude/c3-frontends`, cut from the C3 coordinator head `d7f38b229` (= `main` @ `d2a0bc02c` + the wave log + the 3a and 3c folds). Test-only: **no `src/` file is edited** — every `src/` mutation below was a file-copy seed, restored by file copy and md5-verified; every generated-app mutation went through the new `LOOM_UI_MUTATE` seam (the generated tree, never an emitter). **The workflow half is NOT committed here** — it is the patch block in §"For 3e" below.

## Row → outcome

| mission | status before → after | outcome |
|---|---|---|
| **M-T9.15** | `open` → **`partial`** (test half landed; per-PR wiring is 3e's patch below) | The `sales-system-vue` case of `run-ui.mjs` now runs its own fixture, `test/e2e/fixtures/vue-fullstack/sales-system-vue.ddd` (`test/behavioral/corpus.json:19`), carrying M-T9.38's numeric row: money/decimal/int/long filled through the real create form and read back off the detail page (the fixture's `test e2e "a product's numeric fields survive the UI round-trip"`), plus a harness **list probe** (`numericListProbe`, `test/behavioral/run-ui.mjs:112`; wired by corpus `numericList`, run at `run-ui.mjs:276`) — the LIST read no emitted page object asserts (`ListPage.goto()` only waits for the container testid). The probe seeds the contract's numeric row over `/api`, checks the wire first (so a red probe names which side broke), then requires each value under ITS OWN column header, cell for cell. The contract table grew a measured `vue` column (`test/behavioral/numeric-ui-contract.mjs:57`); the fast-suite ratchet (`numeric-ui-legs.test.ts`) now covers the vue fixture and the probe's wiring. Booted locally and green; measured below. |
| **M-T9.14** | `partial` → **`partial`** (both named residue items BUILT; CI wiring of the auth leg is 3e's, and one runtime defect it found is handed off) | **(a) per-kind `ExprIR` pinning:** `test/generator/flutter/dart-expr-kinds.test.ts` — every `ExprIR.kind` driven through the shared walker's `emitExpr` with `flutterTarget` bound (the entry a generated page uses), 43 byte-exact Dart pins incl. the two loud refusals (`this`, `authz-filter`); vacuity guards: pinned kinds == the `ExprIR` union's kinds read off `loom-ir.ts`, each pin's node is of its filed kind, every `DART_LEAVES` entry is reached. **(b) runtime auth-UI leg:** `test/behavioral/run-ui-auth.mjs` over `test/e2e/fixtures/feliz-flutter-auth-ui/auth-ui.ddd` — generate → build with the frontend's own toolchain (Fable / Flutter SDK) → one origin with the generated Hono backend on PGlite and its **dev-stub verifier registered** (new opt-in `devStub` on `buildServerModule`, `test/behavioral/ui-stack.mjs:218`) → headless Chromium, the principal chosen per browser context by `x-loom-dev-claims` (the tier's `DEV_CLAIMS` mechanism). Nothing is mocked on the authenticated paths: the app's own `/auth/me` reaches the backend, and the backend's own `requires` on `approve` is asserted (viewer → 403) next to the button that mirrors it. Probes: session gate (anonymous → sign-in prompt; the one mock, since the dev stub authenticates everything), page guard ×3 (`/admin` admin/viewer, `/super` admin), action gate ×3 (shown / hidden / the click reaches the backend and approves), menu gate ×2 (feliz only — see D-3b-3). **feliz 10/10 green; flutter 7/7 green + 1 known defect (D-3b-2, ratcheting register).** Fast-suite guard over the fixture + the runner's principals: `test/behavioral/auth-ui-leg.test.ts`. |

Cited, not duplicated: #2898 (M-T9.38 — the numeric half on feliz/flutter; this packet extends its contract table, it does not rebuild it), #2969 (i18n locale wiring, F-034), #2966 (compile-breakers incl. feliz), `generated-flutter-build.yml`'s app-shell heredoc fixture (pinned `enforcement: opt` in C5 5d — untouched; the new auth fixture has no `auth { }` block, so `enforcement` does not apply and it validates with 0 errors).

## Measured (this box, warm caches)

| leg | runs | first-attempt pass | wall-clock |
|---|---|---|---|
| `node run-ui.mjs sales-system-vue` (12 checks: 2 emitted round-trips, 9 smoke, 1 list probe) | 5 clean + 1 earlier | **6/6** | 75 / 81 / 87 / 89 / 90 / 98 s (median 88 s) |
| `node run-ui-auth.mjs feliz` (10 probes) | 4 clean | **4/4** | 69 / 59 / 53 / 58 s |
| `node run-ui-auth.mjs flutter` (8 probes, 1 known defect) | 3 clean (after two harness-bug runs, both the runner's fault and fixed: a header comment matched the platform retarget, and a second semantics-enable wait timed out) | **3/3** | 116 / 102 / 119 s (SDK 3.47.5, pub cache warm) |

A CI runner pays a cold `npm install` of the Vue/Vuetify tree + the Chromium download on top — budget ~4–6 min for the Vue job (the per-PR React cell in `behavioral-ui-e2e.yml` carries `timeout-minutes: 25` for the same shape).

## Mutation proofs (each: seeded, the named assertion failed, restored)

**Vue cell — seeded in the GENERATED app via `LOOM_UI_MUTATE` (booted each time):**
- M1 wrong wire key in the LIST (`list.vue`: the weight and stock cells read each other's key; compiles under `vue-tsc`) → only `✗ [ui-probe] numeric list probe` — `weight: its column reads "4242", contract "1.25"; stock: its column reads "1.25", contract "4242"`. 11 emitted checks stay green. (A first, column-blind version of the probe PASSED this mutation — which is why the probe is header-aware.)
- M2 dropped list column (`barcode` `<th>` + `<td>` removed) → only the list probe — `barcode: the list has no 'barcode' column`. **The emitted suite stays 11/11 green**: without the probe this defect ships.
- M3 wrong wire key on the DETAIL page (`detail.vue` weight↔stock) → only `✗ [ui] a product's numeric fields survive the UI round-trip` — `getByTestId('products-detail-weight') Expected "1.25" Received "4242"`.
- First run with the fixture copied from feliz expected money `"98.7600"` and received `"98.76"` — the finding D-3b-1 below; the `vue` contract cell is the MEASURED value.

**Vue fast-suite ratchet (`numeric-ui-legs.test.ts`):** deleting `barcode: long` from the vue fixture → `every numeric host type is declared on Product in the vue fixture` (`Product has no 'barcode' field`); changing the fixture's `toHaveText("98.76")` to `"98.7600"` → `the vue UI round-trip reads every numeric field back` (names listPrice); replacing `f[cfg.render]` with `f.vue` in the probe → `the vue cell is wired … the list probe must read the contract column`.

**Flutter per-kind pins (`dart-expr-kinds.test.ts`), src seeds:** `DART_LEAVES.literal` money arm → bare number (`src/generator/flutter/dart-expr.ts`, the M-T1.21 defect) fails `literal: money` + both money-binary pins; walker-core's `paren` arm without brackets (`src/generator/_walker/walker-core.ts`) fails `paren: grouping survives` (`(1 + 2)` for `((1 + 2))`); an extra unreached `DART_LEAVES` entry fails `reaches every leaf in DART_LEAVES` naming it; emptying the `duration` pins fails `pins exactly the ExprIR union's kinds` naming `duration`.

**Auth-UI leg, Feliz — seeded in the generated `App.fs` / backend (booted each time):**
- page (`adminView` admits any role) → only `✗ page guard: a viewer gets Forbidden on /admin`.
- action (Approve gate admits any role) → only `✗ action gate: a viewer does not see Approve`.
- session (claims decoder reads `"roles"`) → 8 of 10 fail. **This mutation first left the viewer's hidden-Approve probe GREEN on an empty page** (the app sat on the sign-in prompt behind a good 200) — so every authenticated probe now also fails when the page shows the sign-in prompt; re-run: 2 passed, 8 failed.
- menu (Super link admits any role) → only `✗ menu gate: admin sees the Admin link and not the Super link`.
- anon (the `Anon` branch renders the app) → only `✗ session gate: an anonymous visitor gets the sign-in prompt` — `no 'Sign in' prompt`.
- backend (the generated Hono `requires currentUser.role == "admin"` on approve → `if (false)`) → only `✗ backend: a viewer's approve is refused (403)` — `expected 403, got 204`.
- click (Approve's `onClick` does nothing) → only `✗ action gate: admin's Approve click reaches the backend` — `the click issued no approve POST; job status is "new"`.

**Auth-UI leg, Flutter — seeded in the generated Dart:** page (`admin_page.dart` guard admits any role) → only `✗ page guard: a viewer gets Forbidden on /admin`; action (`job_page.dart` gate admits any role) → only `✗ action gate: a viewer does not see Approve`; session (`auth.dart` probe never yields a user) → 5 authenticated probes fail (2 passed, the anonymous and backend probes); **fix** (D-3b-2's fix applied to the generated `job_page.dart` — content-type + `body: '{}'`) → the click probe PASSES and the leg goes red on `STALE KNOWN_DEFECTS entry — the probe passes now; delete it`, which proves both the diagnosis and the register's ratchet.

**Auth-UI fast guard (`auth-ui-leg.test.ts`):** dropping `requires` from page Admin → `every gate site the leg asserts is declared`; adding an `auth { … oidc … }` block → `the backend authenticates through its dev stub`; the runner's `viewer` principal given role `admin` → `the runner's principals are the roles the gates name`. Each restored by file copy, md5-verified.

## Defects handed off (by tree, with repro) — none fixed here (test-only wave)

- **D-3b-1 — money loses its scale on the Vue/React/Svelte read path (display-only).** The backend sends `"98.7600"`; the Vue detail and list cells render `"98.76"`. Cause: the READ schema's `moneySchema` (`z.union([z.instanceof(Decimal), z.string()]).transform(s => new Decimal(s))` — emitted by `src/generator/react/emit-templates.ts:37`, Svelte twin `src/generator/svelte/emit-templates.ts:292`, the Vue app's `src/lib/schemas.ts` carries the same) turns the wire string into a decimal.js instance, and decimal.js stringifies WITHOUT trailing zeros — so `formatMoney`'s "verbatim" (M-T1.25, `src/generator/_frontend/money-format.ts`) prints a normalised value. M-T1.25's "what the database stores is what the screen shows" holds for a money STRING and not for the money a page actually reads. Repro: `cd test/behavioral && node run-ui.mjs sales-system-vue` and change the contract's `vue` cell to `"98.7600"`. Owner: the frontend money track (M-T1.25 follow-up / 3g if it takes frontend fixes). When fixed, the contract's `vue` cell and the fixture's `toHaveText("98.76")` flip together (the ratchet enforces they move as a pair). Feliz keeps `98.7600`; Flutter drops it too, via a different path (`NumberFormat.decimalPattern()`, already pinned by #2898).
- **D-3b-2 — the Flutter `Action` button cannot execute a param-less operation against the Hono backend.** `src/generator/flutter/flutter-target.ts:674` emits `http.post(apiUri('/jobs/${id}/approve'))` — no body, no `Content-Type: application/json` — and the backend answers **415**; the button's snackbar only shows on 2xx, so the click silently does nothing. The OperationForm path (`src/generator/flutter/riverpod-emit.ts:401`) sends both headers and body. Repro: `FLUTTER=<sdk>/bin/flutter node test/behavioral/run-ui-auth.mjs flutter` → `⊘ action gate: admin's Approve click … approve POST -> 415; job status is "new"`. **Diagnosis proved:** applying the fix to the generated `job_page.dart` (headers + `body: '{}'`) turns the probe green and the leg RED on the stale register entry (see Flutter mutations). Registered in `KNOWN_DEFECTS` (`test/behavioral/run-ui-auth.mjs:415`), which ratchets: the fix deletes the entry in the same change.
- **D-3b-3 — Flutter emits no navigation from a `menu { }` block** (observation, not proven harmful beyond the gate). The generated `main.dart` has routes but no drawer/nav; the menu block and its per-link gates are neither rendered nor refused (no `loom.*` diagnostic). So the menu-link gate site does not exist on Flutter and `run-ui-auth.mjs` asserts it on Feliz only. Owner: the UI track (a `KNOWN_FLUTTER_GAPS`/register row or an emitted nav).

## For 3e (PR 3-B) — the workflow half

Two changes. (1) **Vue per-PR, path-scoped** — a new workflow (path filters are per-workflow, so a second job in `frontend-fullstack-e2e.yml` cannot be scoped), plus the `pr-gate.yml` `workflow_run` entry (`test/system/pr-gate.test.ts` pins completeness), the `docs/testing.md` local-run row (`local-run-mapping.test.ts`), and the draft-gate / path-coverage rows those tests ask for. (2) **The auth-UI leg** on the same label/nightly tier as the other self-hosting legs: two matrix cells in `frontend-fullstack-e2e.yml`, with the setup steps' `if:` widened from `matrix.frontend == 'feliz'`/`'flutter'` to the toolchain. Flake budget for (1): 6/6 first-attempt locally at a median 88 s; the React cell it mirrors has run per-PR on the same runner and harness since the tier landed, so the budget question is cost, not stability — promote it; the self-hosting auth cells stay label/nightly like their siblings until 0.2(b)'s budget says otherwise.

```diff
--- /dev/null
+++ b/.github/workflows/behavioral-ui-vue-e2e.yml
@@ -0,0 +1,77 @@
+name: Behavioral UI e2e — Vue (headless, no docker)
+
+# M-T9.15: the ONE non-React frontend promoted to a per-PR full-stack round-trip
+# (wave C3 packet 3b).  Same runner and topology as behavioral-ui-e2e.yml (the
+# React cell): generate → `vite build` the generated Vue/Vuetify client → serve it
+# and the generated Hono backend (PGlite, in-process) from one origin → run the
+# EMITTED `*.ui.spec.ts` in headless Chromium, plus run-ui.mjs's numeric LIST
+# probe (corpus.json `numericList`).  The other non-React cells stay nightly /
+# `frontend-fullstack`-labelled in frontend-fullstack-e2e.yml.  Measured locally:
+# 6/6 first-attempt, median 88 s warm.
+
+on:
+  push:
+    branches: [main]
+    paths:
+      - 'src/**'
+      - 'bin/**'
+      - 'designs/vuetify/**'
+      - 'vue/**'
+      - 'stacks/**'
+      - 'web/src/runtime/ddl.ts'
+      - 'test/behavioral/**'
+      - 'test/e2e/fixtures/vue-fullstack/**'
+      - 'package.json'
+      - '.github/workflows/behavioral-ui-vue-e2e.yml'
+  pull_request:
+    types: [opened, synchronize, reopened, ready_for_review]
+    paths:
+      - 'src/**'
+      - 'bin/**'
+      - 'designs/vuetify/**'
+      - 'vue/**'
+      - 'stacks/**'
+      - 'web/src/runtime/ddl.ts'
+      - 'test/behavioral/**'
+      - 'test/e2e/fixtures/vue-fullstack/**'
+      - 'package.json'
+      - '.github/workflows/behavioral-ui-vue-e2e.yml'
+      # Vue client + Hono backend only: another backend's or another
+      # frontend's emitter cannot alter this leg.  push:main stays broad.
+      - '!src/generator/java/**'
+      - '!src/generator/dotnet/**'
+      - '!src/generator/python/**'
+      - '!src/generator/elixir/**'
+      - '!src/generator/react/**'
+      - '!src/generator/svelte/**'
+      - '!src/generator/angular/**'
+      - '!src/generator/feliz/**'
+      - '!src/generator/flutter/**'
+      - '!src/platform/java.ts'
+      - '!src/platform/dotnet.ts'
+      - '!src/platform/dotnet/**'
+      - '!src/platform/python.ts'
+      - '!src/platform/elixir.ts'
+  workflow_dispatch:
+permissions:
+  contents: read
+
+concurrency:
+  group: ${{ github.workflow }}-${{ github.ref }}
+  cancel-in-progress: true
+
+jobs:
+  behavioral-ui-vue:
+    if: github.event_name != 'pull_request' || github.event.pull_request.draft == false
+    runs-on: ubuntu-latest
+    timeout-minutes: 25
+    steps:
+      - uses: actions/checkout@v6
+      - uses: actions/setup-node@v6
+        with:
+          node-version: '22'
+          cache: 'npm'
+      - name: Install Loom toolchain
+        run: npm ci
+      - name: Build toolchain
+        run: npm run build
+      - name: Install behavioral harness deps
+        working-directory: test/behavioral
+        run: npm ci || npm install --no-audit --no-fund
+      - name: Run the Vue full-stack round-trip (+ numeric list probe)
+        working-directory: test/behavioral
+        run: node run-ui.mjs sales-system-vue
+      - name: Upload Playwright evidence
+        if: failure()
+        uses: actions/upload-artifact@v4
+        with:
+          name: playwright-vue
+          path: |
+            test/behavioral/.work-ui/**/test-results/**
+            test/behavioral/.work-ui/**/report.json
+          include-hidden-files: true
+          if-no-files-found: ignore
+          retention-days: 14
--- a/.github/workflows/pr-gate.yml
+++ b/.github/workflows/pr-gate.yml
@@ workflows:
       - 'Behavioral UI e2e (headless, no docker)'
+      - 'Behavioral UI e2e — Vue (headless, no docker)'
       - 'Behavioral UI e2e — HEEx / LiveView'
--- a/.github/workflows/frontend-fullstack-e2e.yml
+++ b/.github/workflows/frontend-fullstack-e2e.yml
@@ matrix.include (after the flutter cell)
+          # The RUNTIME auth-UI leg (M-T9.14 residue, wave C3 3b): the session
+          # gate, `requires` page guards, the op-gated Action button (and its
+          # backend 403), and — on feliz — the menu-link gates, driven through
+          # the backend's dev-stub principals (`x-loom-dev-claims`).  flutter
+          # carries one ratcheting KNOWN_DEFECTS entry (D-3b-2).
+          - frontend: feliz-auth
+            case: feliz
+            runner: run-ui-auth.mjs
+            experimental: false
+          - frontend: flutter-auth
+            case: flutter
+            runner: run-ui-auth.mjs
+            experimental: false
@@ steps
-      - name: Set up .NET (Feliz/Fable only)
-        if: matrix.frontend == 'feliz'
+      - name: Set up .NET (Feliz/Fable only)
+        if: startsWith(matrix.frontend, 'feliz')
@@
-      - name: Set up Flutter (flutter cell only)
-        if: matrix.frontend == 'flutter'
+      - name: Set up Flutter (flutter cells only)
+        if: startsWith(matrix.frontend, 'flutter')
```

The `sales-system-vue` matrix row of `frontend-fullstack-e2e.yml` can stay (it is the nightly backstop) or be dropped once the per-PR leg is binding — 3e's call. Local commands for the `docs/testing.md` rows: `cd test/behavioral && node run-ui.mjs sales-system-vue`; `node run-ui-auth.mjs feliz` (needs `dotnet` on PATH — the image's `/opt/dotnet` SDK 10 works with `DOTNET_ROLL_FORWARD=Major`); `FLUTTER=<sdk>/bin/flutter node run-ui-auth.mjs flutter`.

## Local gates on the merged tree

On `b9f134bda` (the packet commits merged with the coordinator head `9e30a9dac`, 3f folded), re-run 2026-09-29 on an idle box:

| gate | result |
|---|---|
| `npx tsc -b` | exit 0 |
| `node scripts/test-typecheck.mjs` | `test/ typecheck gate OK` |
| `npx biome ci . --diagnostic-level=error` | 3436 files, no errors |
| `NODE_USE_ENV_PROXY=1 node scripts/mission-counts.mjs --check` | README region up to date (M-T9.14/M-T9.15 stay `partial`/move `open` → `partial`; nothing archived) |
| `node scripts/ledger-counts.mjs --check` | `.md matches the JSON` |
| `node docs/build.mjs` | exit 0 |
| `npm test` (redirected, exit appended) | **2239 files / 27464 tests passed, 1 failed, `NPM_TEST_EXIT=1`** — the one failure is a starvation timeout (`test/cli/cli-tooling-truth.test.ts:520`, `Test timed out in 30000ms` — it spawns the CLI once per verb); re-run alone: **27/27 passed**. The earlier full run (2026-09-28, under ~50 load average from sibling packets) had 5 failures, all timeouts, all green alone: `openapi-component-uniqueness-census` (4/4), `print-roundtrip` (showcase, 120 s ceiling), `corpus-mutation` `state-gate x M1.aggregate.isDeleted` + `tph-crossings x M1.aggregate.updatedAt` (2/2), and the same `cli-tooling-truth` test. None touches a file this packet changed. |

Booted legs (not in `npm test`; commands in §"For 3e"): Vue cell 6/6, Feliz auth 4/4, Flutter auth 3/3 (7 pass + 1 known defect each), numbers in §"Measured".

## Open-PR overlaps

Searched open PRs (vue / flutter / feliz / run-ui), 2026-09-28 16:4xZ:
- **#2942** (ready — the page emitter's fail-open `/* unresolved: X */ undefined` sentinel): touches `_walker/walker-core.ts`'s `ref`/`method-call` give-up arms. `dart-expr-kinds.test.ts` never drives an unresolved ref (every pin resolves) and asserts no output contains `unresolved`/`undefined`, so it holds on either side of #2942; if #2942 changes an arm's spelling for a RESOLVED node, the matching pin moves with it by design.
- **#2966** (draft, compile-breakers incl. a Feliz form-record collision) and **#2969** (draft, F-034 i18n locale wiring): cited, not duplicated; neither touches the auth fixture's surface (no forms, no locales).
- **#3062** (draft, CodeBlock highlighter vendoring) and **#3063** (soft keywords): no overlap — neither fixture uses `CodeBlock`, and both fixtures' field names (`listPrice`, `weight`, `stock`, `barcode`, `title`, `status`) are unaffected by either keyword list.
- **#3058** is the wave claim this branch folds into.
