# Wave C2 packet 2k — shared walker + JSX/Vue/Svelte/Angular frontends (batch 3) — `claude/c2-walker-3`

*Base `f90e5d78f` (the batch-3 coordinator head). Commit range **`f90e5d78f..HEAD`** — 5 commits, one of them the merge of `origin/main` the coordinator asked for mid-packet, plus this note.*

Tree fence: `src/generator/_walker/**`, `src/generator/_frontend/**`,
`src/generator/{react,vue,svelte,angular}/**`, `designs/**`, plus the gates,
diagnostics catalogue rows, decisions, mission bodies and register the closed
rows require. **Three files OUTSIDE it were edited** — every one named in §7 with
why the change had nowhere else to live.

## Commits

| sha | what |
|---|---|
| `ce743aeb3` | a `Modal` whose `OperationForm` declined no longer emits its opener (the cross-frontend silent-codegen defect 2h found) |
| `98c2523bb` | merge `origin/main` (#2906, #2962, #2959, #2914) — the coordinator's mid-packet instruction |
| `15cb772ae` | `money` / `File` / `valueobject` are component-prop types on all four TS-prop frontends; register row `gap` → `seam` |
| `131e4ebe6` | `loom.component-shadows-stdlib` + **D-PAGE-PRIMITIVE-SHADOW** + **D-MODAL-CONTROLLED-OP-FORM** |
| `d248376cd` | the seven suites the two behaviour changes moved (§10) |
| *(this note)* | the hand-off |

**`MAX_OPEN_GAPS` 20 → 19; `LATENT_SEAMS` 25 → 26.**

## Rows → outcome

| row | outcome |
|---|---|
| the cross-frontend `Modal { OperationForm { <lambda>.<op> } }`-inside-a-`For` defect (2h hand-off §2, "fix first") | **FIXED**, all four; §1 |
| `loom.frontend-prop-type-unsupported` (M-T1.20) | **IMPLEMENTED** on every target the gate names; row re-classed `gap` → `seam`, `MAX_OPEN_GAPS` −1; §2 |
| 2g §7.1 — "does a user declaration shadow a page primitive?" | **DECIDED and BUILT** — `loom.component-shadows-stdlib`, **D-PAGE-PRIMITIVE-SHADOW** `proposed`; §3 |
| 2g §1 / `loom.modal-controlled-op-form-unsupported` (M-T1.6) | **RULED, not built** — **D-MODAL-CONTROLLED-OP-FORM** `proposed`; the build is handed off with its measured cost; §4 |
| `loom.table-filter-unsupported` | **VERIFIED CLEAN on my four**; HEEx half handed to 2m; §5 |
| the `slot`-param walker-core seam (2h hand-off §1) | **RE-MEASURED, not built** — and the measurement changes the recipe; §6 |
| `loom.frontend-collection-op-unsupported`, `loom.toast-message-unsupported`, `loom.page-form-locals-unsupported`, `loom.scaffold-filter-param-unsupported`, `loom.ui-projection-read-unsupported#not-ui-consumable` | **NOT REACHED** — 2g's §3/§4/§2/§5/§6 measurements stand unamended; §8 |
| ledger `M-T1.10-handler-vocabulary`, `F2-CFE-10` | **NOT REACHED**; §8 |

---

**Every file this packet's own commits touch** (35 — the four commits above,
`--stat --name-only`), so the fold can see the surface at a glance:

