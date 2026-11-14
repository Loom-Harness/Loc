# D-DATAGRID-TARGETS — a target hosts `DataGrid` only if it can host TanStack

**Status:** PINNED.

**Problem.** `DataGrid` (M-T1.1 slice 10) is not a markup mapping. It is a
TanStack Table row model — multi-column sort, per-column filters, column
visibility, pagination, row selection — that each target wires to its own
reactivity through the `renderDataGridChild` seam. The seam exists precisely so
those semantics are shared rather than re-derived. That makes "should target X
get a DataGrid?" a different question from every other primitive's, and the
tempting answer is the wrong one: most UI toolkits ship *a* data grid, and
adopting it would satisfy the emitter while quietly forking behaviour.

**Decision.** A frontend ships `DataGrid` **iff it can run TanStack Table
itself**. Not "iff it emits JSX", and not "iff its UI kit has a grid widget".

- **React / Vue / Svelte / Angular / Feliz — yes.** The first four via their
  official adapters or (Svelte) `@tanstack/table-core` directly. **Feliz too:**
  Fable compiles F# to JavaScript, so it binds `table-core` through ordinary
  interop and executes the same row model. No adapter is required, and none
  exists — that was never the test.
- **Flutter — no, permanently.** There is no Dart adapter and no Dart port.
  `dart:js_interop` exists on Flutter *web* only, while the shipping target
  (what `generated-flutter-build.yml` builds) is a native APK with no JS
  runtime. A primitive that compiles on one Flutter target and not the other is
  worse than an honest gap.
- **HEEx — no,** and (revised) for the **same** rule, not an unrelated one.
  LiveView has a JS runtime, so "can it host TanStack?" is not answered by
  physics the way Flutter's is; it is answered by what hosting would cost.
  Both available roads fork the seam:
  - **Hand-rolled server-side.** The rows are already in a socket assign, so
    sort/filter/visibility/paging would be `Enum.sort_by`/`Enum.filter`/
    `Enum.slice` over that assign — feasible, and *that is the problem*: it
    means re-deriving `sortingFns.alphanumeric`, the multi-sort tie-break
    order, `filterFns.includesString` and TanStack's pagination edges in
    Elixir, against a library that keeps moving. Identical to the Dart
    hand-roll this decision already rejects.
  - **A `phx-hook` mounting `table-core`** over a `phx-update="ignore"`
    subtree. Technically the real row model, but a JS-owned island LiveView
    must not patch — forfeiting the server-rendered markup every other HEEx
    primitive is built on (page objects, the shared chrome-i18n path,
    `<.input>`/`<.table>`), to gain one primitive.

  `Table` is server-driven there instead, and carries real sort + pagination.

`Table` is the portable answer on both, and it carries column sort, pagination
and filtering on every frontend. `loom.target-unsupported#datagrid` says so, per
target, rather than "not supported yet".

**Correction (DataGrid pin re-examination).** Until this revision, HEEx's
exclusion was justified — in `KNOWN_HEEX_GAPS`, in `allowlist-ratchet`, and in
the `*-unsupported` register's "phoenixLiveView is the open leg" — by a blocker
that does not exist: *"every interaction would be a `handle_event` round-trip
re-querying the server … and needs backend support for multi-column ORDER BY,
which `list/4`'s single sort/dir pair does not have."* **`DataGrid` drives no
server read on any of the five targets that ship it.** It grids the array it was
handed (`getSortedRowModel` / `getFilteredRowModel` / `getPaginationRowModel`
over `data: rows`; `pageSize:` is a *client* page size), so `list/4`'s sort/dir
pair was never on its path — and on LiveView those same rows sit in a socket
assign, so nothing would be re-queried either. The exclusion survives the
correction, but on this decision's own rule rather than on a backend limit.
Column visibility deserves its own note: it is pure assign state touching no row
model at all, so it is the one grid feature with nothing to fork — which makes
it a candidate for `Table`, not an argument for a partial `DataGrid`.

**Rationale.**

- Flutter ships `DataTable`/`PaginatedDataTable`, which is exactly the trap.
  They would give an author *a* grid whose sort stability, filter composition,
  multi-sort semantics and pagination edges differ from the other five — the
  divergence class the shared seam was built to prevent, reintroduced under a
  primitive with one name.
- The alternative — hand-rolling a row model in Dart — is the same fork with
  more code, and it is unbounded work: parity is measured against a library
  that keeps moving.
- Stating the rule as "can it host TanStack" makes both answers fall out
  mechanically and keeps the next target's decision cheap. Read it as **"can it
  host TanStack *without forking the target's own contract*"** — that is what
  makes it answer HEEx too, where the literal question has a yes-shaped answer
  nobody wants.
- The grid already carries one deliberate override of a TanStack comparator
  (`compareDecimal`, for money columns whose `Decimal.valueOf()` returns a
  string), and `data-grid.test.ts` declines to add a second because it "would
  FORK TanStack's `text`/`alphanumeric` choice" — at *one column*. That is the
  scale at which forking is already treated as a cost; a whole
  re-implementation is the same cost everywhere, with no shared spec to hold
  the targets together.

**Affects.** the `primitive:DataGrid@body` row of `util/target-capabilities.ts`;
`DATA_GRID_PRIMITIVES` (`generator/_packs/required-primitives.ts`);
`util/flutter-deferred-primitives.ts`; `generator/feliz/data-grid-child.ts`;
[`page-metamodel.md` §9.1](../page-metamodel.md); `[new-plan/T1-ui-frontend.md](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T1-ui-frontend.md)`
M-T1.1.
