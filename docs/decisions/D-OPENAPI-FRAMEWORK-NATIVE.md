# D-OPENAPI-FRAMEWORK-NATIVE — each backend's OpenAPI document comes from its framework's own generator

**Status:** owner ruling, 2026-11-08.

**Decision.** A backend's served OpenAPI document is produced by its
framework's OpenAPI generator (`@hono/zod-openapi`, Swashbuckle, FastAPI,
OpenApiSpex, springdoc). Two inputs shape it:

- **Generator configuration** — settings, options and conventions the library
  provides (`springdoc.default-produces-media-type`, `UseOneOfForPolymorphism()`,
  `SupportNonNullableReferenceTypes()`).
- **Source metadata the generator reads** — route definitions, annotations and
  attributes, response models and typed results, library schema declarations
  (`@ApiResponse`, `[ProducesResponseType]`, `responses=`, OpenApiSpex
  `operation` specs and schema modules, sealed or `[JsonPolymorphic]` unions).

Nothing else edits the document. A backend does not post-process it — no
springdoc `OpenApiCustomizer`, no Swashbuckle document/operation/schema filter,
no ASP.NET OpenAPI transformer, no FastAPI `custom_openapi` that rewrites the
schema dict — and does not build it by hand apart from its routes (an
OpenApiSpex `paths` map written out instead of `Paths.from_router`). A
framework limitation is not an exception: change the source representation so
the generator can express the contract, or accept the framework's native
spelling in the parity check.

**The parity check stays, and compares structure.** The conformance-parity
gate diffs the five booted documents pairwise. Its normalizer
(`test/_helpers/openapi-normalize.ts`) first rewrites both documents into one
canonical spelling, so framework-native spellings of one contract compare
equal: an inline array and a named array component with the same `items`;
`$ref` and an inlined identical schema; `oneOf` and `anyOf` over arms a
discriminator separates; explicit, implicit and inferred discriminator
mappings; a polymorphic base whose subtypes `allOf` it and a `oneOf` over the
subtypes; a union arm's tag pinned on the arm (`enum`) and the same tag given
only in the discriminator mapping; a union arm inlined and the same arm as a
named component nothing else references; and, at an error status,
`anyOf: [ProblemDetails, <X>Problem]` (each `<X>Problem` extending
ProblemDetails) and plain ProblemDetails, which accept the same bodies because
ProblemDetails is open. Real contract differences still fail — operations, success and error
statuses, media types, required sets, field schemas, enum values, union arms
and tags. Every accepted equivalence and its nearest rejected difference is a
fixture pair under `test/_helpers/openapi-parity-fixtures/`.

**Enforcement.** `test/system/openapi-native-census.test.ts` scans the
generator and platform trees for emitted post-processing and hand-built paths.
A backend that still does either carries a dated `deferred` waiver naming the
work that removes it, and a waiver whose backend is clean fails.

**Rejected: one Loom-generated document.** Loom could render a single OpenAPI
document from the IR and serve it from every backend. That document would
describe what Loom intends, not what each framework actually routes and
validates, so it could drift from the running service without any check
noticing — the parity gate would compare one document with itself. A
framework-generated document is evidence about the running backend; that
evidence is the point of the gate.
