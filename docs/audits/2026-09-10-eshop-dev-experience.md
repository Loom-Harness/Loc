# Dev-experience audit — building an e-shop as an ordinary user

> Snapshot audit, 2026-09-10, against `main` @ `54750de`. Method: scaffold with
> `ddd new`, then build a non-trivial e-shop over five iterations that simulate
> real user feedback (catalog + ordering → payments + cross-context events →
> auth → a hand-written storefront page → schema evolution → retargeting), and
> COMPILE what came out. Every claim below was reproduced from a minimal model.
>
> Overlap: PR #2861 ("Defects found by building a Jira-like tracker end to end")
> ran the same exercise in parallel and claims the README / `docs/workflow.md` /
> starter / `loom.persistence-mode-unsupported` first-run breakage, a
> parameterized-projection param drop, Vue attribute escaping, and two honest
> gates around `create`. Those are NOT re-claimed here. Two items #2861 lists as
> out of scope (retrieval has no HTTP route; `denyByDefault` skips the auto
> reads) are extended below with axes it did not measure.

## What worked

- **The migration guard is the model for every other diagnostic in the tool.**
  Renaming `stockOnHand` → `available` (while also adding a column) was refused
  with `loom.migration-ambiguous-rename`, which named the table, listed the
  drop/add pair, explained the data loss, gave the annotation syntax and the
  `--allow-destructive` escape. Annotating it produced exactly
  `ALTER TABLE … RENAME COLUMN …` plus the additive `ADD COLUMN`.
- **`loom.page-primitive-unknown-arg`** is the best-written diagnostic I hit: it
  names the accepted argument set and explains that an unknown one is silently
  dropped from every frontend and from the message catalog.
- **Retargeting holds.** The same 300-line model generated on node → dotnet /
  java / python / elixir and react → vue / svelte / angular with zero errors,
  hand-written page included.
- **`denyByDefault`'s coverage report is excellent** — 13 precisely-located
  errors naming every ungated operation, find, workflow entry and handler.

## Defects

### D1 — a macro-emitted member cannot carry the gate `denyByDefault` demands

`ddd new`'s own scaffold, plus the `auth {}` block its own comment tells you to
enable, is an **unsatisfiable model**. From a pristine `ddd new`:

1. uncomment the `auth { enforcement: denyByDefault … }` block;
2. add the `user { … }` block a second error asks for;
3. add `auth: required` to the deployable.

→ 7 errors, six on `crudish`-emitted members:

```
loom.default-deny-ungated Project/update | Project/create | Project/destroy
loom.default-deny-ungated Task/update    | Task/create    | Task/destroy
```

`crudish` (`src/macros/stdlib/crudish.macro.ts:52`) takes one parameter,
`updateOnly`, and emits create/update/destroy with no `requires`. An aggregate
`Create` / `Destroy` has **no header `requires` clause**
(`src/language/ddd.langium:1908`) — the gate is a body STATEMENT, and the body
is macro-owned. There is no way to gate them. The only escape is deleting
`with crudish` and hand-writing all three members.

`scaffoldPaged` has the identical shape: it emits a `queryHandler` bound to a
route, takes only `of:`, and offers no gate — so `scaffoldPaged` +
`denyByDefault` can never validate either. Hand-writing a handler with the same
name does not collide with the macro's (no duplicate-name diagnostic), so which
one wins is undefined.

No fixture, test or doc in the repo combines `crudish` with `denyByDefault`
(grepped), which is why this has stayed invisible.

### D2 — codegen throws a raw JS Error on a model that validated clean

```ddd
workflow Restock requires currentUser.permissions.contains(permissions.manage) {
  itemId: Item id
  create(ev: ItemActivated) by ev.item { let it = Items.getById(ev.item) }
}
```

On a correlated workflow (one that gets instance pages) with a mounted ui:

```
0 error(s), 0 warning(s).
Error: UI gate: reference 'permissions' (unknown) is not evaluable client-side
  at renderGateExpr (generator/_frontend/gate-expr.js:37)
  at renderPageGate (react/walker/page-shell.js:551)
```

The workflow's header gate is copied onto the generated `<W>InstancesList` /
`<W>InstanceDetail` pages, where `permissions.<x>` is not client-evaluable. No
`loom.*` code, no file:line, no page name, nothing written. `currentUser.role`
in the same position is fine. This breaks "validated before emission" directly.

### D3 — a markup primitive inside a collection-op lambda emits uncompilable output

```ddd
body: QueryView { of: Item.all, data: rows => Stack {
  rows.map(i => Card { Text { i.name } })
} }
```

validates clean and emits

```tsx
{(itemAll.data.items).map((i) => Card(Text(i.name)))}
```

`Card` / `Text` become function calls and are never imported — `Cannot find
name 'Card'`. The correct spelling is `For { each: rows, i => Card { … } }`,
which emits proper keyed JSX. `.map` is a legal collection op in expression
position (`docs/page-metamodel.md:619` encourages `orders.filter(…).map(…)`),
so nothing signals that the markup case is different. Wanted: a `loom.*` gate.

### D4 — `money` into a non-formatting text primitive emits uncompilable output

