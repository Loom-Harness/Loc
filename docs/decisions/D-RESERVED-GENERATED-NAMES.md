# D-RESERVED-GENERATED-NAMES — a domain type named like a name the generated code binds is refused

**Status:** DECIDED (owner ruling 341, row 71).

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
- Money is not in the table. A context named like an Elixir module root
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
