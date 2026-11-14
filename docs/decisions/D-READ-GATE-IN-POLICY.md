# D-READ-GATE-IN-POLICY — who may read an aggregate is `policy { read X requires … }`, not a repository find

**Status:** PINNED (owner ruling, 2026-10-25; parent #3949).

**Question.** Under `denyByDefault` the only way to gate an aggregate's
compiler-derived reads was to declare them on the repository with a gate —
`find all(): T[] requires G` / `find byId(id: T id): T? requires G` — and every
other read (history, the scaffolded List page) inherited from those finds. That
put an access rule inside a domain collection, made the gate depend on
declaring a find whose only purpose was to carry it, and let two finds of one
aggregate disagree about who may read it.

**Decision.** "Who may read X" is an access fact and lives in the context's
`policy { }` block, beside the `allow` / `deny` ladder:

```ddd
repository Orders for Order
policy { read Order requires currentUser.role == "clerk" }
```

- One rule per aggregate gates **every** read of it: the list and by-id routes,
  each declared find's route, the audit history read, and the scaffolded List
  page. An exposure gate (`scaffoldPaged(requires:)`, a route / handler
  `requires`) still ANDs on top.
- Semantics are the old find gate's: evaluated before the load, 403, no
  existence oracle, `currentUser` and constants only
  (`loom.policy-read-gate-not-current-user`).
- `FindDecl` loses its `requires` clause (hard cutover, the #3608 ruling);
  `scripts/codemod-find-gate-to-policy.mjs` migrates a project.
- The rule lowers into the carrier the emitters already read: enrichment
  (`applyPolicyReadGates`) puts the gate on every declared find and on the
  injected `all`; the by-id route takes it from `all` (`byIdRouteFind`) and
  history copies it (`ensureHistoryFind`). No emitter changed.
- `read` is not a keyword (it is a common permission / operation name): the
  rule head parses as an identifier and the validator pins it to `read`
  (`loom.policy-unknown-rule`).

**Consequences.** `loom.default-deny-list-ungated` /
`loom.default-deny-by-id-ungated` / `loom.audit-history-ungated` and the
ungated-find arm of `loom.default-deny-ungated` name the policy line to write.
`loom.find-gate-not-current-user` is retired. Two reads of one aggregate can no
longer answer to different principals — model them as different aggregates or
gate the exposure instead. The `find all` exemption from
`loom.repository-find-deprecated` is gone with the gate it existed for.
