# Loom target-matrix sweep — findings

Swept against `main` @ `619708fd` (2026-09-13), toolchain rebuilt from source
(`npm install && npx tsc -b`) before the first cell.

**Class** — SILENT: valid `.ddd`, generator exits 0 with no diagnostic, output is
wrong/uncompilable/mis-rendered · HONEST: refused with a `loom.*` diagnostic that
names the limit · DOCUMENTED: the docs say so up front.
**Severity** — S1 doesn't compile/boot or renders wrong · S2 a claimed combination
is materially broken · S3 friction · S4 polish.

Repros are in `sweep/repro/`. Every one parses clean (`ddd parse` → 0 errors).

---

## F-000 — inventory vs. claims (finding #1, per the rule)

**Verdict: the claimed inventory is accurate.** Enumerated from
`src/platform/registry.ts`, `ls designs/*/` + each `pack.json`,
`src/platform/frontend-dispatch.ts` and `ddd --help`, then compared to
`README.md`, `docs/platforms.md`, `docs/design-packs.md`:

| Axis | Code says | Docs say | Match |
|---|---|---|---|
| Backends | node (v5 default, v4 pinnable), dotnet@v10, elixir@v1, python@v1, java@v1 | "five backends" + the same version table | ✅ |
| Frontends | react, vue, svelte, angular, feliz, flutter (+ `static` = react alias) | "six frontends" | ✅ |
| Design-pack **families** | 13 (`ls designs/`) | "Thirteen design packs" | ✅ |
| Design-pack **versions** | **17** (13 families × 1–2 versions) | not stated as a count | ✅ (no claim to contradict) |
| Static-bundle host dispatch | react/vue/svelte/angular hosts serve any of the four | "a react host can serve a `framework: vue` bundle" | ✅ verified, T4 |
| Walker primitives | 56 top-level + 2 sub | "56 top-level primitives … plus two sub-elements" | ✅ |

No inventory mismatch. The README's "thirteen design packs" counts *families*;
the sweep measures *versions* (17), because a v7 passing says nothing about a v9
— and that distinction turned out to matter (F-008 hits mantine v7 **and** v9;
F-014 hits primeng but not its two Angular siblings).

**Environment note that is itself worth recording:** the checked-out `out/`
(compiled toolchain) was **stale relative to `src/`** on a fresh clone that
already had `node_modules`. Before the rebuild, `ddd generate system` crashed
with a raw Handlebars `"rowsAttrExpr" not defined` stack trace on Vue, Svelte
**and** Angular — including on the repo's own shipped examples. Everything below
was measured *after* `npx tsc -b`. Anyone reproducing this must rebuild first or
they will "discover" three dead frontends that are not dead.

---

## S1 — does not compile

### F-001 — *withdrawn*

A workflow `money` param emitted `http/workflows.ts` using `moneySchema` without
importing it. Reproduced on the **stale** build only; fixed on fresh `main`.
Recorded here because the repro file (`sweep/repro/F-001-workflow-money-param.ddd`)
is retained as a regression case.

### F-002 — a `decimal` comparison in a repository `find` does not compile (Hono)
*Axes:* backend `node@v5` **and** `node@v4` · *Class:* **SILENT** · *Severity:* **S1**

A repository `find` whose `where` compares a `decimal` field emits
`gt(schema.things.weight, limit)` with `limit: number`, but drizzle types a
Postgres `numeric` column as `string`. No overload matches. 0 diagnostics —
`ddd parse` emits only an unrelated style warning.

```
node bin/cli.js generate system sweep/repro/F-002-decimal-find-compare.ddd -o /tmp/f002
cd /tmp/f002/api && npm i && npx tsc --noEmit
```
```
db/repositories/thing-repository.ts(98,71): error TS2769: No overload matches this call.
  Argument of type 'number' is not assignable to parameter of type 'string | SQLWrapper'.
```
Repro: `sweep/repro/F-002-decimal-find-compare.ddd`. The identical model compiles
on .NET, Java and Python, so this is Hono-specific, and it is the **only** error
in the whole generated Hono project — one line of a 37-file backend.

