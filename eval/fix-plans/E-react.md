## 1. Verification table (fresh `main` `9a8f2fe0`, all repros re-run)

| Finding | Status | Claim | Evidence |
|---|---|---|---|
| **F-016** reserved-word operation name | **LIVE** | **UNCLAIMED** | `detail.tsx(104,9): error TS1389: 'void' is not allowed as a variable declaration name` (+2) |
| **F-017** `Chart` triple brace | **LIVE** | **UNCLAIMED** | `dash.tsx(9,183): error TS1136: Property assignment expected` (+6) |
| **F-018** declared `find all(): T[]` breaks FK picker | **LIVE** | **UNCLAIMED** | `sites/new.tsx(48,177): error TS2339: Property 'items' does not exist on type '{…}[]'` (+3); control = `CONTROL tsc exit=0` |
| **F-011** page-gate crash on `permissions.<x>` | **LIVE** (both repros) | **CLAIMED BY #2871** | crash reproduced verbatim; #2871 `src/ir/validate/checks/ui-gate-checks.ts` walks every `ui.pages[].requires` |

Commands (all from `/tmp/loom-main`, generated into `/tmp/agentE/out-*`, then `npm install && npx tsc --noEmit` in `<out>/web`):

```
$ node bin/cli.js generate system /tmp/repro/reserved-word-op.ddd -o /tmp/agentE/out-reserved-word-op
0 error(s), 0 warning(s).
Wrote 75 file(s)
$ npx tsc --noEmit          # exit 2
src/pages/invoices/detail.tsx(104,9): error TS1389: 'void' is not allowed as a variable declaration name.
src/pages/invoices/detail.tsx(104,14): error TS1109: Expression expected.
src/pages/invoices/detail.tsx(137,73): error TS1109: Expression expected.
```
emitted: `  const void = useVoidInvoice(id ?? "");` / `onClick={() => openVoidModal(void)}`

```
$ node bin/cli.js generate system /tmp/repro/chart-triple-brace.ddd -o …
0 error(s), 0 warning(s).
$ npx tsc --noEmit          # exit 2
src/pages/dash.tsx(9,183): error TS1136: Property assignment expected.
src/pages/dash.tsx(9,185): error TS1005: '...' expected.
src/pages/dash.tsx(9,198): error TS1005: '}' expected.
src/pages/dash.tsx(9,235): error TS1382: Unexpected token. Did you mean `{'>'}` or `&gt;`?
src/pages/dash.tsx(9,275): error TS1381: …  (7 total)
```
emitted: `… withLegend yAxisProps={{{ allowDecimals: !((byStatus.data ?? []).every(…)) }} />`

```
$ node bin/cli.js generate system /tmp/repro/paged-vs-array-picker.ddd -o …
…:8:12 warning: repository find 'all' is a wire-shaped list query …
0 error(s), 1 warning(s).
$ npx tsc --noEmit          # exit 2
src/pages/sites/detail.tsx(50,179): error TS2339: Property 'items' does not exist on type '{ id: string; name: string; version: number; display: string; }[]'.
src/pages/sites/detail.tsx(50,197): error TS7006: Parameter '__o' implicitly has an 'any' type.
src/pages/sites/new.tsx(48,177): error TS2339: Property 'items' does not exist …
src/pages/sites/new.tsx(48,195): error TS7006: …
```
Control (same file, `find all` line deleted): `0 error(s), 0 warning(s).` → `CONTROL tsc exit=0`. Note the generated client differs exactly as predicted — declared: `return CustomerListResponse.parse(r)` (bare array, no-arg hook); auto: `return CustomerPaged.parse(r)` (envelope, `useAllCustomers({page,pageSize,sort,dir})`).

```
$ node bin/cli.js generate system /tmp/repro/page-gate-permissions.ddd -o …
0 error(s), 0 warning(s).
Error: UI gate: reference 'permissions' (unknown) is not evaluable client-side — a gate may only touch currentUser and constants.
    at renderGateExpr (file:///tmp/loom-main/out/generator/_frontend/gate-expr.js:37:19)
    …
    at renderPageGate (file:///tmp/loom-main/out/generator/react/walker/page-shell.js:551:24)
```
Identical crash for `/tmp/repro/scaffold-gate-permissions.ddd` (plain scaffold path, no hand-written page).

