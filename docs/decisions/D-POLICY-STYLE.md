# D-POLICY-STYLE — authorization grammar shape

**Status:** PINNED.

**Decision.** Authorization is expressed in dedicated **`policy { }`
blocks** with three sub-sections — `data { reachable when … }`
(row-set reachability filter, paramless), `operations { <op> when … }`
(point gates, params from the operation), and `fields { mask … }`
(field masking) — **over** the function-style policy DSL alternative.
Reuses `function`, `currentUser`, and `permissions {}` as building
blocks inside the block.

**Rationale.** The block form keeps authorization as visibly-separate
*infrastructure* (one place to read "what governs this aggregate"),
makes the reachability-vs-gate distinction structural (different
sub-sections, different binding scopes), and reads as declarative
configuration rather than scattered guard functions. `currentUser`
member accesses (`.permissions`, `.dataKey`, `.id`) resolve against the
shape pinned in
[`architecture/request-context.md`](../architecture/request-context.md).

**Affects.** `authorization.md` (its central grammar);
`policies-supplementary-note.md` stays superseded background;
`ddd.langium` gains the `policy` rule (Phase 3.2).