### F-003 — a `money` workflow param imports a type Svelte never exports
*Axes:* frontend `svelte` (both packs) · *Class:* **SILENT** · *Severity:* **S1**

A `workflow` with a `money` parameter makes the generated workflow page import
`type <Wf>FormState` from `$lib/api/workflows`, which only ever exports
`<Wf>Request` and `use<Wf>Workflow`.

```
src/routes/(app)/workflows/rename/+page.svelte 5:41
  Module '"$lib/api/workflows"' has no exported member 'RenameFormState'.
```
Repro: `sweep/repro/F-003-svelte-workflow-formstate.ddd`. Drop the `money` param
and the same model checks clean, so the param type is the trigger. This is the
**only** error left on both Svelte packs after the shared defects below are
removed — i.e. it alone keeps Svelte off the shippable list.

### F-004 — a `string[]` field seeds an Angular form control with `null`
*Axes:* frontend `angular` (all 3 packs) · *Class:* **SILENT** · *Severity:* **S1**

A non-optional collection field emits
`tags: new FormControl(null, { nonNullable: true })`, which does not satisfy the
generated `Create/UpdateXRequest` (`tags: string[]`).

```
TS2322: Type '{ …; tags: null; }' is not assignable to type 'UpdateProductRequest'.
  Types of property 'tags' are incompatible. Type 'null' is not assignable to type 'string[]'.
```
Repro: `sweep/repro/F-004-angular-collection-field-null.ddd`.

### F-005 — a `currentUser` row filter emits an unbound Ecto variable
*Axes:* backend `elixir@v1` · *Class:* **SILENT** · *Severity:* **S1**

Row-level visibility (`find mine(): T[] where this.owner == currentUser.id`) —
the documented pattern in `docs/auth.md` and `web/src/examples/auth-capabilities.ddd`
— lowers to:

```elixir
query = from(record in Api.C.Thing, where: record.owner == current_user.id)
```
`current_user` is bound nowhere. `mix compile` dies:
```
** (Ecto.Query.CompileError) unbound variable `current_user` in query.
```
Repro: `sweep/repro/F-005-elixir-currentuser-find.ddd`. The same model compiles
on .NET, Java, Python **and** Hono, and all four enforce the equivalent
`requires currentUser.…` gate correctly at runtime (T5). Elixir is the only
backend where the authorization layer's row half fails to build.

### F-006 — Flutter list pages read Riverpod providers that are never emitted
*Axes:* frontend `flutter` · *Class:* **SILENT** · *Severity:* **S1**

Adding one custom repository `find` makes the scaffolded Flutter list page grow
a filter bar that reads `<agg>AllProvider` and `<agg><Find>Provider`.
`lib/reads.dart` emits only `<agg>ByIdProvider`.

```
lib/pages/product_list_page.dart:59
  Error: The method 'productHeavierThanProvider' isn't defined for the type 'ProductListPage'.
  Error: The method 'productAllProvider' isn't defined for the type 'ProductListPage'.
```
Repro: `sweep/repro/F-006-flutter-missing-find-providers.ddd`. Bisected: the bare
aggregate (no custom find) emits no dangling provider; adding the find is the
trigger. The repo's own `sales-system-flutter.ddd` has no custom find, which is
why the shipped example does not hit it.

### F-007 — two forms on one page redeclare every form binding
*Axes:* frontend `react` (all 8 packs), `vue` (both), `svelte` (both) · *Class:* **SILENT** · *Severity:* **S1**

A page body hosting two forms (e.g. `CreateForm` + `WorkflowForm`) emits both
forms' top-level hook declarations into the same component scope:

