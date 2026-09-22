# Wave C2 packet 2l — feliz + flutter, the self-hosting frontends (batch 3)

*Branch `claude/c2-selfhost-3`, cut from `f90e5d78f` (the batch-3 coordinator head on `claude/loom-review-planning-adz0n4`, itself `main` @ `5049b6fea` after batch 2's #2933). Mid-packet the branch also merged `origin/main` at `f90fdd159` (four PRs since launch — #2906, #2962, #2959, #2914; none in this fence, the merge was clean). Commits `aa415bdfd..<head>`, all SSH-signed. Never pushed, no PR — the wave PR #2970 is the claim and the coordinator folds the branch.*

**Fence:** `src/generator/{feliz,flutter}/**`, `src/ir/util/feliz-persist-codec.ts`, `src/ir/validate/checks/ui-framework-checks.ts` (the flutter action-body gate), the `messages.ts` / `unsupported-register.ts` rows a closed row required, `test/generator/{feliz,flutter}/**`, `test/ir/{sentinel-gates,async-effect-subject}.test.ts`, `test/ir/util/persist-codec-divergence.test.ts`, `test/system/diagnostic-firing-census.test.ts`, plus the docs and the ledger.

**A session note that changes how to read the proofs.** This packet was interrupted by a rate limit on 2026-09-14 and resumed on 2026-09-20. The container restarted in between and **the local Flutter SDK at `<scratchpad>/fl/flutter` was gone** — the path packet 2j recorded, on which every Flutter proof in the wave depends. It was re-fetched (recipe below) and the version moved **3.47.3 → 3.47.5**. Do not assume the SDK survives a restart; check before planning around it.

---

## Rows → outcome

| row | outcome |
|---|---|
| ledger `feliz-flutter-persist-codec-asymmetry` (P3) — the `optional` arm | **BUILT.** The F# table gained a nullable-scalar codec at EVERY tier. The two tables now agree on every TYPE; the one thing left is a TIER, and it has a measured cause. Ledger row → `done`. §1 |
| a PRE-EXISTING Feliz silent-codegen defect found by compiling the result | **BUILT.** A store action assigning a bare value to an optional cell emitted FS0001 F# from a clean `.ddd`. Third member of packet 2i's family; independent of `persist:`. §1 |
| `loom.flutter-action-body-unsupported` (M-T1.32, **P1**) — the `toast(…)` half | **BUILT.** `lib/toast.dart`, a `GlobalKey<ScaffoldMessengerState>` on `MaterialApp` — the twin of the `navigate` bridge. Gate arm, catalog entry and firing fixture deleted; three refusal-asserting tests FLIPPED. §2 |
| `loom.flutter-action-body-unsupported` — the standard-op `match await` half | **NOT BUILT.** Still the row's whole content; the register row and M-T1.32 are narrowed to it, and the recipe is unchanged. §2 |
| `loom.async-effect-subject-unsupported` — "measure what the subjects are" | **MEASURED, and the answer changes the row's drain condition.** Exactly THREE reachable subjects, of which ONE is buildable. Census pinned as tests; register `what` rewritten. §3 |
| `loom.store-lifetime-target-unsupported` — the RECORD-shaped residue | **NOT CLOSED, and deliberately NOT re-classed `scope`.** Reasoning in §4 — a `scope` here would be dishonest. |
| `loom.feliz-async-effect-unsupported` (component host) | **NOT BUILT.** §5 |
| M-T1.34 (a Flutter component holds a Riverpod `ref`) | **NOT BUILT.** §5 |
| ledger `F2-CFE-11` flutter half | **NOT BUILT** — and the reproduction attempt found the fixture shape 2j's recipe needs. §5 |
| ledger `M-T1.20-feliz-match-await` (P3) | **NOT BUILT** — it is the same threading as the feliz component-deferral rows; §5 |
| the deferred component shapes on feliz | **NOT BUILT.** §5 |
| `KNOWN_FLUTTER_GAPS` | **RE-VERIFIED at `max: 0`** — unchanged by this packet. |

**`MAX_OPEN_GAPS` is unchanged at 20.** Both codes this packet worked on survive with a strictly smaller `what`: `loom.flutter-action-body-unsupported` lost one of its two arms, `loom.async-effect-subject-unsupported` lost two thirds of its claimed population to a measurement. Neither row could be deleted, so neither lowered the pin. `LATENT_SEAMS` unchanged at 25.

---

## 1. The Feliz `optional` persist cell — and the defect under it

**Repro on the base.** `store Prefs persist: local { state { nickname: string?  retries: int?  seen: datetime? } }` on a feliz deployable:

```
loom.store-lifetime-target-unsupported store 'Prefs': field 'nickname' cannot be persisted
on the feliz frontend … the F# codec covers string / int / long / bool / decimal / money / id
fields plus arrays of string / int / long / bool.  A datetime, duration, guid, enum, entity or
value-object field would be silently dropped …
3 error(s), 0 warning(s).
```

Two things wrong there. The refusal itself (the ledger row), and **the message text, which was stale in both directions**: it still listed `datetime` / `guid` / `enum` as uncovered — packet 2i covered all three — and it never named `File`, which is genuinely uncovered. Both corrected.

**The fix.** `src/ir/util/feliz-persist-codec.ts` gained an `optional` arm returning `{kind: "scalar", scalar, nullable: true}` over any scalar; `src/generator/feliz/store-persist.ts` gained the four emitter halves (`fromRawOptional`, the `toJson` nullable arm, the `urlParamJs` nullable arm, `urlCellString` + the `urlArg`/`felizArgType` nullable arms).

```fsharp
let loadPrefsNickname () =
  let raw = webField "local" "loom.store.Prefs" "nickname"
  if isNull raw then None else Some raw

let loadPrefsRetries () =
  let raw = webField "local" "loom.store.Prefs" "retries"
  if isNull raw then None else (match System.Int32.TryParse raw with | true, v -> Some v | _ -> None)

"\"seen\":" + (match model.PrefsSeen with | Some v -> jsonString (v.ToString("o")) | None -> "null")
```

A junk value falls back to the **declared default**, which is already option-typed, so the arm never mixes `'T` with `'T option` and the round trip stays total.

**The part worth reading — Feliz supports the `url` tier where Flutter refuses, and that is not an oversight on either side.** Flutter refuses a nullable cell under `persist: url` because `hydrateFromUrl` re-seeds through `copyWith`, whose `x ?? this.x` cannot set a cell to null: removing the param and pressing Back would silently KEEP the old value. The Feliz re-seed is the `StoreUrlChanged` arm's `{ model with X = loadPrefsX () }` — a full F# record update that re-runs the loader — so an absent param restores `None`. **`felizPersistCodec` therefore takes no `tier` argument at all**; copying the Dart gate would have been a gate with no defect behind it. Both directions are pinned in `persist-codec-divergence.test.ts`, including that `felizPersistCodec` cannot depend on a tier.

At the `url` tier every nullable scalar is stringified in F# first (`urlArg`) and crosses as `null` when `None`, so **one** writer arm covers every scalar. The `($n)` parens are load-bearing: Fable's `Emit` placeholder scanner swallows a `!` immediately after a placeholder, which would turn `$0!=null` into the *assignment* `$0=null`.

### The silent-codegen defect underneath

Found only by running `dotnet fable` on the result, and it is **independent of `persist:`**:

```
store Prefs { state { nickname: string? }  action set(n: string) { nickname := n } }
```
```fsharp
let model = { model with PrefsNickname = n }
// ./src/App.fs(235,48): error FSHARP: This expression was expected to have type
//   'string option' but here has type 'string'
```

from a `.ddd` reporting `0 error(s), 0 warning(s)`. It reproduces on a **`memory`** store, which is where the regression is pinned (`test/generator/feliz/store.test.ts`) — so the fix is proven to predate the persistence ladder reaching optional cells. This is the third member of the family packet 2i found (an `enum` cell typed by its own name; a `datetime`/`guid` cell seeded `""`), and the lesson is the same one 2i drew: **on this frontend, "the generator emitted something" and "the app compiles" are different questions, and only `dotnet fable` answers the second.**

The `assign` arm now lifts a bare value into `(Some v)` when the target type is optional and the value is not ALREADY an option. `fsYieldsOption` answers that from the three ExprIR shapes that carry the type: the `null` literal (which `FS_LEAVES.literal` spells `None`), a `member` whose `memberType` is optional, and a `ref` carrying an optional `type`. **Where the answer is unknown the predicate says "not an option"**, which is the safe direction — an over-wrap is `string option option`, a loud FS0001; an under-wrap was the shipped defect.

**Mutation-proved, both halves, with file-copy reverts:**
- `if (t.kind === "optional") return undefined` in the codec fails **6** cases across two suites, first *PERSISTS an OPTIONAL scalar as a `'T option` cell — at EVERY tier*: `expected undefined to deeply equal { kind: 'scalar', …(2) }`.
- dropping the `Some` lift fails **2** cases, first *LIFTS a bare value assigned to an optional cell into `Some`*: `expected 'module App…' to contain '{ model with PrefsNickname = (Some n)…'`.

**Build proof (the `generated-feliz-build` leg, on a purpose-built showcase carrying every optional scalar at `local` AND at `url`):** `dotnet fable` **exit 0** (`Fable compilation finished in 11988ms`), `vite build` **exit 0** (`86 modules transformed`, `dist/assets/index-*.js 208.82 kB`).

---

## 2. `toast(…)` from a Flutter action body — M-T1.32 half 1

**Repro on the base.** `action ping() { n := n + 1  toast("saved") }` on a flutter ui → `loom.flutter-action-body-unsupported` ×2 (the message even carried a typo — *"so it can reach a `ScaffoldMessenger`"*, missing the "cannot"; moot now that the entry is deleted).

**The fix is NOT the `ref.listen` effect-queue the mission sketched.** That design re-derives, per page, a mechanism this tree already uses for the twin problem: `navigate` reaches the router from a Notifier through a `GlobalKey<NavigatorState>` on `MaterialApp` (`lib/nav.dart`, wave C1 packet 1e-ii, ledger row F2-CFE-1). `toast` gets the same shape one `MaterialApp` field over.

```dart
// lib/toast.dart
final GlobalKey<ScaffoldMessengerState> appScaffoldMessengerKey =
    GlobalKey<ScaffoldMessengerState>();

void showToast(Object? message) {
  final messenger = appScaffoldMessengerKey.currentState;
  if (messenger == null) return;
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text('$message')));
}

// lib/pages/home_page.dart — the Notifier method
void ping() {
  state = state.copyWith(n: (state.n + 1));
  showToast('saved');
}
```

Three details are load-bearing:

1. **`Object?`, not `String`.** `toast(n)` on an `int` cell coerces instead of failing to compile — the coercion the JS frontends get for free from template literals.
2. **The message goes through the SAME `emitExpr`** every other Notifier statement uses, so a state read in the argument resolves to `state.<cell>` exactly as on the right-hand side of a write.
3. **Emission is use-driven off one marker** (`showToast(`), scanned in last position over pages + `stores.dart` + `components.dart` — so an app that never toasts from an action emits no file, no import and no `MaterialApp` argument. Byte-identical to before, pinned as a negative control.

**A realtime handler's toast deliberately does NOT move.** `LoomRealtime` is a real `ConsumerStatefulWidget` on `MaterialApp.builder`, so it HAS a context and keeps `ScaffoldMessenger.maybeOf(context)`. An in-tree effect should not route through a global key just because an out-of-tree one has to. Pinned as its own case (and the fixture asserts `lib/toast.dart` is NOT emitted for a realtime-only app).

**Proofs.**

| proof | result |
|---|---|
| `flutter analyze` on the generated app (Flutter 3.47.5) | **`No issues found!`** |
| `flutter test`, three hand-written widget cases | green — tap the button and a real `SnackBar` appears with the right text; tap `toast(n)` and the int coerced (`find.text('0')`); `showToast` with no `MaterialApp` attached is a no-op rather than a crash |
| `test/generator/flutter/action-toast.test.ts` | 6 cases green, incl. the byte-identity control and the realtime split |
| the SHIPPING `generated-flutter-build.yml` showcase, regenerated on this tree | `flutter analyze --no-fatal-warnings --no-fatal-infos` exit 0 (19 pre-existing infos, none about toast), `flutter test` **9 passed** |

**Mutation-proved** with a file-copy revert: deleting the `toast` arm from `renderNotifierStmt` fails **4 of the 6** cases, first *shows through the out-of-tree bridge, not through a BuildContext* with `internal: the Flutter Riverpod Notifier emitter cannot render a 'private-operation' call 'toast'`.

**Three tests that asserted the REFUSAL were flipped rather than deleted** — which is exactly what M-T1.32 named as its own verification:

- `test/generator/flutter/action-body-gaps.test.ts` — the toast case now asserts the emission, beside the two floor cases that survive, so the flip is visible side by side.
- `test/ir/sentinel-gates.test.ts` — now admits BOTH view effects (and a non-string argument).
- `test/system/diagnostic-firing-census.test.ts` — the fixture MOVED to the arm that survives (a `match await` on a STANDARD op), rather than being deleted. Without the move the census would have gone green on a code that no longer fires from its own fixture.

**Half 2 is untouched and is the whole of what is left.** `renderVariantMatchNotifier` resolves the awaited op through `agg.operations`, which holds only DECLARED operations, so the five standard ops never resolve. Their routes are already derivable the way `forms-emit.ts` derives them (`POST /<coll>` for `create`, `/<coll>/$id` for `update`/`delete`) — a resolution arm, not new transport.

---

## 3. `loom.async-effect-subject-unsupported` — the census, and what it does to the drain

The packet asked "measure what the subjects are (workflow runs? finds? domain-service calls?)". Measured by **spelling each candidate and running the pipeline**, not by reading the classifier. The answer changes the row's drain condition, so it is now pinned as four cases in `test/ir/async-effect-subject.test.ts`.

| awaited subject | verdict |
|---|---|
| `match await <api>.<Agg>.<declaredOp>()` | CLEAN — the supported control |
| `match await <api>.<Agg>.create(…)` (a STANDARD op) | **CLEAN on a JS frontend.** Refused only on Flutter, by `loom.flutter-action-body-unsupported` (§2 half 2) — so the two codes do NOT overlap |
| **`match await <api>.<Workflow>(args)`** | **raises the code — and is the ONE drainable subject** |
| `match await <api>.<Agg>.all` (a collection read) | raises the code — permanent nonsense, a read has no command to await |
| `match await <state field>` | raises the code — permanent nonsense |
| `match await <api>.<Workflow>.run(…)` (dotted) | **NOT this row's** — refused earlier by scope resolution: `Aggregate 'Settle' not found in api 'A'` |
| `match await <api>.<DomainService>.<op>(…)` | **NOT this row's** — same scope error |

**What this means for the register.** The row will **not reach zero by building**: two of its three reachable subjects are a permanent, correct refusal. When the workflow subject lands, what remains is a `scope` row, not a drained one. The register `what` now says so, names the census, and names the two shapes a reader would wrongly expect to be in the population.

**Cross-packet:** this row's react/vue/svelte/angular halves are packet **2k**'s. The census is target-neutral (it is the shared classifier's population), so 2k can take it as given; the *building* of the workflow subject is seven frontend emitters and belongs to whoever takes M-T1.20's workflow-await slice, not to either of us.

---

## 4. Why `loom.store-lifetime-target-unsupported` was NOT re-classed `scope`

The packet offered "build the record codecs or re-class the record shapes under a D-tag". Neither was taken, and the reason is worth recording so the next packet does not re-litigate it.

What is left on both self-hosting frontends is `File`, `valueobject`, `entity` and arrays of them. **A `scope` re-class would be dishonest**, by the register header's own rule: a `scope` row is *a declared v1 limit*, and this is not a limit — the four JS frontends persist a record-shaped cell without a thought (Zustand's `createJSONStorage` serialises the whole state). It is a **per-target gap**, which is precisely the argument packets 2i and 2j used to WIDEN `json` and the nullable cell rather than gate them. Re-classing it would make the register say "deliberate" about the one property that is accidental.

**The recipe, for whoever builds it.** The obstacle is the totality rule the whole classifier rests on: a record codec must never throw on junk. On Feliz that is reachable — `wire.ts` already emits a Thoth decoder per wire record, and `Decode.fromString <dec>` returns a `Result`, which is total by construction; the loader arm becomes `if isNull raw then <dflt> else (match Decode.fromString <dec> raw with | Ok v -> v | Error _ -> <dflt>)`. On Flutter the same shape needs a `try`/`catch` around `fromJson`, which is what the Dart module's header already says is missing. Both are contained; neither is a seam change. Sizing: **S each**, once the decoder name is threaded from `wire.ts` / `dart-model-emit.ts` into the store path.

---

## 5. Rows not built, with what the next packet needs

1. **`loom.feliz-async-effect-unsupported` (component host) and ledger `M-T1.20-feliz-match-await`.** These are ONE change, as 2i's note already says: let a Feliz component supply the trigger id. That is the same threading the feliz component-deferral rows #4–#7/#9 need, and **the same threading `F2-FFE-4` (claimed by #2721) describes** — check that claim before starting; three ledger rows and two register arms close together or not at all.
2. **M-T1.34 (a Flutter component holds a Riverpod `ref`).** Untouched. 2j's four-step plan in the mission body was written from emitted Dart, so no bypass run is needed to start. Its register row (`loom.flutter-async-effect-unsupported`) is already `scope` under D-FLUTTER-COMPONENT-BINDINGS, so building it LOWERS nothing — it deletes a `scope` row.
3. **Ledger `F2-CFE-11`, flutter half.** Still needs the shape call 2j asked for (keys for `find.byKey` in `flutter test`, vs a DOM-shaped test id that means nothing on a canvas). **Two things measured here that are not in 2j's note, and together they make the build smaller than "bigger than its `S`" suggests:**

   - the translation the recipe wants **already exists**, in `pack.ts` as `testidKey` (` data-testid="x"` → `key: const Key('x')`), used by the walker primitives;
   - the hoisted form widget **already accepts a key** — `forms-emit.ts:1550` emits `{super.key}` (or `{super.key, required this.id}`) as its constructor args.

   So the flutter half is a **CALL-SITE-only** change: `flutter-target.ts`'s `renderCreateForm` / `renderOperationForm` / `renderDestroyForm` currently emit `const CreateAggForm()` / `OpAggForm(id: id)` and need to splice `key: const Key('<testid>')` when the primitive carried one. Nothing new to invent on either side. (Mind the `const`: a keyed `CreateAggForm` is still const-constructible with a `const Key`, so the existing spelling survives.)

   One trap for the reproduction: the fixture needs the api-handle spelling right (`of:` wants the handle-qualified aggregate). A bare `of: Shop.Item` with a mis-declared handle yields `loom.page-primitive-arg-missing` and two `SizedBox.shrink()`s — which looks exactly like the bug and is not.
4. **The nine deferred component shapes on feliz.** Untouched. 2i's slicing (one S fix — the optional parameter — plus two M fixes) is still the right shape, but **the S is understated, and the reason was measured here before deciding not to build it.** 2i's recipe is "`propType` can spell the field `'T option` and the call site pass `None`", which is two edits:

   - `component-emit.ts` `propType` → `` `${wireFieldType(t.inner)} option` `` for an optional param;
   - `feliz-target.ts` `renderUserComponent` → `Some (<expr>)` for a supplied arg, and a `<name> = None` fill for an omitted one (the exact-record fill the `slot` arm at `feliz-target.ts:855` already does for the same reason).

   **The third edit the recipe omits is the BODY READ.** Once the props field is `'T option`, every read of that param inside the component renders an option where a value is wanted — `Html.text props.label` becomes a type error. So the param-read seam has to unwrap (`defaultArg props.label ""`, or a match at the read site), which is a change to how a param ref renders and therefore touches every read position, not just the two declaration sites. Still contained to `src/generator/feliz/**`, but it is an **M**, and it needs a `dotnet fable` run rather than a string assertion — the whole failure mode is a type error the emitter cannot see.

---

## A separate pre-existing finding, recorded not fixed

A Dart **string concatenation** trips `flutter analyze`'s `prefer_interpolation_to_compose_strings`. It has nothing to do with toast:

```
page Home { state { n: int = 0  label: string = "" }
            action bump() { label := `hello {n}` } }
```
```dart
state = state.copyWith(label: ('hello ' + state.n.toString()));
// info • Use interpolation to compose strings … prefer_interpolation_to_compose_strings
```

**It is an `info`, and `generated-flutter-build.yml` runs `flutter analyze --no-fatal-warnings --no-fatal-infos`, so it is NOT a CI blocker** — it is why a plain `flutter analyze` on a generated app reports 19 issues instead of none. Fixing it means teaching `dart-expr.ts`'s `binary` leaf to render a string `+` as interpolation, which would churn byte-golden expectations across the flutter suite — out of proportion to an info. Repro: `<scratchpad>/c2l/concat.ddd`.

---

## Local gates on this tree

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | exit 0 — 181 files, 469 errors, `src/` clean (baseline unmoved) |
| `npm run lint` (`biome ci .`) | 0 errors, 26 warnings (all pre-existing) |
| `node scripts/mission-counts.mjs --check` | up to date |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| feliz leg — `dotnet fable` | **exit 0**, `Fable compilation finished in 11988ms` |
| feliz leg — `vite build` | **exit 0**, `86 modules transformed`, `dist/assets/index-*.js 208.82 kB` |
| flutter — `flutter analyze` on the toast fixture | **`No issues found!`** |
| flutter — `flutter test`, 3 hand-written runtime cases | green; mutation-proved |
| flutter — the SHIPPING CI showcase regenerated: `analyze` (CI flags) + `test` | exit 0; **9 tests passed** |
| `npx vitest run test/generator/flutter/ test/ir/sentinel-gates.test.ts` | 66 files / 405 tests green |
| `test/system/{unsupported-register,diagnostic-catalog,diagnostic-docs-anchors,diagnostic-firing-census}` | green |
| `npm test` (full fast suite) | **`2 failed \| 2105 passed \| 89 skipped (2196)` files, `4 failed \| 24734 passed \| 7 expected fail \| 1159 skipped (25904)` tests, `NPM_TEST_EXIT=1`** — the 4 are the worktree-structural `packaging-split-*` family; see below |

**`npm test` — read this before folding, including the caveat at the end.** Run **redirected to a file with its exit code appended**, never piped: batch 2's lesson is that a piped `npm test | tail` reports `tail`'s status and can never fail. The log is `<scratchpad>/c2l/npm-test.log` and ends with `NPM_TEST_EXIT=1`.

**The 4 failures are the worktree-structural `packaging-split-*` family, exactly the set packet 2i reported**, verified rather than assumed:

```
FAIL test/platform/packaging-split-core-pkg.test.ts    > does not surface `core` as a backend
FAIL test/platform/packaging-split-fs-discovery.test.ts > discovers both @loom/backend-hono-v4 and -v5 …
FAIL test/platform/packaging-split-fs-discovery.test.ts > fs-discovered hono surfaces are the SAME INSTANCE …
FAIL test/platform/packaging-split-fs-discovery.test.ts > only emits backend entries …

$ ls node_modules | grep -c '^@loom'                    → 0
$ git diff --name-only f90e5d78f..HEAD | grep -E 'fs-discovery|^packages/'  → (nothing)
```

`discoverBackendsFs` walks `node_modules/@loom/*` for workspace symlinks and a git worktree has none, so it discovers zero backends. This packet touches neither `src/platform/fs-discovery.ts` nor the `packages/` manifests. **Note the FILE NAMES** — 2j's note records burning a cycle on `packaging-split-discovery.test.ts` (which passes) vs its sibling `packaging-split-**fs**-discovery.test.ts` (which does not); they are one character apart and are not interchangeable.

**The caveat, stated rather than papered over:** the run was STARTED on the tree at `8ce669d6c` (the toast commit) and the last three commits landed while it was executing. Two of those three are docs-only; the one that touches the suite is `d679ce20b`, whose files were **run individually green on the final tree** — `test/ir/async-effect-subject.test.ts` 14 passed, `test/system/unsupported-register.test.ts` 9 passed. Vitest reads a file's contents when it reaches it, so the full run may or may not have picked the new cases up; treat its number as covering `8ce669d6c` and the two named suites as covering the rest. This is exactly why **the coordinator should re-run `npm test` on the FOLDED tree rather than take a number from this note** — which is the standing rule in this wave anyway, and doubly so here: three packets shared this 4-core box at load average ~12, which is why one run took as long as it did.

### The Flutter SDK, re-fetched

2j's path was empty on resume. Re-fetch, and record the recipe because it will happen again:

```bash
ROOT=<scratchpad>/fl
git clone --depth 1 -b stable https://github.com/flutter/flutter.git "$ROOT/flutter"
export PATH="$ROOT/flutter/bin:$PATH" PUB_CACHE="$ROOT/.pub-cache"
git config --global --add safe.directory "$ROOT/flutter"
flutter --version        # Flutter 3.47.5 • Dart 3.13.4
```

`flutter` warns about running as root and works anyway. Disk was at 82% (6.7 G free) with the SDK present, so it is not free — but it fits, and the docker image route still does not.

---

## Open-PR overlaps on this fence

`list_pull_requests` (open, incl. drafts) at launch — 36 open.

| PR | on my fence? | disposition |
|---|---|---|
| **#2966** (four compile-breakers, incl. "a Feliz form-record name collision") | **yes, `src/generator/feliz/**` when it lands** — its file list at launch carried only dotnet/elixir/java/python/`op-gates.ts`, the Feliz half not yet pushed | **No overlap with this packet's rows** (form-record NAMING vs the store persist path + the update-emit assign arm). Different files; if it does touch `store-persist.ts` or `update-emit.ts`, compose — this packet's hunks there are one new function each plus one arm. |
| #2960 (the `auditable` capability with any frontend), #2959 (`toThrow` in a ui e2e body), #2942 (page emitter fails open) | file lists checked for `feliz` / `flutter` / `persist-codec` — **no hits**; #2959 and #2914 have since MERGED and are in this branch via the `origin/main` merge | no action |
| #2938 (wave CR1 batch 1 — `src/generator/_*` default arms; `MAP_UNRENDERED_FRAMEWORK` deleted on feliz there) | shared-area, not touched here | **compose, do not re-add** — this packet adds no `_walker`/`_expr` arm |

**Rows skipped because an open PR covers them: none.**

**Files a fold may need to compose:** `src/diagnostics/messages.ts` (one entry edited, one DELETED), `src/diagnostics/unsupported-register.ts` (three `what` fields edited, no row added or removed, `MAX_OPEN_GAPS` **untouched** — a packet that lowers the pin in the same batch composes cleanly with this), `test/system/diagnostic-firing-census.test.ts` (one fixture MOVED), `docs/audits/targets-completeness-2026-08-30.ledger.json` + `.md` (one row `open` → `done`), `docs/new-plan/T1-ui-frontend.md` (M-T1.20 progress note + the M-T1.32 body and title).

**2k's `src/generator/_walker/**` seam was NOT needed and NOT touched.** The toast bridge deliberately avoided adding a `usesToast` to the shared `WalkContext` — it rides the marker-sniffing rule the nav/modal/chart/money runtimes already use, which is entirely inside `src/generator/flutter/`. Worth knowing: **an out-of-tree runtime needs no shared-seam change on this frontend.**

---

## Decisions taken, and decisions still wanted

**Taken (no `D-*` entry needed — neither reverses a decision, both are the local consequence of an existing one):**

1. **Feliz persists a nullable cell at the `url` tier where Flutter refuses.** The asymmetry is a measured property of the two re-seed paths, not a divergence to reconcile, and `felizPersistCodec` takes no tier so it cannot drift into one. Pinned both ways.
2. **`toast` gets a `GlobalKey` bridge, not an effect queue.** It follows D-FLUTTER-… precedent by being the same mechanism `navigate` already uses; the mission's own sketch is superseded in its body with the reason.

**Still wanted from the owner:**

1. **`F2-CFE-11`'s flutter half still needs 2j's shape call** — `find.byKey` or a DOM-shaped id — before anyone builds it. §5 adds the one fact 2j's note lacked: the translation already exists in `pack.ts`.
2. **`loom.store-lifetime-target-unsupported` should stay a `gap`, not become a `scope`.** §4 is the argument. If the owner disagrees, the re-class needs a `D-*` entry that says out loud why a feature shipping on four of six frontends is a declared v1 limit — which is the sentence I could not write honestly.
3. **`loom.async-effect-subject-unsupported` will need a `scope` re-class, but not yet** — after the workflow subject lands, since two of its three subjects are permanent. Flagged now so the wave's "ratchets to 0" narrative does not stall on a row that cannot reach zero.
