# D-REPOSITORY-CONTRACT — a repository is a body-less declaration whose surface is one declared verb contract

**Status:** PINNED (owner ruling, 2026-10-25). The foundation — the contract
table and the canonical repository op on the IR — has landed; the surface
changes below land in later slices.

**Problem.** The built-in repository verbs existed only as hard-coded copies:
the typing pass, the IR result type, the read/write classifier, three IR
validators, the not-found predicate and the per-backend emitters each kept
their own list of `getById` / `findById` / `find` / `findAll` / `all` / `run`
/ `delete`. The copies drifted — `findById` was typed `T` in one table and
`T?` in another, and its emitted method did not exist on .NET and Elixir — and
the IR carried the surface spelling (`repo-let.method: "getById"`,
`repo-read.readKind`), so every emitter re-dispatched on source text.

**Decision.** The repository is an explicit, **body-less** declaration
(`repository Products for Product`) whose surface is **one declared contract**.
No built-in verb exists outside that contract, there is no active record, and
the unit of work is unchanged (the body is the unit of work, `transactional` or
not, saved at exit).

The target surface:

```ddd
let a = Products.get(id)                     // T, 404 when missing
let b = Products.find(id)                    // T?
let c = Products.getBy(sku: s)               // T, 404 — only over a declared unique (…)
let d = Products.findBy(sku: s)              // T?
if let e = Products.find(Pricey(f)) { … }    // first match of a criterion
let xs = Products.all(Priciest(f), page: p)  // retrieval = criterion + sort
let ys = Products.all(Pricey(f), sort: [price asc], page: p)
Products.remove(x)                           // the only explicit write verb
```

- `getBy` / `findBy` take named args that must equal a declared `unique (…)`
  tuple exactly.
- `get` takes an id only; `get(<Criterion>)` is an error pointing to `find`.
- A retrieval is accepted by `all` only (`find(R)` is an error).
- `all` in a workflow needs `page:`.
- `remove` is legal in write positions only.
- "Who may read X" is `policy { read X requires … }`; exposure gates
  (`scaffoldPaged(requires:)`, route, handler `requires`) AND on top. A read
  gate never sits on the repository.
- Removed, by codemod and hard cutover: the `repository { find … }` body
  (including `find … requires`), the anonymous `retrieval { … }` literal,
  `run`, `findAll(C)`, `getById`, `findById`, `delete` as a repository verb,
  and per-platform reserved find names.
- Unchanged: `Agg.create`, operation calls, `ignoring`, `projection`,
  `scaffoldPaged`, `transactional`, the save at exit. Not now: `count` /
  `exists` (counts stay a `projection`).

**The contract, as built.** `src/util/repository-contract.ts` is the one table
(in `util/` because `language/` and `ir/` both read it). Each entry names a
surface verb accepted today, its canonical **op**, its argument shape, its
result shape (the row, an optional row, rows, or none), its face (read /
write), whether `page:` and `ignoring` apply, and the positions it is accepted
in. The ops:

| op | does | result |
|---|---|---|
| `load` | by id, the row must exist | `T` (absent → not-found) |
| `load-optional` | by id | `T?` |
| `select-one` | first row matching a criterion | `T?` |
| `select-many` | rows matching a criterion / retrieval, or all rows | `T[]` |
| `remove` | delete the given aggregate | — |
| `declared-find` | a find declared in the repository body, by its own name | its declared type |

The IR carries `op` on `repo-let`, `repo-run`, `if-let`, `repo-delete` and the
`repo-read` call info. Typing (`language/typing/elaborate.ts`) and the IR result
type (`ir/lower/repo-read.ts`) read the same entry, and emitters dispatch on
`op`, keeping `method` only for a declared find's own name. Renaming a surface
verb is an edit to the table plus typing/lowering and a codemod — no emitter.

**Consequences.** `test/system/repo-verb-census.test.ts` is the ratchet: a
comparison or set literal keyed on a built-in verb spelling outside the
contract module and the lowerers fails it, unless waived with a count and a
reason (the e2e test client's HTTP verbs, which name routes rather than
repository calls, and the per-platform reserved find names that a later slice
removes).