```tsx
const form = useForm<CreateProductRequest>({ … });
const form = useForm<RegisterProductRequest>({ … });   // TS2451
```
On Mantine/MUI/Chakra it is `register`, `handleSubmit`, `setError`, `control`,
`errors` (and on Chakra also `toast`) — 10–12 errors per page. On Svelte it is a
hard esbuild parse error (`Identifier 'form' has already been declared`).
Repro: `sweep/repro/F-007-two-forms-one-page.ddd`. Twelve of the fifteen JSX/SFC
packs fail on this one construct.

### F-008 — the Mantine `Chart` template emits unbalanced JSX braces
*Axes:* pack `mantine@v7` **and** `mantine@v9` · *Class:* **SILENT** · *Severity:* **S1**

`designs/mantine/v{7,9}/primitive-chart.hbs` line 9–10 escape one brace too many:

```hbs
… withLegend{{#if hasIntegerAxis}} yAxisProps={\{{ allowDecimals: !({{{integerAxisExpr}}}) }}{{/if}} />
```
`={` + the escaped `{{` yields `yAxisProps={{{ … }}` — three opening braces, two
closing. The emitted `home.tsx` does not parse:
```
src/pages/home.tsx(50,216): error TS1136: Property assignment expected.
src/pages/home.tsx(50,277): error TS1382: Unexpected token. Did you mean `{'>'}`?
```
Repro: `sweep/repro/F-008-mantine-chart-braces.ddd`.
**Mantine is the CLI's default pack** (`ddd new --design` defaults to `mantine`),
and it is the only React family that fails the reduced pack pass. Both versions.

### F-009 — `toast(…)` in a page action compiles on React only
*Axes:* frontends `vue`, `svelte`, `angular`, `elixir/HEEx` (Flutter refuses honestly) · *Class:* **SILENT** (4 of 5) · *Severity:* **S1**

`action save() { toast("Saved") }` — a documented page effect
(`docs/page-metamodel.md` §8, and the shipped `store-showcase.ddd` calls it out
as a previously-fixed React defect) — emits a bare `toast` symbol the generated
project never declares:

| frontend | result |
|---|---|
| react | ✅ compiles |
| vue | `src/pages/inputs.vue(25,22): error TS2304: Cannot find name 'toast'.` |
| svelte | `src/routes/(app)/inputs/+page.svelte 15:24 "Cannot find name 'toast'."` |
| angular | `✘ [ERROR] TS2304: Cannot find name 'toast'.` (all 3 packs) |
| elixir/HEEx | `error: undefined function toast/1 … ApiWeb.InputsLive` (both packs) |
| flutter | **HONEST** — `loom.flutter-action-body-unsupported`, refuses at validation with a full explanation |

Repro: `sweep/repro/F-009-toast-in-action.ddd` (flip the frontend `platform:`).
Flutter's refusal is the model for what the other four should do. This single
construct breaks 9 of the 17 pack cells.

### F-010 — Vue `DestroyForm` binds a handler name that does not exist
*Axes:* frontend `vue` (both packs) · *Class:* **SILENT** · *Severity:* **S1**

```
src/pages/product_detail.vue(59,24): error TS2551:
  Property 'onDeleteProduct' does not exist on type '{ … deleteProduct … }'. Did you mean 'deleteProduct'?
```
The template emits `@click='onDeleteProduct'`; the script emits
`const deleteProduct = reactive(useDeleteProduct())`.
Repro: `sweep/repro/F-010-F-011-destroyform.ddd`.

### F-011 — Svelte `DestroyForm` emits an empty arrow body
*Axes:* frontend `svelte` (both packs) · *Class:* **SILENT** · *Severity:* **S1**

```svelte
const deleteProduct = useDeleteProduct(() => );
```
`[PARSE_ERROR] Unexpected token` — the file does not parse at all. Same
primitive as F-010, different breakage per frontend. Same repro file, with the
frontend `platform:` flipped to `svelte`.

