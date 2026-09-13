# Wave C1 hand-off — packet 1e-ii (ledger P1 silent rows on Flutter)

*Branch: `claude/c1-1e-ledger-flutter`, cut from `origin/main` (NOT the wave
head — see "For the coordinator" below). Commits: `39de695e1`, `499c766f7`,
`e617ce951`.*

Scope: the two ledger rows the packet named — `F2-CFE-1` (`navigate(<Page>)` in
a Flutter page `action` is dropped) and `flutter-form-field-drops` (the four
`KNOWN_FLUTTER_GAPS` pins). Both **closed**, both mutation-proved, both moved
`open` → `done` in the ledger.

---

## Fixed

| row | what was wrong (verified on THIS tree first) | what it emits now |
|---|---|---|
| `F2-CFE-1` | `node bin/cli.js generate system nav.ddd` → `app/lib/pages/home_page.dart` line 22: `// TODO(flutter full-parity): 'private-operation' call 'navigate' in a Notifier method`. `ddd parse` = 0 errors 0 warnings. The button compiled and did nothing. Reproduced before any edit. | `navigateTo('/somewhere-else');` in the Notifier method, `import '../nav.dart';` on the page, `navigatorKey: appNavigatorKey,` on `MaterialApp`, and a new `lib/nav.dart` holding the `GlobalKey<NavigatorState>` + `navigateTo`. |
| `F2-CFE-1` (second defect, found while fixing it) | Flutter passed `new Map() // pageRoutes` into `walkBody`, so even a working navigate resolved the shared resolver's `/<page-snake>` FALLBACK, not the destination's declared `route:`. Latent on the page-body `navigate` path too. | `pageRoutes` is built once in `emitProject` by the SAME rule the router uses (`page.route ?? '/' + pageFileBase(...)`) and threaded into the body walk, the page Notifier and store actions. |
| `flutter-form-field-drops` #1 nested-VO sub-field | `addr.geo` dropped: `// TODO(flutter form-field): addr.geo — nested value-object sub-field dropped (deferred, M-B)`. `prepareFields` flattened one level. | Recursive flatten: `_addrGeoLatController` / `_addrGeoLngController`, label `'addr geo lat'`, and the body re-nests `{'addr': {'line': …, 'geo': {'lat': …, 'lng': …}}}`. `objectKey?: string` → `objectPath?: readonly string[]`; `bodyAssembly` builds a tree. |
| `flutter-form-field-drops` #2 VO array w/ non-scalar sub-field | `lines` dropped whole because one sub-field was a bool; row state was `List<List<TextEditingController>>`. | `List<List<dynamic>>`: text/number cells keep a controller in the slot, bool / enum / datetime cells hold the value and render `Checkbox` / `DropdownButtonFormField` / `showDatePicker`. Only nested-VO / array / File / fk-id sub-fields still defer (loudly). |
| `flutter-form-field-drops` #3 bool element array | `flags: bool[]` dropped. | New `bool-array` kind: `final List<bool> _flagsValues = []` + a repeatable checkbox row editor. |
| `flutter-form-field-drops` #4 enum element array | `colors: Color[]` dropped. | New `enum-array` kind: `final List<String> _colorsValues = []` + a repeatable dropdown row editor; a new row seeds the first declared value so the list never carries a null. |

**Wire shape unchanged, and checked from OUTSIDE the emitter (rule 12).** The
expected JSON comes from the Hono backend generated in the same tree, not from
the Flutter emitter: `AddrSchema` with `geo: GeoSchema`, `flags:
z.array(z.boolean())`, `colors: z.array(ColorSchema)`, `LineItemSchema` with
`active: z.boolean()`.

### One new refusal, minted rather than emitting broken Dart

`navigate(<Page>)` where the destination's route carries a `:param` the call
supplies no value for (`/products/:id`) interpolates to `'/products/${id}'` —
and a Notifier method has no route args in scope, so that is Dart that does not
compile: strictly worse than the drop this arm replaced. It is now **refused**
with `loom.flutter-action-statement-unsupported#navigate-route-param`.

That code also absorbs the other two bare `TODO(flutter full-parity)` comments
at the same site (`#private-operation`, `#kind`) and the `match await`
unresolvable-subject one (`#match-await`). All four now route through
`giveUp()` so they carry the shared `loom:unrendered` sentinel the
cross-frontend degradation matrix scans for, with wording from
`src/diagnostics/messages.ts`.

> **Overlap note for the coordinator.** Packet **1d** lists "the three riverpod
> `TODO(flutter full-parity)` arms" in its own scope. My packet brief told me to
> route any statement still commented out at that site through a `loom.*` code,
> so I did — the arms are a two-line change each on top of the navigate fix. If
> 1d also touched them, take 1d's version and keep mine only if it has the
> `#navigate-route-param` arm, which is specific to this row.

