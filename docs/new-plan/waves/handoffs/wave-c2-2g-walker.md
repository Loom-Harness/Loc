### C2 packet 2g — shared frontend walker (react / vue / svelte) — `claude/c2-walker`

Tree fence: `src/generator/_walker/**`, `src/generator/{react,vue,svelte}/**`,
`src/generator/_frontend/**`, the JSX/Vue/Svelte packs under `designs/**`, plus
the tests, the corpus fixture the rows needed, the ledger and
`docs/new-plan/**`. Six files OUTSIDE it were edited — three lowering
modules and three suites in other packets' trees — every one named in §8, with
why the fix had nowhere else to live.

Base: `118d0a3f7` (the wave C2 batch-2 coordinator commit, merged into this
worktree before the first change). Commit range **`118d0a3f7..HEAD`** — 6 commits,
the last five listed below plus this note (its own sha is the branch tip; it
is not written here so the note never has to be amended to name itself).

## Commits

| sha | what |
|---|---|
| `b1424ecb4` | **`queryview-lambda-int-plus-literal-concat`** — a page-body read's `data:` lambda binds the RECORD, not the `string` placeholder |
| `49452f59e` | **M-T1.28 residue 2 (F50)** — Svelte's store-reading `derived` and action-body `toast(...)`, both halves, plus a third instance of the same class |
| `1a1f250be` | ledger row → `done`; M-T1.28's status |
| `31c0f1f2a` | the five suites the typing moved, and the ONE place it over-reached (narrowed, not re-pinned) |
| `808e0b7b4` | comment only — say why `aggregateInDocument` is not `findEntityByName` (the first draft's reason went stale inside the same packet) |
| *(this note)* | the hand-off |

**Every file this packet touches** (20 — `git diff --name-only 118d0a3f7..HEAD`),
so the fold can see the whole surface at a glance:

```
src/generator/_frontend/toast-effect.ts          (new)
src/generator/_walker/shared/store-reads.ts      (new)
src/generator/react/toast-runtime.ts             (now a re-export + the path const)
src/generator/react/walker/page-shell.ts
src/generator/svelte/index.ts
src/generator/svelte/walker/page-shell.ts
src/ir/lower/lower-expr.ts                       ← outside the fence (§8)
src/ir/lower/lower-types.ts                      ← outside the fence (§8)
src/ir/lower/lower.ts                            ← outside the fence (§8)
test/ir/page-read-lambda-element-type.test.ts    (new)
test/generator/svelte/derived-store-read-and-toast.test.ts (new)
test/generator/{react/walker-for, elixir/heex-for, feliz/action, flutter/action}.test.ts
test/system/module-global-state-census.test.ts
web/src/examples/svelte-store-showcase.ddd
docs/audits/targets-completeness-2026-08-30.{ledger.json,md}
docs/new-plan/T1-ui-frontend.md
```

**No pack template, no `designs/**` file, and no `src/ir/validate/**` check was
touched** — so the register, the gate sites and the pack layer are all
conflict-free at fold.

## Rows → outcome

| row | outcome | evidence |
|---|---|---|
| **`queryview-lambda-int-plus-literal-concat`** (ledger P2) | **IMPLEMENTED**, all six frontends | `src/ir/lower/lower-expr.ts:1487` (`PRIMITIVE_ROW_SOURCE_ARG`), `:1497` (`rowBindingEnv`), `:1537` (`aggregateInDocument`), `:1565` (`ofReadResultType`), `:1609` (`queryDataType`), `:1266` (the bare-lambda arm reads `env.rowElem`), `:1648` (the `data:` arm); `src/ir/lower/lower-types.ts:172` (`Env.rowElem`); `src/ir/lower/lower.ts:336-347` (`indexAggregatesDeep`). Gate `test/ir/page-read-lambda-element-type.test.ts` (5 cases). |
| **M-T1.28 residue 2 — F50, the Svelte twin** | **IMPLEMENTED**, both halves + a third | `src/generator/svelte/walker/page-shell.ts` (`buildDerivedLines` takes `usedStores` + the full derived-name set; `buildActionLines` takes `externs`), `src/generator/_walker/shared/store-reads.ts` (new, shared with react), `src/generator/_frontend/toast-effect.ts` (new, shared with react), `src/generator/svelte/index.ts` (emits `src/lib/toast-effect.ts` under `uiUsesToastEffect`). Gate `test/generator/svelte/derived-store-read-and-toast.test.ts` (7 cases). Fixture: `web/src/examples/svelte-store-showcase.ddd` grows both shapes (already in the svelte build matrix). |
| **M-T1.8 vue error boundary** | **already done — verify only, nothing built** | `designs/shadcnVue/v1/app-shell.hbs:3,23` and `designs/vuetify/v3/app-shell.hbs:3,17` both bind `onErrorCaptured`. The mission text (T1-ui-frontend.md M-T1.8) already recorded the vue leg as landed; re-verified on this head. The mission's two LIVE pieces (the unhandled-`await` terminus; the `errors {}` construct) are cross-frontend and cross-backend, not a vue row. |
| **M-T1.3 Angular `Chart` leg (verify #2504)** | **already done — verify only** | `CHART_FRAMEWORKS` (`src/ir/validate/checks/ui-framework-checks.ts:287`) names all seven frontends including `angular`, and `src/generator/angular/chart-runtime.ts` + `angular-target.ts:64` `renderChartData` exist. Nothing to build; angular's tree is 2h's anyway. |
| **`modal-controlled-op-form-unsupported`** (M-T1.6) | **NOT built — measured, needs a ruling** | see §1 below |
| **`page-form-locals-unsupported`** (M-T1.1) | **NOT built — measured** | see §2 |
| **`frontend-collection-op-unsupported`** (M-T1.20) | **NOT built — measured** | see §3 |
| **`toast-message-unsupported`** (M-T1.10) | **NOT built — measured** | see §4 |
| **`scaffold-filter-param-unsupported`** (M-T1.15) | **NOT built — measured** | see §5 |
| **`ui-projection-read-unsupported#not-ui-consumable`** (M-T1.3) | **NOT built — measured** | see §6 |

`MAX_OPEN_GAPS` is **unchanged** and `LATENT_SEAMS` is unchanged: no register
row was drained or retired. The one row this packet CLOSED
(`queryview-lambda-int-plus-literal-concat`) is a ledger row, not a `loom.*`
gate, so it has no register entry. Nothing was re-classed `scope`, so no new
`D-*` entry was written — the six open rows below are all "this is real work
with a known shape", not "this is a declared limit".

---

## The two defects, stated properly

### `queryview-lambda-int-plus-literal-concat` — two facts, not one

The ledger's fix note said "fix the member typing of the `QueryView`/`of:`-lambda
parameter". That is half of it, and the half that does not work alone.

A page-body read is headed by a ui-local `api <handle>: <Api>` alias, which
links to nothing, so `Sales.Order.byId(id)` lowers to an **untyped
`method-call`** (`refKind: "unknown"` all the way down — dumped on this head
before writing anything). The `data:` lambda therefore bound its parameter at
the bare-lambda `string` placeholder, `o.qty` typed `string` too, and
`binaryResultType` picked implicit string CONCATENATION:

```ddd
Text { string(o.qty + 1) }          // qty: int
```
```tsx
String((orderById.data.qty + String(1)))     // "51" for qty=5
```

1. **`ofReadResultType`** recovers the declared result type without linking the
   alias: the aggregate is the suffix the chain NAMES, the verb is either a
   standard read (`byId` → the record, `all`/`findAll` → the array) or a
   declared `find`, whose `returnType` answers it. `For`/`Table`/`DataGrid`
   then thread the ELEMENT type of their source argument to every lambda in
   their subtree through `Env.rowElem`, so a nested `Column { field: r => … }`
   binds it too. **Scope note:** `rowBindingEnv` reads the source through
   `inferExprType`, which answers for a typed local — the `QueryView` `data:`
   binding, i.e. the normal path (`data: rows => For { each: rows, o => … }`,
   verified emitting `String((o.qty + 1))`). A raw INLINE read in `each:` /
   `rows:` still resolves to the placeholder; wiring `ofReadResultType` in as a
   fallback there is two lines and was left out of this packet rather than
   re-run the full suite for a shape no example writes.
2. **The ambient entity index was empty.** `indexMembers` (lower.ts) recursed
   through `members` only, and a `Subdomain`'s children hang off `contexts` —
   so for the overwhelmingly common `system { subdomain { context { … } } }`
   layout the project-global index held **zero** entities, and step 1's
   `entity Order` binding still could not resolve `qty` (`memberTypeOn` →
   `findEntityByName` → ambient). Its own comment has always claimed to index
   "every value object / enum / entity across the import graph (recursing into
   systems / subdomains / contexts)".

**Verified on all six frontends** from one `.ddd` mounting six deployables
(scratch fixture, not committed): react `String((o.qty + 1))`, vue/angular
`{{ String((o.qty + 1)) }}`, svelte `{String((o.qty + 1))}`, feliz
`string (o.qty + 1)` (was `o.qty + (string 1)` — F# `int + string`, a build
break), flutter `(o.qty + 1).toString()` (was `o.qty + 1.toString()` — Dart
`int + String`, a build break). `* 2` and `+ o.qty` byte-identical.

**Mutation-proved by file-copy revert, each half separately.** Dropping the
`contexts` recursion: 2 of 5 fail on `expected '…' to contain
'String((orderById.data.qty + 1))'`. Refusing `ofReadResultType`'s answer
(`if (t) return undefined;`): the same 2 fail identically. The suite also pins
that a genuinely `string` member STILL concatenates (`o.label + String(1)`) —
the fix is a binding fix, not "stop wrapping literals", and that assertion is
what separates them.

### F50 was three instances, not two

The mission recorded the *derived* and *toast* halves. Wiring each one
surfaced the next:

- **derived** — `buildDerivedLines` evaluated every initialiser against a
  throwaway context with no `usedStores` map, so `recordStoreUse` no-oped.
- **…which exposed a NAME disagreement the react side already handles.** The
  shell's store wiring reserves the FULL derived-name set when it picks a
  member's local, while a derived's own context knew only the derived seen so
  far — so `derived count: int = Cart.count` emitted `const count =
  $derived(count);` beside a `cartCount` binding. React's private
  `collectStoreReads` is now `src/generator/_walker/shared/store-reads.ts` and
  both shells fold the colliding names in.
- **toast** — `src/lib/toast.svelte.ts` exports an OBJECT (`{ items, success,
  error }`) the pack's `realtime-toast` template renders, not a callable, and
  its container mounts only on the realtime path. So the page effect gets the
  self-mounting module beside it at `src/lib/toast-effect.ts`; that source and
  the two IR predicates gating it were react-private and are now
  `src/generator/_frontend/toast-effect.ts` (react's `src/lib/toast.ts` keeps
  the identical bytes under its own path).
- **…which exposed a third, Svelte-only.** The action-handler walk shared
  neither `externFunctions` nor `usedExternFunctions` with the shell, so an
  `extern` frontend function called ONLY from an action body lost its import
  too — the same TS2304 shape. React already threaded both; svelte now does.

## The five suites the typing moved — and the one place it over-reached

Four are the SAME fact in two costumes, and in both the emission got MORE
correct, so the assertions were re-pinned with the reason rather than the code
reverted:

- **A non-string template hole now stringifies.** `For { each: [1, 2], n =>
  Bold { \`x={n}\` } }` binds `n` at `int`, so the ICU binding is
  `{ n: String(n) }` (react) / `[n: to_string(n)]` (HEEx) rather than a bare
  `n`. **Probed side by side before touching the tests:** a DECLARED
  `component Row(n: int)` with the same body has ALWAYS emitted
  `{ n: String(n) }`. `react/walker-for`, `elixir/heex-for`.
- **`loom.action-op-has-params` was DEAD on the one shape it exists for.** The
  gate bails unless the instance ref carries `type.kind === "entity"`
  (`ui-action-body-checks.ts:349`), and a `QueryView` `data:` binding carried
  the placeholder — so `Action { p.discount }` on a **detail page's loaded
  record**, the canonical case the gate was written for, never reached it and
  degraded to a comment inside generated Dart / F# instead. It now fires.
  `feliz/action` and `flutter/action` assert the phase-⑦ refusal AND keep the
  seam's give-up assertion via `generateSystemFilesUnchecked`.

The fifth was a genuine over-reach and is **narrowed, not re-pinned**:
`page-primitive-extra-children` reported `Money { 10, "dropped" }` clean,
because widening the ambient index made a `valueobject Money` declared in ANY
context shadow the `Money` **walker primitive** in every page body — silently,
on a model that validated before. That is a name-precedence ruling (which wins
in a ui body — the page-primitive vocabulary or a user declaration?), not a
lookup fix. The subdomain recursion therefore widens **aggregates only**
(`indexAggregatesDeep`, lower.ts), which is all the page-body read resolution
needs; the value-object / enum / domainService halves are untouched. **Decision
needed from the owner — see §7.**

## Local gates run on the merged tree

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | `181 files, 469 errors, src/ clean` — baseline unmoved |
| `npm run lint` (`biome ci .`) | 0 errors, 24 warnings (the pre-existing baseline) |
| `node scripts/mission-counts.mjs --check` | up to date |
| `node scripts/ledger-counts.mjs --check` | `.md matches the JSON` |
| `npm test` | **2057 files / 24 133 tests pass; 4 fail, all environmental** — `packaging-split-fs-discovery` ×3 + `packaging-split-core-pkg` ×1, which cannot pass in ANY git worktree (no `node_modules/@loom` workspace symlinks; verified — `/home/user/Loc/node_modules/@loom` is an EMPTY directory, and the failures read `expected undefined to be defined` for every backend, i.e. fs-discovery found none at all). Exactly the residue packet 2b recorded. 22 min wall clock at load ~10. |
| generated-svelte-build, `svelte-store-showcase.ddd × shadcnSvelte@v1` | **PASS** — `npm install` + `npx svelte-check --tsconfig ./tsconfig.json --fail-on-warnings` + `npx vite build`, 53 s, on the fixture carrying BOTH F50 shapes. This is the runtime-adjacent proof the row wanted: the two symbols the defect left undeclared are exactly what `svelte-check` reports. |

**On `npm test`.** The run BEFORE the fallout commit (`31c0f1f2a`) was 10
failures in 8 files: the 6 this packet caused — all five explained above, plus
the module-global census wanting a pin for the new WeakMap — and the same 4
environmental ones. Each of the 6 was re-run green individually after its fix,
and the final whole-suite run above confirms it: **the failure count went
10 → 4, and the remaining 4 are the pre-existing worktree residue**, so this
packet leaves the suite exactly as it found it.

**The box ran out of disk mid-verification** (`/` hit 100%, 6.1 MB free —
three packets plus their generated-project installs share it). That aborted one
full-suite run into "0 test" worker crashes and one build-gate mutation proof
with `npm error code ENOSPC`. Cleaned up this packet's own temp trees
(`/tmp/loom-{svelte,angular}-build-*`, `/tmp/loom-vue-stack-*`, the scratch
generate outputs, `/tmp/node-compile-cache`) and re-ran; if the fold sees a
harness failure that names ENOSPC or reports suites with `(0 test)`, check
`df -h /` before reading it as a regression.

---

## §1 `modal-controlled-op-form-unsupported` (M-T1.6) — needs a ruling before it can be built

**The register's drain condition and the gate's own membership set disagree,
and that is the blocker, not the emitters.**

`CONTROLLED_MODAL_OP_FORM_FRAMEWORKS = {angular, feliz, phoenixLiveView}` —
the three the gate treats as SUPPORTED. Read what they actually do: the row's
own `what` says they "fork the primitive and render the operation form
**(ignoring the `open:` binding**, driving the dialog from their own
trigger)". So the accepted behaviour is a *degradation* — the author's `open:`
state is dropped — while the register's drain condition for the other four is
"render the controlled shell around the recorded `OperationFormState`", i.e.
genuinely honour it.

Those are different bars, and which one is right decides the size:

- **Match the degradation** (react/vue/svelte fall through to the
  trigger-driven op-form modal with a synthesised trigger label, exactly as
  angular/feliz do) → a ~20-line change in `emitModal`
  (`src/generator/_walker/primitives/forms.ts:960`), the gate deleted,
  `MAX_OPEN_GAPS` −1. But it ships a silent drop of `open:` on seven targets
  instead of four, which is the class this wave exists to remove.
- **Honour `open:`** → the op form has **no inline markup** (`walk(formChild,
  ctx, depth)` returns `""`; packs render it from `ctx.formOfs` through their
  own module component, which owns its trigger). So a controlled shape needs a
  NEW pack template — an op-form module rendered without its own trigger,
  driven by the page's state — in every JSX/Vue/Svelte pack. That is
  design-pack work across 10 packs, not a walker row.

**Recommendation:** rule it first (a `D-*` on whether `open:` + `OperationForm`
is a supported shape at all, or sugar the author should not write), then size
it. Owner: M-T1.6.

## §2 `page-form-locals-unsupported` (M-T1.1) — the "~68 templates" claim is accurate

Measured on this head: `grep -rl "handleSubmit|register(" designs/*/v*/*.hbs`
→ **69 template files across 10 packs** (chakra v2/v3, mantine v7/v9, mui
v5/v7, shadcn v3/v4, shadcnVue v1, vuetify v3; flowbite/shadcnSvelte reach the
same names through `form-of-decls`). `designs/mantine/v9/form-of-decls.hbs`
hardcodes `const create`, `register`, `handleSubmit`, `setError`, `control`,
`formState: { errors }` — and every `primitive-*-form` / `field-input-*`
template that references them has to take the same ordinal. Angular is already
correct (aggregate-scoped locals + #2734's ordinal suffix), so the pattern to
copy exists. This is a pack-wide refactor with a byte-identical-output gate on
the single-form case; it is not a walker row and should be its own packet.

## §3 `frontend-collection-op-unsupported` (M-T1.20) — target-agnostic by design; do not part-land it

The eight refused ops are refused on **every** target with no per-framework
carve-out (the register says so explicitly, and the check confirms it — there
is no framework Set). Landing `sum`/`min`/`max`/`avg`/`first`/`firstOrNull`/
`distinct`/`contains` on the three JS frontends alone would re-introduce the
per-target carve-out the row records as removed, so the honest unit of work is
all seven emitters at once (the money seam for the folds; the launch's
ruling for `first`/`firstOrNull` — `first` throws on empty, `firstOrNull` is
the total form; structural equality for `distinct`/`contains` — which
flutter's wire models have no `operator ==` for, so that half starts with a
codegen change in 2j's tree). Left whole for M-T1.20.

## §4 `toast-message-unsupported` (M-T1.10) — same shape, same reason

`renderMessageExpr` (`src/generator/_frontend/realtime.ts:181`) is a five-arm
switch (`literal`/`ref`/`member`/`paren`/`binary`) that THROWS on everything
else. **The register's "arm-for-arm identical" claim re-verified on this head,
not just cited:** `feliz/realtime.ts:179-187`,
`elixir/realtime-liveview.ts:43-51`, `flutter/realtime.ts:183-191` — the same
five arms and the same `default:` throw in all four. Adding
`convert` / `ternary` / `unary` / `method-call` arms to the `_frontend` one is
an afternoon; doing it there ALONE would make the gate per-target, which the
register records as deliberately not being. The register's own drain condition
is the right one — route the message through each frontend's existing
expression emitter instead of four hand-written subsets — and that is one
seam across four trees, three of which (2a elixir, 2i feliz, 2j flutter) are
not this packet's fence.

## §5 `scaffold-filter-param-unsupported` (M-T1.15) — the two held-back kinds, and why neither is a macro fix

`RENDERABLE_FILTER_PRIMITIVES` (`src/util/filter-param-kinds.ts`) holds back
`enum` and `decimal`/`money`, and the reasons are outside the macro exactly as
documented:

- **enum** — every frontend's state emitter types an enum-valued `state {}`
  field as bare `string` while the query param is the `z.enum([…])` union
  (TS2322). The bar's own `bool` arm shows the shape that works (a three-state
  string `SelectField` + a conversion at the call site: `<state> == "true"`),
  but an enum has no such conversion in the DSL, so the real fix is typing the
  state field as `<Enum> | ""` in `stateTypeAsTsString` and its react / vue /
  svelte / **angular** / feliz / flutter twins — three of those six trees
  (angular 2h, feliz 2i, flutter 2j) are other packets'.
- **decimal / money** — the "unset" sentinel is the int literal `0`, which
  Feliz types `decimal <> int` (FS0001), and `money` binds a `Decimal` that
  `NumberField` does not accept. A per-target zero-literal seam.

Neither is closable inside this fence. Owner: M-T1.15.

## §6 `ui-projection-read-unsupported#not-ui-consumable` (M-T1.3)

A KEYED projection returns rows parameterised by key and a FOLDED one is read
by key off its materialized table; **neither has a frontend client on any
target**, and the per-framework half is already fully ported
(`PROJECTION_READ_FRAMEWORKS` names all seven). So this is not a walker gap at
all — it is a read-path feature (backend route + client hook + the
`Table`-shaped binding) spanning five backends and seven frontends. Mission
work for M-T1.3, not a packet row.

## §7 Decisions needed from the owner

1. **Does a user declaration shadow a page primitive in a ui body?** A
   `valueobject Money` / `enum Badge` / `component Alert` declared in any
   context now has a project-global name; the page-body vocabulary
   (`Money`, `Badge`, `Alert`, `Text`, `Table`, `Column`, …) has the same
   names. This packet's narrowing **avoids the question** (it widens
   aggregates only), and there is no diagnostic for the collision today in
   either direction. It wants a `D-*` and probably a
   `loom.page-primitive-shadowed-*` gate; until then the value-object / enum /
   domainService halves of `indexMembers` stay un-widened and the documented
   intent of that comment stays half-true. **Owner: 2f (`src/ir/**`) or the
   language owner.**
2. **§1's `Modal { open:, OperationForm }` bar** — degrade like angular/feliz,
   or build the controlled op-form pack template. Blocks M-T1.6.

## §8 Hand-offs outside this fence

- **`src/ir/lower/lower-expr.ts`, `lower-types.ts`, `lower.ts` (2f's fence).**
  The page-read typing has nowhere else to live: by the time the walker sees
  the body, the `convert` wrap is already in the IR, and the `data:` binding is
  a phase-⑤ resolution fact. The hunks are self-contained — one new `Env`
  field, one new helper block, one new recursion beside `indexMembers` — and
  touch no other resolution path. **2f: if you are in `lower-expr.ts`, the
  block is `PRIMITIVE_ROW_SOURCE_ARG` … `queryDataType` (contiguous, ~115
  lines) plus the one-line `env.rowElem ?? …` in the bare-lambda arm.**
- **`test/system/module-global-state-census.test.ts`** — one PINNED row for
  the new `aggregatesByDocument` WeakMap (`keyed-cache`).
- **`test/generator/{feliz,flutter,elixir}/…`** — three suites in 2a/2i/2j's
  trees, re-pinned (not weakened) for the reasons above. Each edit is an
  assertion + a comment; no emitter in those trees was touched.
- **The `renderToast` seam (M-T1.28 residue 1) stays open** and now has TWO
  emitted modules behind it (react's `src/lib/toast.ts` and svelte's
  `src/lib/toast-effect.ts`, the same bytes from
  `_frontend/toast-effect.ts:DOM_TOAST_SOURCE`). Whoever builds the seam
  deletes one constant, not two copies.

## §9 Open PRs on this fence — checked, not duplicated

`list_pull_requests` (open, incl. drafts) on 2026-09-14. Of the coordinator's
four named overlaps, **#2902, #2894, #2885 and #2878 had already merged** by
launch; the live ones are:

| PR | overlap | disposition |
|---|---|---|
| #2914 (`vo-subform-row-inputs`) | `_walker` + `_frontend` + the JSX packs | **file lists compared, no intersection.** #2914: `_walker/form-fields-vm.ts`, `_walker/render-primitive.ts`, `_frontend/form-helpers.ts`, `_frontend/view-models.ts`, 8 × `field-input-array.hbs`. This packet: `_frontend/toast-effect.ts` (new), `_walker/shared/store-reads.ts` (new), `react/walker/page-shell.ts`, `svelte/walker/page-shell.ts`, `svelte/index.ts`, `react/toast-runtime.ts`. No pack template touched. |
| #2917 (`fix-svelte-destroyform-thunk`) | `src/generator/svelte/**` | different file (`walker/svelte-target.ts` vs `walker/page-shell.ts`); no hunk overlap |
| #2871 (`page-gate-diagnostics`) | `ui-checks` / `ui-page-structure-checks` | this packet raised no new gate and edited no check file |
| #2865 / #2911 / #2862 / #2864 (audit registers) | list walker defects | none of the six open rows above is claimed there; F50 is M-T1.28's, unclaimed |

Nothing was skipped as already-covered.

## §10 A note on signing

The launch asked for SSH-signed commits. `git config user.signingkey` points at
`/home/claude/.ssh/commit_signing_key.pub`, which is a **0-byte file** in this
container, so `-c commit.gpgsign=true` is a no-op here — `git log --format='%G?'`
reports `N` for these four commits and for the coordinator's own `118d0a3f7`
alike. Nothing in-session can fix that; flagging it so the fold does not read
the missing signatures as this packet's doing.
