# Wave C1 hand-off — packet 1d-ii, the §18 emitter sentinels and M-T1.31 F17

*Branch: `claude/c1-1d-sentinels`, stacked on `claude/c1-1d-giveup-drain` (packet 1d-i).
Commits: `f03408da` (the emitters + gates), `76123746` (tests, fixtures, registers, M-T1.32),
`937ae8b1` (biome + the stale comment the drain left), plus the tracker + this note.*

---

## 0. What the §18 list turned out to be

The packet brief lists ten sentinel sites as "emitter-side silent sentinels … with no `loom.*`
code". Every one was RUN on this tree before it was touched — `node bin/cli.js parse` and
`generate system` on a purpose-built `.ddd` — and the list is **not one class but three**, which
is what decided each fix:

| class | what the author sees | count |
|---|---|---|
| **A. CRASH on valid input** | `0 error(s), 0 warning(s)`, then a bare `throw new Error(...)` mid-generate with a ten-frame stack trace and no code | 4 sites |
| **B. SILENT DROP on valid input** | `0 error(s), 0 warning(s)`, a clean build, a comment in the generated source, and a button that does nothing | 4 sites |
| **C. SILENTLY WRONG** | a write performed, but a *different* write from the one authored — with a `TODO` comment making it read as deferred | 1 site |
| **D. already closed** | the sentinel no longer exists; only a comment describing it remained | 1 site |

Class A is not "better than B" in the way it looks. `0 error(s), 0 warning(s)` followed by a
stack trace is indistinguishable from a toolchain bug: the one signal the author has just been
given says their model is fine. And class C is the worst of the three — `notifier.setOrder(v)
/* TODO: nested write order.shipping.zip */` **clobbers the whole `order` cell with the leaf
value**, while the comment says the work was merely postponed.

Every row below carries the command that produced it.

---

## 1. Fixed

### 1a. Reachable on valid input → a `loom.*` code at phase ⑦

| # | Sentinel | Measured BEFORE | Now |
|---|---|---|---|
| F1 | `svelte/routes-emitter.ts` ~232 emitPath collision `throw` | two pages with `route: "/dup"` → `0 error(s), 0 warning(s)` then `Error: svelte: pages 'Alpha' and 'Beta' both route to src/routes/(app)/dup/+page.svelte`, 10 frames | **`loom.ui-page-route-collision`** (`ui-page-identity-checks.ts`), checked on the **route**, not the SvelteKit path — see §1c |
| F2 | `elixir/liveview-emit.ts` ~630 handler collision `throw` | a page `action bump()` + a rendered component's `action bump()` → `Error: platform: elixir — page 'Home' hoists two different \`bump\` handlers into one LiveView` | **`loom.heex-handler-name-collision`** (`ui-framework-checks.ts`, off `src/ir/util/liveview-hoisting.ts`) |
| F3 | `elixir/liveview-emit.ts` ~697 stateful-component collision `throw` | `Counter()` rendered twice with `state { n: int = 0 }` → `Error: platform: elixir — page 'Home' renders component 'Counter' 2 times, but 'Counter' declares \`state\`` | **`loom.heex-stateful-component-reused`** |
| F4 | `_frontend/component-prop-type.ts` two `default: throw` arms | `component Price(amount: money)` → `Error: component prop: unsupported primitive 'money'.`; `(f: File)` and `(at: Address)` likewise (`type kind 'valueobject'`) | **`loom.frontend-prop-type-unsupported`** (`ui-framework-checks.ts`, off `src/ir/util/frontend-prop-type.ts`) |
| F5 | `_frontend/extern-functions.ts` two `default: throw` arms | `function fmt(m: money): string extern from "./lib/fmt"` → `Error: extern function: unsupported primitive 'money' in signature.` | the same code — one gate, both emitters |
| F6 | `flutter/riverpod-emit.ts` ~196, the `private-operation` arm | `action go() { navigate("/other") }` → react emits `const go = () => { navigate("/other"); };` over a real `useNavigate()`; **flutter** emits `// TODO(flutter full-parity): 'private-operation' call 'navigate' in a Notifier method`. Same for `toast("hi")` | **`loom.flutter-action-body-unsupported#view-effect`**, naming successor mission **M-T1.32** |
| F7 | `flutter/riverpod-emit.ts` ~238, the `match await` arm | `match await Shop.Order.delete() { … }` validated clean; **the request, the error reification and every arm body** replaced by `// TODO(flutter full-parity): \`match await\` subject is not a resolvable remote op`. React renders it | **`loom.flutter-action-body-unsupported#match-await-standard-op`**, same mission |
| F8 | `flutter/riverpod-emit.ts` ~212, the `default:` arm | `return` / `precondition` / `requires` in ANY ui action body: `// TODO(flutter full-parity): unsupported action statement 'return'` on Flutter, and on react a bare `Error: react: unsupported statement 'return' in a page event handler` | **`loom.ui-body-statement-kind`** — the sibling of `loom.if-stmt-page-body-unsupported`, gated once for every frontend |

