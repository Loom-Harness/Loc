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

| Option | Cost | Consequence |
|---|---|---|
| (a) add `kind: "expr"` to the macro param API → `with crudish(requires: <expr>)` | macro API + every macro that emits a reachable member | precise, but per-macro and every future macro must remember |
| (b) **an aggregate / context default gate** — `aggregate Order requires <expr> { … }`, inherited by every client-reachable member that declares none | grammar + validator + the denyByDefault check | the gate lives somewhere a macro cannot take away |
| (c) message-only — denyByDefault names the MACRO, not the member you cannot edit | one message | honest, fixes nothing |

**Recommendation: (c) immediately, (b) as the mission, (a) only on demand.**
(b) has independent value: writing the e-shop I hand-wrote eleven near-identical
`requires` lines that a single aggregate-level gate would have carried.

### G2 — the read path has no replacement of equal power

| Spelling | route | client hook | scaffold filter bar | index hint | survives `denyByDefault` |
|---|---|---|---|---|---|
| `find …: T[]` | yes | yes | yes | yes | yes — **but deprecated** |
| `criterion` + `retrieval` | no | no | no | no | n/a |
| + `scaffoldPaged` + `scaffoldPagedApi` + `serves:` | yes | yes | no | yes | **no** (G1) |

A tool must not deprecate the only spelling that works.

| Option | Cost |
|---|---|
| (a) a `retrieval` becomes route-bearing when its context is served — a true peer of `find`; subsumes `scaffoldPagedApi` | mission-sized, five backends |
| (b) the scaffold binds criteria/retrievals in the filter bar and emits a page per `scaffoldPaged` read | scaffold macros + `_body-builders.ts` |
| (c) downgrade `loom.repository-find-deprecated` to a hint (or scope it to models that already declare a retrieval) until (a)+(b) land | one validator |

**Recommendation: (c) now, (a)+(b) as one mission.**

### G3 — `this.x :=` and factory parameter shadowing

`create(name: string) { this.name := name }` cannot be written: `this.` is not
in the `LValue` head (`ddd.langium:2213`) and the bare `name` resolves to the
shadowing parameter. `docs/language.md:1078` already describes `:=` as
"assignment to a property reachable from `this`".

**Recommendation: add `'this'` to the LValue head** — one grammar alternative
plus one lowering arm. Rejected: resolving a bare LHS to the field instead of
the parameter, which would silently change the meaning of existing models.

### G4 — block-body separators are inconsistent

Commas separate members in `event` / `payload` bodies and are a parse error in
`aggregate` / `valueobject` / `user` bodies. **Recommendation: accept an optional
`,` between members everywhere.** No semantics, one grammar change, and it
retires a whole class of copy-paste failure — including the invalid
`user { id: string, permissions: string[] }` in `docs/page-metamodel.md:161` and
the `aggregate Product { sku: string, price: Money }` in the README.

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
