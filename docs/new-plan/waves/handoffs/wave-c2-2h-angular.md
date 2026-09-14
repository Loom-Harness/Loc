# Wave C2 packet 2h — angular

*Branch `claude/c2-angular`, base `118d0a3f7` (the batch-2 coordinator head, itself `main` @ `9713ffa18` + the wave-log commit). Commits `3c1588b05..<head>`. Tree fence: `src/generator/angular/**`, `designs/{angularMaterial,primeng,spartanNg}/**`, `angular/**` plus the gates/docs/ledger a closed row requires.*

## Rows → outcome

| row | outcome |
|---|---|
| `component-children-unsupported` | **BUILT for the walked flavour; re-classed `scope` for `extern`** under new **D-ANGULAR-EXTERN-CHILDREN**, owner new **M-T1.33**. `MAX_OPEN_GAPS` **24 → 23** |
| the 4 deferred component shapes (`loom.user-component-deferred-target`) | **re-measured, all four still real**; each given a measured recipe in M-T1.20. One (`action(T)`) is now Angular-local and short; two (`slot`) need a walker-core seam → **hand-off to 2g**; one (input-fed read) needs the api client to take a thunk |
| M-T1.14 page-`requires` / nav-link gating parity | **already shipped — verified by generating all four frontends**; mission flipped `done` and archived |
| M-T1.11 `modalTitle` | **already shipped on all three Angular packs, both modal shapes — verified by generating**; the "known remaining hole" note was stale and self-contradictory, corrected in place |
| M-T1.12 field `aria-invalid` / `aria-describedby` on the native packs | **BUILT**, and the gap turned out to be in the FORM path rather than the pack templates. Runtime-proved in a browser on the built bundles |
| the 15 `KNOWN_UNREACHABLE` reactive-forms pins | **re-verified**: 14 structural as stated, **1 measurably wrong reason** (`primitive-modal`) corrected, and half B's fixture extended so the one genuinely null-returning override is exercised |

## 1. `loom.component-children-unsupported` — the walked half drained

**Repro on the base** (`ddd generate system`, 0 errors 1 warning): `component Panel(label: string) { body: Card { Text { label }, Slot { } } }` + `page P { body: Panel("a", Text { "child" }) }` emitted

```
<ng-container [ngComponentOutlet]="Panel" [ngComponentOutletInputs]='{ label: "a" }'></ng-container><!-- Panel: 1 projected child dropped — … -->
```

and the child text appeared nowhere in the project.

**Fix** (`src/generator/angular/walker/angular-target.ts:739` `renderAngularUserComponent`, `:836` `angularTargetFor`; `src/generator/angular/component-selector.ts`; `src/generator/angular/walker/page-shell.ts:688`). Angular has two addressing forms and they were collapsed into one:

- **tag** — a WALKED component is a class Loom emits and stamps `@Component({ selector: "app-panel" })` on, so Loom knows a tag for it. The call site is now `<app-panel [label]='"a"'>…children…</app-panel>`, the class goes in the page's standalone `imports: []`, and the children land in the body's `Slot { }` (`<ng-content>`, which `renderChildrenSlot` already emitted).
- **outlet** — an `extern` component's `@Component({ selector })` is the AUTHOR's, so Loom has no tag to spell; it keeps `<ng-container [ngComponentOutlet]=…>`, which has no content-projection channel, and keeps dropping children.

The tag-addressable set is threaded per walk by `angularTargetFor(<walked names>)` — `index.ts:331` for pages, `components-emit.ts:134` for component bodies — and the page shell keys its two registrations off the SAME set, so markup and registration cannot drift.

The gate narrowed to `c.extern` (`src/ir/util/component-children.ts:69`); the register row is `kind: "scope"`, `mission: "M-T1.33"`.

**Mutation proofs.** Forcing the outlet arm (`if (false && tagAddressable.has(...))`) fails 4 assertions naming the tag form — `expected … to contain '<app-panel [label]='"hi"'>'`, `… '<app-tier-badge [label]='tier()' [level]='3'>'`, `… '<app-ribbon></app-ribbon>'`, `… '<app-tier-badge [label]='"gold"'>'`. Widening the gate back (`ui.components.map` instead of `.filter((c) => c.extern).map`) fails `angular: a WALKED component invoked with children is NOT refused — it projects` with `expected [ Array(1) ] to deeply equal []`.

