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
