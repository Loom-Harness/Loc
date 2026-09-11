# Wave C1 hand-off — packet 1d-i, the give-up drain (M-T9.55) and the walker invariant

*Branch: `claude/c1-1d-giveup-drain`. Commits: `87e1323a` (emitters), `e8adc473` (gates),
`1e6431c6` (corpus fixture), `261dc14d` (tracker + this note), `9b7a2ccd` (biome import order).*

---

## 0. The situation as found, re-verified on this tree

The packet brief said the gate "currently tolerates" 28 newly-seen give-up sites. **It does not, and
the reconciliation matters for what the packet actually was.** #2843 (merged) did BOTH of M-T9.55's
declared slices: it fixed `WALKER_GLOBS` *and* routed all 26 sites the fix uncovered through
`giveUp()`. `walker-give-up-routing.test.ts` was **green on arrival**, with a one-entry
`NOT_A_GIVE_UP` list (`give-up.ts` itself) and no baseline, count-ratchet or tolerated set anywhere
in it. There was nothing left to "shrink to 0" in the sense the brief assumed.

What #2843 left is the thing packet 1d-i is really for. Every one of those declines was **findable**
— one sentinel, one scan — and **none was explicable**: the reason was prose written at the emission
site, so the reader of a generated page got a sentence with nothing to look up, and no test, census
or CLI pass could group two spellings of the same refusal.

Re-verified by repro on this tree before building (`node bin/cli.js parse` + `generate system`):

| `.ddd` | `ddd parse` | emitted page |
|---|---|---|
| `body: Stack { CreateForm { } }` | `0 error(s), 0 warning(s)` | whole body = `{/* loom:unrendered CreateForm(of: …): missing 'of:' aggregate ref */}` |
| `body: Stack { DestroyForm { } }` | `0 error(s), 0 warning(s)` | whole body = `{/* loom:unrendered DestroyForm: expected (of: <Agg>) */}` |

A blank screen, valid input, no diagnostic anywhere. That is the silent class, and it is what the
packet drained.

---

## 1. Fixed

| # | What | Evidence |
|---|---|---|
| F1 | `giveUp(target, code, text)` / `giveUpNotice(...)` take a **catalogued `loom.*` code** and render it into the comment: `loom:unrendered [loom.page-primitive-arg-missing] …`. `GiveUpCode = DiagnosticMessageKey`, so an invented code fails `tsc`. | `src/generator/_walker/give-up.ts`; probe re-run → `{/* loom:unrendered [loom.page-primitive-arg-missing] CreateForm(of: …): … */}` |
| F2 | **81 give-up call sites** across 23 files carry a code. Distribution: `arg-missing` 23, `arg-invalid` 18, `page-ref-unreachable` 28, `target-gap` 7, `page-expr-unrenderable` 1, plus 5 on three pre-existing codes. | `grep -c` census in `walker-give-up-routing.test.ts`'s own scan (asserted > 50 sites over > 10 files) |
| F3 | `giveUpText(code, text)` for the three sites that build their own comment syntax and have no `WalkerTarget` (HEEx engine, Feliz pack, Flutter pack) — they no longer re-spell `GIVE_UP_SENTINEL`. | `elixir/heex-walker-core.ts`, `feliz/pack.ts`, `flutter/pack.ts` |
| F4 | **The HEEx blind spot.** The routing gate scans for `renderComment`/`renderNotice` CALLS, so it never saw the parallel LiveView engine: **14 give-ups** built `<!-- … -->` / `<%!-- … --%>` inline with **no sentinel at all**. All routed. | `elixir/heex-primitives.ts` (11), `heex-walker-core.ts` (3); globs extended to name the two heex walker files |
| F5 | **Silent decline closed:** `QueryView { }` with no `of:` on Phoenix fell through to the `cond` with an empty `ofExpr` — rendering the loading / error / empty arms plus an **empty `true ->` branch**, a framed panel that reads as "loaded, nothing to show" for a read that was never wired. | `heex-primitives.ts` `renderQueryView`; found by the cross-target sweep, not by hand |
| F6 | **Silent decline closed:** `Icon { }` with neither `name:` nor `svg:` on Phoenix emitted `<span class="loom-icon" aria-hidden="true"></span>` — an empty element that reads as a rendered icon. | `heex-primitives.ts` `renderIcon` |
| F7 | Five codes minted with wording in `messages.ts` and anchors in `code-docs.ts` (rule 14: same commit). | `loom.page-primitive-arg-missing`, `-arg-invalid`, `loom.page-ref-unreachable`, `loom.page-expr-unrenderable`, `loom.page-primitive-target-gap` |

