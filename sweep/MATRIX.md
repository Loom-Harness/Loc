# Loom target matrix — sweep report

`main` @ `619708fd` · 2026-09-13 · toolchain rebuilt from source before cell #1
(`npm install && npx tsc -b`) · every verdict backed by a row in
`sweep/results.jsonl` and an artifact tree under `sweep/out/`.

---

## Summary

**Cells attempted: 110** (36 T1 platform cells + 12 T1 compile halves + 17 T2 pack
cells + 17 T2-reduced pack cells + 13 T4 swap/adapter/topology cells + 5 T5 runtime
cells + 10 T5 visual cells). 16 minimal repro `.ddd` files, 280 screenshots.

| | pass | partial | fail | unverified |
|---|---|---|---|---|
| **T1** platform cross-product (36 cells) | 9 | 18 | 9 | 0 |
| **T2** every pack, full 58-primitive probe (17) | 0 | — | 17 | 0 |
| **T2r** every pack, probe minus 4 shared defects (17) | 9 | — | 8 | 0 |
| **T4** swaps · adapters · topology · k8s (13) | 12 | — | 0 | 1 honest refusal |
| **T5** runtime round-trip, all 5 backends (5) | 4 | 1 | 0 | 0 |
| **T5** visual, 9 packs + 1 bisect (10) | 6 | 2 | 2 | 0 |

**SILENT vs HONEST: 24 silent · 4 honest · 1 documented · 1 by-design note.**
That ratio is the headline. Of the 30 live findings (F-002…F-031; F-001 was
withdrawn after a rebuild), **24 are SILENT** — valid `.ddd`, exit code 0, no
diagnostic, and output that does not compile, does not run, or renders wrong.

The four HONEST ones (F-020 Angular component children, F-021 Feliz components,
F-022 HEEx `OperationForm`, F-023 the `match` parse error) are *excellent*: they
name the limit, the emitter file, the reason and the workaround, and F-020 even
repeats itself as a comment in the emitted HTML. Flutter's refusal of `toast(…)`
(part of F-009) is the same quality. That is the bar — and it makes the silence
elsewhere a choice, not a limitation: **the same `toast(…)` breaks four other
frontends and only Flutter says so.**

### The three worst cells

1. **`mui@v5` pack** — builds *completely green* (`tsc --noEmit` ✅, `vite build`
   ✅, one of the 9 packs that passed the reduced tier) and then renders **nothing
   but an error boundary on every route** (F-031). React #130 from the shell's
   hamburger icon; proven by mutation (replace `<MenuIcon />`, the app renders).
   4 DOM nodes, 0 focusables, 28 of 28 screenshots blank. Invisible to every
   compile gate in the repo. `mui@v7` on the same model is fine.
2. **`elixir` backend at runtime** — compiles (after removing a `currentUser` row
   filter it cannot build, F-005), boots, accepts a `POST` with `201`, then returns
   **`500` on every read** of an aggregate with a decimal-arithmetic `derived` field
   (F-029). Also invisible to every compile gate. A team that adopts Phoenix on the
   strength of a green CI matrix finds out in staging.
3. **`mantine` packs (v7 and v9)** — the `Chart` template emits unbalanced JSX
   braces, so `home.tsx` does not parse (F-008). Mantine is the **CLI default**
   (`ddd new` picks it), and it is the only React family that fails the reduced pack
   pass. First `ddd new` + `Chart` + `npm run build` = broken.

(Runner-up, and the one that costs the most breadth: **`flutter`** — one custom
repository `find` makes the scaffolded list page read three Riverpod providers
that `reads.dart` never emits, F-006, so any app with a non-trivial repository
fails `flutter build web`.)

### What I would actually ship on

- **Backend: `dotnet@v10`, `java@v1`, `python@v1`.** All three compiled the full
  probe (`dotnet build /warnaserror`, `gradle testClasses bootJar`, `ruff` +
  `mypy --strict`) with zero errors, and all three passed the full runtime
  round-trip — migrations on an empty DB, create, read, guarded operation, a `403`
  on the same operation without the permission, and a workflow. Their wire
  responses are identical to each other modulo `1` vs `1.0` number formatting.