`Text { p.price }` on a `money` field →
`error TS2322: Type 'Decimal' is not assignable to type 'ReactNode'`. The
scaffolded Table renders money through `<MoneyValue/>`; a hand-written page has
to know to reach for the `Money { … }` primitive. That one-token difference is
the whole diff between a frontend that compiles and one that doesn't, and there
is no diagnostic.

### D5 — an optional value object breaks the generated backend's typecheck

`shipping: Address?` flattens to four nullable columns and hydrates as

```ts
shipping: (root.shipping_line1 == null ? null
  : new Address(root.shipping_line1, root.shipping_city,
                root.shipping_postalCode, root.shipping_country))
```

Only the first column is narrowed; the other three stay `string | null` against a
constructor wanting `string` → `TS2345`, eight times across two repositories in
my model.

### D6 — an `X id?` claim in the `user {}` block emits a missing import and a doubled null

`customerId: Customer id?` produces, in both `auth/user-types.ts` and
`auth/oidc.ts`:

```ts
customerId: Ids.CustomerId | null | null;
```

`Ids` is never imported (`TS2503: Cannot find namespace 'Ids'`), and `| null` is
emitted twice.

D5 + D6 together: `npx tsc --noEmit` on the generated api = **10 errors**. The
per-PR corpus-tsc gate evidently carries no fixture with an optional value
object or an id-typed user claim.

### D7 — the `find` deprecation costs more than the two things it names

`loom.repository-find-deprecated` fires on every list `find` (including the one
`ddd new` writes) and says "pass a criterion to `run` … or name a `retrieval`".
#2861 already records that neither replacement emits an HTTP route. Two further
axes, measured by diffing the generated tree before and after the migration:

- **The scaffolded list page loses its filter bar.** The scaffold binds one input
  per parameter of the aggregate's parameterised *finds*
  (`docs/page-metamodel.md:1191`); criteria and retrievals are not scanned. My
  `products/list.tsx` lost 53 lines of filter UI and rendered an unfiltered
  table.
- **The index suggestion disappears.**
  `src/ir/validate/checks/index-suggestion-checks.ts:107-110` collects filter
  columns from `repo.finds` + `agg.contextFilters` only, so a criterion's
  predicate is invisible. `Product.status` / `Product.available` stopped being
  suggested the moment I migrated.

Even with the full replacement wired (`scaffoldPaged` + `scaffoldPagedApi` +
`serves:`), the generated client hook `useFindAllBySellableProduct` is consumed
by **no generated page** — it is dead client code until you hand-write one.

### D8 — nothing warns that an aggregate can never be instantiated

An aggregate with no `create` and no `crudish`, scaffolded into a ui, yields
list + detail pages, a nav entry and an OpenAPI document — and no way to put a
row in the table. `loom.ui-id-ref-no-display` shouts about a missing picker
label; "this aggregate has no creator" is silent.

### D9 — the natural factory cannot be written

