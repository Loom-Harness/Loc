# Wave C2 packet 2j — flutter

*Branch `claude/c2-flutter`, base `11ed7b31f` (a merge of `fb8f86730`, the batch-2 coordinator head, which is `main` @ `9713ffa18` + the wave-log commit + packet 2g's shared-walker fold). Commits `96d298c29..f118a19fb` (seven, all SSH-signed). Tree fence: `src/generator/flutter/**`, `src/ir/util/flutter-persist-codec.ts`, the flutter half of `src/ir/util/realtime-rooms.ts`, the `messages.ts` / `unsupported-register.ts` rows a closed row required, `test/generator/flutter/**`, `test/platform/allowlist-ratchet.test.ts`, `.github/workflows/generated-{flutter-build,a11y}.yml`, plus the docs and ledger.*

**Local Flutter SDK found, and it changes what "proved" means for this tree.** There is a full Flutter **3.47.3** checkout at `/tmp/.../scratchpad/fl/flutter` (left by wave C1 packet 1e-ii; `flutter --version` works on the host as root with `PUB_CACHE=/tmp/.../scratchpad/fl/.pub-cache`). So every row below is proved by **generating and then compiling and RUNNING the Dart**, not by asserting on emitted strings. Three rows are additionally proved by hand-written `flutter test` widget cases driving the real framework. Recommend recording the SDK path in `docs/tools.md` — the `loom-test-suites` skill has no Flutter recipe, and the docker route is not usable here (`ghcr.io/cirruslabs/flutter:stable` is ~3 GB and the box has ~1–2 GB free).

---

## Rows → outcome

| row | outcome |
|---|---|
| `sourcemap` flutter half (ledger `sourcemap-feliz-flutter-not-emitted`, P2 silent) | **BUILT.** One region per page file + one per user component, the latter `fragment()`-anchored inside the pooled `lib/components.dart`. `ddd breakpoints` resolves. §1 |
| M-T1.16 invariant validation, flutter half (ledger `M-T1.16-invariant-validation-feliz-flutter`, P2 silent) | **BUILT**, through the SAME classifier and the SAME sentence builder the zod/Angular paths use. Runtime-proved in the real `Form`. §2 |
| flutter into the a11y matrix | **DISPOSITIONED + the leg WIDENED** 1 scanned page → 8. Flutter cannot join the axe matrix (canvas, no DOM) and both workflows now say why. §3 |
| `KNOWN_FLUTTER_GAPS` in `allowlist-ratchet` | **REGISTERED at `max: 0`**, after verifying it empty. M-T1.18's stale sentence corrected. §3 |
| M-T4.12 (1) authenticated http client + native bearer (D-FLUTTER-BEARER) | **BUILT**, in the order that decision set. `flutter build web --release` green — the only thing that compiles the web half of the conditional import. §4 |
| the 5+ deferred component shapes | **MEASURED (ten, not five) and DISPOSITIONED** under new **D-FLUTTER-COMPONENT-BINDINGS**; buildable half → new mission **M-T1.34**, recipes in M-T1.20. §5 |
| `flutter-async-effect-unsupported` | **RE-CLASSED `gap` → `scope`** under the same decision, owner M-T1.34. **`MAX_OPEN_GAPS` 25 → 24.** §5 |
| `store-lifetime-target-unsupported#flutter-field` | **NARROWED** — a nullable scalar and a `json` cell now persist; `File`/VO/entity still gated, and a nullable cell is still refused at the `url` tier *for a measured reason*. §6 |
| M-T1.18 M-G (Dart method-call seam, ⚠ verify-first) | **NO-OP, verified.** The seam exists (`flutterTarget.renderIntrinsic`, gated by `dart-intrinsics.test.ts`); the mission's "may be a no-op" was right. §7 |
| M-T3.9 History section | **STALE — already ships on flutter AND feliz.** Corrected with generated evidence. §7 |
| ledger `F2-CFE-11` (`testid:` dropped) | **REPRODUCES, and the flutter half is bigger than its `S`** — flutter forms have no key surface at all. Recorded with the recipe, not built; needs a shape decision. §7 |

`LATENT_SEAMS` unchanged (no seam row retired).

---

## 1. `--sourcemap` records the Flutter pages and components

**Repro on the base.** `ddd generate system <showcase> --sourcemap` on the fixture `generated-flutter-build.yml` itself uses: 8 `app/lib/pages/*.dart` emitted, `.loom/sourcemap.json` carrying **7 entries, all `api/**`**. `ddd breakpoints showcase.ddd --line 115` (the `page Home` line) answered *"No generated location maps to showcase.ddd:115."*. `src/platform/flutter.ts` did not even destructure `sourcemap` off its `emitProject` argument.

**Fix.** `GenerateFlutterOptions.sourcemap` threaded from `src/platform/flutter.ts`, recorded at two sites in `src/generator/flutter/index.ts`:

- **pages** — `options.sourcemap?.file(pagePath, r.source, r.page.origin, pageConstructId(ui.name, r.page))`, one file per page, so a whole-file region is honest.
- **components** — Flutter POOLS every user component into one `lib/components.dart`. A `file()` region there would map the whole file to whichever component came first, which is precisely the misleading mapping `SourceMapRecorder`'s own header tells callers not to emit. So `renderComponentsFile` now returns `FlutterComponentsFile` (`{source, blocks}`) and `index.ts` anchors each block with `fragment()`.

Everything else Flutter emits is either a runtime file with no `.ddd` origin (`money.dart`, `nav.dart`, the realtime transport) or a pooled projection of many constructs (`models.dart`, `reads.dart`, `forms.dart`, `stores.dart`) and stays unmapped, per the recorder's rule.

**End-to-end proof.** `--line 115` → `app/lib/pages/home_page.dart:1`; `--line 106` (a `component`) → `app/lib/components.dart:18`. The two components land on distinct non-overlapping ranges (`[8,16]` and `[18,76]`), which a `file()` call could not have produced.

**Mutation proof.** Reverting the forward in `src/platform/flutter.ts` (`void sourcemap;` + the old no-option call) fails **4 of the 5** new cases in `test/generator/flutter/sourcemap.test.ts` — `no region recorded for app/lib/pages/board_page.dart`, the scaffold twin, `no region recorded for app/lib/components.dart` — the fifth being the off-by-default control, which must keep passing.

**Ledger:** row stays OPEN for the **feliz half (packet 2i)**. Its `fix` field offers an HONEST landing (a `loom.sourcemap-target-unsupported` gate) as an alternative; this packet took the REAL one, and 2i should too — the emission is ~20 lines once `emitProject` destructures the option.

---

## 2. A Flutter form field denies with the rule its aggregate declares

**Repro.** `aggregate Ticket { priority: int  invariant priority >= 1 }` + a `CreateForm`: the emitted `validator:` checked emptiness and number-parseability and nothing else, so the violation reached the user only as a 422. react/vue/svelte fold the same rule into the zod schema; Angular into `Validators.*`. No `loom.*` code marked the divergence.

**Fix.** New `src/generator/flutter/form-validators.ts`, the Dart twin of `angular/form-validators.ts`. Fidelity by REUSE on both halves — `takeSingleFieldChain` decides WHICH rules translate (the exact gate the other two call), and `singleFieldMessage`, now **exported** from `zod-refine.ts`, decides what the denial SAYS. That export is the durable part: two frontends have no zod schema, and re-deriving the wording per frontend is how "Priority must be at least 1" becomes "Invalid input" on one target.

```
price >= 1                      →  if (n < 1) { return 'Price must be at least 1'; }
weight > 0.5   (decimal)        →  if (n <= 0.5) { return 'Weight must be greater than 0.5'; }
code.length == 6                →  if (s.runes.length != 6) { … }
email.matches("^[^@]+@[^@]+$")  →  if (!RegExp(r'^[^@]+@[^@]+$').hasMatch(s)) { … }
```

Length counts **code points** (`s.runes.length`; Dart's `s.length` is UTF-16 units, while the `minLength`/`maxLength` the same constraint publishes into the JSON Schema are code points — the correction Angular made for the same reason). A regex rides a Dart RAW string with a quote/newline fallback. An `OperationForm` folds the operation's own `precondition`s in with the aggregate's invariants. An AUTHORED `message "…"` wins over the derived sentence — the one deliberate divergence from Angular, and it matches what a react user sees (the messaged rule keeps its `.refine`). A field with NO rule keeps the byte-identical arrow one-liner.

**Runtime proof** (`flutter test`, four hand-written widget cases driving the real `Form`): a too-short title denied; an out-of-range `Priority` + sub-bound `Weight` + bad `Email` denied together; a fully valid form denied by nothing; **six emoji ACCEPTED against a `length == 6` rule**, which `s.length` would have refused.

**Mutation-proved twice.** Forcing `guards = []` in `validatorArg` fails 6 of the 8 vitest cases and 2 of the 4 runtime cases (`Found 0 widgets with text "Title must be 3 to 40 characters"`).

**Hollow gate closed with it:** no case in `generated-flutter-build.yml` carried a single `invariant`, so the entire Flutter validation fork had never been compiled by a gate. The showcase now carries four (length range, inclusive min, exclusive bound on a non-integer, regex with an authored message).

**Ledger:** OPEN for feliz. `feliz/wire.ts:renderValidation` still emits only `"Required"`, and the per-field `<form><Field>Error` function already exists — so 2i's job is one `SingleFieldPattern` switch, not a classifier.

---

## 3. The a11y leg, and the gap allowlist

**Flutter cannot join `generated-a11y.yml`, and that is now written down.** axe-core reads a DOM; Flutter web renders to canvas with no element tree (the HTML renderer was removed in Flutter 3.29, and the semantics DOM only materialises once a user activates the a11y placeholder). A `flutter` cell would scan an empty `<flt-glass-pane>` and report zero violations forever — worse than no row. Both workflow files carry the reason in a comment so it is not re-opened as a bug.

**What Flutter has instead was widened.** The emitted `test/a11y_test.dart` (Flutter's own four WCAG `meetsGuideline` matchers, run by `generated-flutter-build.yml`) pumped `App()` **once**, at its `initialRoute` — so it scanned the boot frame and nothing else. It now emits **one case per page**, each pumped through a `_probe` harness supplying a `ProviderScope` and the route arguments a `:id` page reads from `ModalRoute.settings.arguments`. (Going through `App()` would put every gated page behind `AuthGate`'s session probe, which never resolves under `flutter_test`.) On the CI showcase: **1 scanned page → 8**.

**Mutation proof, both halves.** Seeding one 8×8 unlabeled `GestureDetector` into the generated `insights_page.dart` fails the widened leg —

```
Expected: Tappable widgets should have a semantic label
… InsightsPage meets WCAG accessibility guidelines  [E]
```

— while the **pre-widening boot-frame-only file, run against the SAME seeded tree, reports `All tests passed!`**. The second half is the one that shows the widening is load-bearing.

**`KNOWN_FLUTTER_GAPS` is registered.** It is the sibling of `KNOWN_HEEX_GAPS` and the one suppression construct the 2026-07-13 sweep that built `allowlist-ratchet.test.ts` missed — M-T1.18 recorded the omission in prose and nothing acted on it. Verified empty on this tree first (all four pinned form-field shapes were closed by wave C1 packet 1e-ii), then pinned at `max: 0`. The two gates now catch opposite failures: the freeze's set-equality fails on a pin matching no finding, the ratchet on a new pin quietly added beside a new degradation. M-T1.18's stale sentence is corrected rather than left to mislead.

---

## 4. The authenticated http client (M-T4.12 item 1 / D-FLUTTER-BEARER)

**Repro on the base.** A `platform: flutter` deployable with `auth: ui` against an `auth: required` backend emitted BARE top-level `http.get`/`http.post` with no client at all. Every request 401'd — `/auth/me` included, which `AuthGate` reads, so the app sat on the sign-in view forever. And the realtime stream had no credential path to INHERIT, which is why D-FLUTTER-BEARER orders the client first.

**(i) The client.** `src/generator/flutter/api-client.ts` emits `lib/api_client.dart`, a DROP-IN for `package:http/http.dart`: it re-exports everything but the top-level request functions and redefines those over one shared credentialed `Client`. A credentialed app therefore swaps **one import line per library** and the reads, the forms, the `/auth/me` probe, the inline `Action(<inst>.<op>)` POST and the async effects are credentialed at once — rather than eleven call sites each having to remember. Two halves via conditional import:

```
web     http.Client loomApiClient() => BrowserClient()..withCredentials = true;
native  request.headers['Authorization'] = 'Bearer $token';   // a BaseClient wrapper
```

`lib/loom_bearer.dart` is the platform-neutral store the app's own OIDC client fills. Loom emits no OIDC client for Flutter (sign-in is a redirect to the backend's handshake), so the token's SOURCE is the app's; until it sets one, native requests go out unauthenticated — which the file says plainly rather than pretending.

**(ii) The stream inherits it.** `loomEventSource` takes `{withCredentials, bearer}`; the web transport emits `web.EventSource(uri.toString(), web.EventSourceInit(withCredentials: true))`, the IO transport puts the bearer on the streamed request. The caller passes the token, so the transport imports nothing conditional.

**(iii) ONE predicate.** `realtimeStreamCredential` gained `"cookie-web-bearer-native"` and keys it on `deployable.platform`, exactly as the decision required — so the api client and the stream cannot disagree. The GATE is unchanged (`auth: ui` × `auth: required` × a declared `user { }`), and an `auth: none` app emits no client files, keeps the bare `package:http` import and the v1 bare `loomEventSource(uri, types)` call.

**Proof.** `flutter analyze` **0 errors / 0 warnings**, `flutter test` green, and `flutter build web --release` green — the last is the only one that compiles the WEB half of the conditional import (`BrowserClient`); `analyze` never reaches it.

**A silent defect the new gate caught on the way in:** the first cut emitted `'Bearer \$token'` — a Dart-ESCAPED dollar, which compiles clean and sends the literal text `Bearer $token`. `flutter analyze` had nothing to say about it. Worth remembering when emitting Dart string interpolation from a TS template literal.

**Mutation-proved twice:** forcing `credentialed = false` fails 3 of the 6 cases; neutering the stream arm fails the other 2, including the `auth: none` byte-identity control.

M-T4.12 stays `partial` — items 2–4 (the cross-backend RULE 1 conformance test, the durable tee, a browser-level runtime leg) are untouched and named in the mission body.

---

## 5. The deferred component shapes, and the async effect

**How they were measured.** Every filter in `component-emit.ts` bypassed (`candidates`, `usesStores`, `needsPageShell`, `isReadConsumer`, `hasAsyncEffectAction`) plus the two validator arms, then a ten-shape fixture generated and the emitted Dart read. **Ten shapes, one root:** a Flutter component is a plain `StatelessWidget` / `StatefulWidget`, so it holds neither a Riverpod `WidgetRef` nor a route, and cannot reach the four bindings a PAGE shell declares.

| shape | emitted with the filter bypassed | disposition |
|---|---|---|
| `derived` reads route `id` | `String get label => id;` | refused |
| `derived` reads a store | `int get n => count;` | **M-T1.34** |
| `derived` reads `currentUser` | `String get who => currentUser.email;` | **M-T1.34** |
| body reads a store | `Text('${count}')`, `onPressed: () { bump(); }` | **M-T1.34** |
| body reads the bare `id` | `Text('${id}')` | refused |
| body renders `DestroyForm` | `DeleteOrderForm(id: id)` | refused |
| body renders `OperationForm` | `RenameOrderForm(id: id)` | refused |
| body reads a claim | `Text('${currentUser.email}')` | **M-T1.34** |
| `state {}` AND a read | a `StatefulWidget` whose `build` names `orderAll` | **M-T1.34** |
| an action's `match await` | **no Dart at all** — `renderNotifierStmt`'s internal floor THROWS | refused |

Every deferral is honest: emitting instead of deferring gives `Undefined name` Dart that `flutter analyze` rejects, or a codegen crash. The tenth is worth noting precisely — the page path intercepts `variant-match` one level above `renderNotifierStmt` and the component path never did, so the gate guards a crash rather than a degradation.

**The ruling — new `D-FLUTTER-COMPONENT-BINDINGS`.** The four bindings split two ways, not one. The three `ref`-backed ones are ORDINARY WORK (Riverpod supplies the shape and `renderConsumerComponent` already builds half of it) → **M-T1.34**, with a four-step plan in its body. The route `id` is REFUSED: a component has no route by construction, and the only candidate binding — "a component param spelled `id` inherits its caller's route arg" — makes `id` a magic parameter NAME whose meaning depends on where the caller happens to sit. The async effect follows the `id` ruling, not the `ref` one (an instance op posts to `/<coll>/$id/<op>`).

**`flutter-async-effect-unsupported` therefore moves `gap` → `scope`**, owner M-T1.34, and **`MAX_OPEN_GAPS` 25 → 24**. It could not stay a `gap`: the register's own header says a `gap` DRAINS TO ZERO, and a row whose cause is a deliberate refusal never can — leaving it there makes the pin a number that can never reach its target.

An eleventh arm is named but not re-measured: **Flutter is the ONE frontend with no `extern`-component hatch** (`EXTERN_COMPONENT_FRAMEWORKS`), which is M-T1.31 F17's.

---

## 6. The persisted-store codec

`persist: local` over a `string?` or a `json` field was REFUSED on Flutter while the four JS frontends persisted both without a thought (Zustand's `createJSONStorage` serialises the whole state) — a per-target gap, not a shared limit. The two missing conversions are the two that cannot fail: an absent key restores a nullable cell as `null` (the RIGHT value for a `T?` cell, not a lost one — the codec's old comment called this "no absent-vs-null distinction", which reads as a loss and is not one), and a `json` cell IS json, so storing the decoded value back is the identity.

**One deliberate narrowing inside the widening, and it is the part to read.** A nullable cell is still refused at the **`url` tier**, because `hydrateFromUrl` — the browser back/forward re-seed — goes through `copyWith`, whose `x ?? this.x` cannot set a cell to null. Removing the param from the URL and pressing Back would silently KEEP the old value: a WRONG value, not a missing feature. `flutterPersistCodec` now takes the tier so the gate and the emitter read one classifier.

**Two smaller things found by running the analyzer rather than reading:** `stores.dart` needed its `dart:convert` import (a `json` cell at the `url` tier calls `jsonEncode`/`jsonDecode`), and `dynamic?` — legal Dart but an `unnecessary_question_mark` **warning** — was *already* being emitted for the `Provenanced` carrier's `lineage` in every model with a provenanced field. Both fixed.

**Runtime proof:** five `flutter test` cases against a mocked `shared_preferences` — absent → null, present → value, junk → null without throwing, a nested `json` payload verbatim, and a setter write → `listenSelf` mirror → re-boot round trip. **Mutation-proved:** deleting the two new arms refuses all five cells at generate (`field 'nickname' | 'retryCount' | 'lastSeen' | 'blob' | 'extra' cannot be persisted`) and fails 10 of the 12 new vitest cases.

**Ledger `feliz-flutter-persist-codec-asymmetry` stays open and is honestly narrower.** `json` no longer diverges (both persist it — this was the ONE divergence pointing feliz-permissive); `optional` now diverges the other way and is pinned as such; what remains — datetime / enum / guid / decimal[] / money[] / optional on flutter but not feliz — is the FELIZ table's work.

---

## 7. Rows closed by measurement (no code)

- **M-T1.18 M-G — a no-op, as the mission suspected.** The Dart method-call seam exists: `flutterTarget.renderIntrinsic` (`flutter-target.ts:1085`) routes every scalar intrinsic through `DART_LEAVES`, and `test/generator/flutter/dart-intrinsics.test.ts` pins the catalogue against `INTRINSIC_SIGNATURES` for coverage AND against the contract for semantics. The `${recv}.${expr.member}(…)` fallthrough in `walker-core.ts` is reached only by a member that is not an intrinsic, not a collection op and not a hook — which Loom has no way to spell.
- **M-T3.9's frontend residue is STALE.** It said the scaffolded History section "ships on the four JS-family frontends, because Feliz maps non-`byId` reads to `All<Plural>`, Flutter skips them in `collectFlutterReads`, and HEEx assigns the list read". Generating ONE audited scaffolded aggregate through react + flutter + feliz: flutter emits `ref.watch(orderHistoryProvider(id))` and a real `Timeline`; feliz emits `Cmd.OfAsync.perform Api.orderHistory id OrderHistoryLoaded` and an `Html.orderedList` carrying the SAME `orders-detail-history-timeline` testid — both on react's catalog keys. Two of the three claims were wrong. **HEEx was not re-measured and is the one arm left to check.**
- **Ledger `F2-CFE-11` reproduces, and the flutter half is bigger than its `S`.** On Angular the `testid:` is dropped while a DEFAULT namespace still ships, so threading is the whole job. On flutter `grep -c 'Key(' lib/forms.dart` is **0** — no key on the form root, none on any input, none on the submit, with or without a `testid:`. There is no test-id surface to thread into. Not built, because the shape needs a decision first: flutter web renders to canvas, so the consumer is `find.byKey` inside `flutter test` (which the build gate already runs, and which `scripts/flutter-table-controls-test.dart` already drives for the `Table` controls — the precedent for what these keys are FOR), not a Playwright DOM selector. The translation already exists in the emitter: `renderTimeline` turns the walker's ` data-testid="x"` into `key: const Key('x')` via `testidAttr` + `dartString`. Recipe recorded in the ledger row.

---

## Hand-offs outside the fence

1. **To packet 2i (feliz) — three rows where this packet did the flutter half and the feliz half is the same shape.**
   - `sourcemap-feliz-flutter-not-emitted`: `src/platform/feliz.ts` does not destructure `sourcemap` either. Take the REAL landing, not the honest gate — §1 is the template, and feliz emits one file per page so it does not even need the `fragment()` half.
   - `M-T1.16-invariant-validation-feliz-flutter`: `feliz/wire.ts:renderValidation` already has the per-field `<form><Field>Error` function and always says `"Required"`. Import `takeSingleFieldChain` and the now-EXPORTED `singleFieldMessage` from `zod-refine.ts` and write one `SingleFieldPattern` switch. Do NOT re-derive the wording.
   - `feliz-flutter-persist-codec-asymmetry`: the remaining divergences all point flutter-permissive now, and they are all in `feliz-persist-codec.ts`.

2. **To the coordinator — `docs/tools.md` should record the local Flutter SDK path.** The `loom-test-suites` skill has no Flutter recipe, and the docker image does not fit on this box. Every compile/runtime proof in this note came from `PATH=/tmp/.../scratchpad/fl/flutter/bin:$PATH PUB_CACHE=/tmp/.../scratchpad/fl/.pub-cache`. `flutter` refuses to run as root with a warning but works.

3. **To whoever picks up M-T1.34** — the recipes are in the mission body and in M-T1.20's table; both were written from emitted Dart, so no bypass run is needed to start.

4. **To M-T1.31 F17's owner** — the `extern`-component hatch is the eleventh flutter deferral arm and was deliberately not re-measured here.

---

## Open-PR overlaps on this fence

`list_pull_requests` (open, incl. drafts) at launch and again at hand-off — 23 open at launch, 36 at hand-off.

| PR | on my fence? | disposition |
|---|---|---|
| **#2898** (numeric-rich fixtures for both self-hosting frontends) — the coordinator's named overlap at launch | **already merged** before this packet started; not in the open list | no action |
| **#2885** (flutter-target) — the wave log's 2j row | **already merged**; not in the open list | no action |
| #2937 (`slot` as a field name) | `src/diagnostics/messages.ts` | **Composes** — it ADDS `loom.parse-error#reserved-name`; this packet EDITS `loom.store-lifetime-target-unsupported#flutter-field`. Different keys, no textual conflict expected. |
| #2947, #2942, #2923, #2911, #2927, #2905 | file lists checked for `flutter` / `realtime-rooms` / `unsupported-register` — **no hits** | no action |
| #2911 | `eval/matrix/fe-flutter.ddd` (a fixture, not the emitter) | no action |

**Rows skipped because an open PR covers them: none.** No open PR claims any of this packet's rows.

**Files a fold may need to compose:** `src/diagnostics/messages.ts` (one edited entry), `src/diagnostics/unsupported-register.ts` + `test/system/unsupported-register.test.ts` (the `MAX_OPEN_GAPS` 25 → 24 line — another packet lowering it in the same batch meets this one), `docs/decisions.md` (one appended entry), `docs/audits/targets-completeness-2026-08-30.ledger.json` (four `reverified` blocks, three-way by row id), `docs/new-plan/{T1,T3,T4}-*.md` + `README.md` counts. `src/ir/util/realtime-rooms.ts` is shared in principle but only the flutter arm is touched.

---

## Local gates on this tree

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | exit 0 — 181 files, 469 errors, `src/` clean (baseline unmoved) |
| `npm run lint` (`biome ci .`) | 0 errors, 24 warnings (all pre-existing) |
| `node scripts/mission-counts.mjs --check` | exit 0 |
| `node scripts/ledger-counts.mjs --check` | exit 0 |
| `node docs/build.mjs` (the `pages` gate) | exit 0 |
| `npx vitest run test/generator/flutter/` | 66 files / 407 tests green |
| `flutter analyze` (Flutter 3.47.3) on **four** generated fixtures — the CI showcase, the invariant fixture, the `auth: ui` + realtime fixture, the persist fixture, and the app-shell parity fixture | **0 errors, 0 warnings** on every one |
| `flutter test` on all of them | green (the CI showcase now runs 8 a11y cases + the boot smoke) |
| `flutter build web --release` on the CI showcase and on the `auth: ui` fixture | green |
| hand-written `flutter test` runtime proofs | 4 invariant-validation cases + 5 persist round-trip cases, all green; both mutation-proved |
| `npm test` (full fast suite) | see below |

**`npm test`:** the run started at hand-off time on the merged tree. Batch 1 and packet 2h both record the same worktree-only reds — `test/platform/packaging-split-*` cannot pass in ANY git worktree (no `node_modules/@loom` workspace symlinks), and contention timeouts on this 4-core box need re-running alone. Nothing in this packet's diff touches `src/platform/fs-discovery.ts` or those symlinks. Every targeted suite in the blast radius (`test/generator/flutter/`, `test/ir/`, `test/system/`, `test/generator/_frontend/realtime-stream-auth.test.ts`, `test/platform/allowlist-ratchet.test.ts`) was run green individually; `test/system/` was run in full (99 files) and is green after fixing the one failure it found — `direct-generate-systems-ratchet` caught this packet's own `sourcemap.test.ts` importing `generateSystems` directly, now on `generateSystemFiles(source, { sourcemap: true })`.

## Decisions needed from the owner

1. **`D-FLUTTER-COMPONENT-BINDINGS`** is `proposed` (default applies 48 h after merge). Its load-bearing half is the REFUSAL of a route `id` inside a component. Reversing it is cheap — one binding in one seam (`flutterTarget.renderRouteId`, and packet 2h established the per-walk `…TargetFor(…)` factory shape on Angular) — but it should be reversed deliberately, not rediscovered.
2. **`F2-CFE-11`'s flutter half needs a shape call** before anyone builds it: are the emitted keys for `flutter test`'s `find.byKey` (the only consumer a canvas-rendered app has), or is a DOM-shaped test id expected to mean something on Flutter? §7 has the measurement; the ledger row has the recipe.
