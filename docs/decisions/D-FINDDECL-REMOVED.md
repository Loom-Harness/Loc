# D-FINDDECL-REMOVED — a repository declares no reads of its own; `find` declarations are gone

**Status:** APPLIED (#3951 item 5, hard cutover per the #3608 ruling; slice 3
of #3949).

**Question.** After D-LIST-FIND-REMOVED and D-REPO-KEY-LOOKUP every read a
`find` declaration could express had a contract spelling, but the grammar
still parsed `FindDecl`, so a repository body could still mint a bespoke
method — with its own route, client hook, param-binding convention, union
return shapes and a dozen `loom.find-*` diagnostics.

**Decision.**

- `FindDecl` is out of the grammar. A repository is `repository X for T`, with
  an optional empty `{ }`. A `find` left in a repository body is a parse error,
  `loom.parse-error#find-removed`, naming the replacements at the stray `find`.
  There is no warning window.
- Every read is the repository contract (`src/util/repository-contract.ts`):
  `getById` / `findById`, `getBy` / `findBy` over a declared `unique (…)`
  tuple, `find(C)` (first match, `T?`), `findAll(C)` / `run(C | R)` over a
  `criterion` or `retrieval`, and the paged `all`. A name no verb spells is op
  `unknown-read` and is always refused.
- `find all` goes too: the list read is always the implicit `all` (paged for
  a plain relational aggregate). A filtered or widened list read is a
  `criterion` read with `findAll(C) [ignoring …]` / `run(C)`, put on the wire
  with `scaffoldPaged` or a routed `queryHandler`; who may read is
  `policy { read T requires … }`.
- A single-row read a client calls keeps its URL through `scaffoldGet` /
  `scaffoldGetApi` (docs/scaffold-macros.md), or a routed `queryHandler`.
- `T or <Error>` finds are dropped (2026-10-25 ruling): a miss is `T?`, and a
  must-exist miss answers the standard ProblemDetails 404.
- The compiler-synthesised `FindIR`s stay as the internal carrier of every
  repository method enrichment derives: the auto `all`, key lookups, widened
  reads, the paged `findAllBy<C>` finds behind `run` / `scaffoldPaged`, and
  audit `history`.

**Consequences.** The declared-find lowering, the `if let` / `let` declared-find
sources, the `scaffoldHandlers` find target, the list-find check and the
workflow currentUser-find check are removed. The three find codemods
(`codemod-find-to-findby`, `codemod-list-find-to-criterion`,
`codemod-find-gate-to-policy`) parse with the grammar they migrate FROM, so
they cannot run after the cutover and are removed with it; a project still
carrying `find`s runs them from the toolchain before this change (the parent
of the commit that removed them). The per-backend find-ROUTE emission (a
non-synthesised, non-`all` find's `GET /<aggs>/<find>`) has no producer left;
its removal is tracked separately so this cutover stays reviewable.