**Build proof.** `showcase:angularMaterial@v1` generated and `ng build` green under `strictTemplates`. Then the mutation that matters: deleting `Panel` from the page's `imports: []` in the built project fails the same build with `NG8001: 'app-panel' is not a known element` — so the registration this change adds is load-bearing, not decorative.

## 2. M-T1.12 slice 6 — an Angular form field announces its error

**Repro.** A `CreateForm` over an aggregate with wire-translatable invariants rendered the inline message AFTER the whole control and tied nothing to it:

```
<mat-form-field …><input matInput formControlName="priority" …></mat-form-field>@if (…invalid && …touched) {<p class="loom-error" …>Priority is invalid</p>}
```

Visible, inaudible. (The standalone `Field { … error: … }` PRIMITIVE was never the gap — all three packs' `primitive-field.hbs` have carried both attributes since slice 6. The FORM path is Angular's own `form-fields.ts` fork.)

**Fix diverges by pack style, and that is the finding** (`src/generator/angular/form-fields.ts` — the `withFieldError` / `fieldAriaFor` / `fieldErrorId` block; `form-validators.ts:113` no longer appends the message; `create-form.ts:129`, `operation-form.ts:131`, `modal.ts:174` resolve `errorFields` before the markup is built):

- **angularMaterial** — `MatInput` already host-binds `[attr.aria-invalid]` off its own `errorState`, and `MatFormField` derives the input's `aria-describedby` from its `<mat-error>` children. So the fix is PLACEMENT: the message moves INSIDE the form field as `<mat-error id="…">`, and Loom spells no ARIA. Emitting it anyway would be a second writer on one attribute — measured, see below.
- **primeng / spartanNg** — plain `<input>`s with no directive managing either attribute, so Loom binds both, to exactly the condition the message is gated on.

A field with no constraint gets neither and stays byte-identical.

**Runtime proofs** (chromium over the built `dist/browser`, static-served; `priority: int` with `invariant priority >= 1`, seeded 0 so it is invalid):

| | untouched | touched |
|---|---|---|
| angularMaterial | `aria-invalid="false"`, no `aria-describedby`, 0 message nodes | `aria-invalid="true"`, `aria-describedby="orders-new-error-priority"` → 1 node, text `"Priority is invalid"` |
| spartanNg | no aria at all, 0 message nodes | `aria-invalid="true"`, `aria-describedby="orders-new-error-priority"` → 1 node, same text |

**Runtime mutation.** Moving the material message back outside the form field (the pre-fix `<p>`) in the built project and rebuilding leaves `message node count: 1` with `aria-describedby` **absent** — the defect reproduced end to end.

`ng build` green on angularMaterial and spartanNg with the new bindings under `strictTemplates`.

**Hollow-gate fix landed with it:** no case in `generated-angular-build.yml` carried an `invariant`, so the entire Angular validation fork — inline `ValidatorFn` arrows plus template expressions over a typed `FormGroup`, which only `ng build` type-checks — had never been compiled by a gate. The `showcase` case now carries two invariants, and its `mustEmit` pins the message id + condition (deliberately pack-NEUTRAL: pinning either the `<mat-error>` or the `[attr.aria-*]` spelling would fail on two thirds of the matrix).

## 3. The 15 `KNOWN_UNREACHABLE` pins

Fourteen are structural exactly as written: `angularTarget`'s five form overrides delegate to `renderAngular*Form`, whose only `return null` is `call.kind !== "call"` — unconstructible, since the walker registry types the argument. So `primitive-form-of`, `form-default-onsubmit` and the twelve `field-input-*` names stay behind the fork.

**The fifteenth was wrong.** `primitive-modal`'s reason said "angularTarget.renderModal always returns a string". `modal.ts:111` has returned `null` for a state-controlled `Modal { …, open: <state> }` since Angular gained `primitive-modal-controlled` — deliberately, so the shared `emitModal` can reach `emitControlledModal`. The conclusion survives (that fall-through lands on a template all three packs ship, never on `primitive-modal`), the reason does not. Worse, **half B's fixture could not have seen it**: `FORM_HEAVY` is a pure scaffold, so only the op-dialog branch — the one the fork always claims — ran. The pin's reason now states the real mechanism, the fixture grew a hand-written `Board` page with a controlled Modal, and a new assertion requires the angular run to REQUEST `primitive-modal-controlled`.

**Mutation proof.** Forcing `renderCreateForm` to return `null` fails both leak assertions (`the angular run requests none of the exempted templates`, `… nothing outside the available surface`).

