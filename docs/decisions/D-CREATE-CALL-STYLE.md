# D-CREATE-CALL-STYLE — an aggregate's `create` is called like a method; the record form is retired

**Status:** PINNED (owner ruling on #3301, 2026-10-26; #4309).

**Question.** An aggregate factory call had three spellings: positional
`Order.create(c, m)`, named `Order.create(customerId: c, total: m)` and the
record form `Order.create({ customerId: c, total: m })`. Only the record form
lowered to the factory outside workflow bodies; the other two compiled to a
plain method call that passed the wrong arguments (the generated TS was
`Order.create(2, "a")` against `static create(input: { … })`). And the record
form put the create-command wire record into the domain language.

**Decision.**

- An aggregate's `create` is a lifecycle method and is called like any other
  method: by name, or by position. The create input is the declared unnamed
  `create(…)` parameter list when there is one, else the properties minus the
  server-owned (`managed` / `token` / `internal`) ones. Both spellings lower, in
  every body (domain bodies, workflows and handlers, unit tests), to the one
  record each backend's factory takes. `src/language/factory-call.ts` is the
  one mapping the validator and both lowerings share.
- **Positions bind to a declared signature only** (owner ruling, 2026-10-26).
  `Agg.create(a, b)` is allowed against an author-declared `create(x, y)` and
  binds in its parameter order. With no declared signature — no `create(…)`,
  the one `with crudish` synthesizes, an event-sourced create — positional
  arguments are `loom.create-args#positional-without-create`, whose message
  names the named form. Property declaration order is no call signature:
  reordering two properties must never silently swap two arguments.
- **Named arguments keep the order the author wrote** (owner ruling,
  2026-10-26). They are evaluated in that order, and the record they build is
  keyed by name, so the order is a rendering, never a binding.
- The record form is an error, `loom.create-record-form`, with no warning
  window (the #3608 rule: a `scripts/` codemod plus a hard cutover).
  `scripts/codemod-create-record-to-call.mjs` rewrites each record-form call
  into the named form, key for key in the author's order, so the generated
  output is byte-identical; it refuses, with a marker line, a record beside
  another argument and a key named twice.
- An argument list that maps onto no record is `loom.create-args` in every body:
  positions with no declared signature, more positions than parameters,
  positional and named mixed, a name outside a
  declared `create(…)`, or a name given twice. A name outside an undeclared
  create input stays `loom.create-unknown-field` / `loom.create-server-field`.

**Consequences.** Brace literals are untouched: a value object or entity part
is still built with `Money { amount: 1, currency: "USD" }`, and a `seed` row
stays a record literal, `Order { … }` (owner ruling, 2026-10-26): it is data,
not a factory call, so neither the cutover nor the codemod touches it. An HTTP client call in a `test e2e` body,
`api.orders.create({ … })`, takes a request body; its receiver is a member
chain, not an aggregate name, so the rule never reaches it. The generated
backends keep their `static create(input)` factories — this is the language
surface only.
