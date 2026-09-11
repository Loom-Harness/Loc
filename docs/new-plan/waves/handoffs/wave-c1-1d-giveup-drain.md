# Wave C1 hand-off — packet 1d-i, the give-up drain (M-T9.55) and the walker invariant

*Branch: `claude/c1-1d-giveup-drain`. Commits: `87e1323a` (emitters), `e8adc473` (gates),
`<fixture>` (corpus), `<docs>` (tracker + this note).*

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

* **(a) genuine decline on valid input** — the overwhelming majority (74 of 81). Every "missing
  `of:` / `runs:` / entries / accessor", every "not an in-scope aggregate instance", every "aggregate
  not found", every per-frontend porting gap. Each now names one of the five new codes.
* **(b) unreachable branch** — **not used as a `never`-assertion anywhere, deliberately.** Three
  sites are the backstop to a validator that already refuses the shape
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

## 3. Rule 13 — the corpus fixture

`test/fixtures/corpus/walker-give-up-shapes.ddd` (+ manifest row) is the **first `.ddd` in the corpus
that authors a give-up**. Until it landed, every one of the walker's decline paths was exercised only
by hand-written probes inside individual unit tests, so the codes they now carry had no fixture that
would notice them rotting. Five shapes, all of which validate `0 error(s)`:

| shape | code |
|---|---|
| `Timeline { }` | `loom.page-primitive-arg-missing` |
| `IdLink { }` | `loom.page-primitive-arg-missing` |
| `DestroyForm { }` | `loom.page-primitive-arg-invalid` |
| `Icon { name: "no-such-glyph-…" }` | `loom.page-primitive-arg-invalid` |
| `CreateForm { of: "Ghost" }` | `loom.page-ref-unreachable` |

`backends: ["node"]`, `deployables: ["d", "web"]` — the give-ups live in the FRONTEND project, and
`web` is recognised as an emitted project dir by the node marker (`package.json`) alone, so any other
backend row would fail `corpus-coverage`'s emitted-dirs cross-check.

Two codes are **deliberately not witnessed there**, and the fixture header says why rather than
papering over it: `loom.page-primitive-target-gap` is per-FRONTEND (it cannot fire on the react host
the fixture declares — the cross-target sweep covers it on all seven), and
`loom.page-expr-unrenderable` is the markup-position expression backstop, which **no authored `.ddd`
shape is known to reach today**. It is carried as a coded backstop, not claimed as a witnessed
condition.

---

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

### §18 sentinel overlap (for packet 1d-ii)

Per the packet brief, 1d-ii owns the §18 list. **One item overlaps and is now routed here — 1d-ii
should skip it:**

* `flutter/pack.ts`'s and `feliz/pack.ts`'s `<pack> pack: no renderer for "<name>"` fallbacks now
  carry `loom.page-primitive-target-gap` via `giveUpText`.

**Everything else on the §18 list was left untouched**, as instructed: `walker-core.ts`'s
`TODO … hooks {}` (~2015), the three riverpod `TODO(flutter full-parity)` arms,
`flutter-target.ts`'s nested state write, the drizzle predicate `TODO`, the
`extern-functions.ts` / `component-prop-type.ts` throws, `svelte/routes-emitter.ts`'s throw,
`liveview-emit.ts`'s throws, and `elixir/domain-service-emit.ts:453`'s `raise`. None of them is a
`giveUp` site, so none was touched by the mechanical pass.

---

## 6. Gates run, with counts

| Suite | Result |
|---|---|
| `npx tsc -b` | clean |
| `test/system/walker-give-up-routing.test.ts` | **6/6** |
| `test/generator/_walker/walker-declines-with-a-code.test.ts` | **8/8** (7 targets + the partition test), ~110 s |
| `test/generator/_walker/walker-give-up-corpus-shapes.test.ts` | **2/2** |
| `test/system/diagnostic-catalog.test.ts` + `diagnostic-docs-anchors` + `unsupported-register` + routing | **145/145** |
| `test/generator/elixir/` | **1109/1109** (one pre-existing marker pin updated for the code) |
| `test/conformance/corpus-coverage.test.ts -t walker-give-up-shapes` | **1/1** |
| `test/generator/{react,vue,svelte,angular,feliz,flutter,_walker}/`, `test/platform/`, `test/conformance/` | see §7 |
| `npm run lint` | no findings in any file this packet touched (the repo-wide `biome ci` residue is pre-existing on the wave base — `dotnet/dto-mapping.ts`, `java/emit/*`, `ir/types/loom-ir.ts`, … — none of them in this diff) |
| `node docs/build.mjs` | clean |

*(`scripts/mission-counts.mjs` does not exist on this tree — the preamble names it, but only
`scripts/ledger-counts.mjs` is present. Nothing to run; flagged for the coordinator.)*

---

## 7. Contention with the in-flight PRs

Both named PRs touch this tree and both should merge additively:

* **#2861** (`escapeAttrExpr` seam in `_walker/target.ts`) — this packet does not edit `target.ts`
  at all.
* **#2885** (`IdLink` seam in `_walker/**` + `flutter-target.ts`) — the only overlap is
  `controls.ts:58` (`IdLink: missing 'of:' aggregate ref`) and five lines in `flutter-target.ts`,
  each a single inserted argument on an existing `giveUp(...)` call. If #2885 moves the `IdLink`
  give-up into a new seam, the merge is a one-line re-insertion of `"loom.page-primitive-arg-missing"`
  — and the routing gate will fail loudly if it is forgotten, which is the point.