### F-012 — an input `error:` carrying a string literal breaks the Angular template
*Axes:* frontend `angular`, all 3 packs · *Class:* **SILENT** · *Severity:* **S1**

`Field { "Name", bind: name, error: nameOk ? "" : "Required" }` — the shape
`docs/page-metamodel.md` §8.2 documents — interpolates the expression **unescaped**
into a double-quoted Angular attribute:

```html
<input matInput [attr.aria-invalid]="!!( (nameOk() ? "" : "Required") ) || null" …
```
The inner `"` closes the attribute. `NG5002: Opening tag "input" not terminated.`
Repro: `sweep/repro/F-012-angular-error-string-literal.ddd`.

### F-013 — the shadcnVue `<img>` makes a missing asset a hard build failure
*Axes:* pack `shadcnVue@v1` · *Class:* **SILENT** · *Severity:* **S2**

`Image { "/logo.png", alt: … }` emits a raw `<img src="/logo.png">` in an SFC
template. Vue's `transformAssetUrls` turns that into a build-time import:

```
[UNRESOLVED_IMPORT] Could not resolve '/logo.png' in src/pages/display_demo.vue
```
Vuetify emits `<v-img src="/logo.png">` (a component prop, not transformed) and
builds fine; every React/Svelte/Angular pack degrades to a runtime 404. So the
same model bundles on 16 of 17 packs and hard-fails on one.
Repro: `sweep/repro/F-013-F-014-F-016-display-primitives.ddd`.

### F-014 — the PrimeNG `SelectField` nests double quotes inside an attribute
*Axes:* pack `primeng@v1` · *Class:* **SILENT** · *Severity:* **S1**

```html
<p-select [options]="["Private", "Internal", "Public"]" …></p-select>
```
`NG5002: Opening tag "p-select" not terminated.` Same root cause as F-012 (an
expression written raw into a `"`-quoted Angular attribute) at a different site.
`angularMaterial@v1` and `spartanNg@v1` render the same `SelectField` correctly,
so this one is genuinely pack-local. Same repro file as F-013, with
`platform: angular` + `design: primeng`.

### F-015 — a component with children emits a duplicate attribute on HEEx
*Axes:* frontend `elixir/HEEx`, both packs · *Class:* **SILENT** · *Severity:* **S1**

`PageBox { title: "Slotted", Text { … } }` (a user component with a `Slot { }`)
emits:

```heex
<ApiWeb.Components.UiComponents.page_box title={"Slotted"} title={<p>
  <%= pgettext("page.Home.text.63j8dx", "children passed through Slot") %>
</p>} />
```
Two `title=` attributes, the second carrying raw markup.
`(Phoenix.LiveView.TagEngine.Tokenizer.ParseError) expected closing '}' for expression`.
Both HEEx packs, identically — so it is a frontend defect, not a pack defect.
Repro: `sweep/repro/F-015-heex-component-children.ddd`.

---

## S1 — compiles, renders wrong

### F-016 — 10 of 15 packs emit `class="loom-icon"` and never define the CSS
*Axes:* packs chakra v2/v3, mantine v7/v9, mui v5/v7, shadcn v3/v4, shadcnVue v1, vuetify v3 · *Class:* **SILENT** · *Severity:* **S1**

`Icon { name: "check", label: "Verified" }` emits an inline `<svg viewBox="0 0 24 24" …>`
with **no width/height**, wrapped in `<span class="loom-icon …">`. An unsized inline
SVG fills its container, so a 16px icon renders ~900px tall.