- **Backend `node@v5`** with one caveat: a single construct (a `decimal` comparison
  in a repository `find`, F-002) is the *only* error in the entire generated
  project, and the Hono runtime round-trip passed. Avoid that one construct and it
  is production-grade; it is otherwise the fastest to build by an order of
  magnitude.
- **Frontend: `react`** with **shadcn v3/v4, chakra v2/v3, or mui@v7** — *not*
  mantine (F-008) and *not* mui@v5 (F-031). Or **`vue` with `vuetify@v3`**. React
  compiled the full probe as-is; Vue needed the shared defects removed. Every one
  of those five pack versions was screenshotted across 7 pages × 3 widths + dark
  and looked right.
- **Do not ship yet:** `elixir` (backend or HEEx frontend), `svelte`, `angular`,
  `flutter`, `feliz`-with-operation-components, `mantine` (both), `mui@v5`,
  `shadcnVue`, `primeng`.

### What I did not get to

- Boot + Playwright for the **HEEx/LiveView** UI (neither HEEx pack compiles the
  probe, F-009/F-015, so there was nothing to boot).
- `feliz` and `flutter` on the full UI probe — both **honestly refuse** it at
  validation (F-021, F-009), so measuring them there would have required changing
  the model, which breaks the hold-the-model-constant rule. They are measured in T1
  only.
- `kubeconform` on the raw k8s manifests (not installed here); `helm lint` and
  `helm template` both pass, and all 12 manifests parse as YAML.
- **Dark mode** was captured (9 packs × 7 pages at desktop) but not visually
  audited page-by-page — the structural probe found no dark-specific failures, and
  I looked at a sample, not all 49.
- Keyboard navigation and focus-ring *visibility* — I counted focusable elements
  per page (18–27, consistent across packs) but did not tab through them.
- The generated `Dockerfile` build for the Hono backend: it was still running after
  25+ minutes of in-container `npm install` through the egress proxy when I ran the
  Hono runtime cell on the host instead. The .NET, Java and Elixir runtime cells
  *did* run inside their containers.

---

## T1 — platform cross-product

**Model:** `sweep/models/probe-domain.ddd`, byte-identical in all 36 cells
(only the two `deployable` blocks are rewritten). Two contexts, contained entities,
an enum, an optional scalar, a `string[]`, a value object with invariants, two
derived fields (one doing decimal arithmetic), a guarded operation emitting an
event, three repository finds (one row-scoped by `currentUser`), a cross-aggregate
`X id`, `money` + `decimal`, a workflow, `user {}` + `permissions {}` + `requires`
+ `auth: required`, and a scaffolded UI.

**All 36 cells generated successfully** — `generate system` is fast and stable:
2.0–2.3 s per cell, no crashes, no non-determinism.

### The two axes are genuinely orthogonal (measured, not assumed)

I hashed every emitted project tree across the cross-product:

| half | distinct trees across the other axis' 6 values |
|---|---|
| `node`, `node@v4`, `elixir`, `python`, `java` backends | **1** — byte-identical regardless of frontend |
| `dotnet` backend | 6 — but the *only* difference is the absolute `.ddd` path in `#line` pragmas (F-026) |
| `feliz`, `flutter` frontends | **1** — byte-identical regardless of backend |
| `react`, `vue`, `svelte`, `angular` frontends | 5 — the *only* difference is the vite proxy port (`node`/`node@v4` collide at :3000) |

So "identical API contracts, pick per deployable" holds structurally. This also
means each half only had to be compiled **once**: a cell's verdict is
`backend-half ∧ frontend-half`, and the table below is derived from 12 compiles,
not 72. The per-half results are the honest measurements; the 36 cells are their
product.

### Compile halves

