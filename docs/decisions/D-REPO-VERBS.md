# D-REPO-VERBS — the repository verbs are `get` / `find` / `getBy` / `findBy` / `all` / `remove`

**Status:** APPLIED (#3953, hard cutover per the #3608 ruling; slice 5 of
#3949).

**Question.** After D-FINDDECL-REMOVED every read was a contract verb, but the
contract kept the spellings it grew up with: two by-id reads (`getById` /
`findById`) beside two natural-key reads (`getBy` / `findBy`), three list reads
(`findAll(C)`, `run(C | R)`, `all()` / `findAll()`), an anonymous
`retrieval { where: … sort: … }` literal only `run` accepted, and two delete
spellings (`delete` / `remove`).

**Decision.**

- The verbs are `get(id)` (the row; a miss is the standard 404), `find(id)` /
  `find(<Criterion>)` (the row or nothing), `getBy(…)` / `findBy(…)` over a
  declared `unique (…)` key (unchanged), `all(<Criterion | Retrieval>, sort:
  […], page: {…})` / `all()` (a list), and `remove(x)` (the write).
- `find` is overloaded on its argument. A reference to a declared criterion
  (`Name` / `Name(args)`, `language/repo-query-arg.ts`) is the criterion read;
  anything else is an id. The validator, typing and lowering classify through
  that one function. `find(<Retrieval>)` is refused (`loom.repo-find-retrieval`)
  and `get(<Criterion>)` is refused with a pointer to `find`
  (`loom.repo-get-criterion`).
- `sort:` is a slot of the member call (`SortItem`s over the candidate,
  columnar only), accepted on `all(<Criterion>)` alone
  (`loom.repo-sort-placement`). It replaces the anonymous `RetrievalLiteral`,
  which is out of the grammar (`loom.parse-error#retrieval-literal-removed`);
  its never-shipped `loads:` has no successor.
- Each retired verb (`getById`, `findById`, `findAll`, `run`, `delete`) is an
  error that names its replacement (`loom.repo-verb-renamed`). There is no
  warning window. `scripts/codemod-repo-verbs.mjs` rewrites a tree. It is
  text-level, so it runs on sources the new grammar no longer parses.
- The IR keeps naming the repository METHOD a read is emitted as (`getById`,
  `findById`, `findAll`, the synthesised `findAllBy<C>` / `run<R>`). The
  contract table maps each verb to it, so no emitter changed and the generated
  output of the migrated corpus is byte-identical to the pre-rename output.

**Not changed.** `all` in a workflow body without `page:` stays the
`loom.findall-no-page` warning it was for `findAll(C)` / `run(C)`. The issue
asks for `page:` to be required there, but migrating the corpus would mean
inventing a limit for every existing unbounded read. That truncates results
and changes the generated code. It is left for the owner to rule on.