```
packs that DEFINE .loom-icon:  angularMaterial/v1  flowbite/v1  primeng/v1  shadcnSvelte/v1  spartanNg/v1
packs that EMIT  .loom-icon:   those 5 + chakra/v2 chakra/v3 mantine/v7 mantine/v9 mui/v5 mui/v7
                               shadcn/v3 shadcn/v4 shadcnVue/v1 vuetify/v3
```
Evidence: `sweep/shots/shadcn-v4/display-desktop.png`,
`sweep/shots/chakra-v3/display-desktop.png`, `sweep/shots/vuetify-v3/display-desktop.png`
(broken) vs `sweep/shots/spartanNg-v1/display-desktop.png` (correct, ~16px). On
MUI it also pushes the page into horizontal overflow at all three widths.
The a11y half is fine (`role="img" aria-label` on the wrapper) — this is purely
a missing `.loom-icon { width: … } .loom-icon svg { width: 100% }` rule.
Repro: `sweep/repro/F-013-F-014-F-016-display-primitives.ddd`.

### F-017 — `Badge` / `EnumBadge` stretch to full width inside a `Stack`
*Axes:* every pack screenshotted (shadcn v4, chakra v3, mui v7, vuetify v3, spartanNg v1, angularMaterial v1) · *Class:* **SILENT** · *Severity:* **S2**

A `Badge { "Beta" }` as a direct `Stack` child renders as a full-bleed bar across
the content column instead of an inline pill, on every pack I looked at,
including the packs that get `Icon` right. The pack templates emit the library's
own `<Badge>` with no width constraint and the walker's `Stack` stretches its
children. Cosmetic, but it is every badge on every page.

### F-018 — an unrecognised `Button variant:` silently becomes `ghost`
*Axes:* every React/Vue/Svelte/Angular pack · *Class:* **SILENT** · *Severity:* **S2**

The supported vocabulary is `primary | secondary | ghost`
(`src/generator/_walker/primitives/controls.ts:144`). Anything else falls through
the pack template's `{{#if (eq variant "primary")}}…{{else}}…ghost{{/if}}` chain
to `ghost` — a borderless text button — with no diagnostic:

```
Button { "Primary",   variant: "primary"   }  →  <Button variant="default">
Button { "Secondary", variant: "secondary" }  →  <Button variant="outline">
Button { "Ghost",     variant: "ghost"     }  →  <Button variant="ghost">
Button { "Filled",    variant: "filled"    }  →  <Button variant="ghost">   ← silent
Button { "Nonsense",  variant: "wombat"    }  →  <Button variant="ghost">   ← silent
```
**`"filled"` is the value the repo's own primitive reference uses** —
`docs/language-reference/16-ui-walker-primitives.md` shows
`Button { "Save", variant: "filled" }`. Copy the documented example and your
primary action renders as plain text. `loom.page-primitive-unknown-arg` already
rejects unknown argument *names*; unknown argument *values* are unchecked.
Repro: `sweep/repro/F-018-button-variant-silent-fallback.ddd`.

### F-019 — spartanNg's sidebar does not collapse at phone width
*Axes:* pack `spartanNg@v1` · *Class:* **SILENT** · *Severity:* **S2**

At 390px the ~255px sidebar stays fixed and the content column overflows the
viewport (3 of 7 pages). `angularMaterial@v1` on the same framework and the same
model collapses correctly (0 overflow), as do all React/Vue packs.
Evidence: `sweep/shots/spartanNg-v1/home-phone.png`.

---

## S3 / S4 — friction and polish

### F-020 — Angular drops component children (honest, but leaves an orphan i18n key)
*Axes:* frontend `angular` · *Class:* **HONEST** · *Severity:* **S3**

`loom.component-children-unsupported` warns at validation, and the emitted source
even says so inline:
```html
<ng-container [ngComponentOutlet]="PageBox" …></ng-container>
<!-- PageBox: 1 projected child dropped — ngComponentOutlet has no content-projection channel -->
```
This is exactly the behaviour the other silent gaps should copy. One wart: the
dropped text is still harvested into `src/lib/locales/en.json`
(`"page.Home.text.63j8dx": "children passed through Slot"`), so translators get a
key for content nothing renders.

### F-021 — Feliz refuses a component that dispatches an operation
*Axes:* frontend `feliz` · *Class:* **HONEST** · *Severity:* **S3**