---

## Gated (new tests, with counts)

| file | tests | what it pins |
|---|---|---|
| `test/generator/flutter/action-navigate.test.ts` (new) | 5 | the rendered `navigateTo(<real route>)`; `lib/nav.dart` emitted + a SWEEP that every emitted `.dart` calling `navigateTo(` imports it (rule 11); the `MaterialApp` key; byte-identical output for an app that never navigates; the `:param` refusal, coded and bracket-balanced |
| `test/generator/flutter/nested-vo-field.test.ts` (new) | 4 | one controller per leaf + dispose; the re-nested body with `'line'` inside `'addr'`; bracket balance; the nesting read off the BACKEND's zod schema |
| `test/generator/flutter/bool-enum-array.test.ts` (new) | 7 | the two element-array editors and their submit expressions; the heterogeneous VO-array row (`row[2] as bool`, `row[3] as String?`, `row[4] as DateTime?`); dispose touches controller slots only; bracket balance; element shapes read off the backend |
| `test/generator/flutter/_dart-balance.ts` (new helper, not a suite) | — | `dartBracketImbalance(src)` — a bracket sweep over emitted Dart, the cheapest stand-in for `flutter analyze` in a unit test. It is not decoration: it caught a REAL off-by-one closing paren in the datetime row cell during this packet, which every substring assertion passed over. |
| `test/generator/flutter/parity-freeze.test.ts` (rewritten) | 4 | `KNOWN_FLUTTER_GAPS` is now `{}`, so ANY marker the fixture provokes fails; plus a **vacuity test** that the fixture still emits all four shapes (`_addrGeoLatController`, `List<List<dynamic>> _linesRows`, `List<bool> _flagsValues`, `List<String> _colorsValues`) — without it, "no findings" would also be the answer for an empty `forms.dart` |
| `test/generator/_walker/navigate-action-body.test.ts` (updated) | 9 (1 rewritten) | its flutter arm was a pin reading *"Pinned so the day it is fixed, this test says so."* Today is that day — rewritten from the TODO assertion to the rendered `navigateTo('/elsewhere');` + the `nav.dart` import |
| `test/generator/flutter/{forms,object-array}.test.ts` (updated) | 5 | re-pinned to the new shapes (`objectPath`, `List<List<dynamic>>`, the `as TextEditingController` casts) |

Suite runs on the final tree:

| command | result |
|---|---|
| `npx vitest run test/generator/flutter/` | **63 files / 489 tests passed** (with the two walker/system files below) |
| `npx vitest run test/system/ test/conformance/` | **135 files / 5054 tests, 1 failed → fixed, then green** (the failure was `diagnostic-firing-census.test.ts` demanding a bucket for the new code — pinned in `UNREACHABLE_PINS` with the same structural reason `loom.query-emission-invalid` carries: a phase-⑧ give-up cannot be observed by a census that drives `validate()`) |
| `npx vitest run test/generator/_frontend/ test/generator/react/` | 111 files / 1002 passed, 1 expected-fail |
| `npx vitest run test/system/{ledger-counts,gate-ledger}.test.ts` | 15 passed |
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | `182 files, 470 errors, src/ clean` — unchanged, ratchet OK |
| `npx biome ci .` | exit 0 |
| `node scripts/ledger-counts.mjs --check` | `.md matches the JSON` |
| `node docs/build.mjs` | exit 0 |

---

## Mutation proofs (file-copy revert throughout, never `git checkout --`)

| # | mutation | failures | the assertion that named it |
|---|---|---|---|
| 1 | drop the navigate arm in `renderNotifierStmt` (`const nav = undefined`) | 5 | `expected '…' to contain "navigateTo('/somewhere-else');"`; `no lib/nav.dart: expected undefined to be defined`; `expected "import 'dart:async';…" to contain "import 'nav.dart';"` |
| 2 | `const pageRoutes = new Map<string, string>()` (stop threading the route table) | 3 | `expected '…' to contain "navigateTo('/elsewhere');"` — i.e. the resolver fell back to `/other`, exactly the latent bug |
| 3 | restore the one-level VO flatten (drop nested VO sub-fields again) | 4 | `expected '// Form widgets …' to contain "_addrGeoLatController"`; `expected [ Array(1) ] to deeply equal []` (the freeze) |
| 4 | narrow object-array cells back to text/number | 5 | `expected '…' to contain "final List<List<dynamic>> _linesRows = [];"`; `expected '…' not to contain "TODO(flutter form-field)"` |
| 5 | defer bool/enum element arrays again | 5 | `expected '…' to contain "final List<bool> _flagsValues = [];"`; freeze `expected [ …(2) ] to deeply equal []` |
| 6 | re-introduce the real off-by-one closing paren (proves the new bracket gate) | 1 | `expected "'[' opened at line 74 is closed by ')'…" to be undefined` |

