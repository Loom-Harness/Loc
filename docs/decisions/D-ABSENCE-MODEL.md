# D-ABSENCE-MODEL — "may be missing" has one type, `T?`; presence is the generated update's rule, not a type

**Status:** PINNED (owner rulings 2026-10-25 on #4108; parent #4120).

**Question.** Loom had two shapes for one idea. `T?` was nullable, and `T option`
was a union `union[T, none]` meant to carry *presence* (supplied vs absent) for
partial updates. Every target handled both, and they disagreed: an `option`
payload field rode the wire as a tagged `{ "type": "none" }`, an `option`
operation return or aggregate field was refused, and the three-state `T? option`
was never built.

**Decision.**
- **One nullability type.** `T?` is the only "may be missing" type. `T option`
  and `T or none` lower to it (`canonicalUnion`, and the typing pass's
  `Ty.union`), so the IR has one `optional` shape for every target to read. A
  `none` stays a tagged variant only beside two or more present variants.
- **The `option` keyword is deprecated.** It warns (`loom.option-deprecated`)
  and the quick fix rewrites `T option` to `T?`. Because it means `T?`, it is
  legal wherever `T?` is.
- **On the wire an absent value is `null`**, never a tagged object.
- **Presence is not a type.** "Not supplied" is needed only by the generated
  update, which becomes a JSON Merge Patch (RFC 7396): a missing key leaves the
  field unchanged, `null` clears a `T?` field, a value sets it (#4109).
  Hand-written operations and commands keep plain params. The three-state
  `T? option` is declined.

**Consequences.** A variant `match` over a `T?` subject is a presence check on
every backend (the `T` arm on present, `none` or `else` on absent). A remote
`api` call to a `T?` find answers `null` on its 404, exactly as a local find.
An unguarded member read on a `T?` is `loom.nullable-receiver`. A plain `let`
of an `option` find, in a workflow, handler or domain-service body, binds the
`T?` exactly as a find declared `T?` does: the binding may be null, and its
reads go through `?.`, `??` or an `if let x = R.find(…) { … } else { … }`
branch.

The merge-patch update is RS-47. "The generated update" is recognised by shape —
an `update` operation whose body only assigns each parameter to the
same-named field (`mergePatchFields`, `src/ir/util/merge-patch.ts`) — so a
`crudish` update keeps the contract after `unfold`. `null` on a required field
is the missing-field 422 (`"<field> is required"`). A wire rule is judged in
the request schema only when the patch carries every member it reads, and by
the domain floor over the merged state otherwise. A caller no longer has to
send a `mask unless` field it cannot read (#3600).