`loom.user-component-deferred-target` — a `component` whose body renders
`Action { product.publish }` is not emitted at all on Feliz, and the validator
says precisely that, names the emitter file, and tells you which frontends do
render it. Excellent diagnostic; a real capability gap.

### F-022 — HEEx refuses `OperationForm` inside a component
*Axes:* frontend `elixir/HEEx` · *Class:* **HONEST** · *Severity:* **S3**

`loom.heex-component-host-state-unsupported`, with the reason (a HEEx function
component has no process to own the assign/upload/`handle_event`) and the fix
(move it into the page body). Cost me one model restructure; correctly flagged.

### F-023 — a bare-name condition in a predicate `match` mis-parses
*Axes:* language · *Class:* **HONEST** (parse error) but **misdirected** · *Severity:* **S3**

```
match {
  pwOk => Badge { "ok" }      // pwOk is a `derived bool`
  else => Text { "no" }
}
→ error: Expecting token of type '=>' but found `else`.
```
A bare `NameRef` arm condition is taken for a variant-arm type atom (the grammar
comment at `ddd.langium:2261` predicts exactly this), so the error lands on the
`else` two lines later and says nothing about the real cause. `pwOk == true`
parses. The docs' own snippet in `docs/language-reference/16` uses comma-separated
arms, which also matters — `docs/page-metamodel.md`'s examples omit the commas.

### F-024 — `CodeBlock` gives every generated app a hard CDN dependency
*Axes:* all React packs (+ any pack whose CodeBlock highlights) · *Class:* **DOCUMENTED** · *Severity:* **S3**

