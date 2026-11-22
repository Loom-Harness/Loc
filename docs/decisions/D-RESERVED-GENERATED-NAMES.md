# D-RESERVED-GENERATED-NAMES — a domain type named like a name the generated code binds is refused

**Status:** DECIDED (owner rulings 341, 412, 413, 435, 373).

**Question.** The backends import framework and runtime types by simple name
into the same compilation units that import the model's types. A domain type
of the same name gives one simple name two bindings: `aggregate Page` beside
Spring Data's `org.springframework.data.domain.Page`, `valueobject Promise`
beside the TypeScript global, `aggregate Request` beside FastAPI's `Request`,
`valueobject Instant` beside `java.time.Instant` (where the single-type import
wins and the field silently takes the JDK type). Escape such names per
backend — qualify one side at every use site — or refuse them?

**Decision.** **Refuse, identically on every target.** A declaration that
becomes a generated type (`aggregate`, `entity`, `valueobject`, `enum`,
`event`, `payload` / `command` / `query` / `response` / `error`,
`domainService`) may not take a name in the table
`src/util/reserved-type-names.ts`; the AST validator reports
`loom.reserved-type-name` on every platform, so a model that validates stays
portable across the backend matrix. Nothing is renamed or escaped, and shipped
models that used a refused name were rewritten.

- The table holds only names whose clash is proven: each entry names the
  targets and the binder (the imported or generated type, the language
  global), and each one breaks the build of a target it lists when the
  refusal is ignored.
- The table shrinks by fixing emitters, not by waiving entries (owner ruling
  412): where a backend can spell a clashing platform name another way, it
  does, and the name leaves the table, re-derived by the same scan and proof.
  The Java backend binds nothing a domain type cannot take — every unit
  imports each type by its single name, and a unit that holds a type of the
  model's sharing a platform type's simple name spells the platform type
  fully qualified.
- What remains is a binding the emitter cannot avoid:
  - **node, TypeScript globals** (`Promise`, `Record`, `Date`, `JSON`,
    `Math`, `Object`, `String`, `Number`, `Symbol`): language-level, bound in
    every module, and a module-scope class of that name shadows the global the
    emitted code calls.
  - **node, named library imports** (`HTTPException`, `OpenAPIHono`,
    `AnyPgColumn`, `NodePgDatabase`, `Decimal`): hono, `@hono/zod-openapi`,
    drizzle and decimal.js export them by name only, into the units that also
    import the model's types.
  - **node, generated runtime** (`DomainError`, `AggregateNotFoundError`,
    `ConcurrencyError`, `DisallowedError`, `ForbiddenError`,
    `ExternHandlerError`, `DomainEventDispatcher`, `ProblemDetails`,
    `UuidString`) and **generated module files** (`Errors` →
    `domain/errors.ts`, `Events` → `domain/events.ts`, `Ids` →
    `domain/ids.ts`): a domain type of that name is a second declaration in
    the same module, or writes the same file.
  - **python, framework names imported by name** (`Request`, `Response`,
    `Query`, `Depends`, `APIRouter`, `BaseModel`, `RootModel`,
    `ValidationError`, `InitErrorDetails`, `PydanticCustomError`,
    `AsyncSession`, `IntegrityError`, `Annotated`, `Protocol`, `Path`,
    `Decimal`, `CalendarDate`): FastAPI, pydantic, SQLAlchemy and the standard
    library are spelled bare in the route, schema and repository modules
    beside the model's types, and the python import finalizer refuses a
    second binding of one name in a module; `ValueError` is the builtin the
    domain modules raise.
  - **python, generated runtime** (`Base`, `DomainEvent`,
    `DomainEventDispatcher`, `NoopDomainEventDispatcher`, `PagedResult`,
    `ProblemDetails`, `PROBLEM_JSON`, the domain errors) and **generated module
    files** (`Errors`, `Events`, `Ids`, `Paging`, `RepositoryPorts`,
    `ValueObjects` → `app/domain/<snake>.py`).
  - **.NET** — the BCL names the emitters spell bare (`DateTime`, `Array`,
    the `System` root namespace) and the `OpenTelemetry` namespace, which the
    ambient aliasing cannot repair; the generated project types
    (`DomainException`, `AggregateNotFoundException`, `DisallowedException`,
    `ForbiddenException`, `WireFormatException`, `HttpMetrics`,
    `ProblemDetailsError`, `RequestContext`), which the generated units
    import by namespace beside the model's; the generated namespaces
    `Persistence`, and `Domain.Ids` / `Domain.Enums` / `Domain.ValueObjects`,
    which an aggregate `Id` / `Enum` / `ValueObject` would share; and
    `Create`, the generated factory method, which a type of that name cannot
    hold as a member.
  - **elixir** — the generated modules a domain type's module path collides
    with (`ProblemDetails`, the OpenAPI schema `FileRef`); generation itself
    refuses the second module.
- `aggregate User` stays legal (owner ruling 413): the node clash with the
  auth principal's `User` type is a node emitter defect, waived in the proof
  with an expiry, not a reserved name.
- The built-in type names (`File`, `AuditEntry`, `Money`, `bytes`,
  `ParseError`, `EventMeta`) are not in this table (owner ruling 435): the
  language owns them, and their own rules refuse or resolve them.
- It is complete against the emitters: every simple name they can import,
  annotate with or rely on from the language runtime is either in the table or
  admitted, and every admitted name builds as a domain type on every backend.
- This does not touch D-TARGET-RESERVED-NAMES: a member, parameter or enum
  value named like a target KEYWORD is still escaped, never refused. The .NET
  backend's ambient aliasing (`src/generator/_symbols/plan.ts`) stays — it
  changes no name the author wrote — and the BCL names it repairs (`Task`,
  `TaskStatus`, `Queue`) are admitted.
- A `context` may not be named `permissions` (owner ruling 373): under the
  same code, as language ambiguity — `<Context>.permissions.<name>` is the
  qualified permission spelling — so that entry needs no compile proof.
- A context named like an Elixir module root
  (`Repo`, `Telemetry`) is a separate, held question; the table names types
  only.

**Consequences.** `test/system/reserved-type-names.test.ts` derives the
emitters' bound names (`test/_helpers/generated-bound-names.ts`) and fails on
an unclassified or stale name; `test/e2e/reserved-type-names-proof.test.ts`
(`npm run test:reserved-names-proof`) is the mutation proof per entry and the
build of every admitted name; `test/fixtures/corpus/admitted-type-names.ddd`
declares the near-miss names on all five compile legs;
`test/language/validation/reserved-type-names.test.ts` pins the refusal per
declaration kind.

**Sources.** [`01-lexical-structure.md`](../language-reference/01-lexical-structure.md#names-the-generated-code-binds).

**Enforced by:** `test/system/reserved-type-names.test.ts`, `test/language/validation/reserved-type-names.test.ts`, `test/fixtures/corpus/admitted-type-names.ddd`