### The classification, per the packet's (a)/(b)/(c)

* **(a) genuine decline on valid input** — the overwhelming majority (**75 of 81**). Every "missing
  `of:` / `runs:` / entries / accessor", every "not an in-scope aggregate instance", every "aggregate
  not found", every per-frontend porting gap. Each now names one of the five new codes.
* **(b) unreachable branch** — **not used as a `never`-assertion anywhere, deliberately.** Six
  sites (5 + the one in H3 below) are the backstop to a validator that already refuses the shape
  (`walker-core.ts`'s `ref:` ×2 → `loom.unresolved-page-ref`, `unknown page element` /
  `unknown layout component` → `loom.unknown-page-element`, the registered-primitive-without-a-
  renderer arm → `loom.sub-primitive-misplaced`), and each of those three codes **already describes
  the walker comment in its catalog text**, written before this packet. Converting them to `throw`
  would turn a defence-in-depth comment into a codegen crash on an unvalidated model — which the api
  toolkit and the playground can both hand the generator. Naming the code they back up is the
  stronger form: it says *which gate is supposed to have caught this*.
* **(c) silent fallback emitting something wrong** — F5 and F6, both treated as (a) and routed.

---

## 2. Gated

| Gate | What it pins | Mutation proof (the assertion that failed) |
|---|---|---|
| `test/system/walker-give-up-routing.test.ts` (+3 assertions, 6 tests total) | Every `giveUp`/`giveUpNotice`/`giveUpText` passes a **string-literal catalog key**; `UNCODED_GIVE_UPS` is shrink-only and **EMPTY**; a vacuity guard requires > 50 sites over > 10 files; stale waivers fail. Globs extended with the two heex walker files. | `timeline.ts:43`'s code → `String("loom.made-up-code") as GiveUpCode` (a cast, so `tsc` still passes — the exact shape the type alone cannot stop). **FAILED: "every give-up names a catalogued `loom.*` code"**, reporting `src/generator/_walker/primitives/timeline.ts:43  <not a string literal>`. Reverted by file copy → green. |
| `test/generator/_walker/walker-declines-with-a-code.test.ts` (new, 8 tests) | **The walker invariant.** All 58 registry primitives spelled with NO arguments, driven through all **seven** targets; each target partitions into "refused with a code before codegen" (4 primitives) and "reaches the walker", and every decline the latter produce carries a catalogued code. Per-primitive attribution via probe-marker bracketing + a measured control pair. | `emitTimeline`'s missing-entries arm → a bare `return ""`. **FAILED on 5 of the 8 tests** — react / vue / svelte / angular / feliz, each: "these primitives emitted NOTHING between their probe markers — no markup and no give-up", `expected [ 'Timeline' ] to deeply equal []`. (flutter and phoenixLiveView stayed green *correctly*: both fork the whole primitive through their own `renderTimeline` / HEEx arm, so the mutated shared arm is not on their path — which is itself a useful reading of the result.) Reverted by file copy → 8/8 green. |
| `test/generator/_walker/walker-give-up-corpus-shapes.test.ts` (new, 2 tests) | The corpus fixture still validates CLEAN (it stops being a witness the day a validator takes one of its shapes over — and must fail loudly rather than quietly stop covering) and each declared shape reaches its declared code in the emitted page. | n/a — it is the rule-13 witness for the gates above, not a gate of its own. |
| `test/system/diagnostic-catalog.test.ts` (orphan check extended) | A code named at a give-up call site counts as USED. Codegen has no `diagMessage` channel, so the five new codes would read as orphans. The link stays machine-checked **both ways**: `GiveUpCode = DiagnosticMessageKey` one way, this scan the other — deleting the last give-up naming a code deletes its entry too. | The check failed with exactly the five new keys before the extension (that is how it was found). |
| 7 wording pins updated | They now pin the **code** as well as the sentinel — strictly more than before. | `feliz-`/`flutter-pack-groundwork`, `heex-unsupported-primitive` (×2), `heex-standalone-op-form-marker`, `walker-key-value-row`, `walker-form-of`, `walker-query-view` |

