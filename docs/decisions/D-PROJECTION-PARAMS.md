# D-PROJECTION-PARAMS — a query-time projection's declared parameters are its only filter, checked like operation inputs

**Status:** PINNED (owner ruling 15 on the projection semantics plan, 2026-11-13).

**Question.** A parameterised query-time projection (`projection X(p: T) { from … where … }`)
was bound differently per emission arm and per backend: the grouped and
singleton arms read the parameter as a free variable on four backends, python
read the snake-cased query key, and Phoenix coerced through helpers it never
defined. Which query keys reach the query, and how is each checked?

**Decision.** The declared parameters, and nothing else. One plan,
`projectionQueryParams` (`src/ir/plan/projection-params.ts`), gives every
backend each parameter's wire name (the declared spelling), whether it is
required (`T?` is optional) and the check its query-string text must pass (the
type the app's OpenAPI document publishes). Every arm binds them the same way,
and a value that fails is refused with the 422 `field-invalid` envelope at
`/<name>` before the gate or the query runs: `field.malformed-id` for an
`X id` / `guid`, `field.integer-range` with its bounds for an integer outside
`int`, `field.missing` for an absent required parameter (D-WIRE-POLICY).

**Consequences.** The `projection-params` corpus fixture pins the grouped,
singleton and repository arms and the two ruled refusals with a wire golden on
every behavioural leg. `test/system/projection-params-census.test.ts` fails on a
query-projection emitter that reads a projection's parameter list around the
plan. A type-mismatch sentence (`?maxRank=many`) is still the framework's text,
as it is for every query parameter (`FIELD_REASONS["type-mismatch"]`).