### 1b. Unreachable → an internal floor that names the gate

| # | Sentinel | The proof | Now |
|---|---|---|---|
| F9 | `elixir/domain-service-emit.ts` ~453 runtime `raise` | Not a codegen failure: it emitted a `def` whose whole body was `raise "…cross-context reading not yet supported"` — code that compiles under `--warnings-as-errors`, ships, and dies on the first call. Structurally dead: a read port comes from a `repo-read` Call, and `lowerDomainService` builds `serviceRepos` from `env.ctx?.members` **alone**, so a port can never name a foreign repository; the body that motivated it lowers to an unresolved `ref` and is refused by `loom.domain-service-cross-context-read` | a **generate-time** `throw` carrying `loom.domain-service-cross-context-read#elixir-emit-invariant`, plus `test/generator/elixir/domain-service-cross-context-floor.test.ts` which asserts the tautology over a two-context model that *wants* to cross, with a port-count vacuity guard |
| F10 | `_walker/walker-core.ts` ~2019 `TODO … needs hooks {} binding` | Dead behind `loom.method-call-unresolved-receiver` (F2, `ui-action-body-checks.ts`) — *and the proof found a hole*, see §3 | routed through `giveUpText("loom.method-call-unresolved-receiver", …)`, so the placeholder names the gate instead of a `hooks {}` binding **the language does not have** |

Neither became a `throw`-in-the-walker: the drain's branch-(b) reasoning holds. The api toolkit and
the playground can both hand a generator an unvalidated model, and a codegen crash there is worse
than a coded comment. The two floors that ARE throws (F9, and the svelte/liveview ones) are in
emitters where the alternative was shipping broken output, not a comment.

### 1c. Fixed rather than gated

