# D-REACT-FORM-NESTED — generated React forms keep nested react-hook-form state; FormState/Payload aliases only when the schema transforms

**Status:** maintainer ruling, 2026-06-12.

**Decision.** Generated React forms keep nested, RHF-native state. The dual
`<Action>FormState = z.input` / `<Action>Payload = z.output` aliases are
emitted only for actions whose request schema has a real transform (today
`money`, reached directly or through array/optional/value-object nesting);
transform-less actions keep the single `<Action>Request` type. Server errors
route through `pointerToFlat` and nested `setError`; no per-action FieldMap is
emitted.

**Why.** A flat dot-key form-state schema is unimplementable: react-hook-form
treats dots in field names as nesting, so `register("price.amount")` yields
nested values a flat-keyed zod schema would reject. Emitting the alias pair
only on a transform avoids structurally identical alias noise.

**Consequence.** Gate: `test/generator/react/dual-form-types.test.ts`.
