# Wave C3F · packet F6 — frontend i18n + primitive census

Branch `claude/c3f-f6`, cut from `main` @ `e389606bb` (re-fetched before the hand-off: `main` had not moved). Re-run after the first run's container was lost; every item re-verified on that `main` first (all thirteen still reproduced). Open PRs checked: **#3182** (frontend body vocabulary — touches `feliz/index.ts`, `feliz/update-emit.ts`, but none of these defects; merge is mechanical, different regions), **#3105** (L1-F frontends — `vue/walker/page-shell.ts`, `angular/*-module.ts`; no overlap with these items), **#3117** (HEEx — merged, already in the base).

## Item → outcome

| item | outcome | where |
|---|---|---|
| **D-I18N-1** scaffold sidebar labels catalogued, rendered raw | **fixed** on react ×4, vue ×2, svelte ×2, angular ×3, HEEx ×2 (both menu shapes); **narrowed** to feliz/flutter (derived menu) — see below | `_frontend/menu-emitter.ts` `adoptPageMenuMeta`: the caller's DEFAULT sections take the catalog keys of the pages they link (`page.List.menu.{label,section}.<hash>`), and a one-link-per-page default (angular, phoenix) groups an entry under its page's `menu { section }`; angular/HEEx default labels read the page's `menu { label }`. Extraction (`_walker/i18n-extract.ts`) no longer catalogues page `menu` metadata an explicit ui `menu { }` never reads (only a `link Page` with no `label:` reads the page's label). Shared reader: new `src/ir/util/page-menu.ts`. |
| **D-I18N-2** DestroyForm chrome raw | **fixed** on vue ×2, angular ×3, feliz, HEEx ×2; **narrowed** to flutter | vue `walker/destroy-form.ts`, angular `destroy-form.ts`, feliz `feliz-target.ts` (Feliz now also CONFIRMS before deleting, as every other frontend does), HEEx `heex-primitives.ts` (`String.replace(pgettext(…), "{entity}", …)` — no ICU runtime needed). Flutter's delete button lives in `forms.dart` (`flutter/forms-emit.ts`) — **F7's fence**. |
| **D-I18N-3** 404 raw on vue/angular | **fixed** | `vue/not-found-page.hbs` + `vue/index.ts`; angular `renderNotFoundComponent`. Angular now reads `chrome.backToHome` too, so the `O-backToHome` over-merge waiver lost its NG targets. |
| **D-I18N-4** root error view raw on feliz/flutter | **fixed** | `feliz/index.ts` (`shellChrome("rootErrorTitle")`), `flutter/index.ts` (`errorBoundarySetup(i18n)` + `import 'i18n.dart'`). |
| **D-I18N-5** angular bool Yes/No raw | **fixed** | root cause: `angular/index.ts` rendered `lib/format.ts` BEFORE `pack.setChromeI18n`, so the templates' existing `chromeValue` calls rendered OFF. Moved after. |
| **D-I18N-6** HEEx pager counter raw | **fixed** | new `{{{sharedChrome …}}}` HEEx-pack helper (`_packs/pack-chrome.ts`) reading the shared `chrome.prev/next/pageOf` keys, holes as runtime expressions; both HEEx packs' `core-components.heex.hbs`. Visible change: the pager's back button says "Prev" (the catalog's English, as on every other frontend's Table pager), not "Previous". |
| **D-I18N-7** feliz catalog carries mantine pack keys | **fixed** | `src/system/i18n-catalog.ts` `packChromeForUi` skips feliz/flutter deployables (they render no `.hbs` pack; Feliz's `design` defaults to `mantine` in lowering). **Fence crossing** (`src/system/`). |
| **D-I18N-8** feliz trigger-Modal title never rendered | **fixed** | `feliz-target.ts` `renderModal` heads the disclosure content with the `title:` (`localizedNamedValue`, role `modalTitle`). |
| **D-I18N-9** | F7's (not taken) | — |
| **D-I18N-10** HEEx explicit-menu section heading dropped | **fixed** | `elixir/sidebar-emit.ts`: a lone section's heading renders when it is AUTHORED (carries a key). |
| **D-CENSUS-1** row-scoped `Action { o.<op> }` unrendered everywhere | **fixed** on all 15 cells | shared `emitAction` (`_walker/primitives/controls.ts` `emitRowAction`): React hoists a per-row child component (`<Op><Agg>RowAction`, hook bound to the row id); Vue/Svelte read the id through the hook getter from a `{ current }` holder the click fills (`ActionMutationState.rowIdHolder`; React's `importOnly`); Angular `on<Op><Agg>Row(id)`; Feliz dispatches `(<row>.id)` + its collector (`feliz/wire.ts`) types Table/For row lambdas, and the done arm refetches the page's list reads of that aggregate (`feliz/update-emit.ts`); Flutter interpolates `${row.id}`; HEEx `listTypes`/`rowTypes` on the walk context → `phx-value-id={o.id}`. Two Feliz defects the compile leg surfaced on the way: the collector resolved a list `QueryView`'s aggregate only from a paged `…all(…)` call, so a `For` over a bare `<handle>.<Agg>.all` lost its `then:` arm (`RetireProductThen` undefined — new `listQueryAggregate`); and a one-click Action's `Api.<op><Agg>` collided with an `OperationForm` over the same op (Fable: *two module members with same name*) — the action's fn is now `<op><Agg>Action`. A `when`-gated op's per-record `can_<op>` probe is not wired on a ROW button (one probe cannot serve every row); the server still refuses. |
| **D-CENSUS-2** Avatar without `src:` drops `alt` | **fixed** | `hasAltLabel` VM flag (`_walker/primitives/text.ts`); vuetify/shadcnVue/angular ×3 templates, `feliz/pack.ts`, `flutter/pack.ts`, HEEx `renderAvatar`: the fallback element is `role="img"` + `aria-label`. |
| **D-CENSUS-3** HEEx component call drops children | **fixed** | `heex-walker-core.ts` `renderUserComponent`: positional overflow args render between the tags into `render_slot(@inner_block)`. |

**Registers.** `DEAD_KEY_WAIVERS`: D-I18N-3/4/5/6/7/8/10 deleted; D-I18N-1 narrowed to `feliz`,`flutter` × `derived`; D-I18N-2 narrowed to `flutter`; `O-backToHome` lost `...NG`; D-I18N-9 kept (F7). Census `GAPS`: all 26 rows deleted (the map is empty); the `Action` probe gained a witness.

**Residue, handed on.**
- **Feliz/Flutter derived nav** (the D-I18N-1 remainder): Feliz's navbar labels links by page NAME (`List`, `New`) and Flutter emits no navigation, so the scaffold pages' `menu` keys stay dead there. That is the menu-navigation rework F7 owns with D-I18N-9 — if F7 derives those navs through `deriveSidebarFromUi`, `adoptPageMenuMeta` keys them for free and the waiver row goes.
- **Workflow scaffold pages' `menu` keys** (not in the gate's fixture): the default React/Vue/Svelte sidebar labels `/workflows` "All workflows" while the scaffold's `WorkflowsIndex` page says `label: "Index"`, and the `…InstancesList` pages have no default entry — those keys stay unread. A label decision for M-T1.13 (scaffolded navigation), not a key bug.
- **Minted M-T1.42** (`T1-ui-frontend.md`): `auto-paged-table.ts`'s `markSortableColumns` makes an `o => Action { o.<op> }` column a server sort control on `"<op>"` (found on the census probe; macro fence).
- M-T1.39 (per-row operation DIALOG) is untouched: a parameterless row op now works; an op with params still has no row spelling.

## Mutation proofs (file-copy revert to the `e389606bb` version, gate run, copy back; tree clean after)

| reverted file | gate · cell | failing assertion (read) |
|---|---|---|
| `_frontend/menu-emitter.ts` | round-trip · mantine (derived) | `deadKeys: [page.List.menu.label.fc6u0m, …kdfstp, page.List.menu.section.m7tqsh]` |
| `_walker/i18n-extract.ts` | round-trip · vuetify (explicit) | `deadKeys` ×3 (the page `menu` keys an explicit menu never reads) |
| `angular/index.ts` | round-trip · angularMaterial (derived) | `deadKeys: [chrome.backToHome, chrome.notFound, pack.angularMaterial.boolFalse…, …boolTrue…, page.List.menu.label ×2]` |
| `elixir/sidebar-emit.ts` | round-trip · daisyui (explicit) / coreComponents ×2 | `deadKeys: [menu.section.cjxo6h]` (+ the derived labels) |
| `vue/walker/destroy-form.ts` | round-trip · vuetify (derived) | `deadKeys` (chrome.delete*) |
| `angular/destroy-form.ts` | round-trip · spartanNg (derived) | `deadKeys` (chrome.delete*) |
| `feliz/feliz-target.ts` | round-trip · feliz (derived) | `deadKeys: [chrome.deleteConfirm, chrome.deleteEntity, page.Detail.modalTitle ×2, page.ProductAdmin.modalTitle.yjd7gk]` |
| `elixir/heex-primitives.ts` | round-trip · daisyui (derived); census · heex/daisyui | `deadKeys` (chrome.delete*); `Avatar: content dropped: no "AvatarAlt"` |
| `vue/not-found-page.hbs` | round-trip · shadcnVue (derived) | `deadKeys` (chrome.notFound) |
| `feliz/index.ts` | round-trip · feliz (explicit) | `deadKeys` (chrome.rootErrorTitle) |
| `flutter/index.ts` | round-trip · flutter (derived) | `deadKeys` (chrome.rootErrorTitle) |
| `designs/{coreComponents,daisyui}/…/core-components.heex.hbs` | round-trip · coreComponents / daisyui (derived) | `deadKeys: [chrome.next, chrome.pageOf, chrome.prev]` |
| `src/system/i18n-catalog.ts` | round-trip · feliz (derived) | `deadKeys` (`pack.mantine.*`) |
| `_walker/primitives/controls.ts` | row-scoped-action · react/mantine, vue/vuetify, svelte/flowbite | `{ unrendered: true, table: ["<ActivateCustomerRowAction id={row.id} />"], for: […{o.id}…], wiring: [the child fn, "useActivateCustomer(id)"] }` |
| `angular/action.ts` · `feliz/feliz-target.ts` · `feliz/wire.ts` · `flutter/flutter-target.ts` | row-scoped-action · that cell | the cell's row-id assertion fails |
| `elixir/heex-walker-core.ts` | census · heex/daisyui | `Slot: content dropped: no "slotted"` + `Action: degraded: … loom:unrendered [loom.page-ref-unreach…` |
| `designs/vuetify/v3/primitive-avatar.hbs` · `designs/angularMaterial/v1/primitive-avatar.hbs` · `feliz/pack.ts` · `flutter/pack.ts` | census · that cell | `Avatar: content dropped: no "AvatarAlt"` |

## Compile evidence (the generated-*-build gates' own commands)

One fixture per cell (scaffold over two aggregates + a trigger Modal over an OperationForm + DestroyForm + Avatar without src + a Table-column row Action + a `For` row Action with `then: toast(…)`), generated from the branch head:

| cell | command(s) | result |
|---|---|---|
| react/mantine, react/shadcn | `npx tsc --noEmit`, `npx vite build` | pass |
| vue/vuetify, vue/shadcnVue | `npx vue-tsc --noEmit`, `npx vite build` | pass |
| svelte/flowbite, svelte/shadcnSvelte | `svelte-kit sync`, `svelte-check --fail-on-warnings`, `vite build` | pass |
| angular/angularMaterial, primeng, spartanNg | `npx ng build` (Node 24 — the CLI's floor) | pass |
| feliz | `npm run build` (`dotnet fable` 8.0 SDK + `vite build`) | **failed first** (the two Feliz defects above), pass after the fix |
| flutter | `flutter pub get` + `flutter analyze --no-fatal-warnings --no-fatal-infos` (`ghcr.io/cirruslabs/flutter:stable`) | pass — 0 errors, 0 warnings (24 lint infos, all pre-existing shapes) |
| heex/coreComponents, heex/daisyui | `generated-elixir-vanilla-build` (`mix compile --warnings-as-errors`, `LOOM_HEX_MIRROR=1`, fixture copied in for the run and removed) | pass |

Not run here: the React `mui`/`chakra` cells (same walker output as mantine/shadcn bar the pack templates, which this branch does not touch for React) and the behavioural UI legs — CI's `generated-*-build` matrices and `frontend-fullstack-e2e` confirm.

## Gates

- `npx tsc -b`, `node scripts/test-typecheck.mjs`, `npx biome ci .` — clean.
- `test/generator/_walker/{i18n-round-trip,primitive-census,row-scoped-action,walker-declines-with-a-code,page-emitter-equivalence}.test.ts` — 85/85.
- `test/generator/{vue,angular,feliz,flutter,elixir,_walker,_frontend,svelte,react,_packs}` + `test/macro` — 5640/5641 on the full run; the one failure (`_packs/menu-emitter.test.ts` "drops the default entry a page claims") was the intended re-grouping of a scaffold List entry under its page's `Aggregates` section — expectation updated, with its catalog keys now asserted. Tests updated for the new, keyed output: `react/generator-react` (sidebar), `svelte/flowbite-pack-shell`, `elixir/heex-destroyform`, `feliz/{mutation,error-boundary,action}`, `flutter/error-boundary`; baseline fixture `test/fixtures/baseline-output/web_app/src/App.tsx` re-captured (sidebar `t()` keys only).
- `npx vitest run test/system test/ir` — 7312 passed; three failures, all closed: `generator-throw-census` (the new `sharedChrome` throw — a manifest row in the `M-T9.83` custom-pack class), `target-string-funnel-census` (feliz-target's raw-splice baseline 5 → 4: the DestroyForm label is now funnelled — a fix lowers its row), and `e2e-fixture-validation` (elixir leg TIMED OUT at 120 s under the shared machine's load; green re-run with a longer timeout). Re-run of those three: 26/26.
- `NODE_USE_ENV_PROXY=1 node scripts/mission-counts.mjs --check` — clean after `--write` (M-T1.42).
- Not run: the full `npm test` (shared machine, per the brief).

## Fence crossings

- `src/system/i18n-catalog.ts` (D-I18N-7 — one skip line; the catalog builder is where the stray pack chrome was merged).
- `src/ir/util/page-menu.ts` (new, pure readers shared by the menu emitter and the extraction pass so the two cannot disagree on which page metadata a sidebar reads).
- `vue/not-found-page.hbs` (top-level Vue shell template).
- `_packs/pack-chrome.ts` (the `sharedChrome` HEEx helper) and `_frontend/menu-emitter.ts` — pack chrome / shared frontend, inside the packet's intent.
- `feliz/wire.ts` + `feliz/update-emit.ts` (the Feliz action collector + done-arm refetch) — not the Feliz HTTP helper F7 owns; `flutter/index.ts` main-dart error view only — `forms.dart` / menu navigation untouched.
- `docs/new-plan/T1-ui-frontend.md` (M-T1.42) + the README count block (`mission-counts.mjs --write`).
