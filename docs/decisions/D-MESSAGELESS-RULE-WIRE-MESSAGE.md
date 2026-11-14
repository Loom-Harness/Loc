# D-MESSAGELESS-RULE-WIRE-MESSAGE — a message-less single-field rule's 422 carries node's synthesized sentence, never the framework default

**Status:** decided (owner ruling D10 of the 2026-09-28 eval-closure review, item #15d).

**Question.** An unnamed rule (no `name:`, so no `message`) that is a single-field shape
(`invariant seats >= 1`, `precondition code.matches("^[A-Z]{3}$")`) rides each
backend's NATIVE wire constraint, and the native constraint's text is whatever
the framework says. On python that was pydantic's default —
`String should match pattern '^[A-Z]{3}$'` — which puts the server's regex on
the wire, and `Input should be greater than or equal to 1` for a bound. Which
message does the wire carry?

**Decision.** The sentence node already sends: `singleFieldMessage(field,
pattern)` (`src/generator/zod-refine.ts` — "Code is not in the expected
format", "Amount must be at least 1") for a shape node chains natively, and
node's refine default (`Invariant violated: <src>`) for a conjunction node does
not chain (`email.matches(r) && email.length <= 120`). Wire parity, and the
regex never leaves the server. No `errors[].code` is attached — node attaches
none for a message-less rule, and the code is the i18n key of AUTHORED text.

**Python shape.** The `Field(...)` constraint stays (it is what publishes
`pattern`/`minLength`/`minimum` into the OpenAPI document), and each request /
value-object model gains one `@field_validator(<fields>, mode="wrap")` whose
`(field, pydantic error type) → message` table is built from the SAME
classification as the kwargs (`src/generator/python/emit/wire-constraints.ts`).
Only errors the table arms are re-raised as `PydanticCustomError(<type>,
<message>)`; a type error or a nested model's error passes through. Done in the
model rather than the `RequestValidationError` handler because the handler sees
only a `loc`, and one field name can carry different bounds on two models.

**Consequences.** Pinned by `test/generator/python/unnamed-wire-message.test.ts`
(derives node's message set and requires each in python's tables) and by the
`validation-messages` wire golden (seq 14/15). .NET, Java and Elixir send the
same sentence since [D-MESSAGELESS-DEFAULT](D-MESSAGELESS-DEFAULT.md),
which extends this ruling to every backend and every message-less rule.
