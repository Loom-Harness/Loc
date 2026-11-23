# D-RESERVED-GENERATED-NAMES — a domain type named like a name the generated code binds is refused

**Status:** DECIDED (owner rulings 341, 412, 413, 435, 373).

**Question.** The generated code binds framework and runtime names in the
same compilation units that hold the model's types. A domain type of the same
name gives one simple name two bindings: `aggregate Page` beside Spring Data's
`Page`, `aggregate Request` beside FastAPI's `Request`, `valueobject Promise`
beside the TypeScript global, `aggregate Errors` beside the generated module
`app/domain/errors.py`. Spell such names around per backend, or refuse them?

**Decision.** **Refuse what no emitter can spell around, identically on
every target; spell around everything else.** A declaration that becomes a
generated type (`aggregate`, `entity`, `valueobject`, `enum`, `event`,
`payload` / `command` / `query` / `response` / `error`, `domainService`) may
not take a name in the table `src/util/reserved-type-names.ts`; the AST
validator reports `loom.reserved-type-name` on every platform, so a model that
validates stays portable across the backend matrix. Nothing is renamed or
escaped, and shipped models that used a refused name were rewritten.

- The table shrinks by fixing emitters, not by waiving entries (owner ruling
  412). Where a domain type shares a simple name with a framework or runtime
  type, the backend spells the framework side another way and the name is
  not refused: the Java units import each type by its single name and write
  the platform type fully qualified; the python and node import finalizers
  alias the framework import (`from fastapi import Request as
  _fastapi_Request`) and keep the model's name bare, the events module
  included; the .NET units write the BCL or project type `global::` and alias
  the domain type where a namespace takes its name; the Dapper repositories
  name their row mapper `Create`, a name no domain type can take.
- Every entry carries one of three categories:
  - **language** — a global the target language binds in every module and
    the emitted code calls: the TypeScript `Promise`, `Record`, `Date`,
    `JSON`, `Math`, `Object`, `String`, `Number`, `Symbol` (node).
  - **generated** — a generated module, type or member the model's types
    share a namespace with: the module files an aggregate of the name would
    overwrite (`Errors`, `Events`, `Ids` on node and python; `Paging`,
    `RepositoryPorts`, `ValueObjects` on python); the runtime the events
    module declares beside every event (`DomainEvent` on node, python and
    Java; `DomainEventDispatcher` on node and python;
    `NoopDomainEventDispatcher`, `PostCommitDispatcher` on python); the .NET `Id` member and `Create`
    factory a type of that name cannot hold, and `WaitForDatabaseAsync`, a
    top-level function of `Program.cs` every unit sees; the Elixir modules
    `ProblemDetails`, `<Context>.Dispatch` and `FileRef`.
  - **import-style** — a name an emitter still spells bare where it could
    alias it: only `Decimal` on node, which the shared expression and numeric
    helpers write for `decimal.js`. Such an entry is parked work: it carries a
    deferral with a `reviewUntil` date and the open issue it waits on, and a
    fast test fails it once the date passes or the issue closes.
- Each entry breaks the build of every target it lists when the refusal is
  ignored, and builds on every target it does not list, in all four shapes the
  proof declares (value object, aggregate, emitted event, enum).
- `aggregate User` stays legal (owner ruling 413): the node clash with the
  auth principal's `User` type is a node emitter defect, waived in the proof
  with an expiry, not a reserved name. `Create` stays refused (the generated
  factory), and the Dapper row mapper leans on that.
- The built-in type names (`File`, `AuditEntry`, `Money`, `bytes`,
  `ParseError`, `EventMeta`) are not in this table (owner ruling 435): the
  language owns them, and their own rules refuse or resolve them.
- It is complete against the emitters: every simple name they can import,
  annotate with, rely on from the language runtime or declare for their own
  runtime (`src/generator/_symbols/runtime-names/`) is either in the table or
  admitted, and every admitted name builds as a domain type on every backend.
- This does not touch D-TARGET-RESERVED-NAMES: a member, parameter or enum
  value named like a target KEYWORD is still escaped, never refused.
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
build of every admitted name, and of every entry on the targets it does not
list, in four shapes; `test/fixtures/corpus/admitted-type-names.ddd`
declares the near-miss names on all five compile legs;
`test/language/validation/reserved-type-names.test.ts` pins the refusal per
declaration kind.

**Sources.** [`01-lexical-structure.md`](../language-reference/01-lexical-structure.md#names-the-generated-code-binds).

**Enforced by:** `test/system/reserved-type-names.test.ts`, `test/language/validation/reserved-type-names.test.ts`, `test/fixtures/corpus/admitted-type-names.ddd`