```
src/generator/_walker/primitives/{for,forms}.ts
src/generator/_frontend/{component-prop-type,extern-functions}.ts
src/generator/react/{pages-emitter.ts,walker/page-shell.ts}
src/generator/vue/{index.ts,walker/page-shell.ts}
src/generator/svelte/{routes-emitter.ts,walker/page-shell.ts}
src/generator/angular/{index.ts,extern-components.ts,walker/page-shell.ts}
src/diagnostics/{messages,code-docs,unsupported-register}.ts
src/ir/types/loom-ir.ts                       ← outside the fence (§7)
src/ir/util/frontend-prop-type.ts             ← outside the fence (§7)
src/language/validators/ui.ts                 ← outside the fence (§7)
docs/decisions.md
test/generator/_walker/{component-prop-money-file-vo,modal-op-form-row-binding}.test.ts   (new)
test/language/validation/component-shadows-primitive.test.ts                              (new)
test/ir/{frontend-prop-type-support,sentinel-gates}.test.ts
test/system/{diagnostic-firing-census,unsupported-register}.test.ts
test/generator/_frontend/{component-prop-type,extern-functions}.test.ts        (the moved floor)
test/generator/svelte/svelte-extern-functions.test.ts                          (fixture rename)
test/generator/elixir/page-derived.test.ts                                     (fixture rename)
test/language/{outline.test.ts,validation/extern-component.test.ts}            (fixture rename)
```