---

## Flipped

- Ledger `open` → `done`: **`F2-CFE-1`**, **`flutter-form-field-drops`**. Open
  rows 153 → 151, P1 7 → 5, silent 20 → 18 (recomputed by
  `scripts/ledger-counts.mjs --write`; see the caveat below).
- `docs/audits/targets-completeness-2026-08-30.md` § Conflicts —
  `flutter-form-field-drops: HONEST vs SILENT` gains a **CLOSED** line recording
  that the interim `loom.flutter-form-field-unsupported` step the
  fresh-gate-probe recipe proposed was **deliberately skipped**: all four shapes
  render, so minting a refusal code and deleting it in the same wave buys
  nothing.

---

## Handed off / not done

| item | why | what I'd do |
|---|---|---|
| **`flutter analyze` not run locally** | The recipe in `docs/tools.md` needs `ghcr.io/cirruslabs/flutter:stable`, which is not in the local image cache, and this box's `dockerd` holds a STALE proxy port (it dials `127.0.0.1:44471`; the session's `HTTPS_PROXY` is `:38077`), so the pull fails with `proxyconnect … connection refused`. Restarting `dockerd` would fix it but would kill the `loom-st-pg` postgres container another wave agent is running, so I left it. | The compile proof for this packet is therefore the emitted-Dart assertions + `dartBracketImbalance` + the existing `generated-flutter-build` CI gate, which is binding per-PR. **Worth someone re-running `bash <recipe>` once the daemon is restarted** — the new Dart is substantial (three new row editors, a heterogeneous row list, a new runtime file). Add `docs/tools.md`'s recipe to the coordinator's pre-flip list. |
| **Corpus fixture: deliberately NOT added.** | `test/fixtures/corpus/` is a BACKEND matrix — `manifest.ts` rows are `{feature, backends: Backend[]}` over `.ddd` files carrying `platform: __PLATFORM__`, and **not one of the 60 corpus fixtures declares a `ui … framework:`** (verified: `grep -l "framework:" test/fixtures/corpus/*.ddd` returns nothing). A Flutter frontend fixture needs a `ui { framework: flutter }` + a flutter deployable, which the platform substitution cannot express. | Per the packet's own instruction ("a frontend fixture may belong under `test/generator/flutter/` instead, say which"): the four shapes' fixtures are the inline `.ddd` sources in `action-navigate.test.ts`, `nested-vo-field.test.ts` and `bool-enum-array.test.ts`, which is where every other flutter fixture in this repo lives. |
| **Cross-frontend: `navigate(<ParamPage>)` is broken everywhere, not just Flutter** | Out of my tree fence. React/Vue/Svelte/Angular resolve the route to the literal `/products/:id` and push it — it compiles and matches no route. Flutter now refuses it; the others navigate to nothing. | A validator refusal (`loom.navigate-to-parameterised-page-needs-path`) at phase ④/⑦ would close it for every frontend at once, and would let the Flutter emitter drop its `#navigate-route-param` arm. Repro: any ui with `page D { route: "/products/:id" }` and `action go() { navigate(D) }` — `ddd parse` is clean on all seven. Suggest routing to whichever C2 packet owns the frontend trees. |
| **`loom.flutter-action-statement-unsupported` has no docs anchor** | It is listed in `test/system/diagnostic-docs-undocumented.ts` alongside its siblings (`loom.flutter-async-effect-unsupported`, `loom.flutter-primitive-unsupported`), which is the established home for the flutter-gap codes. | If C7 drains that list, the natural anchor is `actions.md` § navigate. |

---

## For the coordinator — the ledger reconciliation

This worktree was cut from **`origin/main`**, not the wave head, so its ledger
is the PRE-C0 copy: its `F2-CFE-1` row still read *"broken on all 7 frontend
targets (feliz hard-crashes codegen)"*, with `targets: [react, vue, svelte,
angular, feliz, flutter, heex]`. Wave C0's retitle — flutter-only — is the
accurate one, and it is what this close acts on: I verified on this tree that
the other six already navigate (`test/generator/_walker/navigate-action-body.test.ts`
covers react/vue/svelte/angular/feliz/heex and was green before I touched
anything; only its flutter arm was a TODO pin). **Only the flutter arm
remained, and it is closed.**

Consequences at fold:

1. My `open`-bucket removal targets the row **by `id`**, so it applies cleanly
   to the C0-retitled row too.
2. The counts I wrote into the `.md` were computed from THIS tree's stale
   bucket (153 → 151). Re-run `node scripts/ledger-counts.mjs --write` on the
   folded tree; `--check` is in the local gate list.
3. The `done` rows I added carry the full closure evidence in their `title`
   (matching the bucket's existing minimal `{id, title, source}` shape); their
   `source` is `wave-c1-1e-ledger-flutter`.