| half | command | verdict | time | finding |
|---|---|---|---|---|
| `node@v5` (Hono/TS) | `npx tsc --noEmit` | ❌ | 7.5 s | F-002 (1 error, whole project) |
| `node@v4` (Hono/TS) | `npx tsc --noEmit` | ❌ | 7.2 s | F-002 (identical) |
| `dotnet@v10` | `dotnet build /warnaserror` (sdk:10.0) | ✅ | 9.2 s¹ | — |
| `elixir@v1` | `mix compile --warnings-as-errors` | ❌ | 71.6 s | F-005 |
| `python@v1` | `uv sync` + `ruff check` + `mypy --strict` | ✅ | 11.1 s² | — |
| `java@v1` | `gradle --no-daemon testClasses bootJar` (gradle:9-jdk25) | ✅ | 60.3 s | — |
| `react` | `tsc --noEmit` | ✅ | 5.1 s | — |
| `vue` | `vue-tsc --noEmit` | ✅ | 12.4 s | — |
| `svelte` | `svelte-kit sync && svelte-check` | ❌ | 7.6 s | F-003 |
| `angular` | `ng build` (node:24 container³) | ❌ | 10.8 s | F-004 |
| `feliz` | `dotnet tool restore && dotnet fable && vite build` | ✅ | 51.8 s | — |
| `flutter` | `flutter pub get && flutter build web --release` | ❌ | 53.9 s | F-006 |

¹ warm `obj/` from a prior run in the same mounted dir; a cold build measured 16.2 s.
² after a 35 s `uv sync`. ³ the host's node 22.22.2 is below the Angular CLI's
22.22.3 minimum — an **environment** constraint, worked around, not a Loom defect.

### The 36 cells

✅ both halves compile · ⚠️ one half compiles · ❌ neither

| backend ↓ / frontend → | react | vue | svelte | angular | feliz | flutter |
|---|---|---|---|---|---|---|
| **node@v5** | ⚠️ F-002 | ⚠️ F-002 | ❌ F-002+F-003 | ❌ F-002+F-004 | ⚠️ F-002 | ❌ F-002+F-006 |
| **node@v4** | ⚠️ F-002 | ⚠️ F-002 | ❌ F-002+F-003 | ❌ F-002+F-004 | ⚠️ F-002 | ❌ F-002+F-006 |
| **dotnet@v10** | ✅ | ✅ | ⚠️ F-003 | ⚠️ F-004 | ✅ | ⚠️ F-006 |
| **elixir@v1** | ⚠️ F-005 | ⚠️ F-005 | ❌ F-005+F-003 | ❌ F-005+F-004 | ⚠️ F-005 | ❌ F-005+F-006 |
| **python@v1** | ✅ | ✅ | ⚠️ F-003 | ⚠️ F-004 | ✅ | ⚠️ F-006 |
| **java@v1** | ✅ | ✅ | ⚠️ F-003 | ⚠️ F-004 | ✅ | ⚠️ F-006 |

**9 ✅ · 18 ⚠️ · 9 ❌.** Note the shape: the failures are *four independent
single-construct defects*, one per axis value, not broad rot. Fix F-002, F-003,
F-004, F-005 and F-006 and this table is 36/36.

### Output size and build cost per backend (same model)

| backend | files | size | compile | frontend | files | size | build |
|---|---|---|---|---|---|---|---|
| node@v5 / v4 | 37 | 133 KB | 7 s | react | 43 | 142 KB | 5 s |
| dotnet@v10 | 97 | 185 KB | 9–16 s | vue | 44 | 136 KB | 12 s |
| elixir@v1 | 71 | 144 KB | 72 s | svelte | 46 | 154 KB | 8 s |
| python@v1 | 44 | 109 KB | 11 s | angular | 43 | 146 KB | 11 s |
| java@v1 | 82 | 131 KB | 60 s | feliz | 18 | 145 KB | 52 s |
| | | | | flutter | 25 | 129 KB | 54 s |

Build time *is* a finding here: the fast backends (node 7 s, dotnet 9 s, python
11 s) and the slow ones (java 60 s, elixir 72 s) differ by an order of magnitude,
and on the frontend side feliz (52 s, `dotnet fable` + vite) and flutter (54 s) are
a different product from react (5 s). None of this is pathological — but a team
choosing java+flutter is signing up for ~2 minutes of CI per compile where
node+react costs ~12 seconds.