**F-011 claim detail (read in full, then stop as instructed).** #2871 "Three page-body/gate holes…" — its D2 is this exact defect, same stack, same `permissions` root. `src/ir/validate/checks/ui-gate-checks.ts` (new, 137 lines) iterates `for (const ui of sys.uis) for (const page of ui.pages) { if (!page.requires) continue; … }` — so it covers **both** my repros (the hand-written page and the gate the scaffold copies off `find all(…) requires`), not only the workflow-instance-page shape its body narrates. The `origin` sentence is workflow-specific; my scaffold repro would get the generic (no-origin) message, which is still a `loom.*` error with ui + page + offending chain, not a stack trace. **No fix plan follows.** Two review notes for whoever lands it, offered as observations only:

- It **refuses** where F-011 argued the gate should **work**: `permissions.read` does lower to the constant `"s.read"` on every backend, so a client-evaluable rendering is possible in principle. #2871's counter-argument is scoping, not evaluability — `permissions` is subdomain-scoped and a `ui` is declared outside the subdomain, so the name never resolves to a `ref` with a value by the time the frontend sees it. That is a real constraint; the alternative fix (resolve the catalogue reference at lowering so the page gate carries the literal) is strictly larger and is not what #2871 chose. Worth one reviewer sentence, since the deny-by-default + permissions + `auth: ui` posture remains un-expressible without falling back to the raw runtime string, which the diagnostic itself admits "does NOT expand the `implies` closure".
- `docs/auth.md:858-863` still says the inheritance is "**Sound** because both are `currentUser`-only by validation, which is exactly what a page gate can evaluate client-side." That sentence is what made the crash surprising and is now false in the `permissions.<x>` case. #2871 touches no docs; it should amend that paragraph.

Claim-checking method for the other three: read #2871 (files + the new check), #2883, #2874, #2878 in full; `list_pull_requests` over all 30 open PRs; and body searches for `yAxisProps` (0 hits), `"data?.items"`/`"id-select"`/`"reference picker"` (#2871, #2870, #2906 — none touches `form-fields-vm.ts` or the `field-input-id-select` templates), `"const void"`/`"reserved word"` (only #2877, a `crudish(requires:)` gate). **#2883 does not cover F-016**: it widens eight *soft keywords* in the `.ddd` grammar's identifier positions, and its own "Not fixed" section says declaration names stay bare `ID`. F-016 is the opposite axis — `void` is not a Loom keyword at all (it parses clean today), the collision is with the **host** language at emission. **#2874 does not cover F-018**: it narrows `loom.repository-find-deprecated` to contexts that already declare a criterion/retrieval — which actually makes F-018 quieter, since my repro's context has neither, so after #2874 the file generates `0 error(s), 0 warning(s)` and still breaks `tsc`.

---

## 2. Fix plans

### F-016 — reserved-word operation name → `const void = …`

**Root cause.** The frontend op-form wiring lowercases the op name into a *local const* with no host-keyword hygiene:

- `src/generator/react/walker/page-shell.ts:814` — `opCamel: lowerFirst(op.name),`
- `src/generator/vue/walker/page-shell.ts:442` — `const opCamel = lowerFirst(state.op.name);`
- `src/generator/svelte/walker/page-shell.ts:233` — `opCamel: lowerFirst(op.name),`
- `src/generator/_walker/primitives/forms.ts:289` and `:1053` — `opCamel: lowerFirst(opName),` (the `primitive-modal` trigger, both the instance-qualified and by-name shapes)

`opCamel` reaches the packs as the declaration (`const {{opCamel}} = use{{opPascal}}{{aggregateName}}(…)`), the reference (`open{{opPascal}}Modal({{opCamel}})`, `{{opCamel}}.isPending`), and as the stem of derived locals (`{{opCamel}}ModalOpen`, `{{opCamel}}Form`).