A page containing `CodeBlock` fetches
`https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/{highlight.min.js,styles/github-dark.min.css}`
at runtime. Documented (`registry.ts`: "syntax-highlighted via highlight.js CDN at
runtime"), but it means a generated app is not self-contained, does not work
air-gapped, and needs a CSP allowance. Vuetify/Angular packs made no CDN request
in my runs. Observed as the only failed network call in all 196 screenshots.

### F-025 — `decimal` crosses the wire as a JSON number, `money` as a string
*Axes:* all backends · *Class:* **SILENT** · *Severity:* **S3**

```
POST {"price":"19.9900", "weight":2.5}     price=money (string), weight=decimal (number)
POST {"weight":"2.5"}  → 422 "Invalid input: expected number, received string"
```
`money` is precision-preserving on the wire; `decimal` is an IEEE double. Two
decimal types, two precision policies, no note in the payload docs. (The 422 is
itself good — the validation error is precise and points at `/weight`.)

### F-026 — .NET embeds the absolute `.ddd` path in every domain file
*Axes:* backend `dotnet` · *Class:* **SILENT** · *Severity:* **S4**

`Domain/Orders/Order.cs` carries
`#line (97,11)-(97,35) "/home/user/Loc/sweep/out/t1/dotnet__react/model.ddd"`.
This was the *only* reason the .NET backend half was not byte-identical across
the six frontend cells (6 distinct hashes vs 1 for every other backend). It makes
.NET output non-reproducible across machines and checkouts.

### F-027 — the i18n catalog is not pack-invariant
*Axes:* pack swap · *Class:* by design, worth knowing · *Severity:* **S4**

Swapping shadcn → mui changes `src/locales/en.json` by 2 keys: the pack's own
chrome strings are namespaced `pack.shadcn.*` / `pack.mui.*` (closeDialog,
addItem, removeItem, boolTrue/False, noParameters, operationSucceeded,
arrayUnsupported, breadcrumbsLandmark). Correct namespacing, but a pack swap
therefore invalidates part of a translator's completed catalog.

### F-028 — every generated Elixir project ships a dependency with a security advisory
*Axes:* backend `elixir` · *Class:* **SILENT** · *Severity:* **S3**

`mix deps.get` on a freshly generated project prints
`Found packages with security advisories, see above for details` on every run.
The generated `mix.exs` pins whatever it pins; nothing in the toolchain surfaces
this to the user.

---

## Runtime findings (T5)

### F-029 — a decimal-arithmetic `derived` field makes every read 500 on Phoenix
*Axes:* backend `elixir@v1` · *Class:* **SILENT** · *Severity:* **S1**

`derived footprint: decimal = size.width * size.height` compiles clean, the app
boots clean, `POST /api/products` returns **201** — and then *every* read of that
aggregate returns **500**:

```
GET /api/products/{id}  → 500 {"title":"Internal Server Error","detail":"internal"}
GET /api/products       → 500
```
```
** (ArgumentError) implicit conversion of 1.0 to Decimal is not allowed. Use Decimal.from_float/1
    (decimal 3.1.1) lib/decimal.ex:1254: Decimal.mult/2
    (api 0.1.0) lib/api_web/controllers/product_controller.ex:218: ApiWeb.ProductController.serialize/1
```
The serializer multiplies two floats loaded from Ecto with `Decimal.mult/2`.
Repro: `sweep/repro/F-029-elixir-decimal-derived-500.ddd`. The identical derived
field serializes correctly on Hono, .NET, Java and Python (`"footprint":2` /
`"footprint":2.0`). This is the single most dangerous finding in the sweep: it is
invisible to **every** compile-tier gate and only appears when the stack is booted
and actually read from.

### F-030 — the workflow response shape diverges on Phoenix
*Axes:* backend `elixir@v1` vs the other four · *Class:* **SILENT** · *Severity:* **S2**

Same `.ddd`, same endpoint, two contracts:

| backend | `POST /api/workflows/place_order` |
|---|---|
| node, dotnet, java, python | `204`, empty body |
| elixir | `202`, `{"status":"accepted","result":{ …full Order… }}` |

The work itself is correct on all five (the order and its line persist; Phoenix
`lineCount: 1` on a follow-up read). A client written against the documented
"identical API contracts" claim and tested on Hono breaks when the deployable is
re-pointed at Phoenix. Phoenix also serializes object keys alphabetically where
the other four use declaration order — cosmetic, but it means a byte-diff of two
backends' responses is not a usable parity check without normalisation.

### F-031 — the whole `mui@v5` app renders nothing (React #130 in the shell)
*Axes:* pack `mui@v5` · *Class:* **SILENT** · *Severity:* **S1**

`mui@v5` builds completely green — `tsc --noEmit` and `vite build` both pass, it
is one of the 9 packs that passed the reduced T2 tier — and then **every route
renders only the error boundary**:

```
Something went wrong. Minified React error #130; …args[]=object
```
4 DOM nodes, 0 focusable elements, 28 of 28 screenshots blank
(`sweep/shots/mui-v5/`). `mui@v7`, on the same model, renders all 7 pages fine.

**Cause, proven by mutation.** The React componentStack puts the throw inside
`header > div > button` — the AppBar hamburger. `src/App.tsx` has:

```tsx
import MenuIcon from "@mui/icons-material/Menu";
…
<IconButton …><MenuIcon /></IconButton>
```

`@mui/icons-material@5.18.0` is CJS, and Vite resolves that deep default import
to the module *object* rather than the component. Replacing `<MenuIcon />` with
`<span>M</span>` and rebuilding the identical project makes it render correctly:

```
before:  "Something went wrong. Minified React error #130 …"
after:   "Skip to content M5 AGGREGATES Hello no chart here"
```

Repro: `sweep/repro/F-031-mui-v5-blank-app.ddd` — a `Heading` + `Text` page, i.e.
nothing in the page body is involved; it is the shell.

**This is the finding that most justifies the visual tier.** Every compile-tier
gate in the repo is green on `mui@v5`; only opening the page reveals that the
pack ships a blank app. It is also the cleanest counterexample to extrapolating
across versions: v5 and v7 are the same family, the same model, one renders and
one does not.
