# D-REPO-KEY-LOOKUP — a natural-key read is `getBy` / `findBy` over a declared `unique (…)` tuple

**Status:** PINNED (owner ruling on #3949, 2026-10-25; slice 3 of #3949, #3951).
The two verbs, their diagnostics and the emission on all five backends hold
now; `FindDecl` itself is gone (D-FINDDECL-REMOVED).

**Question.** A single-row lookup by a natural key was a repository `find`
the author wrote by hand — `find bySku(s: string): Product? where this.sku ==
s` — one method per key, with nothing tying the key to a uniqueness rule. A
key no `unique (…)` covered returned whichever duplicate the database yielded
first (`loom.single-row-find-not-unique` was only advisory). And
`T or <Error>` finds let one lookup answer a declared error body on a miss.

**Decision.**

- `Repo.getBy(<col>: v, …)` yields the row; `Repo.findBy(<col>: v, …)` yields
  `T?`. Their named arguments must equal one declared `unique (…)` tuple of
  the aggregate (inherited tuples count) exactly, in any order:
  `loom.repo-key-not-unique` when no tuple covers the names (with a
  did-you-mean over the declared tuples), `loom.repo-key-incomplete` for part
  of a tuple or a positional argument. The tuple rule is one function,
  `resolveKeyTuple` in `src/util/repository-contract.ts`, read by the
  validator and the lowerer alike; the contract rows are `getBy` →
  `load-by-key` and `findBy` → `load-by-key-optional`.
- A `getBy` miss answers the standard ProblemDetails 404 (`"not_found"`) on
  every backend. `findBy` is an `if let` source, and a plain `let` binds it
  as `T?` — like every `T?` read (#4258: `find(C)`, `findById`, a `T?` find),
  read through a null test or narrowed by `if let`, its un-narrowed
  dereference being `loom.nullable-receiver`.
- Capability filters apply as on any read. A trailing `ignoring …` widens one
  call — on a `let` or an `if let` source, the two positions that bind a read.
- Each backend emits one repository method per used (verb, tuple, `ignoring`
  stance), named from the columns in declared order (`findBySku`,
  `getByRegionAndName`, `getBySkuIgnoringAll`, `keyLookupMethodName`) with a
  `WHERE` on exactly those columns. The method is DERIVED from the calls in
  enrichment (`src/ir/enrich/key-lookup-finds.ts`) as a `synthesized` find,
  so it rides each backend's existing find emitter and escaping and has no
  HTTP route; `findRaisesNotFound` (`src/ir/util/key-lookup.ts`) is the one
  predicate the java / python / elixir repository emitters read to raise
  not-found where node and .NET already did for a `T` find.
- `T or <Error>` finds are dropped: a miss is `T?`, and a `getBy` miss is the
  standard 404. `T option` maps like `T?`, `T envelope` like `T`.
- `findBy` / `getBy` stay unique-only (owner ruling, 2026-10-25, second
  comment): they promise zero-or-one, and only a declared `unique (…)` makes
  that true. A single-row find over any other key is a specification query —
  a `criterion` read with `Repo.find(<Criterion>)` (first match, `T?`).
- `scripts/codemod-find-to-findby.mjs` migrates every single-row find: a
  declared tuple → `findBy` / `getBy` (carrying `ignoring`); the `id` →
  `findById` / `getById`; anything else → `criterion <Plural><Find>` beside
  the repository (an existing one reused) and `Repo.find(<Criterion>(args))`.
  A clause-less find binding its parameters by name counts as the equality
  conjunction. A find moves only when every call site takes its target; a
  `T?` read is accepted as an `if let` source, a `let` or in a domain-service
  expression, and a must-exist find over a non-unique key has no target (no
  `else` statement answers a 404), so those call sites are reported and the
  find stays. `--add-unique` declares the key instead; never by default.

**Consequences.** A natural-key read no longer needs a repository body. The
synthesised method is not on the wire: a client that read a find's route
needs a routed `queryHandler` over the read. What the codemod reports (route
reads, must-exist finds over non-unique keys, variant matches on a
`T or <Error>` read, row-less finds) is what the `FindDecl` removal still has
to settle by hand.