`LATENT_SEAMS` unchanged (no seam row retired).

## 4. M-T1.14 — closed, verified by generation

One system (a page with `requires currentUser.role == "admin"` plus an ungated sibling, `auth: ui`) generated through all four static-bundle frontends; the emitted lines are in the archived mission body. Angular emits `@if (currentUser.role === "admin") { … } @else { …Forbidden… }` over an injected `SessionService`, and `@if (…) { <a routerLink="/secret" …> }` in the app shell — the same pair react/vue/svelte emit. Mission archived to `archive/T1-done.md`.

**Recorded, not absorbed:** there is no single CROSS-frontend gate for this pair. Four independent per-frontend tests agree; losing it on one frontend fails only that frontend's file. A `test/system/`-level parity gate would be the fix and is deliberately NOT taken here (shared tree, 2g/2f are live in it).

## 5. M-T1.11 `modalTitle` — closed, verified by generation

Both shapes, all three Angular packs. State-controlled: `<h3 id="boxOpen-title" class="loom-modal-title">{{ t("page.Board.modalTitle.e8x5i7", "ControlledTitle") }}</h3>`, byte-identical across the packs. Op-dialog: `{{ t("page.Detail.modalTitle.v4jvrg", "OpDialogTitle") }}` on the same catalog key react/vue/svelte use. The stale note in M-T1.11 is corrected in place (it contradicted a later sentence in its own paragraph).

## 6. The four deferred component shapes — measured, not built

Each measured by bypassing its own filter and reading the emitted project. The table with the per-shape recipe is now in **M-T1.20** (`docs/new-plan/T1-ui-frontend.md`). Summary:

- **`slot` / optional `slot` param** — the body interpolates the slot as a VALUE (`{{ head }}` over `@Input() head!: unknown`) and the call site binds `[head]='Text("hi")'`, calling a function that does not exist. Closing it needs the body walk to know a ref's declared type is `slot` **and its render position**, so it can emit `<ng-content select="[…]">` — a `src/generator/_walker/**` seam. **HAND-OFF to packet 2g** (see below).
- **`action(T)` param** — now *almost* right, because of row 1: the component emits `@Input() onPick!: (arg: OrderResponse) => void` and the call site `<app-picker [onPick]='(o) => { router.navigateByUrl("/p"); }'>`. Only the binding is wrong (Angular template expressions have no arrow functions; the body would need `this.` too). The remedy is Angular-local and needs no shared seam — hoist the lambda into an arrow-valued class field typed `Picker["onPick"]` (reusing the class the page already imports) and bind the field. Left unbuilt for budget, with the emitted code in the mission body so the next agent does not re-measure.
- **api read whose ARG reads an `@Input()`** — the read hoists as a class-FIELD initializer, which runs before Angular sets inputs. Remedy: make it a reactive query (the exemption `isReactiveQueryRead` already grants user finds), which needs the generated `use<X>ById` to accept a thunk.

## Hand-offs outside the fence

1. **To packet 2g (`src/generator/_walker/**`) — the `slot`-param seam.** The body walk needs to answer "is this ref a `slot`-typed param, and is it in child position?". Today `WalkEnv` carries `paramTypes` (aggregate-typed params only) and `paramNames` (a bare `Set<string>`). The minimal shape is one optional field, e.g. `slotParams?: ReadonlySet<string>`, plus a `renderNamedSlot?(name): string` target seam; Angular would answer `<ng-content select="[loomSlot<Name>]"></ng-content>` and its call site would wrap the arg in `<ng-container ngProjectAs="[loomSlot<Name>]">`. Vue/Svelte already render named slots, so the seam has existing consumers to match. **No edit made in 2g's tree by this packet.**

2. **To packet 2g (M-T1.6, `modal-controlled-op-form-unsupported`) — a cross-frontend defect found in passing.** `Modal { OperationForm { <lambdaBinding>.<op> }, trigger: … }` inside a `For`/`QueryView` lambda generates broken code on three frontends and reports **0 errors, 0 warnings**:

   - react — `onClick={() => openConfirmModal(confirm)}`, where `openConfirmModal` is never declared (TS2304) and `confirm` resolves to `window.confirm`;
   - vue — `@click="openConfirmModal(confirm)"`, same, undeclared in `setup`;
   - svelte — `{@render confirmOpModal(confirmForm)}`, one occurrence in the whole file (never declared);
   - angular — honest: `<!-- loom:unrendered [loom.page-primitive-arg-invalid] Modal: could not resolve the OperationForm operation -->`.

   Repro `.ddd` shape: a `QueryView { of: X.all, data: rows => For { each: rows, o => Modal { OperationForm { o.confirm }, trigger: Button { … }, title: … } } }`. Angular's arm is the only one that degrades visibly, so this is not an Angular row.