**No `designs/` template and no `src/ir/validate/` check was touched**, so the pack
layer and the gate sites are conflict-free at fold. (The `field-input-array.hbs`
files that show up in a diff of the whole range are #2914's, arriving through the
`origin/main` merge — not this packet's.)

## §1 The `Modal { OperationForm { <row>.<op> } }` silent-codegen defect — fixed on all four

**Repro** (`ddd generate system`, `0 error(s), 0 warning(s)` on the base):

```ddd
page Board {
  route: "/board"
  body: QueryView {
    of: Sales.Order.all,
    data: rows => For {
      each: rows,
      o => Modal { title: "Confirm order", trigger: Button { "Confirm" }, OperationForm { o.confirm } }
    }
  }
}
```

```tsx
// react — BEFORE
<Button variant="filled" onClick={() => openConfirmModal(confirm)}>Confirm</Button>
```

`openConfirmModal` is never declared (TS2304) and `confirm` resolves to
`window.confirm`. vue emitted `@click="openConfirmModal(confirm)"` (same, not in
`setup`), svelte `{@render confirmOpModal(confirmForm)}` with one occurrence in
the file. Angular, which forks the whole primitive, was the only honest one.

**Cause.** `emitModal` (`src/generator/_walker/primitives/forms.ts:972`) walked
the `OperationForm` child purely for its side effect — recording an
`OperationFormState` on `ctx.formOfs` — and **discarded the result**. The op-form
emitter had already declined (it must: the page shell hoists the mutation hook to
function top, and a `For` item only exists inside the iteration callback — React
forbids a hook inside `.map`, and the other frontends hoist for the same shell
reason), so nothing was recorded, the shell emitted no opener and no form module,
and the trigger was rendered anyway.

**Fix, two halves.**

* `emitModal` propagates a form child's give-up instead of dropping it
  (`forms.ts:1005-1020`), so the refusal reaches the page on every target sharing
  the primitive.
* `emitFor` (`src/generator/_walker/primitives/for.ts:74-91`) opens a ROW SCOPE
  via `extendRowScope` — the same scope opener `Table`/`DataGrid` cells use.
  `For` was the third row-rendering primitive and the one left out of M-T1.33, so
  every resolution built on `listRowAggregates` answered "unknown" for a `For`
  item. With the row aggregate recorded, the refusal names the real reason
  instead of calling a resolvable name unresolvable.

```tsx
// react — AFTER
{/* loom:unrendered [loom.page-ref-unreachable] Form(o.confirm): 'o' binds a ROW of Order;
    an operation form needs an instance in scope where the mutation hook is declared
    (a page/component param, or a single-record QueryView 'data:' binding) — not a per-row one */}
```

**Mutation proofs** (file-copy revert, each half separately),
`test/generator/_walker/modal-op-form-row-binding.test.ts`:

| mutation | result |
|---|---|
| `void formChildOut;` (drop the propagation) | 6 of 8 fail — `expected '…' not to contain 'openConfirmModal'` |
| `extendRowScope(ctx, itemVar, itemVar, undefined)` (drop the row aggregate) | 3 of 8 fail — `expected '…' to contain "'o' binds a ROW of Order"` |

The suite also pins the sibling shape that must keep working — the scaffold's own
Detail-page `OperationForm { p.<op> }` under a `single: true` QueryView still
emits the opener, the hook and no give-up. That assertion is what separates
"propagate the child's refusal" from "refuse harder".

**Not closed by this:** making the per-row op form actually WORK. It needs the
row hoisted into its own component so a hook can bind that row's id — a real
architectural change, not an emitter gap, and it is not claimed anywhere.

## §2 `loom.frontend-prop-type-unsupported` — implemented, row re-classed to a seam

```ddd
component PriceTag(amount: money)  { body: Text { string(amount) } }
component Brochure(doc: File)      { body: Text { doc.url } }
component ShipPanel(at: Address)   { body: Text { at.street } }   // Address is a `valueobject`
```

```tsx
// react
import Decimal from "decimal.js";
export interface PriceTagProps  { amount: Decimal; }
export interface BrochureProps  { doc: { url: string; key: string; contentType: string; size: number }; }
export interface ShipPanelProps { at: { street: string; zip: string }; }
```

```ts
// angular
@Input() amount!: Decimal;
@Input() doc!: { url: string; key: string; contentType: string; size: number };
@Input() at!: { street: string; zip: string };
```

vue and svelte spell the same three in their own props syntax (`{ amount: Decimal }`
in svelte's `$props()` destructure, `defineProps` in vue).

**Why each spelling.**

* **money → `Decimal`** — what `moneySchema` parses the wire's decimal string
  into, so it is what `<Agg>Response["price"]` holds. The binding is requested
  through a **sentinel** on the import sink (`MONEY_IMPORT_SENTINEL`,
  `_frontend/component-prop-type.ts`) rather than an import line: decimal.js binds
  through a DEFAULT import and every shell already emits exactly one, so a second
  `import type { Decimal }` beside it is TS2300. Each shell drains the sentinel
  (`takeMoneyPropImport`) and folds it into the line it already owns.
* **File → structural** — `api-module.ts` spells the same four-field object inline
  in `REQUEST_PRIMITIVE`/`RESPONSE_PRIMITIVE`; there is no emitted `FileRef` alias
  to import, and the global DOM `File` is a different type.
* **valueobject → structural, from `vo.fields`** — the emitted `<VO>Schema` lives
  inside whichever aggregate's api module happens to reach it (`api/product.ts`
  for a `Money` under `Product.price`), and a VO no aggregate uses has no schema at
  all, so there is no import path a standalone prop could name. TypeScript is
  structural, so the spelling is assignable from the DTO both ways. The VO index is
  built once per emitter (`valueObjectIndex`) from the bounded contexts the
  frontends already carry.

**The fourth divergence, found while landing it.** Angular never reached the
shared layer: `angular/extern-components.ts`'s `angularWireType` is a private copy
that answered `unknown` for all three instead of throwing — so on that one frontend
the gate was refusing a model that would have emitted silently-wrong types rather
than crashed. That copy now spells the same three, through the same sentinel.

`uiUsesMoney` (`src/ir/types/loom-ir.ts`) grew with it: it looked only at `state {}`
fields, and a money prop is the other producer of a `Decimal` binding — without it
the file imports a package the generated `package.json` never declares.

**Register.** `kind: "gap"` → `"seam"`. `FRONTEND_PROP_PRIMITIVES` now holds every
member of `PrimitiveName`; what still reaches the gate is the carrier kinds, and the
only one a param position can spell (`A or B`) is independently refused by
`loom.union-position` — verified by running it, not by reading the code.

**Mutation proofs** (file-copy revert, three separately),
`test/generator/_walker/component-prop-money-file-vo.test.ts` (9 cases) +
`test/ir/frontend-prop-type-support.test.ts` (50):

| mutation | result |
|---|---|
| angular back to `unknown` for all three | 2 fail — `expected '…' to contain '@Input() amount!: Decimal;'` |
| the shared layer stops requesting decimal.js | react/vue/svelte fail — `decimal.js imports in …: expected 0 to be 1` (an undeclared `Decimal`, TS2304) |
| `uiUsesMoney` ignores params | `expected '{ "name": "loom-react-app"…' to contain 'decimal.js'` |

That last fixture is deliberately a **second** system in which nothing in the
domain is money: in the first, `Product.price` already makes `contextUsesMoney`
true and the assertion would pass with the gate untouched — the hollow-check shape
CLAUDE.md §59/§63 warns about.

**Two suites flipped with the behaviour, not relaxed.**
`test/ir/sentinel-gates.test.ts` — four cases from "refuses" to "ADMITS", plus a new
carrier-kind case that still fires; and the firing-census fixture for the code moved
from `component Price(amount: money)` to `component Picker(x: Order or Order)`. Both
are the ratchet doing its job: a gate that stops refusing has to say so, or the suite
keeps asserting a limit that no longer exists.

## §3 D-PAGE-PRIMITIVE-SHADOW — decided on measurement, and narrower than the default

2g §7.1 asked whether a user declaration shadows a page primitive. Measured on
`main` @ `5049b6fea`, one generation per case:

| collision | what happens |
|---|---|
| `component Alert(msg: string) { body: Heading { msg, level: 3 } }` + `body: Stack { Alert("hi") }` | `0 error(s), 0 warning(s)`. `src/components/Alert.tsx` is written **and** the call site emits the PACK's primitive — `import { Alert, … } from "@mantine/core"` / `<Alert color="red" variant="light">{t("page.Home.alert.sx4lga", "hi")}</Alert>`. The author's `Heading` appears nowhere. |
| `valueobject Money { … }` + `body: … Money { 10, "dropped" }` | the PRIMITIVE wins and its own arity gate fires (`loom.page-primitive-extra-children`). The value object does not capture the name. |

So the blanket default the launch named ("a `valueobject`/`enum`/`component` whose
name is a walker primitive is an ERROR") is wrong in one direction. The decision
refuses the **component** collision only:

* a component (walked or `extern`) is reached by the dispatcher under exactly the
  primitive's name and loses, so the declaration is dead on arrival — the same
  defect `loom.extern-function-shadows-stdlib` has always refused, with the same
  stated reason; the component arm was simply missing. New code
  **`loom.component-shadows-stdlib`**, error at phase ④
  (`src/language/validators/ui.ts`, `checkComponent`), with its catalog text,
  `code-docs` anchor and firing-census fixture in the same commit;
* a `valueobject` / `enum` / `domainService` is not reached by the dispatcher, and
  refusing it would reject `web/src/examples/sales-system.ddd`, which declares
  `valueobject Money` beside pages using the `Money` primitive.

**Corpus scan:** no `.ddd` under `examples/`, `web/src/examples/`, `journey/` or
`test/` declares a component named after a primitive, so the new gate breaks nothing.

**Mutation proof.** `if (false && isWalkerPrimitive(comp.name))` fails 4 of 7 with
`expected [] to include 'loom.component-shadows-stdlib'`
(`test/language/validation/component-shadows-primitive.test.ts`). The suite also
pins the SCOPE line — a `valueobject` sharing a primitive name stays clean, and the
primitive's arity gate still fires on it — so a later widening of the gate fails
there rather than only in the examples corpus.

**Consequence the decision unblocks (2f / whoever is next in `src/ir/lower/`):** 2g
narrowed `indexAggregatesDeep` (`src/ir/lower/lower.ts`) to aggregates ONLY,
explicitly deferring the value-object / enum / domainService halves to this ruling
because widening them looked like it would shadow the primitives. The measurement
says it does not. The halves may be widened when a row needs them. **No row on this
tree needed it, so nothing was widened** — the narrowing and its comment are
unchanged; only the blocker is gone.

## §4 D-MODAL-CONTROLLED-OP-FORM — ruled, handed off, NOT part-landed

The ruling: `Modal { open: <stateBool>, OperationForm { … }, trigger: … }` is a
supported shape and `open:` must be honoured.

`CONTROLLED_MODAL_OP_FORM_FRAMEWORKS` (angular, feliz, phoenixLiveView) names the
three that do not refuse it — but each **drops `open:`** and drives the dialog from
its own trigger. Angular's `renderAngularModal` (`src/generator/angular/modal.ts:123`)
builds a private `<opKey>Open` signal and never reads the binding. So matching the
"supported" behaviour on react/vue/svelte would spread a silent drop from four
targets to seven *and* delete the diagnostic that names it. The decision takes the
higher bar.

**Why it is handed off rather than built.** Measured:

* an `OperationForm` child emits NO inline markup (`walk(formChild, …)` returns
  `""`); every pack renders it from `ctx.formOfs` through a module component that
  **owns its own trigger** — shadcn wraps `<DialogTrigger asChild><Button …>`,
  mui/chakra emit `<Button onClick={() => setOpen(true)}>` beside the dialog, the
  Svelte packs open a `{{opCamel}}ModalOpen` local from their own button. A
  controlled shape needs a second, trigger-less template per pack;
* `designs/shadcnVue/v1/form-op-module.hbs` is still
  `// TODO(vue-forms): operation modal/form module (v-dialog) lands in the forms slice`
  — on Vue the UNcontrolled shape is not built either, so that pack needs the module
  before it can need a controlled variant;
* the three "supported" targets each need their fork taught to read `open:` — 2m's
  tree (HEEx), 2l's (feliz), and Angular's `modal.ts`.

A fix on react alone would re-introduce the per-target carve-out the register
records as the thing to remove, so nothing was part-landed. The row stays
`kind: "gap"` under M-T1.6 with its membership set unchanged; the recipe is in the
decision and in the M-T1.6 mission body.

## §5 `loom.table-filter-unsupported` — verified clean on my four

`TABLE_FILTER_FRAMEWORKS`
(`src/ir/validate/checks/ui-collection-display-checks.ts:278`) already names
react / vue / svelte / angular / feliz / flutter; only `phoenixLiveView` is excluded,
and all four of my targets declare BOTH walker seams (`renderFilteredRows` +
`renderFilterInput` — grepped: `react/walker/tsx-target.ts`,
`vue/walker/vue-target.ts`, `svelte/walker/svelte-target.ts`,
`angular/walker/angular-target.ts`) and each carries its own suite
(`test/generator/{react,vue,svelte,angular}/table-filter.test.ts`). Nothing to build;
no code touched.

**Hand-off → 2m (elixir).** The remaining half is the HEEx parallel walker:
`renderTable`'s `else if` chain handles rows/testid/sort/page and lets `filter:` fall
through into nothing. Drains when the generated `list/4` takes a filter param and the
LiveView grows the matching `handle_event` + `<.input>`. Note that **#2906 (merged
into this branch) is NOT this row** — it fixed the Phoenix SCAFFOLD's filter bar, not
the `Table { filter: <state> }` primitive; the register row and its membership set
are unchanged on the merged tree.

## §6 The `slot`-param seam — re-measured, and the recipe has changed

2h handed this over as a `src/generator/_walker/**` seam. Re-measured here by
generating both sides:

* **react renders it correctly today.** `component Panel(head: slot, label: string)`
  emits `head: ReactNode` and the call site
  `<Panel head={<Text>{t("page.Home.text.sx4lga", "hi")}</Text>} label="x" />`.
  Vue and Svelte likewise (2h's own note says so).
* **angular refuses honestly** — `loom.user-component-deferred-target`, exit 1, with
  a diagnostic naming the component, the parameter, the emitter function and two ways
  out. It is not silent.

So the seam is not a cross-frontend gap; it is an Angular-shaped one, and **2h's own
tag work is the enabler**: since D-ANGULAR-EXTERN-CHILDREN, a WALKED component's call
site is `<app-panel [label]='…'>…</app-panel>`, which *does* have a content-projection
channel. The recipe, concretely:

1. `WalkContext` grows one optional field — `slotParams?: ReadonlySet<string>`
   (`src/generator/_walker/walker-core.ts`, beside `paramNames`, which is a bare
   `Set<string>` and carries no type information);
2. `WalkerTarget` grows one optional seam — `renderNamedSlot?(name: string): string`.
   React/Vue/Svelte do **not** implement it (they already render slot params as
   values/snippets), so the seam is additive and byte-identical on those three;
3. Angular answers `<ng-content select="[loomSlot<Name>]"></ng-content>` from the
   body and wraps the call-site argument in
   `<ng-container ngProjectAs="[loomSlot<Name>]">…</ng-container>`. Both halves must
   agree on one attribute name, so derive it in one place;
4. narrow `hasSlotOrActionParam` (`src/generator/angular/components-emit.ts`) to the
   `action` half, and delete the `slot` arm of the gate in the same PR;
5. gate with `ng build` under `strictTemplates` — **node ≥ 22.22.3 required**; the
   host node is 22.22.2, so run it in docker as 2h did
   (`docker run --rm -v <outdir>/web:/app -w /app node:24-bookworm-slim npx ng build`).

The **optional `slot`** case is the same arm, not a second one
(`hasSlotOrActionParam` unwraps `optional`).

## §7 Files edited OUTSIDE the fence

| file | why it had nowhere else to live |
|---|---|
| `src/ir/types/loom-ir.ts` (`uiUsesMoney`) | the conditional-dep gate that decides whether the generated `package.json` declares decimal.js. A money PROP only became a producer of the `Decimal` binding in this packet; leaving the predicate behind means the emitted file imports a package nothing installs. One function, one added clause. |
| `src/ir/util/frontend-prop-type.ts` | the validator's half of the prop-type fact. The gate and the emitters are pinned against each other by `test/ir/frontend-prop-type-support.test.ts`; teaching one side and not the other fails that gate by construction. |
| `src/language/validators/ui.ts` (`checkComponent`) | the phase-④ home of `loom.component-shadows-stdlib`; its twin (`loom.extern-function-shadows-stdlib`) is 30 lines below in the same file. |
| `src/diagnostics/{messages,code-docs,unsupported-register}.ts` | catalogue + anchor + register rows for the two codes touched — in the fence by the launch's own list, listed for completeness. |

`src/ir/validate/checks/ui-framework-checks.ts` was **not** edited: the gate reads
`frontend-prop-type.ts`, so teaching the util was enough and no check file moved.

## §8 Rows NOT reached, and what stands

None of these was started; **2g's measurements in §2–§6 of
`wave-c2-2g-walker.md` stand unamended** and are still the best available
description:

* `loom.frontend-collection-op-unsupported` (2g §3) — target-agnostic by design;
  eight ops × seven emitters, three of the trees outside this fence.
* `loom.toast-message-unsupported` (2g §4) — one seam across four trees
  (`_frontend/realtime.ts` + feliz/elixir/flutter twins); doing the `_frontend` one
  alone would make the gate per-target, which the register records as deliberately
  not being.
* `loom.page-form-locals-unsupported` (2g §2) — 69 templates across 10 packs; its own
  packet.
* `loom.scaffold-filter-param-unsupported` (2g §5) — the enum arm needs
  `stateTypeAsTsString` and its five twins, three of them other packets'.
* `loom.ui-projection-read-unsupported#not-ui-consumable` (2g §6) — a read-path
  feature across five backends and seven frontends, not a walker row.
* ledger `M-T1.10-handler-vocabulary` (P3) and `F2-CFE-10` (P3) — untouched.

## §9 Open PRs on this fence — checked, not duplicated

`list_pull_requests` (open, incl. drafts) at resume.

| PR | overlap | disposition |
|---|---|---|
| **#2914** (`vo-subform-row-inputs`) | `_walker/form-fields-vm.ts`, `_walker/render-primitive.ts`, `_frontend/form-helpers.ts`, every pack's `field-input-array.hbs` | **MERGED into `main` and into this branch** (`d52cb1235`) before any of this packet's prop-layer work. No longer an overlap. |
| #2942 (page emitter fails open) | the page emitter's unresolved-ref path | §1's hunk is in `emitModal`/`emitFor`, not the ref fallthrough. Same *spirit* (stop failing open), different site — compose at fold, keep both. |
| #2939 (emitted TS names an unimported symbol) | the binder gate | §2's money sentinel exists for exactly this class (an undeclared `Decimal` is TS2304); if #2939's gate lands, the `decimal.js imports … toBe(1)` assertion becomes redundant with it rather than in conflict. |
| #2871 (page-gate diagnostics: `ui-checks`, `ui-page-structure-checks`) | IR-validate leaves | §3's gate is in `src/language/validators/ui.ts` (phase ④), a different file. No hunk overlap. |
| #2949 (invented member read on a primitive) | `lower-expr` member typing | no file in common. |
| #2938 (CR1-e/f waiver drains in `src/generator/_*` default arms) | `_expr`/`_stmt` default arms | this packet touched neither. |

No row was skipped as already-covered by an open PR.

## §10 Local gates on the merged tree

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `npm run lint` (`biome ci .`) | **0 errors, 26 warnings** (the pre-existing baseline) |
| `node scripts/test-typecheck.mjs` | `181 files, 469 errors, src/ clean` — baseline unmoved |
| `node scripts/mission-counts.mjs --check` | up to date |
| `node scripts/ledger-counts.mjs --check` | `.md matches the JSON` |
| `node docs/build.mjs` (the `pages` gate) | exit 0 |
| `npx vitest run test/generator/{_walker,react,vue,svelte,angular}` | 251 files / 2010 tests green (after §1) |
| `npx vitest run test/generator/{_walker,react,vue,svelte,angular} test/ir test/system/diagnostic-firing-census` | 531 files / 5570 tests, **5 failed** on the first pass — all five the ratchets §2 describes (`sentinel-gates` ×4 + the firing-census fixture), each then updated to the new behaviour and re-run green individually. The whole-suite run below is what confirms it. |
| `npm test` (full fast suite, redirected to a file with its exit code appended) | **2198 files / 25 919 tests — 4 failed, all environmental**; see below |

**On `npm test`.** The FIRST whole-suite run was **12 failed / 24 739 passed**
in 8 files, and the split is worth reading rather than the count:

* **4 environmental** — `test/platform/packaging-split-fs-discovery` ×3 +
  `packaging-split-core-pkg` ×1, the worktree-only reds every batch of this wave
  has recorded. A git worktree has no `node_modules/@loom` workspace symlinks, so
  `discoverBackendsFs` finds nothing; neither file is in this packet's diff.
* **3 assert the prop-layer FLOOR that §2 moved** —
  `_frontend/component-prop-type.test.ts` ("THROWS on a value-object param",
  "THROWS on a `money` / `File` primitive") and
  `_frontend/extern-functions.test.ts` ("THROWS on a type with no wire
  spelling"). Each is **re-pointed, not deleted**: what is still below the floor
  is `duration` (expression-only, the one primitive with no wire form at all),
  `slot` (a param marker in a data position), and an UNDECLARED value object —
  the case where answering `unknown` rather than throwing would silently void
  the contract. Each arm also gained the positive assertion that replaces it.
  The stale `it.fails` placeholder proposing
  `number | string | { toString(): string }` for the money arm became a real
  assertion, with the reason that union is NOT what landed: it admits a bare
  `string`, i.e. an unparsed wire value, which is the bug `moneySchema` exists
  to prevent.
* **5 declared a component named after a walker primitive** — `component Badge`
  in `language/outline`, `generator/svelte/svelte-extern-functions`,
  `generator/elixir/page-derived` and `ir/sentinel-gates`; `component Chart` in
  `language/validation/extern-component`. Renamed (`TierBadge` / `SalesChart`)
  rather than narrowing §3's gate: on each of them the dispatcher was resolving
  the call to the PACK's primitive while the component was emitted and never
  rendered, so the fixtures were expressing the defect incidentally. The rename
  keeps every one testing what it means to test.

**That five is the hole in §3's corpus scan, and it is worth naming.** The scan
covered `.ddd` FILES under `examples/`, `web/src/examples/`, `journey/` and
`test/`; these five fixtures are `.ddd` inlined in `.ts` template literals, which
a filename-based scan cannot see. No shipped `.ddd` file collides — five test
fixtures did. **Whoever adds a declaration-name gate next: scan the inline
fixtures too.**

All eight were fixed in `d248376cd` and re-run green individually
(`vitest run test/generator/_frontend test/language/validation
test/language/outline test/ir/sentinel-gates` — 105 files / 1215 tests). The
whole-suite run below is what confirms the packet leaves the suite as it found
it.

**Final `npm test` — `d248376cd`, 2026-09-21.**

```
Test Files  2 failed | 2107 passed | 89 skipped (2198)
     Tests  4 failed | 24750 passed | 6 expected fail | 1159 skipped (25919)
EXIT=1
```

All four failures are `test/platform/packaging-split-fs-discovery` (×3) and
`packaging-split-core-pkg` (×1) — the worktree-only reds batches 1 and 2 both
recorded. Verified here rather than cited: `ls node_modules/@loom` in this
worktree is **No such file or directory**, while the main checkout at
`/home/user/Loc/node_modules/@loom` holds `backend-hono-v4`, `backend-hono-v5`,
`core` and `ui-test-driver`. `discoverBackendsFs` walks those workspace symlinks,
finds none, and every assertion in both files reads "expected undefined to be
defined" / "expected false to be true". Neither file is in this packet's diff,
and neither reads anything this packet touched.

**So the failure count went 12 → 4, and the remaining 4 are the pre-existing
worktree residue: this packet leaves the suite exactly as it found it.**

*(Run-count note for the fold: the FIRST run was the 12 described above; the
SECOND was killed mid-run by a rate limit and a container restart; this is the
third, on the same `d248376cd` tree, after `npx tsc -b` was re-run clean in the
restarted container. The box carried a load average of 15–25 throughout — three
sibling packets plus the coordinator — so the wall clock is not a useful signal
here.)*



**Disk.** The box hit `/` 100 % (191 MB free) mid-packet and a suite died with
`ENOSPC: no space left on device` reported as an *import* failure inside
`src/generator/java/index.ts` — which reads nothing like a disk problem. Freed
~6.6 GB of finished-packet scratch (`scratchpad/{fl,c2j,show,r4,bench,tools,dotnet,gradle-home}`,
all dated 2026-09-11…14, and `/tmp/loom-{pairwise-dotnet-nuget-cache,bootproof-*,bhjv-*,bhui-*}`).
If the fold sees a harness failure naming ENOSPC, or suites reporting `(0 test)`,
check `df -h /` before reading it as a regression.

**Signing.** `-c commit.gpgsign=true` was passed on every commit;
`git config user.signingkey` points at a **0-byte** `commit_signing_key.pub` in this
container, so `git log --format='%G?'` reports `N` for these commits and for the
coordinator's `f90e5d78f` alike. Same environment fact 2g recorded; nothing
in-session fixes it.

## §11 Hand-offs outside this fence

1. **→ 2m (elixir).** `loom.table-filter-unsupported`, HEEx half — §5 names the
   emitter, the fall-through and the drain condition.
2. **→ 2l (feliz + flutter) and 2m.** D-MODAL-CONTROLLED-OP-FORM's three
   "supported" forks all drop `open:` — feliz's and HEEx's halves are theirs; §4
   has the measurement. Nothing to do until the pack-layer packet exists, but the
   ruling is now recorded rather than open.
3. **→ whoever takes M-T1.20's Angular rows.** The `slot`-param recipe in §6 is
   materially different from 2h's (it is Angular-local on top of their own tag
   work, not a cross-frontend seam), plus the two steps that delete the gate arm
   and the docker `ng build` invocation.
4. **→ 2f / the next agent in `src/ir/lower/`.** D-PAGE-PRIMITIVE-SHADOW unblocks
   widening `indexMembers`' value-object / enum / domainService halves; §3 says why
   and confirms nothing was widened here.
5. **→ the coordinator.** The per-row op-form shape (§1, last paragraph) is a real
   product hole with no mission: a list page cannot host a per-row operation dialog
   on ANY frontend, and now says so honestly instead of emitting broken code.
