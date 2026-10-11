# Wave C3F — packet F7: frontend server-error mapping + Flutter/Feliz

Branch `claude/c3f-f7` off `main` @ `e389606bb`.  Re-run after a container loss;
every item re-verified on that base before building.  Open PRs read first:
#3090 (Feliz/Flutter If-Match + Action `then:`) is merged and was built on;
#3182 (frontend action vocabulary) touches `feliz/{index,wire,update-emit}.ts`
in different functions (toast arm, find params) — no overlap with the Api-fn /
Model / navbar edits here, expect a textual merge only; #3105 (L1-F) touches
none of these files.

## Outcomes

| item | outcome | where |
|---|---|---|
| **D-ACL-1** (vue) | fixed — `applyServerError` reads the thrown `ApiError`'s `.body` and walks the RFC 7807 `errors[]` ARRAY: a pointer names the field's dot-path, a pointer-less entry is `__global` | `vue/loom-form.hbs` |
| **D-ACL-2** (svelte) | fixed — `applyServerErrors` walks the array the same way; a pointer-less entry returns `global` (the caller toasts it) | `src/generator/svelte/emit-templates.ts` |
| **D-ACL-3** (angular) | fixed — new `src/lib/server-errors.ts` (`applyServerErrors` / `placeServerErrors`): each entry → `control.setErrors({ server })` + `markAsTouched()`; what no control can take is rethrown to `LoomErrorHandler`.  Create / operation / workflow / modal submits catch into it; every form field renders `errors?.['server']` in its message slot (falling back to the client constraint's sentence) | `src/generator/angular/{server-errors,index,form-fields}.ts`, `angular/walker/page-shell.ts` |
| **D-ACL-4** (feliz) | fixed — create / op / workflow Api fns return `Result<_, ServerErrors>` decoded from the ProblemDetails (`ServerErrors.ofResponse`); the Model keeps `<Form>Server`; each field renders `View.serverError`, the rest `View.serverFormError` above the submit (a pointer naming no rendered field goes there too) | `src/generator/feliz/{wire,update-emit,feliz-target,index}.ts` |
| **D-ACL-5** (flutter) | fixed — `ServerErrors` class in `lib/forms.dart`; a rejection is decoded, kept on the form, rendered under each field, the rest in the existing banner.  `'Request failed (<status>)'` survives only as the fallback for a body with no problem message (HTML 502); it is still untranslated — Flutter forms have no i18n chrome yet (F6's area).  `DestroyForm` now shows the problem's own `detail` | `src/generator/flutter/forms-emit.ts` |
| **D-3b-1** money scale | fixed — `moneySchema` has one owner, `_frontend/money-schema.ts` (React / Vue / Svelte emit it); a parsed wire value renders (`toString`/`toJSON`) at the wire string's scale.  Contract `vue` cell and the Vue fixture flipped to `"98.7600"`.  Flutter still renders `98.76` via `NumberFormat.decimalPattern()` — out of this item's scope, its contract cell unchanged | `src/generator/_frontend/money-schema.ts`, `test/behavioral/numeric-ui-contract.mjs` |
| **D-3b-2** Flutter Action 415 | fixed — the one-click POST sends `{}` as `application/json`; the auth-UI leg's `KNOWN_DEFECTS` row deleted (register now empty) | `src/generator/flutter/flutter-target.ts`, `test/behavioral/run-ui-auth.mjs` |
| **D-3b-3 + D-I18N-9** explicit menu | fixed — Flutter: `lib/nav_menu.dart` (`LoomNavMenu`) mounted as every page's `AppBar(bottom:)`; Feliz: the navbar renders the explicit menu instead of the page list.  Both read the shared `deriveSidebarFromUi` (sections, labels, catalog keys), translate authored labels (`t(…)` / `I18n.t …`), gate a link to a `requires` page on the page's own claims guard; an external link opens in a new tab (Feliz) or shows its URL as a tooltip (Flutter — no URL launcher dependency).  `D-I18N-9` waiver deleted; the auth-UI leg's menu-gate probes now run on Flutter too | `src/generator/flutter/menu-emit.ts`, `flutter/index.ts`, `feliz/index.ts` |

Waivers / registers drained: ACL `WAIVERS` 5 → 0; auth-UI `KNOWN_DEFECTS` 1 → 0;
i18n `DEAD_KEY_WAIVERS` loses `D-I18N-9`.

## Mutation proofs (file-copy revert, md5-verified restore)

- ACL vue: `body` read off the error instead of `.body` → `vue: … expected { __global: 'Validation failed' }` (the D-ACL-1 shape).  svelte: array branch disabled → `svelte: … expected {}` (D-ACL-2).
- ACL angular: mapper never finds a control → `angular: the 422 did not land … { __global }`; submit catch rethrows instead of mapping → `the CreateForm submit must hand a rejection to the mapper`.
- ACL feliz: create fn back to a status-only error → `the create fn must decode a rejection, not drop its body`.  flutter: submit builds a status-only `ServerErrors` → `the submit must decode a rejection, not print its status`.
- Money: `keepScale` removed → `money-schema-runtime` `expected '98.76' to be '98.7600'` (react + svelte templates); **runtime**: the same mutation rebuilt into `out/` takes `run-ui.mjs sales-system-vue` red on BOTH the detail spec (`Received: "98.76"`) and the numeric list probe (10 passed, 2 failed); fixed: 12/12.
- Flutter Action: body/headers removed → `action.test.ts` fails on the POST pin.
- Menu: Flutter `renderFlutterNavMenu` returning "" and Feliz passing no menu → `i18n-round-trip` `feliz (explicit)` / `flutter (explicit)` fail with 3 dead keys each; gate dropped → `explicit-menu.test.ts` fails on both gated-link pins.

## Runtime / toolchain evidence (this container)

- `run-ui.mjs sales-system-vue`: 12 passed, 0 failed (money `98.7600` on detail + list).
- `run-ui-auth.mjs feliz` (host dotnet 10 + Fable 4.29): **10 passed, 0 failed** incl. both menu-gate probes on the explicit menu.
- `run-ui-auth.mjs flutter` (Flutter 3.x via the `ghcr.io/cirruslabs/flutter:stable` docker shim, `docs/tools.md`): **10 passed, 0 failed** — up from 7/7 + 1 known defect: the Approve click now reaches the backend and approves (D-3b-2), and both menu-gate probes run and pass on Flutter (D-3b-3; links read off the semantics tree's `role=link` nodes).
- Feliz decoder executed: the GENERATED `ServerErrors` module Fable-compiled and run on the absent-optional golden 422 → `fields=[estimate, Estimate cannot be negative]`; nested pointer → `price.amount`; pointer-less → form-level; 409 → its `detail`; HTML 502 → `HTTP 502`.
- Flutter decoder executed: the GENERATED `ServerErrors` class under `dart run` (`dart:stable` image) → same mapping; a pointer naming no rendered field falls to the form-level message.
- Compile gates: Angular `ng build` (`generated-angular-build` `showcase` × primeng and × angularMaterial, node 24) green; scaffolded Feliz app (`create` + VO-row update + param-less op) `dotnet fable` green; scaffolded Flutter app `flutter analyze` (0 errors / 0 warnings) + `flutter build web` green; the auth fixture's Flutter app with `nav_menu.dart` `flutter analyze` clean.
- Not run here (CI confirms): `generated-vue-build` / `generated-svelte-build` / `generated-react-build` compile of the money/ACL runtime text (both are type-safe ES2022 TS; the Vue leg above built the Vue app with them).

## Fence crossings

- `test/generator/_walker/i18n-round-trip.test.ts` (F6's tree): deletion of the `D-I18N-9` waiver block only.
- `src/generator/angular/walker/page-shell.ts` (a per-frontend walker shell): the four form submit bodies + one import line.
- `src/generator/_frontend/money-schema.ts` (new) and the `REACT_LIB_SCHEMAS_MONEY_TS` / `SVELTE_LIB_SCHEMAS_MONEY` constants now re-export it.

## Gates

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | OK |
| `npx biome ci .` | clean |
| `server-error-acl-parity`, `money-schema-runtime`, `explicit-menu`, `i18n-round-trip`, `numeric-ui-legs`, `auth-ui-leg` | green |
| `test/generator/{feliz,flutter}` | 902/902 |
| `test/generator/{react,vue,svelte,angular,_frontend,_walker}` | 2590/2595 in the shared run; the 5 reds were 40–120 s timeouts under load (`walker-declines-with-a-code`, `react/data-grid`, `react/frontend-acl-emit`) and pass re-run alone |
| `test/system test/ir` (`--maxWorkers=2`) | re-run clean: **7315 passed, 31 skipped, 0 failed, exit 0** (a first run lost two files to `Worker exited unexpectedly` under shared-box memory pressure, 0 failures) |
| `mission-counts --check` | up to date |