3. **To the coordinator — the cross-frontend `requires`/nav-link parity gate** named in §4. It belongs in `test/system/` (a shared tree), so it is reported rather than added.

## Open-PR overlaps on this fence

Checked with `list_pull_requests` (open, incl. drafts) at launch and again mid-packet.

| PR | files on my fence | disposition |
|---|---|---|
| **#2927** (Wave 4 (#2922): Angular can't take a reference collection…) | `src/generator/angular/form-fields.ts`, `src/generator/angular/walker/page-shell.ts` | **Real overlap, not flagged at launch.** My `form-fields.ts` hunks are the new `withFieldError` / `fieldAriaFor` block plus the `flatMarkup` mapping in `partitionAngularFields`; my `page-shell.ts` hunk is only the used-user-component registration loop. #2927 adds a reference-collection form control, i.e. a new `fieldInput` branch — it composes (a new branch inherits the `testid` string that now carries the ARIA) but will conflict textually in `fieldInput`'s branch list. Compose at fold; keep both. |
| **#2905** (Angular root tsconfig compiled the e2e project) | `angular/tsconfig*.hbs` ×3 | No overlap — I touched no `.hbs` under `angular/`. |
| #2894 (four frontends incl. angular: `api-module`, `workflows-module`) | — | Merged before this packet started; nothing open. |
| #2865 (insurance-claims defects) | — | Merged/closed; not in the open list at launch. |
| #2914, #2923, #2911, #2896, #2871 | none matched `angular`/`designs/` on inspection | no action |

Rows skipped because an open PR covers them: **none** — no open PR claims any of this packet's six rows.

## Local gates on the merged tree

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node docs/build.mjs` (the `pages` gate) | exit 0 |
| `node scripts/test-typecheck.mjs` | exit 0 — 181 files, 469 errors, `src/` clean (baseline unmoved) |
| `npm run lint` (`biome ci .`) | 0 errors, 26 warnings (all pre-existing) |
| `node scripts/mission-counts.mjs --check` | exit 0 |
| `node scripts/ledger-counts.mjs --check` | exit 0 |
| `npx vitest run test/generator/angular` | 34 files / 235 tests green |
| `npx vitest run test/platform/pack-render-reachability.test.ts` | 12 green (mutation-proved) |
| `generated-angular-build`: `showcase × angularMaterial@v1`, `showcase × spartanNg@v1` | `ng build` green (node 24 in docker — the host node is 22.22.2, below the Angular CLI floor of 22.22.3, so **every** cell of this leg fails locally on the host; see the note below) |
| `npm test` (full fast suite) | **2147 files / 25286 tests — 4 failed, all `test/platform/packaging-split-*`**: the worktree-only reds batch 1 recorded. A git worktree has no `node_modules/@loom` workspace symlinks (`ls node_modules/@loom` → no such directory here; four entries in the main checkout), so `discoverBackendsFs` finds nothing. Both files read only `src/platform/fs-discovery.ts` and those symlinks, neither of which is in this packet's diff. Batch 1 counted three; the fourth is `packaging-split-core-pkg.test.ts`'s single case, same cause. |

**Environment note for whoever runs this leg locally.** The host node is **22.22.2** and the Angular CLI's floor is **22.22.3 / 24.15 / 26**, so `npx ng build` refuses before compiling anything and *every* cell of `generated-angular-build` and of the Angular `generated-a11y` cell fails identically, with a message that reads nothing like a code defect. The harness already re-throws with the node version for exactly this reason. The workaround used here: let the vitest harness generate + `npm install` (which works on 22.22.2), then run the build in a container —

```
docker run --rm -v <outdir>/web:/app -w /app node:24-bookworm-slim npx ng build
```

The Angular **axe/a11y leg could not be run** for the same reason (it shells `npx ng build` in-process), and it would not have covered this row anyway: the M-T1.12 attributes only appear once a field is touched AND invalid, which a page-load axe scan never reaches. The browser interaction proof in §2 is the substitute, and is strictly stronger for this row.