---

## T2 — every pack, every version

**Model:** `sweep/models/probe-ui.ddd` — **all 58 walker primitives** (56
top-level + `Tab` + `Column`, verified mechanically by `sweep/coverage.mjs` against
`src/util/walker-primitive-names.ts`), plus page `state`, `derived`, a named
`action`, `match`, lambdas, a validated form, a detail page, a dashboard, an
empty-state page, and a component with `Slot { }`. Two lines are dropped for
exactly the targets that honestly refuse them (`DataGrid` on HEEx/Flutter,
`ProvenanceInfo` on Flutter).

**All 17 pack versions generated successfully** and — a genuinely good result —
**not one emitted a walker give-up comment.** I grepped every output tree for
`not supported`, `unknown layout component` and `TODO`: zero hits across 17 packs
on the full primitive set. Whatever else is broken, no primitive silently vanishes.

**All 17 then failed to compile or bundle.** Every failure was one of four defects
shared by *every* pack of a framework — i.e. toolchain defects, not pack defects.
So I ran the whole tier a second time with exactly those four constructs removed
(F-007 two-forms-on-a-page, F-009 `toast()`, F-010/F-011 `DestroyForm`, F-012
input `error:` with a string literal) to make the pack axis readable. **Both
columns are reported; the reduced column is the pack verdict.**

| family | version | framework | full probe | reduced probe | build | pack-specific finding |
|---|---|---|---|---|---|---|
| chakra | v2 | react | ❌ F-007 | ✅ | 8.9 s | — |
| chakra | v3 | react | ❌ F-007 | ✅ | 8.5 s | — |
| **mantine** | **v7** | react | ❌ F-008 | ❌ | 1.7 s | **F-008** Chart template |
| **mantine** | **v9** | react | ❌ F-008 | ❌ | 1.7 s | **F-008** Chart template |
| **mui** | **v5** | react | ❌ F-007 | ✅ builds, ❌ **renders blank** | 7.6 s | **F-031** shell React #130 |
| mui | v7 | react | ❌ F-007 | ✅ | 7.2 s | — |
| shadcn | v3 | react | ❌ F-007 | ✅ | 7.6 s | — |
| shadcn | v4 | react | ❌ F-007 | ✅ | 7.9 s | — |
| **shadcnVue** | **v1** | vue | ❌ F-007/9/10 | ❌ | 8.6 s | **F-013** `<img>` asset import |
| vuetify | v3 | vue | ❌ F-007/9/10 | ✅ | 11.9 s | — |
| flowbite | v1 | svelte | ❌ F-007/9/11 | ❌ | 7.2 s | F-003 (frontend, not pack) |
| shadcnSvelte | v1 | svelte | ❌ F-007/9/11 | ❌ | 6.7 s | F-003 (frontend, not pack) |
| angularMaterial | v1 | angular | ❌ F-009/12 | ✅ | 10.6 s | — |
| **primeng** | **v1** | angular | ❌ F-009/12 | ❌ | 9.5 s | **F-014** `p-select` attribute |
| spartanNg | v1 | angular | ❌ F-009/12 | ✅ | 8.7 s | — |
| coreComponents | v3 | elixir/HEEx | ❌ F-009 | ❌ | 82.8 s | F-015 (frontend, not pack) |
| daisyui | v1 | elixir/HEEx | ❌ F-009 | ❌ | 82.6 s | F-015 (frontend, not pack) |

**Pack-axis verdict: 5 of 17 versions carry a pack-local defect** — mantine v7,
mantine v9 (F-008), shadcnVue v1 (F-013), primeng v1 (F-014), and **mui v5**
(F-031, which *passes* this tier and only fails when you open the page). The other 13
are as good as their framework lets them be. Two versions of a family behaving
differently *did* happen — but only in the direction that matters for this rule:
mantine v7 and v9 fail **identically**, while shadcn v3/v4, mui v5/v7 and chakra
v2/v3 all pass identically. Never extrapolate: at compile time it happened to be
consistent within families and wildly inconsistent *across* Angular's three packs
(angularMaterial ✅, spartanNg ✅, primeng ❌ — same framework, same model) — and at
*runtime* the rule bit inside a family too, with mui@v5 blank and mui@v7 perfect.

