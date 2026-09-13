# Agent F — Vue / Angular / scaffold topology (F-032, F-033, F-019)
Base: fresh main `9a8f2fe0`.

## Verification
| Finding | Status | Claimed? | Evidence |
|---|---|---|---|
| F-032 vue nullable `X id?` breaks `vue-tsc` | **FIXED** by `d8b5f7c1` (PR #2885, merged 2026-09-13T12:15Z) | n/a | `npm run build` → `✓ 764 modules transformed. ✓ built in 2.19s  BUILD_EXIT=0` |
| F-033 angular `string[]` → `FormControl(null)` | **LIVE** | UNCLAIMED | `ng build` → `TS2322 … Type 'null' is not assignable to type 'string[]'` ×2 |
| F-019 ui scaffolds an unserved subdomain | **LIVE, worse than filed** | UNCLAIMED | `parse` → `0 error(s)`; `tsc` → **20+ errors** (17×TS18050, TS2304, TS2552, TS7006) |

**F-032 needs no work.** `d8b5f7c1` added `_walker/primitives/id-link.ts`; the guard now emits a
`<template v-if='row.assetId'>` / `v-else` pair and `vue-tsc` narrows through it. #2885 also landed the
gate that would have caught it — the vue build test's scaffold case gained `placedBy: Customer id?`.

## F-033 — Angular: `controlInit` has no array arm
`src/generator/angular/form-fields.ts:220` — `controlInit(t)` has arms for `primitive`, `enum`, `id`,
then falls through to `return "null"` at `:242-245`. **No `array` arm.** The comment directly above
already reasons about this exact TS2345/2322 shape for `id` — the array case is wrong by omission.
A `string[]` reaches the fallthrough because `:596-599` classifies it as *flat*: `arrayVoFields` returns
null for a scalar element, so it is neither "array" (VO arrays only) nor "group", and `fieldInput` has
no array arm either → plain enabled text input, no placeholder, no disable.

**The cross-frontend picture is a 4-way split, not the 2-way one I assumed:**
| frontend | default | input | builds |
|---|---|---|---|
| react | `skills: []` | disabled + `"(arrays not yet supported in forms)"` | ✅ |
| svelte | `skills: []` | disabled + same | ✅ |
| vue | `skills: []` | disabled + same | ✅ (`✓ built in 1.40s`) |
| **angular** | **`FormControl(null, {nonNullable:true})`** | **enabled plain input** | **❌** |
| feliz | `skills = ""` | **real editable field**, comma-split on submit | — |
| flutter | `List<TextEditingController>` | **real repeatable row editor** w/ add/remove | — |

→ **Bonus parity finding:** Feliz and Flutter already ship working scalar-array editors, so the
`"(arrays not yet supported in forms)"` string the other three emit is **factually stale on 2 of 6 targets**.

**Change:** add an `array` arm to `controlInit` (`return "[]"`, dispatching on the *unwrapped* type so
`string[]?` behaves like `string[]`); add an array arm to `fieldInput` returning the disabled input with
the placeholder, three-way by style; add `"arrayUnsupported"` to the three Angular packs' chrome so it
routes through `_i18n` instead of an inline literal. Explicitly **not** in scope: a real
`FormArray<FormControl<string>>` editor — that is a capability addition.
**Test:** `test/generator/angular/array-form-control.test.ts`, modelled on the existing
`money-form-control.test.ts` — the closest precedent, because `money` was the *same* defect class
(`FormControl(0)` vs a `string` wire slot) fixed in the *same* function. Per pack: `[]` init, no
`FormControl(null`, disabled + chrome key, `int` still `0` (guards over-broad matching), VO array still
`FormArray<FormGroup>([])`.
**Mutation proof:** two independent reverts (`cp` aside/back) — `controlInit` arm alone → init assertions
fail, `int`/VO pass; `fieldInput` arm alone → disabled/placeholder fail, init passes. Then `ng build` in
docker: 2 errors → exit 0.
**Blast radius:** Angular only (react/svelte/vue route through `prepareFormFieldVM`; feliz/flutter have
own emitters). Also fixes the page-local form path at `walker/page-shell.ts:53-62`.
**Effort: S** code, **M** with tests + docker proof + i18n golden churn.

## F-019 — a documented obligation that structurally cannot fire
`docs/page-metamodel.md` §3 and §10 both state it. The check that should enforce it —
`checkMethodCallReceiver` (F2), `src/ir/validate/checks/ui-action-body-checks.ts:506` — builds its
handle set **model-wide** (`ui-checks.ts:75-79`), while the walker builds it **deployable-scoped**.
`Bar` is an aggregate *somewhere*, so `handles.has(root.name)` is true at `:514` and F2 returns clean.
At codegen `enrichments.ts:1938-1943` has already narrowed the frontend's `contextNames` to its
target's, so the receiver emits the sentinel and the give-up arm fires.

**Structural reason it was never implemented:** the loop is `for (const ui of sys.uis)` — a ui is
validated with *no notion of which deployable hosts it*, so the `targets` chain the doc names is not in
scope at that point at all.

**It also falsifies an in-code claim.** `src/generator/_walker/walker-core.ts:2010-2016` asserts the arm
is *"DEAD on valid `.ddd`"*, "proven by `unresolved-receiver-give-up.test.ts`". The repro is a valid
`.ddd` that reaches it — that test drives every body *position*, but not every *scoping*. Correct the
comment in the same PR.

**Change:** in `ui-checks.ts`, build a per-ui reachable set from `renderingHosts` (`:127-135`, already
maps ui → hosting deployables, handling `d.uiName` and `d.hostedUiNames`), union `contextNames` across
hosts, and scope `handles` to it **only when the ui has ≥1 host** (an unmounted ui keeps the model-wide
set). Raise a dedicated `loom.ui-scaffold-unreachable-subdomain` rather than letting F2's misleading
"Declare the handle, or fix the reference" speak — the handle *is* declared; the `targets:` chain is
what doesn't reach it. Message drafted for `src/diagnostics/messages.ts` beside `loom.ui-framework-unhostable`;
register in `code-docs.ts` + a firing fixture for `diagnostic-firing-census`.
**Test:** extend `test/ir/ui-body-gate-f2-shapes.test.ts` (the file this directly corrects) — positive;
negative (`contexts: [CA, CB]` clean); no-host ui clean; `hostedUiNames` union case; and a **chained**
`web → bff → api` case, since `enrichDeployables` resolves exactly one hop.
**Mutation proof:** (1) revert `handles` to model-wide → positive fails, all four negatives pass;
(2) delete the unmounted-ui guard → no-host negative fails, positive passes. Then `ddd parse` on the
repro goes non-zero.
**Blast radius — pre-flighted:** six corpus `.ddd` scaffold a selector with >1 subdomain
(`examples/acme`, `showcase`, `vue-showcase`, `web/src/examples/acme`, `pokemon-world`,
`vanilla-daisyui-pack`). Generated all six, grepped for the sentinel: **0 files**, including the two
that scaffold a strict subset. Empty blast radius on the shipped corpus.
**Effort: M** — small code change, but a new *error*-severity gate carries the negatives, the corpus
pre-flight, four diagnostic-registration gates and the corrected `walker-core.ts` claim.

## Corpus skew — the gate answer (feeds §5 of the aggregate plan)
Re-measured on `9a8f2fe0`: **391 `.ddd` files** (the 2026-09-10 audit measured 280 — the corpus grew
~40% in three days and the skew grew with it): react `platform:35`, svelte 9, vue 4, angular 1,
feliz 1, flutter 1.

**A per-*target* floor would NOT have caught either finding. A per-*shape*-per-target floor would.**
Angular already *has* `generated-angular-build.test.ts` with four cases including a full scaffold — the
floor was satisfied and the defect shipped anyway, because:
- the scaffold case's array is `items: LineItem[]`, a **VO** array — the shape Angular handles correctly;
- its only scalar array (`lines: string[]`, line 286) sits in a `store { state { … } }` block, a position
  that structurally cannot reach `controlInit`.

So **the gate contains the literal string `string[]` and still never reaches the code under test** —
`experience_gathered.md` §59/§63's failure shape reproduced at the *fixture* level rather than the
assertion level. F-032 is the same story with the opposite ending: #2885 closed it by adding the missing
*shape* (`placedBy: Customer id?`) to the vue gate, not by adding vue `.ddd` files.
F-019 is a third variety — a **topology** defect, orthogonal to which frontend renders; no corpus gate
can catch it, only a validator.

**Cheapest gate that works:** a derived **field-shape × target coverage matrix**, following the
`walker-stdlib-completeness.test.ts` / `heex-parity.test.ts` ratchet pattern already in the repo.
Enumerate the ~14 shapes a scaffolded form must render (`string`, `int`, `decimal`, `money`, `bool`,
`datetime`, `enum`, `File`, `X id`, `X id?`, `T?`, `T[]` scalar, `VO`, `VO[]`); assert each
`generated-*-build.test.ts` scaffold case covers every shape; missing shape → failure naming shape+gate,
with a ratcheting waiver list. **Cost: one test file + ~12 fields added to four existing fixtures. No new
`.ddd` files, no new CI legs, no new runner slots** — it makes the existing per-pack matrices actually
reach what they claim. Under it F-033 fails day one; F-032 would have too. By-product: it immediately
surfaces the stale `"(arrays not yet supported in forms)"` honesty gap on Feliz/Flutter.