**Recommendation: MANGLE at emission, do not add a validator refusal.** The repo has already settled this doctrine and written it down at `src/util/naming.ts:370-380`: escape a *local binding*, refuse a *declared/wire* name, because a rename of a wire field silently moves the wire. Here nothing crosses the wire — I checked every `opCamel` use in all 13 packs plus `vue/`, `sveltekit/`, `angular/`: it never appears inside a `data-testid`, a route, a `queryKey` or any string literal (those all use `{{opName}}` / `{{slug}}`). The route stays `POST /invoices/{id}/void`, the testid stays `invoices-op-void`. `escapeTsIdent` (`src/util/naming.ts:360`, `TS_KEYWORDS` = 46 words including `void`) already exists and is already used by the Hono backend for exactly this (`src/generator/typescript/render-stmt.ts:170`: *"`let`-names may collide with a JS reserved word; escape consistently with the matching `refKind: "let"` use sites (`let new` → `new_`)"*). The frontend simply never joined.

**Concrete change.** Wrap all five producer sites: `opCamel: escapeTsIdent(lowerFirst(op.name))`. One variable feeds declaration and every reference, so one wrap per site fixes both halves and keeps derived names (`void_ModalOpen`) internally consistent. No pack template changes.

**Full hazard enumeration (the "don't stop at `void`" ask).** Intersecting `TS_KEYWORDS` with the words the grammar does **not** tokenize as Loom keywords (computed from `ddd.langium`) gives **27** operation names that are legal Loom and illegal JS locals:

```
break case catch class const continue debugger default delete do export finally
instanceof new super switch throw try typeof var void while yield interface
package protected public
```

Probe (`/tmp/agentE/probe/fe-*.ddd`, ops `void`/`new`/`class`/`typeof`) confirms the emitted breakage is the same for all four.

**Test to add.** `test/generator/_walker/reserved-op-name.test.ts` — one fixture with `operation void()` / `new()` / `class()` / `typeof()` on a scaffolded aggregate, generated for `react`, `vue`, `svelte`; assert the declaration is `const void_ = use…`, that the trigger references `void_`, that `data-testid="…-op-void"` and the route/i18n key are **unchanged** (the non-regression half that proves the escape did not leak into the wire), and — the strongest assertion — parse the emitted `.tsx` with `ts.createSourceFile(…, ScriptKind.TSX)` and require `parseDiagnostics.length === 0`.

**Mutation proof.** `cp` the three `page-shell.ts` aside, revert `escapeTsIdent(` → nothing at each site one at a time, rebuild, re-run: each must fail with the *syntax-diagnostic* assertion (not just the substring one), and the testid/route assertions must stay green in both states (non-vacuity). Restore by file copy, never `git checkout --` (§84).

**Blast radius across the other five frontends** (all measured, `/tmp/agentE/probe/out-fe-*`):

| frontend | emission | verdict |
|---|---|---|
| react | `const void = useVoidInvoice(id ?? "");` | **broken** |
| vue | `const void = reactive(useVoidInvoice(id ?? ""));` … `@click="openVoidModal(void)"` | **broken** |
| svelte | `const void = useVoidInvoice(() => id ?? "");` | **broken** |
| angular | `readonly voidInvoice = useVoidInvoice();` | safe (compound name) |
| feliz | `Api.voidInvoice`, `SubmitVoidInvoiceForm` | safe (compound) |
| flutter | `class VoidInvoiceForm extends StatefulWidget` | safe (Pascal compound) |

**Effort: S** (5 one-line changes + one cross-framework test).

### F-017 — `Chart` emits `yAxisProps={{{ … }}`

**Root cause — a one-character Handlebars escape error, in two files, four lines.** `designs/mantine/v7/primitive-chart.hbs:9` and `:10`, and `designs/mantine/v9/primitive-chart.hbs:9` and `:10`:

```hbs
… withLegend{{#if hasIntegerAxis}} yAxisProps={\{{ allowDecimals: !({{{integerAxisExpr}}}) }}{{/if}} />
```

`\{{` is Handlebars' escape for a literal `{{`; the author left a *stray literal* `{` in front of it, so the render is `{` + `{{` = three opens against two closes. Verified directly against the repo's own Handlebars:

```
current : withLegend yAxisProps={{{ allowDecimals: !(EXPR) }} />
proposed: withLegend yAxisProps={{ allowDecimals: !(EXPR) }} />
```