### Why the invariant test brackets its probes (worth keeping if this file is ever edited)

A plain `Stack { P1 { }, P2 { }, … }` proves the codes are there but **cannot see a primitive that
renders nothing at all**: a silent `return ""` only shortens the joined body, and the "carries a
code" assertion stays green on the *other* primitives' give-ups. That is branch (C) in its purest
form — the one the file is named for. Each primitive is therefore bracketed by two literal `Text`
markers, and the region between them compared against a **control pair** with nothing between it;
the control *measures* what two adjacent markers cost on that target rather than assuming it, so the
comparison needs no per-target knowledge and cannot drift when a pack changes its text wrapper.
Before the bracketing was added, the `return ""` mutation was **invisible**.

One target-specific gotcha, recorded in the test: the region lookup uses `lastIndexOf`, not
`indexOf`. Feliz emits its i18n catalog at the top of `App.fs`, one row per translatable string
**ordered by hash**, so the first occurrence of every marker is a catalog row in an order unrelated
to the page body (`CtlE` precedes `CtlB` there). The render is always the last occurrence.

---

## 3. Rule 13 — the fixture, and where the repo said it may NOT live

`test/fixtures/walker-give-up-shapes.ddd` is the first CHECKED-IN `.ddd` that authors a give-up.
Until it landed, every one of the walker's decline paths was exercised only by probes written inline
inside individual unit tests, so the codes they now carry had no fixture that would notice them
rotting. Five shapes, each verified to validate `0 error(s)` before it went in:

| shape | code |
|---|---|
| `Timeline { }` | `loom.page-primitive-arg-missing` |
| `IdLink { }` | `loom.page-primitive-arg-missing` |
| `DestroyForm { }` | `loom.page-primitive-arg-invalid` |
| `Icon { name: "no-such-glyph-…" }` | `loom.page-primitive-arg-invalid` |
| `CreateForm { of: "Ghost" }` | `loom.page-ref-unreachable` |

**It is deliberately NOT under `test/fixtures/corpus/`, and the first attempt to put it there was
right to fail.** Rule 13 names the corpus, but the corpus is a BACKEND feature matrix and two of its
own gates say so normatively:

* `test/system/clause-census.test.ts` — *"the corpus fixtures still carry no `ui` — the other half of
  §82, stated"*, whose comment ends **"If this ever flips, the comment is wrong rather than the code
  — read it before deleting the assertion."** The fixture flipped it;
* `test/conformance/feature-doc-coverage.test.ts` — `FEATURE_DOCS` admits only docs describing an
  authorable DOMAIN feature, and a `doc:` citation outside that set fails.

Both caught it, which is the gates working. Forcing it in would have meant deleting a reviewed
property to make a rule of thumb fit — so the fixture moved to `test/fixtures/`, beside
`dispatch-sample.ddd` / `outbox-sample.ddd`, read directly by
`test/generator/_walker/walker-give-up-corpus-shapes.test.ts`. **Note for the wave rules:** rule 13's
"under `test/fixtures/corpus/`" is right for a domain/backend shape and wrong for a frontend one;
the general form is "a checked-in `.ddd`, in the fixture home its subject belongs to".