Output size, full probe: React packs 51–70 files / 98–138 KB; Vue 53–90 / 97–122 KB;
Svelte 53–55 / 101–106 KB; Angular 44 / 101–105 KB; **HEEx 102 files / 207–208 KB**
(the Phoenix project carries the whole backend too). HEEx also costs ~83 s per
build vs 7–12 s for everything else.

---

## T3 — pack × framework

The shadcn family spans three frameworks in-tree, and T2 already measured all
three on the same model:

| shadcn family member | framework | reduced-probe verdict |
|---|---|---|
| `shadcn@v3` / `shadcn@v4` | react | ✅ ✅ (and they render identically) |
| `shadcnVue@v1` | vue | ❌ F-013 |
| `shadcnSvelte@v1` | svelte | ❌ F-003 (frontend) |

**The family name does not travel.** A team standardising on "shadcn" gets a
working React app, a Vue app whose bundle fails on a missing asset, and a Svelte
app that does not type-check. The HEEx pair (`coreComponents` / `daisyui`) is the
other cross-framework family and both fail identically on F-009/F-015.

**React pack against a non-default backend:** covered by the T1 hash evidence
above — the react frontend tree is byte-identical across all five backends except
the vite proxy port. The pack layer is orthogonal to the backend, as claimed.

---

## T4 — swaps and mixes

Every cell starts from a T1/T2 cell and changes exactly one thing. Model:
`probe-domain-t4.ddd` (= `probe-domain.ddd` minus the one `find` that triggers
F-002, so the axis under test is readable).

| cell | change | verdict | evidence |
|---|---|---|---|
| **pack swap** shadcn → mui | `design:` only | ✅ | backend half **byte-identical**; 20 `web_app` files differ, all pack-owned: `pages/*`, `App.tsx`, `main.tsx`, `theme.ts`, `lib/format.tsx`, `locales/en.json`, `package.json`, `tsconfig.json` (`@/*` alias), `vite.config.ts` (tailwind plugin). Nothing unrelated moved. |
| **frontend swap** on fixed backend | `platform:` only | ✅ | T1 hash evidence — backend tree unchanged |
| **one backend, two frontends** | + a `svelte` deployable | ✅ | 143 files; compose = `db` + `api` + `web_app` + `web_app2` (:3002), both proxying the same api |
| **two backends, one system** | + a `java` deployable | ✅ | 156 files; compose = `db` + `api` (Hono :3000) + `api2` (Spring Boot :8081, own jdbc db) + `web_app` |
| **host dispatch** | `platform: react` host, `framework: vue` ui | ✅ | the host really dispatched: `web_app/src` is `App.vue` + `router.ts`; deps are `vue`, `vue-router`, `@tanstack/vue-query`, `vuetify` — no react in the bundle |
| **adapter** node `persistence: mikroorm` | | ✅ | `tsc --noEmit` clean |
| **adapter** node `directoryLayout: byFeature` | | ✅ | `tsc --noEmit` clean |
| **adapter** dotnet `persistence: dapper` | | ✅ | `dotnet build /warnaserror` clean |
| **adapter** dotnet `directoryLayout: byFeature` | | ✅ | `dotnet build /warnaserror` clean |
| **adapter** java `directoryLayout: byFeature` | | ✅ | `gradle testClasses bootJar` clean |
| **adapter** python `persistence: sqlalchemy` | | 🟡 honest | `'persistence: sqlalchemy' on deployable 'api' is not available on platform 'python'. Platform 'python' exposes no 'persistence:' choices` — correct, and says so |
| **k8s** `--k8s` helm lint | | ✅ | `helm lint` clean |
| **k8s** `--k8s` helm template | | ✅ | renders |
| **k8s** raw manifests | | ✅ | 12 YAML docs parse (`kubeconform` unavailable here — see caveats) |