**Concrete change.** Delete the stray brace on all four lines: `yAxisProps={\{{` → `yAxisProps=\{{`. The sibling packs show this is a mantine-local slip, not a shared idiom — chakra/shadcn write `contentStyle=\{{ … }}` (correct, no leading `{`) and `allowDecimals={!(…)}`; mui writes `slotProps=\{{ … }}` and `yAxis={[{ … }]}`.

**Why no compile gate caught it — two independent holes, both real.**
1. **No `.ddd` in the compiled corpus uses `Chart` on a JSX frontend.** `grep -rln Chart --include=*.ddd .` over the whole repo returns exactly one file: `test/e2e/fixtures/elixir-vanilla-build/vanilla-projection-read.ddd` — a HEEx fixture. `examples/`, `web/src/examples/` and `journey/` have none, so `generated-react-build.yml` (corpus × every pack, the job that runs `tsc`) never emits a chart.
2. **The unit test that does render a chart asserts substrings only.** `test/generator/react/projection-read-grouped.test.ts:102` renders `CHART_PAGE` against mantine and checks `toContain("(salesByStatus.data ?? []).map((r) => ({"))` etc. — its own fixture output contains `yAxisProps={{{` today and passes. `grep -rn "yAxisProps\|allowDecimals" test/` → zero hits.

**Test to add.** A pack sweep, because the per-pack template is exactly where this class hides: `test/generator/_packs/emitted-pages-parse.test.ts` — generate a fixture page exercising `Chart` (line **and** bar; `hasIntegerAxis` is unconditionally true on the JS-family targets, see `src/generator/_walker/primitives/chart.ts:169`) against **every** tsx pack (`mantine@v7`, `mantine@v9`, `chakra@v2/v3`, `mui@v5/v7`, `shadcn@v3/v4`) and parse each emitted `.tsx` with `ts.createSourceFile(…, ScriptKind.TSX)`, asserting `parseDiagnostics` is empty. I ran exactly this check by hand and it is decisive and cheap:

```
out-chart-chakra/web/src/pages/dash.tsx     PARSE OK
out-chart-mantine/web/src/pages/dash.tsx    7 syntax error(s): Property assignment expected. | '...' expected. | '}' expected.
out-chart-mantinev7/web/src/pages/dash.tsx  7 syntax error(s): …
out-chart-mui/web/src/pages/dash.tsx        PARSE OK
out-chart-shadcn/web/src/pages/dash.tsx     PARSE OK
```