Two codes are not witnessed by this fixture, and the header says why rather than papering over it:
`loom.page-primitive-target-gap` is per-FRONTEND (it cannot fire on the react host the fixture
declares — the cross-target sweep covers it on all seven), and `loom.page-expr-unrenderable` is the
markup-position expression backstop, which **no authored `.ddd` shape is known to reach today**.

## 4. Flipped

| Mission | From | To | Evidence |
|---|---|---|---|
| **M-T9.55** | `open` · P0 ⭐ | **`done` (2026-09-11)** | Three-slice table in the heading: slices 1+2 = #2843 (glob + routing), slice 3 = this packet (codes, ratchet, invariant, corpus witness). Body rewritten to record what slice 3 was *for*, the HEEx blind spot, and the residue below. |

`M-T9.55`'s section is flipped **in place**; moving it to `archive/T9-done.md` is outside this
packet's fence and is the coordinator's C0.4-style sweep.

---

## 5. Handed off (NOT fixed here)

| # | What | Repro / where | Why not here |
|---|---|---|---|
| H1 | **The codes are not yet CLI diagnostics.** A give-up names its code in the generated comment; `ddd generate system` still exits `0 error(s), 0 warning(s)` on a page that renders nothing. The honest completion is a phase-⑨ pass that scans the emitted file map for `GIVE_UP_RE` (exported from `give-up.ts` for exactly this) and reports one diagnostic per hit. It needs **no emitter change** — the code is already in the output — and it is derived from the emitters' own output, so it cannot drift. | `src/system/` (out of this packet's fence; `src/system/index.ts` has no diagnostic channel at all today). Repro: `node bin/cli.js generate system` on `test/fixtures/corpus/walker-give-up-shapes.ddd` → 5 `loom:unrendered [loom.…]` comments, `0 warning(s)`. | Fence. This is the follow-on the drain unblocks. |
| H2 | **HEEx named-icon parity gap.** `renderIcon` in `heex-primitives.ts` does `void name` and never consults the builtin glyph registry, so `Icon { name: "trash" }` — a perfectly valid icon that renders on all six JSX/markup targets — emits an empty `<span class="loom-icon">` on Phoenix. Only the *nothing-named-at-all* case was routed here (F6). | `src/generator/elixir/heex-primitives.ts` ~line 2210, beside the routed give-up. `lookupBuiltinIcon` is already imported in that file. | It is a PARITY defect, not a give-up-routing one, and closing it changes the emitted bytes of **every valid named icon** on Phoenix — a different blast radius and a different gate (`heex-parity.test.ts`). Smuggling it into a give-up drain would have hidden it. |
| H3 | `loom.page-expr-unrenderable` (`walker-core.ts`'s markup-position `default:` arm) has **no known reachable `.ddd` shape**. Either prove it dead and make it a `never`-check, or find the shape and add a fixture. | `src/generator/_walker/walker-core.ts:~1206` | Proving unreachability needs an exhaustive `ExprIR.kind` argument over what the page-body lowerer can produce — a walk-census-shaped job, not a give-up-routing one. Left coded so it is honest either way. |
| H4 | `src/diagnostics/unsupported-register.ts` has **no row for `loom.page-primitive-target-gap`**, which is a genuine per-target porting gap (7 sites: Timeline / ProvenanceInfo on feliz+flutter, the HEEx instance-op-form, both procedural packs' missing-renderer fallback). It escapes the register because the register keys on the `-unsupported` / `-backend` suffix and this code carries neither. | `src/diagnostics/unsupported-register.ts` | Naming it `*-unsupported` would have obliged a register row in a file outside the fence, and the register's own header is explicit that the classification is a **reviewed** field, not one derivable from the name. Flagging rather than deciding. |

| H5 | **The cross-frontend matrix's `GAPS` is not ratcheted.** `test/platform/allowlist-ratchet.test.ts` pins the entry count of the showcase ALLOWLIST, the corpus compile-skip maps, the HEEx frozen set and `KNOWN_GAPS` — but NOT `frontend-showcase-render.test.ts`'s `GAPS`, the register that says "this frontend × ui cell does not render". A new frozen gap can therefore be added with no count moving anywhere. This packet added one (see below), which is exactly the event a ratchet exists to make visible. | `test/platform/allowlist-ratchet.test.ts` | Adding a register to that ratchet is a decision about the ratchet's scope, not part of a give-up drain — and doing it in the same PR that adds an entry would look like covering the tracks. |

### The gap this drain REVEALED (not introduced)

Routing the HEEx give-ups through `giveUpText` gave them the sentinel — and the cross-frontend
matrix finds silent degradation *by* that sentinel, so one HEEx cell that had been passing went red:

> `heex:Console does not render: MARKER "loom:unrendered" in fe_cell/lib/fe_cell_web/live/kitchen_live.ex`

The gap is **older than this packet**. `Console`'s Kitchen page hands a standalone
instance-qualified `OperationForm { row.<op> }` (inside a `single:` QueryView, no Modal) to the HEEx
walker, which cannot render it — LiveView's op-form needs the `handle_event` + form-binding half
`renderModal` owns. The emitter has *said so in the output* since #2652, and
`heex-standalone-op-form-marker.test.ts` pins that marker deliberately. But the marker was built
inline and carried **no sentinel**, so the matrix could not see it — the same blind spot as F4, one
layer up.

Recorded as a reasoned `GAPS` entry (`"heex:Console"`) with the closing recipe: **Flutter had the
identical finding and closed it** when `renderModal` / `renderOperationForm` grew the
instance-qualified arm, so the HEEx fix is the same shape — teach `renderForm`'s HEEx arm to emit
the form plus its `handle_event` clause, then delete the entry.

### The five gates that had to be taught about the new codes

Worth listing, because each is a register this packet's authors would not have found by grepping:

| Gate | What it wanted |
|---|---|
| `test/system/diagnostic-catalog.test.ts` | the orphan check scans `diagMessage(…)` call sites; a code named only at a `giveUp(…)` read as an orphan — taught it about give-up codes, in both directions |
| `test/system/diagnostic-firing-census.test.ts` | every catalogued code in exactly one bucket: four went to `DRIVEN_ELSEWHERE` with CHECKED pointers, `loom.page-expr-unrenderable` to `UNREACHABLE_PINS` with its reason |
| `test/generator/_walker/render-degradation.test.ts` | its `origins` pin the EXACT emitter template; the three that gained `giveUpText` now name the inner PROSE template (the outer expression also defeats its `${…}` substitution, which does not nest) |
| `test/ir/api-caller-census.test.ts` + `test/system/gate-ledger.test.ts` | both demanded a signed reason for a corpus fixture with no `test e2e` block — moot once the fixture left the corpus, but they caught it first |
| `test/conformance/frontend-showcase-render.test.ts` | see above |

### §18 sentinel overlap (for packet 1d-ii)

Per the packet brief, 1d-ii owns the §18 list. **Checked item by item: NOTHING on that list was
touched.** Not one of them is a `giveUp` site, so the mechanical pass could not have reached them,
and the diff confirms it — every hunk in `walker-core.ts` and `flutter-target.ts` is a single
inserted code argument on an existing `giveUp(...)` call.

One thing ADJACENT to the list is now routed, and 1d-ii should treat it as done rather than
re-open it: `flutter/pack.ts`'s and `feliz/pack.ts`'s `<pack> pack: no renderer for "<name>"`
fallbacks carry `loom.page-primitive-target-gap` via `giveUpText`. They are sentinel-bearing
give-ups (they were already in `frontend-showcase-render.test.ts`'s `FALLBACK_MARKERS`), not §18
TODO/throw sentinels.

**Left untouched**, as instructed: `walker-core.ts`'s
`TODO … hooks {}` (~2015), the three riverpod `TODO(flutter full-parity)` arms,
`flutter-target.ts`'s nested state write, the drizzle predicate `TODO`, the
`extern-functions.ts` / `component-prop-type.ts` throws, `svelte/routes-emitter.ts`'s throw,
`liveview-emit.ts`'s throws, and `elixir/domain-service-emit.ts:453`'s `raise`. None of them is a
`giveUp` site, so none was touched by the mechanical pass.

---

## 6. Gates run, with counts

The final sweep, on the branch tip, after every fix above:

```
npx vitest run test/generator/{react,vue,svelte,angular,feliz,flutter,_walker,elixir}/ \
               test/platform/ test/conformance/ test/system/ test/ir/

  Test Files  962 passed | 1 skipped (963)
       Tests  12200 passed | 31 skipped (12231)
```

| Gate | Result |
|---|---|
| `npx tsc -b` | clean |
| the sweep above (every suite this packet can touch) | **962 files / 12 200 tests, green** |
| `test/system/walker-give-up-routing.test.ts` | 6/6 — the census ratchet, `UNCODED_GIVE_UPS` empty |
| `test/generator/_walker/walker-declines-with-a-code.test.ts` | 9/9 (7 targets + the partition test + the per-code coverage assertion), ~115 s |
| `test/generator/_walker/walker-give-up-corpus-shapes.test.ts` | 2/2 |
| `node scripts/test-typecheck.mjs` | ratchet OK — 182 files, 470 errors, `src/` clean (unchanged) |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| `node docs/build.mjs` | clean |
| `npm run lint` | no finding in any file this packet touched. The repo-wide `biome ci` residue is PRE-EXISTING on the wave base (`dotnet/dto-mapping.ts`, `java/emit/{dto,service,workflow}.ts`, `python/routes-builder.ts`, `ir/types/loom-ir.ts`, `ir/validate/checks/ui-checks.ts`, `language/model-patch.ts`, `platform/hono/v4/routes-builder.ts`, `macros/stdlib/auto-paged-table.ts`, `scripts/measure-pack-spacing.mjs`, `test/ir/wire/wire-spec.test.ts` — none in this diff) and is flagged for the coordinator |

*(`scripts/mission-counts.mjs` does not exist on this tree — the preamble names it, but only
`scripts/ledger-counts.mjs` is present. Nothing to run; flagged.)*

*One docs observation, pre-existing and not fixed here: `RENDERED_SUBDIRS` in `docs/build.mjs`
lists `new-plan`, `new-plan/missions` and the two archive dirs but **not** `new-plan/waves` or
`new-plan/waves/handoffs`, so every track-file link into a hand-off note 404s on the published
site — `T9:265` → `wave-2-numeric-codec.md` and `T6:250` → `wave-2-seeder-contract.md` already do.
The M-T9.55 heading's link to this note follows the same established pattern rather than inventing
a different one; adding the two dirs to that list is a one-line fix for whoever owns
`docs/build.mjs`.*

## 7. Contention with the in-flight PRs

Both named PRs touch this tree and both should merge additively:

* **#2861** (`escapeAttrExpr` seam in `_walker/target.ts`) — this packet does not edit `target.ts`
  at all.
* **#2885** (`IdLink` seam in `_walker/**` + `flutter-target.ts`) — the only overlap is
  `controls.ts:58` (`IdLink: missing 'of:' aggregate ref`) and five lines in `flutter-target.ts`,
  each a single inserted argument on an existing `giveUp(...)` call. If #2885 moves the `IdLink`
  give-up into a new seam, the merge is a one-line re-insertion of `"loom.page-primitive-arg-missing"`
  — and the routing gate will fail loudly if it is forgotten, which is the point.
