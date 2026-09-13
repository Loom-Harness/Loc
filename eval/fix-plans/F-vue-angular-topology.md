Verification complete. No files were modified, no PRs opened.

---

# 1. Verification table

| Finding | Status | Claimed? | Evidence (fresh `main` `9a8f2fe0`) |
|---|---|---|---|
| **F-032** (vue) nullable `X id?` breaks `vue-tsc` | **FIXED** by `d8b5f7c1` (PR **#2885**, merged 2026-09-13T12:15:33Z) | n/a — fix merged | Build is green end to end |
| **F-033** (angular) `string[]` → `FormControl(null)` → `ng build` fails | **LIVE** | **UNCLAIMED** | Real `ng build` failure, quoted below |
| **F-019** (topology) ui scaffolds an unserved subdomain | **LIVE** (and worse than reported) | **UNCLAIMED** | `0 error(s)` then 20+ `tsc` errors |

### F-032 — FIXED, no work to plan

`d8b5f7c1` added `src/generator/_walker/primitives/id-link.ts` (+ `shared/row-field-type.ts`, the `extendRowScope`/`cellRowAggregate` fixes). The guard now emits:

```
/tmp/agentF/out-vue/web/src/pages/work_orders/list.vue:57
                <td><template v-if='row.assetId'>
                  <router-link :to="`/assets/${ row.assetId }`" :title="row.assetId">{{ shortId(row.assetId) }}</router-link>
                </template>
                <template v-else>
                  <span>—</span>
                </template></td>
```

and `vue-tsc` narrows through the `v-if`:

```
$ cd /tmp/agentF/out-vue/web && npm run build
> vue-tsc --noEmit && vite build
✓ 764 modules transformed.
✓ built in 2.19s
BUILD_EXIT=0
```

Nothing to plan. PR #2885 also landed the gate that would have caught it: `test/e2e/generated-vue-build.test.ts`'s scaffold case gained `placedBy: Customer id?`.

### F-033 — LIVE

```
$ cd /tmp/loom-main && node bin/cli.js generate system /tmp/repro/angular-string-array-form.ddd -o /tmp/agentF/out-ng
0 error(s), 0 warning(s).
Wrote 76 file(s) in /tmp/agentF/out-ng

$ grep -rn "FormControl" /tmp/agentF/out-ng/web/src/
src/app/pages/tech-new.component.ts:37:  readonly techForm = new FormGroup({ fullName: new FormControl("", { nonNullable: true }), skills: new FormControl(null, { nonNullable: true }) });
src/app/pages/tech-detail.component.ts:79:  readonly updateTechForm = new FormGroup({ fullName: new FormControl("", { nonNullable: true }), skills: new FormControl(null, { nonNullable: true }) });
```

```
$ docker run --rm -v /tmp/agentF/out-ng/web:/w … node:24-alpine … npm run build
✘ [ERROR] TS2322: Type '{ fullName: string; skills: null; }' is not assignable to type 'UpdateTechRequest'.
  Types of property 'skills' are incompatible.
    Type 'null' is not assignable to type 'string[]'. [plugin angular-compiler]
    src/app/pages/tech-detail.component.ts:82:65

✘ [ERROR] TS2345: Argument of type '{ fullName: string; skills: null; }' is not assignable to parameter of type 'CreateTechRequest'.
  Types of property 'skills' are incompatible.
    Type 'null' is not assignable to type 'string[]'. [plugin angular-compiler]
    src/app/pages/tech-new.component.ts:40:50
```

The markup half is wrong too — a plain *enabled* text input with no placeholder and no disable:

```
src/app/pages/tech-new.component.ts:28
  <mat-form-field class="loom-field"><mat-label>Skills</mat-label><input matInput formControlName="skills" data-testid="teches-new-input-skills"></mat-form-field>
```

Claim search: `search_pull_requests` for `"string[]" in:body` (860 results, 20 inspected) and `angular FormControl in:body` (9 results, all closed: #2782, #2672, #1967, #1951, #2033, #2106, #2052, #1344, #1975) returned nothing covering this. #2907's packet **2h angular** fences `src/generator/angular/**` but its row list does not name this defect — **fence overlap, row unclaimed**. #2905 touches only the three Angular packs' `tsconfig.hbs` — no overlap with `form-fields.ts`.

### F-019 — LIVE, and the emitted output is worse than the audit recorded

```
$ node bin/cli.js parse /tmp/repro/ui-scaffolds-unserved-subdomain.ddd
0 error(s), 0 warning(s).
OK: /tmp/repro/ui-scaffolds-unserved-subdomain.ddd

$ node bin/cli.js generate system … -o /tmp/agentF/out-topo
Wrote 81 file(s) in /tmp/agentF/out-topo
$ ls /tmp/agentF/out-topo/web/src/api/
client.ts  config.ts  foo.ts
$ ls /tmp/agentF/out-topo/web/src/pages/
bars  foos  home.tsx
```

```
$ cd /tmp/agentF/out-topo/web && npx tsc --noEmit
src/pages/bars/detail.tsx(21,123): error TS18050: The value 'undefined' cannot be used here.
… (16 more TS18050) …
src/pages/bars/detail.tsx(43,55): error TS2304: Cannot find name 'openUpdateModal'.
src/pages/bars/detail.tsx(43,71): error TS2552: Cannot find name 'update'. Did you mean 'Date'?
src/pages/bars/list.tsx(48,183): error TS7006: Parameter 'row' implicitly has an 'any' type.
TSC_EXIT=2
```

Claim search: `is:open "ui-scaffold" OR "unserved" OR "does not host" in:body` → only #2871 (three unrelated page-body/gate holes). #2861's "subdomain" hit is its README `module` → `subdomain` fix. **UNCLAIMED.**

---

# 2. Fix plans

## F-033 — Angular initialises a scalar array to `null`

### Root cause

`src/generator/angular/form-fields.ts:220` — `controlInit(t: TypeIR)` has arms for `primitive`, `enum`, and `id`, then falls through:

```ts
// src/generator/angular/form-fields.ts:242-245
  // Optional id (`t.kind === "optional"`), value objects and nested entities
  // keep `null`: their request type is nullable or `unknown` (request-side VO/
  // entity stay `unknown` in `wireTsType`), both null-assignable.
  return "null";
```

There is **no `array` arm**. The comment block directly above it (`:236-241`) already reasons about this exact TS2345/2322 shape for `id` — the array case is wrong purely by omission.

A `string[]` reaches that fallthrough because it is filtered into `flat` at `:598`:

```ts
// :596-599
const isArray  = (f) => arrayVoFields(f.type, bc) !== null;   // VO arrays only
const isGroup  = (f) => !isArray(f) && voScalarFields(f.type, bc) !== null;
const flat     = fields.filter((f) => !isArray(f) && !isGroup(f));
```

`arrayVoFields` returns `null` for a scalar element, so a `string[]` is neither an "array" nor a "group" — it is a *flat* field, and `fieldInput` (`:252`) has no array arm either, so it renders the plain-text fallback.

Second-order: the three Angular packs carry no `field-input-array.hbs` and no `arrayUnsupported` chrome string. Measured across all 17 packs:

```
angularMaterial v1  fmt=angular  arrayUnsupported=0
primeng         v1  fmt=angular  arrayUnsupported=0
spartanNg       v1  fmt=angular  arrayUnsupported=0
(every react/vue/svelte pack: arrayUnsupported=1)
```

### Cross-frontend divergence — the honest picture is a 4-way split, not a 2-way one

I generated the same aggregate on all six frontends. The task's framing ("array editing is a known, deliberately-surfaced gap") is true of only three of them:

| frontend | form default | input | builds? |
|---|---|---|---|
| react | `defaultValues: { …, skills: [] }` | disabled `TextInput` + `t("pack.mantine.arrayUnsupported…", "(arrays not yet supported in forms)")` | yes |
| svelte | `createForm(…, { …, skills: [] })` | disabled `Input` + same placeholder | yes |
| vue | `useLoomForm(…, { …, skills: [] })` | disabled `v-text-field`, `v-model="form.values.skills"` + same placeholder | **yes** (verified `npm run build`, `✓ built in 1.40s`) |
| **angular** | **`new FormControl(null, { nonNullable: true })`** | **enabled plain `matInput`, no placeholder** | **NO** |
| feliz | `skills = ""` | **real editable field**, comma-split on submit: `form.skills.Split(',') \|> Array.toList \|> List.map (fun s -> s.Trim()) \|> List.filter …` | — |
| flutter | `List<TextEditingController> _skillsControllers = []` | **real repeatable row editor** with add/remove `IconButton`s | — |

Worth reporting upward: **Feliz and Flutter already implement scalar-array editing**, so the `"(arrays not yet supported in forms)"` string the other three ship is factually stale on two of six targets. That is a separate parity finding, not part of this fix.

### Concrete change

1. **`src/generator/angular/form-fields.ts:220` `controlInit`** — add an array arm before the `null` fallthrough:
   ```ts
   // A scalar array (`string[]`, `int[]`) is a `nonNullable` control over the
   // element array: `getRawValue()` feeds `CreateXRequest.skills: string[]`,
   // and `null` is not assignable to it (TS2345/2322 under `ng build`) — the
   // same failure `money`/`id` already document two comments up.  Editing is
   // not wired (parity with react/vue/svelte's disabled input), so the control
   // holds the empty array the wire accepts.
   if (unwrapOpt(t).kind === "array") return "[]";
   ```
   Dispatch on the **unwrapped** type so `string[]?` behaves like `string[]`, matching what `fieldInput` already does at `:265`.

2. **`src/generator/angular/form-fields.ts:252` `fieldInput`** — add an array arm returning the disabled input with the placeholder, per style (`material` / `primeng` / plain), mirroring the `File` and `enum` arms' three-way shape.

3. **`designs/{angularMaterial,primeng,spartanNg}/v1/pack.json`** — add `"arrayUnsupported": "(arrays not yet supported in forms)"` to the chrome block, so the placeholder routes through `_i18n` and gets a `msg.<hash>` key like the other nine packs rather than being an inline literal.

Deliberately **not** in scope: making the Angular control a real `FormArray<FormControl<string>>` editor (the Flutter/Feliz shape). That is a capability addition with its own blast radius; this change restores build-green and makes Angular say the same honest thing its three JSX/markup siblings say.

### Test to add

`test/generator/angular/array-form-control.test.ts`, modelled directly on the existing `test/generator/angular/money-form-control.test.ts` — the closest precedent, since `money` was the *same* defect class (`FormControl(0)` against a `string` wire slot → TS2345) fixed in the *same* function.

Per design pack (angularMaterial / primeng / spartanNg), on an aggregate carrying `skills: string[]`, `tags: string[]?`, and a control `qty: int`:
- the create and update form groups emit `skills: new FormControl([], { nonNullable: true })`;
- `new FormControl(null` does **not** appear for either array field;
- the markup carries `disabled` and the `arrayUnsupported` chrome key;
- the `int` control field still emits `0` and `type="number"` / `p-inputnumber` (guards against over-broad matching);
- a VO array (`items: LineItem[]`) still emits `new FormArray<FormGroup>([])` — the path `arrayVoFields` owns must not be captured by the new arm.

### Mutation proof

Copy `src/generator/angular/form-fields.ts` aside with `cp` (never `git checkout --` — CLAUDE.md, `experience_gathered.md` §84), revert the `controlInit` array arm to `return "null"`, run the new suite, restore by `cp`. Expected: the three per-pack `[]`-init assertions fail and the `int` / VO-array cases pass. Second mutation: revert the `fieldInput` array arm alone — the `disabled`/placeholder assertions fail while the init assertions still pass, proving the two halves are independently reached. State both results in the PR body.

End-to-end proof (the one that actually closes the bug class): `ng build` on the generated repro in docker goes from the two TS2322/TS2345 errors quoted above to exit 0.

### Blast radius

- **Angular only.** React/Svelte/Vue never call `controlInit` (they route through `prepareFormFieldVM`); Feliz/Flutter have their own form emitters. Verified: all five build or emit correct code today for this field.
- Within Angular, `controlInit` is also called from `walker/page-shell.ts:53-62` (page-local forms) — the same fix improves that path identically; add one assertion there.
- Pack-json chrome additions are additive; `_i18n/validation-catalog.ts` will mint three new `msg.<hash>` keys. Expect `test/generator/*/i18n-*` golden churn.

### Gate that should carry the shape afterwards

`test/e2e/generated-angular-build.test.ts` — the scaffold case (line ~81) currently carries `items: LineItem[]`, a **VO** array, i.e. exactly the array shape Angular handles correctly. Its only `string[]` (line 286) is a `store { state { lines: string[] } }` field, which never reaches a form control. So the gate has **zero** scalar-array-on-an-aggregate coverage. Add `skills: string[]` to that scaffold case's `Customer`, which is what makes the recurrence structurally catchable.

### Effort

**S** for the code (three arms + three chrome strings), **M** with the tests, the docker `ng build` proof, and the i18n golden churn.

---

## F-019 — a documented validator obligation that never fires

### Root cause — the gate and the generator disagree about what "resolvable" means

`docs/page-metamodel.md:213-214` (§3) and `:1226-1227` (§10) both state the obligation:

> - Every `scaffold` selector and every page-data binding inside the `ui` must
>   resolve to a subdomain reachable through the deployable's `targets` chain.

The check that *should* enforce it exists — `checkMethodCallReceiver` (F2) at `src/ir/validate/checks/ui-action-body-checks.ts:506` — but its handle set is built **model-wide**, while the walker's is built **deployable-scoped**:

```ts
// src/ir/validate/checks/ui-checks.ts:75-79  — model-wide
for (const c of allContexts(loom)) {
  for (const a of c.aggregates) aggNames.add(a.name);
  …
}

// src/ir/validate/checks/ui-checks.ts:141-148
for (const ui of sys.uis) {                    // ← no hosting deployable in scope
  const handles = new Set<string>([
    ...ui.apiParams.map((p) => p.name),
    ...(ui.channelParams ?? []).map((p) => p.name),
    ...aggNames,                               // ← every aggregate in the MODEL
    ...workflowNames,
    "Views",
  ]);
```

```ts
// :514 — the escape
if (ctx.handles.has(root.name) || ctx.scope.has(root.name)) return;
```

`Bar` is an aggregate *somewhere* in the model, so it is in `handles`, so F2 returns clean. At codegen the frontend deployable's `contextNames` has already been narrowed to its target's:

```ts
// src/ir/enrich/enrichments.ts:1938-1943
if (!descriptorFor(d.platform).isFrontend || !d.targetName) return d;
const target = deployables.find((t) => t.name === d.targetName);
if (!target) return d;
return { ...d, contextNames: [...target.contextNames] };
```

so the walker's handle set lacks `Bar`, the receiver emits the sentinel, and the give-up arm fires.

**The structural reason the obligation was never implemented:** the loop is `for (const ui of sys.uis)` — a ui is validated with *no notion of which deployable hosts it*, so the `targets` chain the doc names is not in scope at that point at all.

This also **falsifies an in-code claim.** `src/generator/_walker/walker-core.ts:2010-2016`:

```
// DEAD on valid `.ddd`: `loom.method-call-unresolved-receiver`
// (`ui-action-body-checks.ts` F2) rejects an unresolved method-call
// receiver at IR-validate time (phase ⑦), before codegen — proven by
// `test/generator/_walker/unresolved-receiver-give-up.test.ts`, which
// drives every body position that reaches this arm and asserts the gate
// fires first.
```

The repro is a *valid* `.ddd` (`0 error(s), 0 warning(s)`) that reaches this arm. The comment should be corrected in the same PR — that test drives every body *position*, but not every *scoping* under which a receiver can fail to resolve.

### Concrete change

**Home:** `src/ir/validate/checks/ui-checks.ts`. Do not add a new leaf — the defect is the construction of `handles`, which lives here.

1. Build a per-ui **reachable-aggregate set** before the `for (const ui of sys.uis)` loop, reusing the existing `renderingHosts` resolution at `:127-135` (which already maps ui → hosting deployables and handles both `d.uiName` and `d.hostedUiNames`). For each ui, union `contextNames` over every hosting deployable, then collect the aggregates/workflows/projections in those contexts.

2. Scope `handles` (`:143`) to that set **only when the ui has at least one host**. An unmounted ui (declared, no deployable) keeps the model-wide set — narrowing it to nothing would fire on models that generate no frontend at all. Same for a ui whose hosts have empty `contextNames`.

3. Raise a **dedicated, targeted** diagnostic rather than letting the generic F2 message speak. F2's text ("Declare the handle, or fix the reference") is actively misleading here: the handle *is* declared, it is the `targets:` chain that doesn't reach it. New code:

   **`loom.ui-scaffold-unreachable-subdomain`**

   `src/diagnostics/messages.ts` entry (alongside the sibling `loom.ui-framework-unhostable` at `:268`):
   ```ts
   "loom.ui-scaffold-unreachable-subdomain": (p: {
     uiName: unknown;
     aggName: unknown;
     contextName: unknown;
     deployableName: unknown;
     targetName: unknown;
     reachable: unknown;
   }) =>
     `ui '${p.uiName}' reads aggregate '${p.aggName}' (context '${p.contextName}'), ` +
     `which deployable '${p.deployableName}' cannot reach: its target '${p.targetName}' ` +
     `hosts ${p.reachable}. Add the context to the target deployable's 'contexts:', ` +
     `or drop it from the ui's scaffold selector / page bindings.`,
   ```
   Per CLAUDE.md the call site passes `diagMessage("loom.ui-scaffold-unreachable-subdomain", {…})` and attaches the bare `code` — `test/system/diagnostic-catalog.test.ts` fails on an inline literal.

4. Register the code in `src/diagnostics/code-docs.ts` pointing at the `page-metamodel` anchor (`diagnostic-docs-anchors.test.ts` / `diagnostic-docs-undocumented.ts` require it), and add a firing fixture so `test/system/diagnostic-firing-census.test.ts` does not record it as `UNCOVERED`.

This covers **both** halves of the documented obligation in one check — the scaffold selector and hand-written page-data bindings both land as aggregate reads in the page body IR, which is the one place they are uniformly observable.

### Test to add

Extend `test/ir/ui-body-gate-f2-shapes.test.ts` (which currently asserts the F2 gate is complete — the file the new case directly corrects), plus a case in `test/e2e/generated-react-build.test.ts`-adjacent unit coverage:

- the repro model → exactly one `loom.ui-scaffold-unreachable-subdomain` error naming `Bar`, `CB`, `web`, `api`;
- the **negative**: the same model with `contexts: [CA, CB]` on `api` validates clean (guards against a gate that fires on everything);
- a ui with **no** hosting deployable still validates clean;
- a `hostedUiNames` case: deployable `web` (react) hosts a second `framework: vue` ui whose subdomain the target *does* serve → clean, proving the union over hosts is real and not just `d.uiName`;
- a **chained** case: `web → bff → api`, where the aggregate lives only behind `api` — states what "targets *chain*" means, since `enrichDeployables` currently resolves exactly one hop.

Also correct the `walker-core.ts:2010` "DEAD on valid `.ddd`" comment and the corresponding claim in `test/generator/_walker/unresolved-receiver-give-up.test.ts`.

### Mutation proof

Two mutations, each by `cp`-aside / `cp`-back:

1. Revert `handles` to the model-wide `aggNames` (the pre-fix state). Expected: the positive case fails (no diagnostic raised) while all four negative cases still pass — the mutation moves exactly the assertion that names it.
2. Delete the "unmounted ui keeps the model-wide set" guard. Expected: the no-host negative case fails and the positive one still passes — proving the guard is load-bearing and not decorative.

Then the end-to-end proof: `node bin/cli.js parse /tmp/repro/ui-scaffolds-unserved-subdomain.ddd` goes from `0 error(s), 0 warning(s)` to a non-zero exit naming `Bar`.

### Blast radius

A new error-severity gate can break shipped examples, so I pre-flighted it. Six corpus `.ddd` files scaffold a selector while declaring more than one subdomain:

```
./web/src/examples/acme.ddd                                        (subdomains=2)
./web/src/examples/pokemon-world.ddd                               (subdomains=2)
./test/e2e/fixtures/elixir-vanilla-build/vanilla-daisyui-pack.ddd  (subdomains=2)
./examples/acme.ddd                                                (subdomains=3)
./examples/showcase.ddd                                            (subdomains=3)
./examples/vue-showcase.ddd                                        (subdomains=3)
```

Generating all six and grepping the output for the sentinel the new gate would fire on:

```
web/src/examples/acme.ddd -> sentinel files: 0
examples/acme.ddd -> sentinel files: 0
examples/showcase.ddd -> sentinel files: 0
examples/vue-showcase.ddd -> sentinel files: 0
web/src/examples/pokemon-world.ddd -> sentinel files: 0
test/e2e/fixtures/elixir-vanilla-build/vanilla-daisyui-pack.ddd -> sentinel files: 0
```

**Zero** — including `vanilla-daisyui-pack.ddd` and `showcase.ddd`, which scaffold a strict subset of their subdomains (the shape most likely to trip). Blast radius on the shipped corpus is empty; still re-run the full 51-file scaffold set before flipping ready.

Cross-frontend: the gate is IR-level and target-agnostic, so it fires identically for all six frontends and for HEEx. Expect `diagnostic-firing-census` and `local-run-mapping` bookkeeping churn only.

### Effort

**M.** The code change is small (one scoped set + one diagnostic), but it is a new *error*-severity gate, so the negative cases, the corpus pre-flight, the four diagnostic-registration gates, and the corrected `walker-core.ts` claim are the bulk of the work.

---

# 3. Corpus skew — would a per-target floor have caught these?

Re-measured on `9a8f2fe0` (391 `.ddd` files, vs. the audit's 280 at §F9 — the corpus grew ~40% in three days, and the skew grew with it):

```
react     framework:4    platform:35
vue       framework:0    platform:4
svelte    framework:0    platform:9
angular   framework:4    platform:1
feliz     framework:4    platform:1
flutter   framework:0    platform:1
```

**Verdict: a per-*target* floor would NOT have caught either finding. A per-*shape*-per-target floor would have caught both.**

Angular is not absent from the corpus — it has a dedicated `generated-angular-build.test.ts` with four cases, one of which is a full scaffold. A "≥N `.ddd` per target" floor was already satisfied and the defect shipped anyway. The reason is visible in the fixture:

- The Angular scaffold case carries `items: LineItem[]` — a **value-object** array, which is exactly the array shape Angular handles correctly (`FormArray<FormGroup>`).
- Its only scalar array, `lines: string[]` at line 286, is a `store { state { … } }` field — a position that structurally cannot reach `controlInit`.

So the gate contains the word `string[]` and still never reaches the code under test. That is `experience_gathered.md` §59/§63's recurring failure shape — a check that never reaches the thing it names — reproduced at the *fixture* level rather than the assertion level. F-032 is the same story with the opposite ending: #2885 closed it precisely by adding the missing *shape* (`placedBy: Customer id?`) to the vue gate, not by adding vue `.ddd` files.

F-019 is a third variety — no per-target corpus can catch it, because it is a *topology* defect (ui × deployable × targets), orthogonal to which frontend renders. Only a validator gate closes it.

### Cheapest gate that would actually work

A **field-shape × target coverage matrix**, derived rather than hand-maintained — the `walker-stdlib-completeness.test.ts` / `heex-parity.test.ts` ratchet pattern this repo already uses:

1. Enumerate the field shapes a scaffolded **form** must render from the IR type vocabulary — roughly a dozen: `string`, `int`, `decimal`, `money`, `bool`, `datetime`, `enum`, `File`, `X id`, `X id?`, `T?`, `T[]` (scalar), `VO`, `VO[]`.
2. For each of the four `generated-*-build.test.ts` gates plus feliz/flutter, assert the scaffold case's aggregate **covers every shape**.
3. Missing shape → test failure naming the shape and the gate, with a waiver list that ratchets (a fix deletes its waiver in the same PR).

Cost: one test file plus ~12 fields added to four existing scaffold fixtures. It requires no new `.ddd` files, no new CI legs, and no new runner slots — it makes the *existing* per-pack build matrices actually reach what they claim to cover. Under it:

- **F-033** fails on day one: `T[]`-scalar is uncovered in the Angular gate.
- **F-032** would have failed the same way: `X id?` was uncovered in the vue gate, which is exactly the hole #2885 closed by hand.
- **F-019** is untouched — a topology gate, not a corpus gate.

A useful by-product: the matrix would immediately surface the stale-honesty finding above — that `"(arrays not yet supported in forms)"` is false on Feliz and Flutter, which both ship working scalar-array editors while three other frontends tell the user the feature does not exist.