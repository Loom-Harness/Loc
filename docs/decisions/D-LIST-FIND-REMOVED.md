# D-LIST-FIND-REMOVED — a list read is a criterion; a list `find` and a criterion/retrieval name clash are errors

**Status:** PINNED (owner rulings on #3463 item 6 and #3608, 2026-10-21; slice 2 of #3949).
In force: the name-clash error and the list-find hard error
(`loom.list-find-removed`).

**Question.** Two read-path rules were soft. A repository `find` returning a
list (`T[]` / `T paged`) was only a warning,
so a new list query can still mint one more `find byX` method on the
repository. And a name declared both as a `criterion` and as a `retrieval`
was resolved by a precedence rule (the retrieval won), so `Repo.all(<Name>)`
silently picked one meaning.

**Decision.**

- A `criterion` and a `retrieval` with the same name in one context are an
  **error**, `loom.criterion-retrieval-name-clash` (reported on the
  retrieval). There is no precedence rule.
- A list `find` becomes an **error** with no warning window (the #3608 rule
  for breaking language changes: a hard cutover with every model in the
  repository rewritten). A
  list read is a `criterion` (or a `retrieval` when it needs a `sort:`), read
  with `Repo.all(<it>(args))` and put on the wire with `scaffoldPaged(of: …)` +
  `scaffoldPagedApi(of: …)` or a routed `queryHandler`.
- Two finds stay legal: a single-row find (`T` / `T?` and the single-row
  carriers), and a declared `find all(): T[] / T paged`. Read gates live in
  `policy { read X requires … }` (D-READ-GATE-IN-POLICY), not on a find. The finds the compiler synthesises
  in enrichment (auto-`findAll`, the paged find behind `scaffoldPaged`,
  projection sources, `findAllBy<Criterion>`) are not author-declared and are
  unaffected.
- Every list find in the repository's models is rewritten to a
  criterion beside its repository (`<Plural><Find>`, the find's `where` as the
  body, or the parameter-name convention spelled out for a find written
  without one; a `where` that is exactly a criterion over the find's own
  params reuses that criterion) and each `Repo.<find>(args)` call to
  `Repo.all(<Criterion>(args))`. A find carries no sort, so the target is
  always a criterion. A parameterless, filterless list find read every row and
  becomes the repository's `find all`. A `test e2e` read of the find's route
  keeps the route through a routed `queryHandler List<Criterion>` over the
  read on the same path (parameters as `{token}`s, a GET carries no body).

**Consequences.** The grammar keeps parsing `FindDecl` with any return type —
the list check is by return type, and removing `FindDecl` altogether belongs
to #3951. The emitters' find paths stay: each is still reached by single-row
finds, `find all`, or the synthesised paged finds. The scaffolded list page's
filter bar and its per-view pages were built from list finds only, so they
went with the hard error.

**Enforced by:** `test/language/validation/criterion-retrieval-name-clash.test.ts`