**The adapter axis is the healthiest part of the product: 5 for 5.** The full
selectable menu is node `{drizzle, mikroorm} × {byLayer, byFeature}`, dotnet
`{efcore, dapper} × {byLayer, byFeature}`, java `{jpa} × {byLayer, byFeature}`,
elixir `{ecto} × {byFeature}` (single-valued), python none. Every non-default
combination I could select compiled clean.

**Broker axis:** not exercised — the probe model declares no `channel`, and adding
one would have broken model constancy.

---

## T5 — runtime and visual

### Runtime: all five backends, sampled at one round-trip each

Postgres 18 in a container; migrations applied against an **empty** database;
then create → read → guarded operation → the same operation without the permission
→ workflow.

| backend | migrate | POST | GET | op (allowed) | op (denied) | workflow | verdict |
|---|---|---|---|---|---|---|---|
| **node@v5** (Hono) | ✅ 2 chains, per-context schemas | ✅ 201 | ✅ 200 | ✅ 204 | ✅ **403** | ✅ 204 + event emitted | ✅ |
| **dotnet@v10** | ✅ | ✅ 201 | ✅ 200 | ✅ 204 | ✅ **403** | ✅ 204 | ✅ |
| **java@v1** | ✅ | ✅ 201 | ✅ 200 | ✅ 204 | ✅ **403** | ✅ 204 | ✅ |
| **python@v1** | ✅ applied 2 | ✅ 201 | ✅ 200 | ✅ 204 | ✅ **403** | ✅ 204 | ✅ |
| **elixir@v1** | ✅ | ✅ 201 | ❌ **500** | ✅ 204 | ✅ **403** | ⚠️ 202 + body | ⚠️ F-029, F-030 |

The `403` body is identical on all five and names the exact predicate:
`Forbidden: currentUser.permissions.contains(permissions.productsWrite)`. The
authorization layer is real and it works — which makes F-005 (elixir cannot even
*compile* the row-filter half of the same feature) the sharper disappointment.

The four passing backends return **the same wire shape** for the same aggregate,
including derived fields, the `money` string, the `null` optional, the `string[]`,
and the paged envelope. The only divergence is number formatting (`"footprint":2`
on node/dotnet vs `2.0` on python/java) which is JSON-equivalent. Elixir diverges
structurally on workflows (F-030) and sorts object keys alphabetically.

**Elixir needed the model changed to get this far** — `probe-domain.ddd` does not
compile on Phoenix (F-005), so the elixir runtime cell ran the model minus the
`currentUser` find. Stated so the number is not read as more than it is.

### Visual: 9 packs × 7 pages × 3 widths + desktop-dark = **252 screenshots**

`sweep/shots/<pack>/`, each with a `report.json` recording per-page console errors,
failed network calls, DOM node count, heading count, focusable count and horizontal
overflow. **Sampled, not exhaustive:** I screenshotted the 9 packs that build
(shadcn v3/v4, chakra v2/v3, mui v5/v7, vuetify v3, angularMaterial v1, spartanNg v1)
— 7 pages × {desktop 1440, tablet 834, phone 390} + desktop-dark = 28 each — and I
*looked at* ~14 of the 252 in detail; the rest are covered by the structural probe,
which is what caught mui@v5 (4 DOM nodes is not something you spot by eye in a
thumbnail grid).