| # | What | Why a fix and not a code |
|---|---|---|
| F11 | `flutter/flutter-target.ts` ~216 nested state write | It emitted `notifier.setOrder(v) /* TODO(flutter): nested write order.shipping.zip */` — **not a deferred write but a different one**, clobbering the whole `order` cell with the leaf value, under a comment that reads as "handled". The correct rendering is small and already existed one module away (`riverpod-emit.ts`'s `nestedCopyWith`), so implementing it beat refusing it. Both now share `src/generator/flutter/copy-with.ts` (`riverpod-emit.ts` imports `flutter-target.ts`, so the seam cannot import back — hence the leaf). `renderNestedStateWrite(["order","shipping","zip"], "v")` → `notifier.setOrder(state.order.copyWith(shipping: state.order.shipping.copyWith(zip: v)))` |

### 1d. Already closed — a flip with evidence

| # | What the brief listed | What is on this tree |
|---|---|---|
| F12 | "the drizzle predicate `TODO` fallback — prove dead or gate" | **There is no fallback.** `grep -rn TODO src/platform/hono/ src/generator/typescript/` returns exactly one hit, and it is a COMMENT (`repository-find-predicate.ts:98`, "the caller then falls back to a TODO comment") describing behaviour that no longer exists. Every caller holding a declared filter routes the `null` through `refuseOutOfVocabulary("drizzle-predicate", …)` (`_expr/target.ts`), which throws a `QueryEmissionRefusal` carrying **`loom.query-emission-invalid`**. The comment is corrected; nothing else to do |

### 1e. M-T1.31 F17 — the Flutter extern hatch

`checkUserComponentSupport` skipped `c.extern` for every framework, on the reasoning that "an
`extern` component is a hand-written shim the emitter always wires". Measured per frontend, one
`.ddd` each:

| frontend | what it emits for `component RiskBadge(score: int) extern from "./components/RiskBadge"` |
|---|---|
| react / vue / svelte / angular | `src/components/RiskBadge.props.ts` + the import |
| feliz | `open Components.RiskBadge` + `(RiskBadge {\| score = 3 \|})` |
| phoenixLiveView | `<.live_component module={Components.RiskBadge} id="risk_badge" score={3} />` |
| **flutter** | **nothing** — the call site renders `const SizedBox.shrink()` carrying `loom:unrendered [loom.unknown-page-element] unknown layout component: RiskBadge` |

So the exemption was true of every frontend the gate covered when it was written, and false of the
one it had since gained. It is now the per-framework `EXTERN_COMPONENT_FRAMEWORKS` set, and Flutter
raises `loom.user-component-deferred-target` — the EXISTING code for "this frontend's component
emitter filters it out entirely", rather than a second name for one condition. The walker's own
give-up was doubly misleading here: `unknown-page-element` reads as "you mistyped a name" for a
component the ui **declares**.

`test/ir/user-component-deferred.test.ts` asserts both halves, which is what keeps the row from
outliving the gap: the gate fires, *and* the Flutter emitter really does drop it. The day Flutter
grows a hatch, the second assertion fails and the framework has to join the set.

---

## 2. Gated

| Gate | What it pins | Mutation proof — the assertion that failed |
|---|---|---|
| `test/ir/sentinel-gates.test.ts` (new, 23 tests) | every new phase-⑦ code fires on the measured shape AND stays quiet on the nearest shape that works — distinct routes, a spellable prop type, a DECLARED-op `match await`, feliz for the TS-only prop layer, react for the flutter-only arms | route gate disabled (`if (false as boolean)`, leaving the sibling emitPath/slot checks intact so a test that merely saw "some collision" would still pass) → **5 FAILED**: the four `fires on <framework>` rows with `expected [] to include 'loom.ui-page-route-collision'`, plus the census fixture |
| the same file, statement-kind arm | `return` / `precondition` / `requires` refused on react AND flutter; `let` + a state write still admitted | `BACKEND_ONLY_UI_STMT_KINDS` emptied → **7 FAILED**, all six `refuses <kind> in a <fw> action body` rows plus `loom.ui-body-statement-kind fires` |
| `test/ir/frontend-prop-type-support.test.ts` (new, 46 tests) | the shared predicate compared **against both emitters by running them**, over a domain built from `PRIMITIVES` (so a new primitive joins automatically), with a vacuity guard that the verdicts actually SPLIT the domain | `money` added to `FRONTEND_PROP_PRIMITIVES` in the predicate only → **10 FAILED**, incl. `primitive money: predicate and component-prop emitter agree` with **"predicate says true, emitter says the opposite"**, and both `sentinel-gates` money rows. This is the exact drift the two-copies-across-a-layer-boundary arrangement invites |
| `test/generator/_walker/unresolved-receiver-give-up.test.ts` (new, 7 tests) | five DIFFERENT body positions that can hold a method call, each refused by F2 before codegen; plus the arm driven directly still yields sentinel + code | `page.derived` un-walked again → **FAILED: "an unresolved method-call receiver in a \`derived\` binding reached codegen — the walker arm's claim that F2 precedes it is no longer true"** |
| `test/generator/elixir/heex-component-state.test.ts` (rewritten arms) | both LiveView collisions refused at IR-validate, AND the emitter floor still fires on an unvalidated model | handler-collision gate narrowed to page-own actions → **2 FAILED**, and the more informative one is the emitter test: `expected [Function] to throw error matching /loom\.heex-handler-name-collision.../ but got 'internal: page 'Home' hoists two di…'` — i.e. the FLOOR caught what the gate stopped catching, proving both layers are live |
| `test/generator/flutter/action-body-gaps.test.ts` (new, 4 tests) | the three riverpod arms throw with their code; a DECLARED-op `match await` still emits the full effect | the view-effect arm restored to `return \`// TODO(flutter full-parity)…\`` → **2 FAILED: "promise resolved "Map{ …(54) }" instead of rejecting"** — i.e. the whole project generated happily, which is the defect |
| `test/generator/svelte/route-collision-floor.test.ts` (new, 2 tests) | the SvelteKit floor throws its code; distinct routes still emit both pages | (covered by the route-gate mutation above) |
| `test/ir/user-component-deferred.test.ts` (F17 arms) | flutter gated, feliz/angular not; the flutter emitter really drops it | exemption re-widened to every frontend → **FAILED: "an extern component on a Flutter ui renders nothing and said nothing (M-T1.31 F17)"** |
| `test/generator/flutter/flutter-target.test.ts` | the nested write is now an exact `toBe` on the copyWith chain, plus `not.toContain("TODO")` | the old assertion (`toContain("notifier.setOrder(v)")`) failed on the fix, which is how the silently-wrong write was confirmed |

Six mutations, six file-copy reverts (never `git checkout --`), `tsc -b` clean afterwards each time.

---

## 3. The defect the gates FOUND (not introduced)

`unresolved-receiver-give-up.test.ts` drives five body positions at the F2 gate rather than the one
the original bug report used. Four were refused. The fifth was not:

```
derived v: int = ghost.compute(1)     →  0 error(s), 0 warning(s)
```

`checkBody` was called on `page.body`, `page.title`, `page.requires` and every `action` body — but
**never on a `derived` expression**, on pages or on components. So the one expression surface the
ui body checks did not walk was silently exempt from F1 (Action params), F2 (method-call receiver),
F3 (projection reads), the handler-slot check and the lambda-purity check alike. Fixed in
`ui-checks.ts` (both loops), and the probe battery is what keeps it fixed.

Worth stating as a general lesson for the wave: **a gate's coverage is a claim about POSITIONS, and
the only way to check it is to enumerate them.** The emitter comment asserting "this branch is DEAD
on valid `.ddd`" had been true-ish and wrong in one corner for as long as `derived` has existed.

---

## 4. Flipped

| Mission | From | To | Evidence |
|---|---|---|---|
| **M-T1.31** | `open` | `open` (F17 landed 2026-09-11; F11 in flight) | Heading + a three-bullet status block: F17 done here with its mutation proof, F11 left to PR **#2860** (`claude/fix-destroy-form-gate`) per the packet brief, and the walker invariant recorded as landed by packet 1d-i rather than here |
| **M-T1.32** | — | **minted** (`open` · M · P1) | The successor `loom.flutter-action-body-unsupported` names, with both halves of the fix written out (route the view effect out of the Notifier via `ref.listen`; resolve a standard op the way `forms-emit.ts` already derives its routes) and the ratchet that retires it |

---

## 5. Registers taught about the new codes

Five, and none of them would have been found by grepping for the code:

| Register | What it wanted |
|---|---|
| `test/system/diagnostic-docs-undocumented.ts` | a row per new code (6), or a real doc anchor — the ratchet only shrinks |
| `test/system/diagnostic-firing-census.test.ts` | a minimal `.ddd` per code that makes it come out of `validate()`, RUN by the gate. Added a `heexUi` and a `flutterUi` scaffold beside the existing `uiPages`, because three of the codes are per-frontend |
| `src/diagnostics/unsupported-register.ts` | a row per `*-unsupported` code with a `file:line`, a `kind`, and a mission. **`MAX_OPEN_GAPS` 49 → 51**, with the reviewed note per raise — and re-pointing **7 pre-existing rows** whose `file:line` into `ui-framework-checks.ts` my insertions had shifted (the gate checks that a row's site still resolves to its own code within ±20 lines, which is a good check and a real maintenance cost of editing that file) |
| `test/system/diagnostic-catalog.test.ts` | the orphan scan reads only the validator dirs plus a short allowlist, so a `#…-invariant` key rendered from an EMITTER floor read as an orphan. Extended with the five emitter files carrying a floor, on the same reasoning `_expr/target.ts` was added — the wording lives in the catalog, so deleting the last floor that names a code must delete its entry too |
| `node scripts/test-typecheck.mjs` | two new test files gained a `(string \| undefined)[]` error (`LoomDiagnostic.code` is optional). Fixed in the tests, not by raising the baseline |

---

## 6. Handed off (NOT fixed here)

| # | What | Repro / where | Why not here |
|---|---|---|---|
| H1 | **`feliz-target.ts`'s `renderNestedStateWrite: () => "()"`.** The Feliz twin of the Flutter defect this packet fixed, and worse: it emits F# *unit*, so a nested `a.b.c := v` write is dropped with no comment, no sentinel and no code — invisible to the give-up scanner the drain built. | `src/generator/feliz/feliz-target.ts:323` | `feliz-target.ts` is edited by open PR **#2860** (named in the packet brief as contention). The fix is the same shape as F11 — an inside-out record-copy fold — but it needs the Feliz update-emitter's write path read first, and landing it in this packet would have conflicted. |
| H2 | **`loom.frontend-prop-type-unsupported` is a `gap`, and `money` is the cheap third of it.** A money field's react DTO type is `Decimal` (decimal.js, via `moneySchema`), so the prop spelling is `Decimal` plus an import threaded through `dtoImports` — mechanical, but it changes the emitted import block of every component file and wants its own compile gate. `File` (a fixed `FileRef` object) and `valueobject` (which already has a wire DTO) are the other two. | `src/generator/_frontend/component-prop-type.ts` | Draining a register row is a feature slice, not a sentinel drain; doing it here would have hidden a real emission change inside a honesty pass. The row names M-T1.20. |
| H3 | **`loom.page-expr-unrenderable` reachability** (inherited from packet 1d-i's H3). NOT resolved here: it is `walker-core.ts`'s markup-position `default:` arm, and this packet's §18 list did not include it. Still carried as a coded backstop with an `UNREACHABLE_PINS` entry. | `src/generator/_walker/walker-core.ts:~1206` | Proving it dead needs an exhaustive `ExprIR.kind` argument over what the page-body lowerer can produce — the same walk-census-shaped job 1d-i named. The technique this packet used for F10 (enumerate the POSITIONS, drive each one) is the obvious way in, and §3 shows it finds real holes. |
| H5 | **The give-up codes still are not CLI diagnostics** (inherited from 1d-i's H1, and now MORE load-bearing). This packet moved eight conditions from "a comment in the output" to "a `loom.*` error", which sharpens the contrast: the remaining walker give-ups still exit `0 error(s), 0 warning(s)`. The phase-⑨ scan 1d-i described (`GIVE_UP_RE` over the emitted file map) needs no emitter change. | `src/system/` — outside this packet's fence | Fence. |
| H6 | **`docs/build.mjs`'s `RENDERED_SUBDIRS` still omits `new-plan/waves` and `new-plan/waves/handoffs`**, so every track-file link into a hand-off note 404s on the published site — including the two this packet added (M-T1.31's and M-T1.32's). | `docs/build.mjs` | A one-line fix for whoever owns that file; 1d-i flagged it first and this packet followed the same established pattern rather than inventing a different link shape. |

---

## 7. Gates run, with counts

On the branch tip, after every fix:

| Gate | Result |
|---|---|
| `npx tsc -b` | clean |
| `npx vitest run test/ir/ test/generator/ test/platform/ test/system/ test/conformance/ test/language/` | **RESULT_PLACEHOLDER** |
| `test/ir/sentinel-gates.test.ts` | 23/23 |
| `test/ir/frontend-prop-type-support.test.ts` | 46/46 |
| `test/generator/_walker/unresolved-receiver-give-up.test.ts` | 7/7 |
| `test/generator/elixir/domain-service-cross-context-floor.test.ts` | 3/3 |
| `test/generator/flutter/action-body-gaps.test.ts` | 4/4 |
| `test/generator/svelte/route-collision-floor.test.ts` | 2/2 |
| `test/ir/user-component-deferred.test.ts` | 111/111 |
| `test/system/{diagnostic-catalog,diagnostic-firing-census,diagnostic-docs-anchors,unsupported-register}` | all green |
| `node scripts/test-typecheck.mjs` | ratchet OK — 182 files, 470 errors, `src/` clean (unchanged) |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| `node docs/build.mjs` | clean |
| `npm run lint` | no finding in any file this packet touched. The repo-wide `biome ci` residue is PRE-EXISTING on the wave base (`dotnet/dto-mapping.ts`, `elixir/auth-emit.ts`, `elixir/domain/predicates.ts`, `flutter/index.ts`, `java/emit/{dto,service,workflow}.ts`, `python/routes-builder.ts`, `ir/types/loom-ir.ts`, `ir/validate/checks/{ui-checks,ui-collection-display-checks,orm-adapter-checks}.ts`, `language/model-patch.ts`, `platform/hono/v4/routes-builder.ts`, `macros/stdlib/auto-paged-table.ts`, `scripts/measure-pack-spacing.mjs`, and several test files) and is flagged for the coordinator |

*(`scripts/mission-counts.mjs` does not exist on this tree — the preamble names it, but only
`scripts/ledger-counts.mjs` is present. Nothing to run; flagged, as 1d-i did.)*

---

## 8. Contention

* **#2885** (`IdLink` seam in `_walker/**` + `flutter-target.ts`) — this packet's `flutter-target.ts`
  hunk is confined to `renderNestedStateWrite` plus one import and one header sentence; its
  `walker-core.ts` hunk is the `method-call` arm alone. No overlap with an `IdLink` seam.
* **#2860** (`feliz-target.ts`, and M-T1.31's F11) — deliberately untouched, both the file and the
  finding. H1 above is the Feliz sibling of a defect this packet fixed on Flutter and should be
  merged AFTER #2860, not into it.
* **Packet 1d-i** (`claude/c1-1d-giveup-drain`) is merged into this branch, not duplicated: its
  §18 section says none of these sites was a `giveUp` call, and the diff confirms it — the only
  file both packets touch is `walker-core.ts`, where 1d-i inserted code arguments into existing
  `giveUp(...)` calls and this packet rewrote one `return` in the `method-call` arm.