Separately, add `Chart` to one shipped example so the corpus tsc gate reaches it (`examples/showcase.ddd` already has a `projection`; a 1-line `Chart` page closes hole #1 permanently).

**Mutation proof.** `cp` the two `.hbs` aside, restore the stray `{`, re-run: the new parse gate must fail on mantine@v7 and v9 and stay green on the other six (that split is the non-vacuity half — it proves the gate reaches the pack under test rather than failing on something shared).

**Blast radius: mantine only, both versions — and `mantine` is what bareword `design:` resolves to** (`src/util/builtin-formats.ts`: `BUILTIN_PACK_LATEST.mantine = "v9"`), i.e. the default React path. Vue/Svelte/Angular are unaffected: they render `Chart` through their own runtime component (`vue/primitive-chart.hbs` → `<LoomChart …>`, `sveltekit/`, `angular/` likewise) and `hasIntegerAxis` is `false` for them because their targets implement `renderChartData`. Feliz/Flutter likewise. HEEx has its own renderer. **Effort: S.**

### F-018 — declared `find all(): T[]` breaks every scaffolded reference picker

**Root cause.** The picker's option source is hardcoded to the paged envelope in the pack templates, while the rest of the frontend already derives the shape. The view-model that feeds them, `src/generator/_walker/form-fields-vm.ts:83-91`, passes only `hookVar`:

```ts
return { template: "field-input-id-select", path, label, testId, errorExpr,
         hookVar: idTargetHookVar(target), displayField: "display" };
```

and **13 pack templates plus the Angular emitter** each write their own `.data?.items ?? []` on top of it — e.g. `designs/mantine/v9/field-input-id-select.hbs:5`, `designs/shadcn/v4/…:14`, `designs/chakra/v3/…:10`, `designs/mui/v7/…:8`, `designs/shadcnSvelte/v1/…:3`, `designs/flowbite/v1/…:3`, `designs/shadcnVue/v1/…:1`, `designs/vuetify/v3/…:1`, and `src/generator/angular/form-fields.ts:336,340,342` (`${hookVar}.data()?.items ?? []`).

The compiler already knows the answer and uses it everywhere else: `src/generator/_walker/paged-query.ts` ("*Is a `QueryView`'s `of:` read PAGED? One derivation, every consumer*") resolves the repository find and asks `pagedReturn(find.returnType)`. That is why the scaffolded **list** page adapts correctly to both shapes in the very same generated app (paged → `customerAll.data.items.map(…)` + `totalPages`; array → `[...(customerAll.data)].sort(…).slice(…)`), while the picker two files away does not. The picker is a consumer that never asked.

**Recommendation: adapt, do not refuse.** A `loom.*` refusal is the wrong primary answer here precisely because of the forcing function — `docs/auth.md:44-45` instructs: *"Declaring an explicit `find all(): T[] requires <expr>` gates that route, and does so on all five backends"*. The security-recommended spelling must not be the broken one.

**Concrete change.**
1. Add an options-shape helper next to `idTargetHookVar` in `src/generator/_frontend/form-helpers.ts` that answers, for an id-target aggregate, the option-list expression: paged → `(${hookVar}.data?.items ?? [])`, array → `(${hookVar}.data ?? [])`. It resolves the target's repository `all` find through the same `pagedReturn` (`src/ir/stdlib/generics.ts`) the walker's `queryShape` uses — not a second predicate. The target may live in another bounded context, so index with `bcByAggregateOf(contexts)` from `paged-query.ts` rather than the local `ctx: BoundedContextIR`; that means threading the index into `prepareFormFieldVM` (three call sites: `form-fields-vm.ts:113`, `:157`, `_walker/primitives/forms.ts:413`).
2. Emit it as a new VM field `optionsExpr`; change the 13 templates from `({{{hookVar}}}.data?.items ?? [])` to `{{{optionsExpr}}}`. `hookVar` stays — the page shell still declares `const __customers = useAllCustomers()` from it.
3. Angular: the same derivation inside `idTargetForField` (`src/generator/angular/form-fields.ts:59-73`), consumed at `:336/:340/:342` (Angular's accessor is `data()`, so the helper needs a per-target accessor spelling or an Angular-side twin).
4. **The third shape.** A declared `find all(): T` / `T?` yields one record, not a list. Route it to the existing text-input fallback the VM already has for a display-less target (`template: "field-input-id-text"` with `placeholderJson: "<id> — <reason>"`), reason: "`find all` on `<T>` returns a single record, so there is no option list to populate". Degrade honestly rather than emit `.map` over an object.
5. **Docs.** `docs/auth.md` §Find gates gains a sentence that the explicit gated form is fully supported by the scaffolded pickers (after this fix it is true; today it is not). `docs/design-packs.md` must document the new `optionsExpr` context variable in the `field-input-id-select` contract — an out-of-tree pack that keeps `.data?.items` compiles but keeps the bug, so the template-context change belongs in the pack-authoring reference, and `field-input-id-select`'s entry in `REQUIRED_PRIMITIVES` is the natural pin.

**Test to add.** `test/generator/_frontend/id-picker-shape.test.ts` — the two-aggregate fixture from the repro, generated **twice** (with and without `find all(): Customer[] requires true`) × react/vue/svelte/angular. Assert the declared-array run emits `(__customers.data ?? [])` and *never* `.items`, the auto run still emits `(__customers.data?.items ?? [])` byte-identically (the no-move half), and add the single-return case asserting the text-input fallback. Extend `test/generator/angular/x-id-select.test.ts` and `test/generator/react/walker-form-of.test.ts` with the array arm.

**Mutation proof.** `cp` `form-fields-vm.ts` aside, hard-code `optionsExpr` back to the paged spelling, re-run: the declared-array assertions fail on all four frontends while the auto-`findAll` assertions stay green (proving the test discriminates the shape rather than the substring). A second, stronger mutation: make the helper always answer `array` — the auto-`findAll` assertions must then fail. Both directions, since a one-sided proof here would pass on a helper that ignores its input.

**Blast radius** (probes at `/tmp/agentE/probe/out-picker-*`): react, vue (`:items="(__customers.data?.items ?? []).map(…)"`), svelte (`{#each (__customers.data?.items ?? []) …}`) and angular (`@for (__o of customerAll.data()?.items ?? []; …)`) are all broken — the four that share this VM and these templates. **Feliz and Flutter are already correct**, by two different routes worth citing in the PR: Feliz re-derives the call shape (`Api.allCustomers model.PageNum 10 …` when paged vs a no-arg call when array), and Flutter sniffs at runtime — `final raw = decoded is Map<String, dynamic> ? decoded['items'] : decoded;` (`web/lib/forms.dart:166`). **Effort: M** (1 helper + 1 VM field + 3 threading sites + 13 templates + Angular twin + docs).

---

## 3. Cross-target hazard assessment (F-016, F-017)

**F-017 is one site, not a sweep.** It is a typo in one pack family (mantine v7 + v9, 4 lines), proven by rendering the same `.ddd` against all eight React packs. Fix the four lines; the sweep-shaped work is the missing *gate*, not the missing fixes.

**F-016 is a sweep — and it is open on one backend, silently.** Probing `operation void/new/class/typeof` across all five backends:

| target | emission | verdict |
|---|---|---|
| **node (Hono)** | `public void(): void {` — a class **method** name | **safe.** Verified: `class A { public void(){} public new(){} public class(){} public typeof(){} }` → `tsc --noEmit` exit 0. Method names are property names; only the *frontend's* `const` is a binding position. |
| **dotnet** | `public void Class()`, `aggregate.Class();` | **safe** — PascalCase, and C# has `@case` if it ever weren't. |
| **java** | refuses at phase ⑦ | **already handled.** `loom.java-reserved-identifier-unsupported X/C/Invoice: 'C.Invoice' declares operation 'new', which is a Java reserved word — … Java has no verbatim-identifier escape (C#'s '@new'), and renaming it to 'new_' would rename the JSON property on java alone. Rename the declaration, or host this context on a node / dotnet / python / elixir deployable.` |
| **elixir** | `def void_invoice!(record)` | **safe** — compound name; `escapeElixirIdent` exists for locals. |
| **python** | `def class(self) -> None:` and `found.class()` | **BROKEN, silently.** `0 error(s), 0 warning(s)` then `File "…/domain/invoice.py", line 53 / def class(self) -> None: / SyntaxError: invalid syntax` (`python3 -m py_compile`, exit 1). Sites: `app/domain/invoice.py` (the method) and `app/http/invoice_routes.py:167` (the call). 24 Python keywords are legal Loom operation names. |

So the class is open on **react + vue + svelte (frontend locals)** and **python (method + call site)**; java refuses correctly, dotnet/elixir/angular/feliz/flutter/node are safe by naming convention. The right shape is one PR per language, all applying the doctrine already written at `src/util/naming.ts:370-380`: `escapeTsIdent` at the five frontend producers, `escapePythonIdent` at the Python `def` + every call site (a rename of a generated method, invisible to the wire — the route stays `/invoices/{id}/class`). The java gate's message is the model for what a *refusal* should read like, and its existence is also the proof that the repo already decided which positions refuse and which escape. Note the java diagnostic currently advertises python as a safe host (*"or host this context on a node / dotnet / python / elixir deployable"*) — which, for `class`, it is not; that sentence should be corrected in the same PR that fixes python.

Adjacent identifier positions I probed and found **already safe** on React, so the fix does not need to widen: page-body lambda bindings are renamed by the walker (`Column("D", class => class.display)` emits `.map((row) => …)`), and a field named `delete` lands only in object-property position. `state <keyword>: …` does not parse at all (`error: Expecting token of type '{' but found 'new'`).

Scratch artifacts, all under `/tmp/agentE/` (nothing in `/tmp/loom-main` or `/home/user/Loc` was modified; no branch, commit, or PR was created): `out-*` (the four repro trees + the F-018 control), `probe/` (the 11-target reserved-word matrix, the 5-frontend picker matrix, the 5-pack chart matrix), and `parse-tsx.mjs` (the TSX syntax-diagnostic checker the F-017 gate should become).