`create(name: string) { this.name := name }` is impossible: `this.x :=` is a
parse error (`Expecting token of type '}' but found 'this'`, and
`docs/language.md:1078` describes `:=` as "assignment to a property reachable
from `this`"), while the bare `name :=` resolves to the shadowing parameter. Every
factory parameter has to be renamed away from the field it fills.

### D10 — smaller surface papercuts

- Commas separate members in `event` / `payload` bodies but are a parse error in
  `aggregate` / `valueobject` / `user` bodies. `docs/page-metamodel.md:161`
  shows the invalid `user { id: string, permissions: string[] }`.
- `docs/language.md:322` documents `channel Name { carries: [Event, …] }` with
  brackets; the grammar (`ddd.langium:1344`) takes a bare comma list.
  `docs/channels.md`'s own example is right, so the two disagree.
- The `loom.migration-ambiguous-rename` fix text gives `migration "<name>" { … }`
  without saying the block is ROOT-level, not a `system` member
  (`ddd.langium:36`). Pasted where the model lives it is a parse error.
- An `api` block that no deployable `serves:` is a silent no-op — I declared one
  with `scaffoldPagedApi`, forgot `serves:`, and got 0 errors and 0 routes.
- IR-phase diagnostics print with no file:line at all (`loom.ui-id-ref-no-display
  webApp/Product.category: …`), where AST diagnostics print `main.ddd:63:14`.
- `'requires' must be of type 'bool', got 'unknown'` names no sub-expression; the
  magic `permissions` receiver typed to `unknown` silently.

## The systemic ratchet

Nothing in CI parses the `ddd` fences in `README.md` / `docs/*.md`. I extracted
all 9 self-contained `system …` fences from those files and parsed each:

| Fence | Result |
|---|---|
| `README.md:61` | 1 error (the headline example; needs ≥8 fixes to parse) |
| `docs/auth.md:118` | 2 errors (fragment — refs an aggregate it doesn't show) |
| `docs/tenancy.md:14` | 1 error (`crossTenant` prefix — logged at `T9-toolchain-health.md:529`, still there) |
| `docs/api-toolkit.md:153` | 1 error (deliberately-invalid example — correct) |
| `docs/page-metamodel.md:161` | 1 error (sketch, but shows an invalid `user {}`) |
| 4 others | clean |

`docs/language.md`'s own complete example parses clean, which shows the fix is
affordable — it is simply not enforced. A gate that parses every self-contained
fence, with an explicit waiver list for the deliberately-invalid ones, is the
ratchet that keeps #2861's doc fixes from rotting again.

---

# Remediation plan

Sequenced 2026-09-10, after reconciling with #2861 (which owns the projection
parameter drop, Vue attribute escaping, the first-run doc/starter breakage, and
the `create`-input gates — none of those appear below).

## Design gaps — decide before Wave 2

### G1 — a macro-emitted member has no way to carry an authorization gate

The defect is D1; the gap is that there is no surface where the gate could go.
`crudish` and `scaffoldPaged` emit client-reachable members, macro params are
`string | bool | int | ref | refList` (`src/macros/api/define.ts:65-69`) with no
expression kind, and an aggregate `Create` / `Destroy` carries its gate as a
body STATEMENT in a body the macro owns.

> **Revised 2026-09-10 after maintainer review.** An inherited aggregate- or
> context-level default gate was REJECTED — a default-deny rule that is not
> visible at the member it guards is the wrong trade. The recommendation below
> replaces it.

**Recommendation: pass a named policy function to the macro.** The gate stays
explicit, named, and written at the macro call site; nothing is inherited.

```ddd
policy CatalogManager(): bool =
  currentUser.permissions.contains(permissions.catalogManage)

aggregate Product with crudish(requires: CatalogManager) { sku: string }
```

Cost — **no grammar change**. `requires: CatalogManager` is a bare ID, already a
`MacroArgRef` (`ddd.langium:1136`). What changes:

1. `NamedDeclKind` in `src/macros/api/define.ts` gains `"Policy"`;
2. `crudish` declares `requires: { kind: "ref", of: "Policy", optional: true }`
   and splices `requires <Policy>()` as the first statement of each emitted body;
3. `denyByDefault`'s message, when the ungated member came from a macro, names
   the macro and this parameter instead of a member the author cannot edit.

Verified: a named policy function already gates and inlines correctly today —
`create(...) { requires CatalogManager() }` emits
`if (!((currentUser.permissions).includes("sales.catalogManage"))) throw new
ForbiddenError("Forbidden: CatalogManager()")`. The macro has only to splice the
statement the author would have written by hand.

`scaffoldPaged`'s half of this problem disappears entirely under G2 — a
`retrieval` that carries its own `requires` needs no macro.

### G2 — the read path has no replacement of equal power

| Spelling | route | client hook | scaffold filter bar | index hint | survives `denyByDefault` |
|---|---|---|---|---|---|
| `find …: T[]` | yes | yes | yes | yes | yes — **but deprecated** |
| `criterion` + `retrieval` | no | no | no | no | n/a |
| + `scaffoldPaged` + `scaffoldPagedApi` + `serves:` | yes | yes | no | yes | **no** (G1) |

A tool must not deprecate the only spelling that works.

**Recommendation: bring `retrieval` to parity on all six axes, then retire the
macros, then make the deprecation honest — in that order.** A `find` yields six
things; a `retrieval` must yield the same six before the warning is defensible.

```ddd
criterion Sellable of Product = status == Active && stock > 0

retrieval SellableProducts of Product
  requires currentUser.role == "staff"      // ← new clause, mirrors `find … requires`
  { where: Sellable  sort: [sku asc] }
```

| # | axis | today | after |
|---|---|---|---|
| 1 | repository method | ✅ `runSellableProducts` | unchanged |
| 2 | HTTP route | ❌ needs `scaffoldPaged` + `scaffoldPagedApi` + `serves:` | derived from the declaration |
| 3 | typed client + hook | ❌ | follows the route |
| 4 | scaffold list-page filter bar | ❌ scaffold scans `find` params only | scans retrieval params too |
| 5 | index suggestion | ❌ checker scans `repo.finds` + `contextFilters` | scans criterion predicates too |
| 6 | survives `denyByDefault` | ❌ the macro-emitted handler cannot be gated | the `requires` clause above |

Axis 6 belongs to THIS proposal rather than G1's: a route-bearing retrieval that
carries its own gate removes `scaffoldPaged` from the G1 problem altogether.
Once 2–6 land, **`scaffoldPaged` and `scaffoldPagedApi` retire** — they exist
only to supply axis 2.

Interim, shipped first and alone: `loom.repository-find-deprecated` stops firing
until the replacement reaches parity, so `ddd new` no longer warns about its own
template.

### G3 — `this.x :=` and factory parameter shadowing

`create(name: string) { this.name := name }` cannot be written: `this.` is not
in the `LValue` head (`ddd.langium:2213`) and the bare `name` resolves to the
shadowing parameter. `docs/language.md:1078` already describes `:=` as
"assignment to a property reachable from `this`".

Two options, and they are not the same size.

**(a) Make the spelling work — ~15 lines.** Not a feature; a prefix flag.
`LValue` (`ddd.langium:2209`) gains `(thisRef?='this' '.')?` before `head`, and
`lowerStatement`'s LValue dispatch (`lower-stmt.ts:181`) gains one early branch:
a `thisRef` head resolves straight to a this-prop, skipping the action /
function / operation / store / service / resource arms it must not consider.
Plus a printer arm (`print-completeness.test.ts` will demand it) and a test.
`'this'` is already a token (`ddd.langium:2601`, `ThisRef`), and `('this' '.')?`
is already spelled at `ddd.langium:1704`.

**(b) Refuse the silent bug only — one validator, no grammar.**
`loom.param-shadows-field` on `name := name` where `name` is both a parameter and
a field: "the assignment writes the parameter, not the field; rename the
parameter." Stops the silent no-op, leaves the natural spelling unwritable.

**Recommendation: (a).** (b) is strictly smaller but still leaves every factory
parameter renamed away from the field it fills. Rejected outright: resolving a
bare LHS name to the field instead of the parameter — that silently changes the
meaning of models that already compile.

### G4 — block-body separators are inconsistent

Commas separate members in `event` / `payload` bodies and are a parse error in
`aggregate` / `valueobject` / `user` bodies. **ACCEPTED — align them.**

The grammar already ships the idiom, at `EventDecl` (`ddd.langium:1332`):

```langium
(fields+=Property (','? fields+=Property)* ','?)?
```

Apply that exact shape to the four rules that lack it:

| rule | line | today |
|---|---|---|
| `Aggregate` | 1066 | `members+=AggregateMember*` |
| `ValueObject` | 990 | `members+=ValueObjectMember*` |
| `EntityPart` | 1324 | `members+=EntityPartMember*` |
| `UserBlock` | 144 | `fields+=UserField*` |

No semantics, no new idiom, and it retires a whole class of copy-paste failure —
including the invalid `user { id: string, permissions: string[] }` in
`docs/page-metamodel.md:161` and the `aggregate Product { sku: string, price: Money }`
in the README.

### G5 — IR-phase diagnostics carry no source position

`LoomDiagnostic` is `{severity, message, source, code}` with no span
(`src/ir/validate/checks/diagnostic.ts`), so `ddd parse` prints
`loom.ui-id-ref-no-display webApp/Product.category: …` where an AST diagnostic
prints `main.ddd:63:14`. `src/ir/lower/origin.ts` already captures `$cstNode`
spans. **Recommendation: its own mission, sequenced last** — an optional span on
`LoomDiagnostic`, threaded from the IR nodes that carry origin, plus the CLI
and LSP printers. It touches all ~17 check leaves.

## The fleet

Each agent: branch from fresh `origin/main`, open its DRAFT PR first (the claim),
implement, mutation-prove the gate it adds, run the matching local gate, then
mark ready. One slice per agent; no two agents in a wave share a file.

### Wave 1 — six agents, no design decision needed, startable now

| # | Slice | Primary files | Proof |
|---|---|---|---|
| F1 | **D2** — the UI-gate codegen throw becomes a `loom.*` validator error | `src/generator/_frontend/gate-expr.ts`, `src/language/validators/` | the repro model validates-clean today and must fail validation after; revert the check → repro throws again |
| F2 | **D3 + D4** — two page-body gates: a markup primitive inside a collection-op lambda, and a `money` expression in a non-formatting text slot | `src/language/validators/ui-checks.ts`, `src/generator/_walker/` | each gate mutation-proven; both repros currently emit non-compiling output |
| F3 | **D5** — optional value-object hydration narrows only its first column | `src/generator/typescript/repository-builder.ts` + the four backend siblings | new corpus fixture with an optional VO; `test:tsc-corpus` red before, green after |
| F4 | **D6** — an `X id?` claim in `user {}` emits an unimported `Ids.` and a doubled `\| null` | the auth emitters, all backends | new corpus fixture with an id-typed claim; same gate |
| F5 | **D7b** — index suggestions are blind to `criterion` / `retrieval` predicates | `src/ir/validate/checks/index-suggestion-checks.ts` | test asserting the suggestion survives a find → criterion migration |
| F6 | **D8** — an aggregate with no creator gets a diagnostic | validators | stacked on #2861 slice 4, or dropped if that PR takes it |

F3 and F4 both add a corpus fixture — distinct filenames, agreed up front.

### Wave 2 — three agents, gated on the G-decisions above

| # | Slice | Depends on |
|---|---|---|
| F7 | the macro gate surface | **G1** |
| F8 | read-path parity (filter bar + retrieval route, or the honest downgrade first) | **G2** |
| F9 | `this.` in the LValue head; optional commas between members | **G3 + G4** |

### Wave 3 — three agents, finishing

| # | Slice | Depends on |
|---|---|---|
| F10 | the ` ```ddd ` fence CI gate + waiver list | **#2861 slice 3 merging first** |
| F11 | papercuts: the `channel carries:` doc, the root-vs-system placement in the migration message, a diagnostic for an `api` no deployable `serves:`, and the `'requires' must be of type 'bool', got 'unknown'` wording | — |
| F12 | source positions on IR diagnostics | **G5** |

---

# Pass 2 — the same model on every other target

The first pass compiled node + react only. This pass regenerated the identical
e-shop model onto the other four backends and the other three frontends, plus
the Phoenix LiveView ui, and compiled what could be compiled here.

| Target | How far it was taken | Result |
|---|---|---|
| node / react | `tsc --noEmit` both halves | 10 backend errors, 1 frontend (D1 pass) |
| **java** | `gradle compileJava` on JDK 21 | **2 errors, one defect** — compile-proven |
| **vue** | `vue-tsc --noEmit` | **31 errors**, every one scaffold-emitted |
| **svelte** | `svelte-check` | **1 error** |
| **python** | module namespace evaluation | **1 defect, runtime** — proven |
| **dotnet** | source inspection (no SDK here) | **2 defects**, both unambiguous |
| **elixir** | generation diff against react | **1 defect — silent wrong data** |
| angular | `tsc -p tsconfig.app.json` | clean. `ng build` not run: the generated project's Angular CLI wants Node ≥ 22.22.3, this host has 22.22.2, so template typechecking is UNVERIFIED |
| flutter / feliz | not attempted — no SDK here | unverified |

## P1 — Phoenix LiveView silently substitutes "list everything" for every filtered page read

The most severe thing in either pass. A page body that names a filtered read
renders a different result set on Phoenix than on every other frontend, with no
diagnostic.

```ddd
criterion LiveItems of Item = st == Live
page OnlyLive { route: "/only-live"
  body: QueryView { of: Item.findAllByLiveItems(), data: rows => … } }
```

| target | emitted load |
|---|---|
| react | `useFindAllByLiveItemsItem()` — the filtered read |
| **phoenixLiveView** | `Api.Shop.list_items()` — **every row** |

The context module exposes `find_all_by_live_items_item/4` two lines away; the
LiveView never calls it. My storefront page — `of: Product.findAllBySellable()`,
meaning in-stock, published products — renders drafts and discontinued products
on Phoenix.

With a **parameterised find** it is worse than wrong, it is nonsense:

```ddd
find byState(state: St): Item[] where this.st == state
body: QueryView { of: Item.byState(Live), … }
```
→ `case Api.Shop.list_items(:Live) do`

against `defdelegate list_items(page \\ 1, page_size \\ 20, sort \\ "id", dir \\ "asc")`
— the filter value is passed as the **page number**. The find is not delegated
into the context module at all.

Root cause: `src/generator/elixir/liveview-emit.ts:1293` hard-codes
`list_<agg>s(<args>)` for any list-shaped read; the `of:` call's operation name
is never consulted. `byId` is routed correctly (`get_<agg>`), so this is
specific to the collection path. Repro: `/tmp/heex.ddd` and `/tmp/heex2.ddd`
shapes, reproduced in the audit's session.

## P2 — the `user {}` id-claim defect (D6) hits four of five backends, four different ways

One emitter bug, four symptoms, from `customerId: Customer id?`:

| backend | emitted | symptom |
|---|---|---|
| node | `Ids.CustomerId \| null \| null`, `Ids` unimported | `TS2503`, compile-proven |
| **java** | `CustomerId customerId`, unimported (`User` is in `…auth`, the id in `…domain.ids`) | **`cannot find symbol` — compile-proven, and the ONLY error in the whole Java tree** |
| **python** | `cast(CustomerId \| None \| None, …)` with no import | **`NameError` on every OIDC token verification** — the annotation is inside a function body, so it is evaluated per call. Proven: `'CustomerId' in vars(app.auth.oidc)` is `False`, and evaluating the emitted annotation in its own module raises. Login is permanently broken. |
| **dotnet** | `public sealed record User(…, CustomerId?? CustomerId)` | **`??` is not C# type syntax — the project does not parse** |
| elixir | a plain map | fine |

The doubled nullable (`\| null \| null`, `\| None \| None`, `??`) and the missing
import are two independent bugs in the same line, and the neutral type renderer
is emitting the optional marker twice for an `X id?`.

## P3 — the optional value object (D5) also breaks .NET, at the schema

Node's symptom was a typecheck error in repository hydration. On .NET it is a
schema mismatch. Isolated with one aggregate carrying both shapes:

```ddd
aggregate Person with crudish { name: string  home: Addr  office: Addr? }
```

```csharp
builder.OwnsOne<Addr>(x => x.Home, o => { … });          // required VO — correct
builder.Property(x => x.Office).HasColumnName("office"); // optional VO — wrong
```

while the migration it ships beside creates `office_line1` / `office_city` and
no column called `office`. EF cannot map a complex type as a scalar without a
converter, so this fails at model build — every read and write of the aggregate.

Java maps the optional VO with `@Embedded` + `@AttributeOverride`, which is
correct JPA. Python mirrors node's first-column-only narrowing but is
dynamically typed, so a partially-null row yields an `Address` with `None`
fields rather than an error — latent, not fatal.

## P4 — the Vue frontend does not typecheck: 31 errors, all scaffold-emitted

`vue-tsc --noEmit` is the first half of the generated project's own
`npm run build`, so `npm run build` fails on the generated Vue app. Three
classes, none of them from my hand-written page:

| count | error | cause |
|---|---|---|
| 22 | `TS18049` `…values.shipping is possibly 'null' or 'undefined'` | an **optional value object** dereferenced in the scaffolded create/update form with no guard |
| 4 | `TS2322` `Type 'string' is not assignable to type 'Decimal'` | a **`money`** field bound to a form input model |
| 5 | `TS2322` `'string \| null \| undefined'` → `'string \| number \| undefined'` | an **optional string / `X id?`** bound to an input |

Files: `customers/detail`, `orders/detail`, `payments/detail`, `payments/new`,
`products/detail`, `products/new`. Any Vue model with an optional value object,
a money field, or an optional string hits this — which is close to every real
model, so the `generated-vue-build` corpus evidently has none of the three.

## P5 — Svelte: a parameterless criterion read calls a hook that requires an argument

```
src/routes/(app)/shop/+page.svelte:8  Expected 1 arguments, but got 0.
```

The page emits `useFindAllBySellableProduct()`; the client emits
`export function useFindAllBySellableProduct(query: () => FindAllBySellableQuery)`
— required. React gives the same parameter a default (`= {}`) and Vue passes one.
A Svelte-only arity disagreement between the two emitters.

## P6 — `type`, `user`, `event`, `index`, `header` and `document` cannot be field names

```ddd
aggregate Invoice { type: string }
→ error: Expecting token of type '}' but found `type`.
```

183 of the 296 identifiers tracked in
`test/language/parsing/keyword-identifier-coverage.snapshot.json` are usable in
zero positions. Most are unavoidable (`aggregate`, `context`, `enum`), but the
set includes ordinary domain vocabulary: `type`, `user`, `event`, `index`,
`header`, `document`, `layout`, `log`, `main`, `provider`, `required`, `seed`,
`solution`, `storage`, `test`, `theme`, `unique`, `work`. `Invoice.type` and
`Account.type` are among the most common field names in business modelling.
`state`, `key`, `role` and `status` are fine, so the line is arbitrary from a
modeller's point of view.

The snapshot RECORDS this — these are reviewed decisions, not oversights — but
the review was against the grammar, not against what users name fields. Two
separable asks: widen the soft-keyword set in the field-name position, and make
the failure say "`type` is reserved here" instead of "Expecting token of type
'}'".

## What pass 2 changes about the fleet

Three of the wave-1 slices grow, and one new agent joins ahead of them.

- **New, ahead of everything: P1**, the Phoenix list-read substitution. It is the
  only defect here that produces *wrong data silently* rather than a build
  failure, and it needs no design decision:
  `src/generator/elixir/liveview-emit.ts` must resolve the `of:` call's
  operation the way `byId` already is, and refuse (a `loom.*` gate) rather than
  fall back when it cannot.
- **F4 grows from one backend to four.** The `user {}` id-claim slice now covers
  node, java, python and dotnet, with the doubled-nullable and the missing
  import as two distinct fixes. Its proof is a corpus fixture with an `X id?`
  claim compiled on every backend — java's leg is one line and catches it.
- **F3 grows to include the .NET schema half.** The optional value object is a
  typecheck error on node and a model-build failure on dotnet, and the fixture
  must assert the EF mapping emits `OwnsOne` for both the required and the
  optional case.
- **New: P4 + P5**, the Vue and Svelte frontend breaks. Both are scaffold-side
  and independent of the page-body gates in F2, so they are one more agent:
  the optional-VO form guard, the money-input binding, the optional-string input
  binding, and the Svelte hook arity.
- **P6** joins the papercut agent (F11) as two separable asks: widen the
  soft-keyword set in the field-name position, and make the failure name the
  reserved word.

The common thread across P2, P3, P4 and P5 is that the per-PR compile gates
carry no corpus fixture with an **optional value object**, a **`money` field
bound to a form**, or an **`X id?` user claim** — three shapes that appear in
essentially every real model. One fixture carrying all three, compiled on every
backend and typechecked on every frontend, would have caught nine of the
eleven defects in this audit.

---

# Worked examples for each recommendation

Every "generated" block below is real output from this toolchain. Where the
proposal is new syntax, the generated half comes from the hand-written
desugaring that exists today — that is what the sugar has to produce.

## G1 — a named policy passed to the macro

**Today.** The starter's own recommended posture cannot be expressed:

```ddd
aggregate Product with crudish { sku: string }
```
```
loom.default-deny-ungated Product/update  … declares no `requires` gate
loom.default-deny-ungated Product/create  … declares no `requires` gate
loom.default-deny-ungated Product/destroy … declares no `requires` gate
```
The three members come from the macro, and an aggregate `create` / `destroy`
carries its gate as a body statement, so there is nowhere to put one.

**Proposed.** The gate is named once and handed to the macro that emits the
members. Nothing is inherited; the rule is visible at the call site.

```ddd
policy CatalogManager(): bool =
  currentUser.permissions.contains(permissions.catalogManage)

aggregate Product with crudish(requires: CatalogManager) {
  sku: string
  name: string

  // A hand-written member still carries its own gate, as today.
  operation view() { requires true }
}
```

**Generated** (Hono — this is today's output for the hand-written
`create(...) { requires CatalogManager() }`, `pol.ddd`; the macro has only to
splice that statement):

```ts
// api/http/product.routes.ts — create, rename and destroy each open with:
if (!((currentUser.permissions).includes("sales.catalogManage")))
  throw new ForbiddenError("Forbidden: CatalogManager()");
```

No grammar change: `requires: CatalogManager` is already a `MacroArgRef`
(`ddd.langium:1136`). `NamedDeclKind` gains `"Policy"`, `crudish` gains the
optional param, and `denyByDefault`'s message names the macro and the parameter
when the ungated member came from one.

## G2 — a `retrieval` carries its own route

**Today.** Three declarations and a `serves:` clause to publish one filtered list:

```ddd
context Catalog with scaffoldPaged(of: Sellable) { … }
api CatalogApi with scaffoldPagedApi(of: Sellable) { }
deployable api { … serves: CatalogApi }
```

Drop any one of the three and the read vanishes with no diagnostic. Under
`denyByDefault` the combination cannot validate at all (G1).

**Proposed.** The retrieval is the declaration; the route, the client, the
filter bar, the index hint and the gate all follow from it:

```ddd
criterion  Sellable of Product = status == Active && stock > 0

retrieval  SellableProducts of Product
  requires currentUser.role == "staff"     // ← new, mirrors `find … requires`
  { where: Sellable  sort: [sku asc] }
```

That `requires` clause is what makes the read survive `denyByDefault` without any
macro — which is why `scaffoldPaged` and `scaffoldPagedApi` retire once this
lands, and why G1 then has only `crudish` left to solve.

**Generated** (Hono — this is today's `scaffoldPaged` + `scaffoldPagedApi`
output, which is exactly what the sugar must keep producing):

```ts
// api/http/catalogApi-routes.ts
app.openapi(
  createRoute({
    method: "get",
    path: "/products/projections/sellable",
    operationId: "catalogListProductBySellable",
    request: { query: z.object({ page: …, pageSize: …, sort: …, dir: … }) },
    …
  }),
  async (httpCtx) => {
    const query = httpCtx.req.valid("query");
    const products = new ProductRepository(db, events);
    const result = await products.findAllBySellable(
      query.page, query.pageSize, query.sort, query.dir);
    return httpCtx.json(
      { ...result, items: result.items.map((__e) => products.toWire(__e)) }, 200);
  },
);
```

Interim, until that lands — `loom.repository-find-deprecated` stops firing on a
model that has no retrieval to migrate to, so `ddd new` no longer warns about
its own template.

## G3 — `this.` on the left of `:=`

**Today.** The natural factory and the natural setter are both unwritable:

```ddd
create(name: string)      { this.name := name }   // ✗ Expecting token of type '}' but found `this`
operation rename(name: string) { this.name := name } // ✗ same
operation rename(name: string) { name := name }   // parses — assigns the parameter to itself
```
The only working spelling renames the parameter away from its field:
```ddd
operation rename(newName: string) { name := newName }
```

**Proposed (a).** `'this'` joins the LValue head, so the shadowed form means what
it reads as. `'this'` is already a token (`ddd.langium:2601`) and `('this' '.')?`
is already spelled at `ddd.langium:1704`; the lowering gains one early branch.

```ddd
operation rename(name: string) { this.name := name }
```

**Alternative (b), no grammar.** Leave the spelling unwritable and refuse the
silent bug instead — `loom.param-shadows-field` on `name := name`:
"the assignment writes the parameter, not the field; rename the parameter."
Smaller, but every factory parameter stays renamed away from its field.

**Generated** (Hono — identical to what the renamed-parameter form emits today):

```ts
public rename(name: string): void {
  this._name = name;
  this._assertInvariants();
}
```

## G4 — an optional comma between members

**Today.** Commas separate members in `event` and `payload` bodies and are a
parse error in `aggregate`, `valueobject` and `user`:

```ddd
event  OrderPlaced { order: Order id, at: datetime }   // ✓
aggregate Product  { sku: string, price: money }       // ✗ Expecting token of type '}' but found `,`
user               { id: string, role: string }        // ✗ same
```

**Proposed.** Both spellings parse and mean the same thing:

```ddd
aggregate Product with crudish { sku: string, price: money }
```

**Generated** (Drizzle — byte-identical to the newline form's output today):

```ts
// api/db/schema.ts
sku:   text("sku").notNull(),
price: numeric("price", { precision: 19, scale: 4 }).notNull(),
```

This is also what makes the README's `aggregate Product { sku: string, price: Money }`
and `docs/page-metamodel.md:161`'s `user { id: string, permissions: string[] }`
true rather than aspirational.

## G5 — a source position on an IR diagnostic

Not a language change — a CLI one. Same model, same run:

```
main.ddd:63:14 error: 'requires' must be of type 'bool', got 'unknown'.        ← AST phase
loom.ui-id-ref-no-display webApp/Product.category: … no 'derived display' …    ← IR phase
```

**Proposed** — the IR half gains the same prefix, from the `$cstNode` span
`src/ir/lower/origin.ts` already captures:

```
main.ddd:41:9 error: loom.ui-id-ref-no-display  'Product.category' references
  Category id, but 'Category' has no 'derived display' clause.
```

## P1 — the Phoenix read that has to name its own query

Not a proposal — a fix. Same page body, two frontends:

```ddd
criterion Sellable of Product = status == Active && stockOnHand > 0
page Storefront {
  route: "/shop"
  body: QueryView { of: Product.findAllBySellable(), data: rows => … }
}
```

```tsx
// react — correct
const productFindAllBySellable = useFindAllBySellableProduct();
```

```elixir
# phoenixLiveView — WRONG: every product, drafts and discontinued included
case Api.Catalog.list_products() do
  {:ok, items} -> assign(socket, :items, items)
  _ -> assign(socket, :items, :error)
end
```

…while the same context module already exposes the right one:

```elixir
defdelegate find_all_by_sellable_product(page \\ 1, page_size \\ 20,
                                         sort \\ "id", dir \\ "asc"),
  to: Api.Catalog.ProductRepository, as: :find_all_by_sellable
```

With a parameterised find the fallback is not merely wrong, it is nonsense —
`of: Item.byState(Live)` emits `Api.Shop.list_items(:Live)` against
`list_items(page \\ 1, …)`, so the filter value arrives as the page number.

## P2 — one `.ddd` line, four broken backends

```ddd
user {
  id: string
  role: string
  permissions: string[]
  customerId: Customer id?
}
```

```ts
// node — Ids never imported, `| null` twice
customerId: Ids.CustomerId | null | null;     // TS2503: Cannot find namespace 'Ids'
```
```java
// java — CustomerId lives in …domain.ids, User in …auth, no import
public record User(String id, String role, List<String> permissions, CustomerId customerId) {}
// error: cannot find symbol — symbol: class CustomerId
```
```python
# python — evaluated per call inside cast(), so every token verification raises
customer_id=cast(CustomerId | None | None, _claim(payload, "customer_id")),
# NameError: name 'CustomerId' is not defined
```
```csharp
// dotnet — `??` is the null-coalescing operator, not a type suffix
public sealed record User(string Id, string Role, List<string> Permissions, CustomerId?? CustomerId);
```

Correct, in each: import the id type, and emit the optional marker once
(`Ids.CustomerId | null`, `CustomerId?`, `CustomerId | None`).

## P3 — an optional value object, required and optional side by side

```ddd
valueobject Addr { line1: string  city: string }
aggregate Person with crudish {
  name:   string
  home:   Addr
  office: Addr?
}
```

```csharp
// dotnet — Infrastructure/Persistence/Configurations/PersonConfiguration.cs
builder.OwnsOne<Addr>(x => x.Home, o => { … });            // required — correct
builder.Property(x => x.Office).HasColumnName("office");   // optional — WRONG
```
```sql
-- the migration shipped beside it creates neither an `office` column …
"home_line1"   TEXT NOT NULL,
"home_city"    TEXT NOT NULL,
"office_line1" TEXT NULL,
"office_city"  TEXT NULL,
```

The optional case has to take the same `OwnsOne` path, marked optional.
On node the same shape fails in hydration, narrowing only the first column:

```ts
shipping: (root.shipping_line1 == null ? null
  : new Address(root.shipping_line1, root.shipping_city,      // string | null
                root.shipping_postalCode, root.shipping_country))
// TS2345: Argument of type 'string | null' is not assignable to parameter of type 'string'
```

## P4 / P5 — the three Vue shapes and the Svelte arity

```ddd
aggregate Customer with crudish {
  email:    string
  fullName: string
  shipping: Address?        // → 22 × TS18049
}
aggregate Product with crudish {
  price:       money        // →  4 × TS2322  string vs Decimal
  description: string?      // →  5 × TS2322  null vs string | number
}
```

```vue
<!-- optional VO — dereferenced with no guard -->
:model-value="updateForm.values.shipping.line1"
<!-- 'updateForm.values.shipping' is possibly 'null' or 'undefined' -->

<!-- money — the input model is Decimal, the binding is a string -->
:model-value="String(form.values.price ?? '0')"
@update:model-value="(v) => form.values.price = String(v || '0')"
```

```svelte
<!-- svelte — the page calls it with no argument … -->
const productFindAllBySellable = useFindAllBySellableProduct();
```
```ts
// … and the client declares the argument required (react defaults it to {})
export function useFindAllBySellableProduct(query: () => FindAllBySellableQuery) { … }
```

## P6 — the reserved words a modeller actually reaches for

```ddd
aggregate Invoice { type: string }      // ✗ Expecting token of type '}' but found `type`
aggregate Audit   { event: string }     // ✗
aggregate Page    { index: int }        // ✗
aggregate Request { header: string }    // ✗
aggregate Vault   { document: string }  // ✗
aggregate Order   { status: string }    // ✓
aggregate Order   { state: string }     // ✓
aggregate Order   { key: string }       // ✓
```

Two separable asks: widen the soft-keyword set in the field-name position, and
make the refusal name the word — `'type' is reserved here; quote it or rename
the field` — instead of `Expecting token of type '}'`.