| pack | shots | blank pages | median DOM nodes | focusables | h-overflow | console errors | failed calls | visually distinct? |
|---|---|---|---|---|---|---|---|---|
| shadcn-v3 | 28 | 0 | 54 | 18 | 0 | 0 | highlight.js CDN only | yes — black/neutral, boxed cards |
| shadcn-v4 | 28 | 0 | 54 | 18 | 0 | 0 | highlight.js CDN only | yes — v3/v4 render identically |
| chakra-v2 | 28 | 0 | 72 | 18 | 0 | 0 | highlight.js CDN only | yes — blue app bar |
| chakra-v3 | 28 | 0 | 65 | 18 | 0 | 0 | highlight.js CDN only | yes |
| **mui-v5** | 28 | **28** | **4** | **0** | 0 | **28** (React #130) | highlight.js CDN only | **n/a — blank (F-031)** |
| mui-v7 | 28 | 0 | 129 | 27 | **4** (F-016) | 0 | highlight.js CDN only | yes — densest DOM |
| vuetify-v3 | 28 | 0 | 103 | 21 | 0 | 0 | **none** | yes — v-img/v-btn idiom |
| angularMaterial-v1 | 28 | 0 | 99 | 20 | 0 | 0 | **none** | yes — mat-* chrome |
| spartanNg-v1 | 28 | 0 | 52 | 20 | **3** (F-019) | 0 | **none** | yes — leanest DOM |

Plus one diagnostic set, `sweep/shots/mui-v5-nochart/` — the mui@v5 bisect (a
two-primitive page, same blank result, which is how F-031 was localised to the
shell rather than the `Chart`).

Checked per the brief:

- **Raw/unstyled fallback where a component was expected** — yes, twice, both
  cross-pack: an unsized `Icon` (F-016, 10 of 15 packs emit a class whose CSS only
  5 define — a 16 px icon renders ~900 px tall) and a `Button` whose declared
  `variant` is silently downgraded to borderless text (F-018).
- **Overlap / overflow / clipping** — MUI overflows horizontally on the Display
  page at all three widths (the giant icon); spartanNg overflows at phone width
  because its sidebar never collapses (F-019). No clipping elsewhere.
- **A primitive that renders as nothing** — no *primitive* did, on any pack that
  rendered at all. One whole *pack* renders as nothing (mui@v5, F-031).
  All 58 primitives produced markup on the other eight. (Angular *does* drop component children, but
  **honestly** — the emitted HTML carries an explaining comment, F-020.)
- **Console errors and failed network calls** — zero console errors of Loom's
  making. The only failed requests in all 196 shots are the two `highlight.js`
  CDN assets `CodeBlock` fetches at runtime (F-024), blocked by this sandbox's
  egress. Vuetify and both Angular packs made no external request at all. The
  28 console errors on mui@v5 are F-031, not a network problem.
- **Form validation surfacing invariants** — yes. The `Inputs` page renders all
  seven input primitives, and the `match` arm reflecting `pw.length >= 8` updates
  correctly ("password too short" at phone width, `sweep/shots/shadcn-v4/inputs-phone.png`).
  The backend-side twin is also real: a wrong-typed field comes back as
  `422` with `{"pointer":"/weight","message":"Invalid input: expected number, received string"}`.
- **Keyboard focus / visible focus rings** — partially. Every pack emits a
  "Skip to content" link as the first focusable and 18–27 focusable elements per
  page, consistently. I did **not** tab through them or assert ring visibility.
- **Visually distinct packs** — yes, all eight that render are clearly different
  designs
  (chrome colour, badge treatment, card borders, DOM density varying 52→129 nodes
  for the same page). The one exception is *within* a family: `shadcn@v3` and
  `shadcn@v4` render byte-for-byte identically (54 nodes, 204 chars, same
  screenshots) — two pack versions doing the same job, which is expected for a
  stack bump, not a design change. No two *families* render alike. The pack layer
  is doing real work.

---

## Per-axis rollup

### Backends

| backend | verdict | evidence |
|---|---|---|
| **dotnet@v10** | **production-ready** | full probe `dotnet build /warnaserror` clean; full runtime round-trip; both adapter axes (`dapper`, `byFeature`) clean |
| **java@v1** | **production-ready** | `gradle testClasses bootJar` clean; full runtime round-trip; `byFeature` clean. Cost: 60 s per compile |
| **python@v1** | **production-ready** | `ruff` + `mypy --strict` clean; full runtime round-trip. No adapter menu (and says so) |
| **node@v5 / v4** | **near-ready, one sharp edge** | fastest by far; full runtime round-trip; both adapters clean — but a `decimal` comparison in a `find` does not compile (F-002), with no diagnostic |
| **elixir@v1** | **demo-grade** | cannot compile a documented `currentUser` row filter (F-005); with that removed it boots, but **every read of a decimal-derived aggregate 500s** (F-029) and workflows answer a different contract (F-030). Slowest compile (72 s) |

### Frontends

| frontend | verdict | evidence |
|---|---|---|
| **react** | **production-ready** | only frontend to compile the full 58-primitive probe unmodified; 6 of 8 packs bundle; visually complete |
| **vue** | **near-ready** | `vue-tsc` clean on the domain probe; needs F-009/F-010 fixed for the UI probe; vuetify bundles clean |
| **feliz** | **works, narrow** | `dotnet fable` + `vite build` clean on the domain probe; **honestly** refuses components that dispatch operations (F-021) |
| **svelte** | **demo-grade** | one construct (`money` workflow param, F-003) breaks both packs; plus F-011 |
| **angular** | **demo-grade** | a `string[]` field (F-004) and a documented `error:` shape (F-012) both break the build; component children honestly dropped (F-020) |
| **flutter** | **demo-grade** | a single custom repository `find` breaks the build (F-006); honest refusals elsewhere (F-009) |
| **elixir/HEEx** | **demo-grade** | neither pack compiles the probe (F-009, F-015) |

### Packs

| verdict | packs |
|---|---|
| **pack layer sound** (12 versions) | chakra v2/v3, mui v7, shadcn v3/v4, vuetify v3, flowbite v1, shadcnSvelte v1, angularMaterial v1, spartanNg v1, coreComponents v3, daisyui v1 — each as good as its framework allows |
| **pack-local defect** (5 versions) | **mui v5** (F-031 — compiles green, renders a blank app), **mantine v7 + v9** (F-008 — and mantine is the CLI default), **shadcnVue v1** (F-013), **primeng v1** (F-014) |
| **cross-pack visual debt** | F-016 (icon CSS missing in 10 of 15), F-017 (badges full-width everywhere), F-018 (silent variant fallback) |

---

## Reproducing this

```bash
npm install && npx tsc -b          # MANDATORY — see F-000
dockerd >/tmp/dockerd.log 2>&1 &

node sweep/gen-t1.mjs              # 36 T1 cells + tree hashes  → sweep/t1-gen.json
node sweep/t1-cells.mjs            # derive the 36 cell verdicts → results.jsonl
node sweep/gen-t2.mjs              # 17 pack cells (full probe)
node sweep/gen-t2r.mjs             # 17 pack cells (reduced probe)
node sweep/compile.mjs <id> <cwd> <tier> <axesJSON> -- <cmd…>   # one compile cell
node sweep/shots.mjs <pack> <dist> <port>                       # 28 screenshots
node sweep/coverage.mjs <model.ddd>                             # primitive coverage
node sweep/shot-summary.mjs                                     # visual rollup
```

`sweep/compile.mjs` skips a cell already in `results.jsonl`; set `REDO=1` to force.

**Files:** `sweep/MATRIX.md` (this) · `sweep/FINDINGS.md` (F-000…F-030) ·
`sweep/results.jsonl` (100 rows) · `sweep/repro/` (8 minimal `.ddd`, all parse
clean) · `sweep/shots/` (196 PNGs + 7 `report.json`) · `sweep/models/`
(`probe-domain.ddd`, `probe-domain-t4.ddd`, `probe-ui.ddd`) · `sweep/out/`
(every generated tree, gitignored).

**Toolchains used:** host node 22.22.2, JDK 21 + Gradle 8.14 (unused — too old),
`uv` + python 3.11. Containers: `mcr.microsoft.com/dotnet/sdk:10.0` (.NET),
`mcr.microsoft.com/dotnet/sdk:8.0` + host node bind-mounted (Feliz/Fable),
`gradle:9-jdk25` (Java — the host JDK **cannot** build the generated Java 25
toolchain), `hexpm/elixir:1.18.4-erlang-27.3.4` (Phoenix; `HEX_CACERTS_PATH`
pointed at the proxy CA was enough, the hex-mirror workaround was not needed),
`ghcr.io/cirruslabs/flutter:stable` (Flutter), `node:24-bookworm` (Angular — the
host node is 0.0.1 below the CLI minimum), `postgres:18-alpine`, `alpine/helm`.

**No toolchain code was changed and no PR was opened**, per the brief.
