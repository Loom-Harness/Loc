# D-WIRE-POLICY — a request refusal's status, body and stage come from one IR fact

**Status:** PINNED (owner rulings 2026-10-21 on #3880, #3881, #3508, #3504,
#3721; fact landed for #3593 item 4).

**Question.** The same malformed request earned a different status or body per
backend (#3584, #3585, #3508), because each backend decided for itself which
input is a 400 / 415 / 422 / 409, what the problem body says, and which check
runs first.

**Decision.** One derived table, `src/ir/enrich/wire-policy.ts`, owns those
answers, and backends render it:

- **Rejection classes** (`wireRejection`): status (fixed, or the stdlib error
  name an `httpStatus` override retargets), `title`, fixed `detail` or sentence
  parts, whether `errors[]` rides the body, and the stage. Malformed JSON and a
  foreign media type are 400 / 415 at `transport`; a bad field is the 422
  `Validation failed` rung at `schema`; a `when` gate is 409 `Disallowed`; a
  lost version race and a unique key are 409 `Conflict`.
- **Field reasons** (`FIELD_REASONS`): a missing required field is
  `"<field> is required"` (#3881), a malformed `X id` inside well-formed JSON is
  a 422 at its pointer with `Expected UUID.` (#3508), plus the fixed range
  sentences (RS-42).
- **Ingress** (`ingressFor`): a numeric field accepts only a JSON number, a
  `money` field only its string form, no coercion (D-NUMERIC-INGRESS-STRICT,
  #3880); `""` is a valid required `string` (#3721).
- **Stages** (`WIRE_CHECK_ORDER`, `ruleStage`): transport → schema → authorize
  → load → state-gate → domain → persist. A rule that reads only the request's
  members is a `schema` check, refused before the row loads (#3584).
- **Declared error variants** (`errorVariantResponse`): `application/problem+json`
  at the mapped status with the `/errors/<kebab>` type, never a 200 union
  (#3504).

**Consequences.** node/Hono renders every refusal from the fact, and
`test/generator/hono/wire-policy-census.test.ts` fails on a status, title or
sentence a node emitter picks itself. python/FastAPI renders it through
`src/generator/python/wire-policy-py.ts`, guarded by
`test/generator/python/wire-policy-census.test.ts` (request bools are
`StrictBool`, so `"true"`/`1` is a refusal like every other cross-type value).
The remaining backends move onto it one at a time; until each does, its
wire-golden legs carry a per-golden waiver in `test/_helpers/wire-waivers.ts`
for the missing-field sentence.
