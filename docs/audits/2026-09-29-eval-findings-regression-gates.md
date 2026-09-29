# Regression-gate audit — the Meridian eval findings — 2026-09-29

**Question.** Not "is the finding fixed?" but **"would a gate go red if the fix
were reverted?"** A fix that landed without a gate is a defect with a timer on
it, so every already-fixed row of the Meridian evaluation
(`eval-cargo/FINDINGS.md`, branch `claude/loom-platform-eval-mc2v5j`, 13
findings) was re-checked against fresh `main` and then **mutation-proved**.

**Method, per finding.** (1) Re-verify the fix is actually on `main` — by
generating and reading the emitted output, not by reading the PR. (2) Find the
gate that claims to cover it. (3) **Seed the original defect** at the fix site.
(4) Run the gate and read *which* assertion fired. (5) Revert the seed **by file
copy** (`cp` aside → mutate → `cp` back), never `git checkout -- <path>` (§84).
The tree was verified clean (`git status --porcelain` empty) after each proof,
including the two that required regenerating the Langium parser.

**Snapshot commit:** `cbda9165` (fresh `main`).

## Headline

**Nine findings are confirmed fixed on `main`. All nine are already genuinely
gated — every gate failed on its seeded defect, with the assertion that fired
being the one under test. No gate was missing, so none was written.**

That is the whole result, and it is a result about *process*, not luck: each
gate is a purpose-built file whose header states the defect in the emitted-code
terms the finding used, and **eight of the ten gate files carry an explicit
vacuity guard or a named control** — an assertion that the defect-bearing
construct still reaches the file under test, so the real assertion cannot pass
over a fixture that quietly stopped exercising it. The other two are two-sided
by construction rather than by a guard clause: `keyword-identifier-completeness`
is a committed coverage snapshot that fails on drift in *either* direction, plus
a snapshot-independent "domain-word floor"; `interp-format-hole-conversion`
pairs each positive assertion with a negative one ("the raw (unconverted) read
should be gone"). That is §59/§63/§118 applied prospectively rather than
rediscovered.

## The table

| # | Fixed on `main`? | Gate | Seeded defect | Result |
|---|---|---|---|---|
| **F-001** `route` unusable as a field name | yes — parses `0 error(s)` | `test/language/parsing/keyword-identifier-completeness.test.ts` (+ committed coverage snapshot) | drop `'route'` from `CommonSoftKeywords` in `ddd.langium`, regenerate | **RED** — `~ route: snapshot [fieldName, …] → live [nameRef, paramName]` |
| **F-002** ICU `{at, date}` emits uncompilable TS | yes — emits `.toISOString()` | `test/ir/interp-format-hole-conversion.test.ts` | drop `&& !hole.format` in `lower-expr.ts:3119` | **RED ×4** (node/dotnet/java/python) — "the formatted datetime hole is emitted raw" |
| **F-003** uncallable aggregate is silent | yes — `loom.aggregate-not-constructible` | `test/ir/aggregate-constructible-checks.test.ts` | comment out the `diags.push` | **RED ×2** — `expected [] to deeply equal [ 'Policy' ]` |
| **F-004** `denyByDefault` ⊗ `eventLog` | yes (**#3048 merged since the brief**) — two halves | grammar: `test/language/validation/callable-sites.test.ts`; warning: `test/ir/default-deny.test.ts` | (a) strip `CallableGates` from the `Create` rule, regenerate; (b) comment out the warning's `diags.push` | **RED** both — (a) "the widened spelling must PARSE"; (b) "expected undefined to be defined" |
| **F-005** `tenancy by` unreachable across `import` | yes — parses `0 error(s)` | `test/language/validators/tenancy-multifile.test.ts` | `roots = [model]` (current document only) in `tenancy.ts:84` | **RED** — "the tenancy line is declared in main.ddd, one import away" |
| **F-007** root-level VO emits out-of-order Zod | yes | `test/generator/_frontend/vo-schema-dependency-order.test.ts` | drop `orderValueObjectsByDependency` in `zod-schemas.ts:409` | **RED ×3** (react/vue/svelte) — "CodeSchema is declared AFTER the OuterSchema" |
| **F-009** `domainService` precondition → unimported `DomainError` | yes | `test/generator/domain-service-precondition-error-import.test.ts` | drop `"DomainError"` from the candidate list in `domain-service.ts:90` | **RED** (node only; the other four backends stayed green, which is the parity claim) |
| **F-010** query-time projection publishes an empty row schema | yes | `test/generator/projection-select-only-wire-shape.test.ts` | drop the `selectDerivedFields` fallback in `enrichments.ts:1267` | **RED ×4** (node/java/dotnet/python) — "the row type is missing the declared column" |
| **F-013** .NET wire validators call `Regex.IsMatch` without the `using` | yes | `test/generator/dotnet/request-validator-usings.test.ts` | drop the `usings` propagation at the Requests site (`validator-emit.ts:375`) | **RED** — "Regex.IsMatch is emitted without its namespace (CS0103)" |

All ten gate files run **unconditionally in the fast suite** (`npm test`) — none
sits behind a `LOOM_*` env gate, a `describe.skipIf`, or a `vitest.config.ts`
exclude. The only `process.env` reference among them is
`LOOM_UPDATE_KW_SNAPSHOT`, the snapshot-refresh path, not a skip.

## Three corrections to the finding-status record

These moved under the audit and are the reason "re-verify, `main` moves fast" is
not boilerplate:

- **F-004 is fixed.** PR #3048 **merged**; it was recorded as an open claim. It
  is now in scope and gated on both halves.
- **F-011 is still live.** PR #2948 was **closed without merging**, so the
  generated Keycloak realm still cannot satisfy the model it was generated from.
  Recorded as claimed-by-an-open-PR; it is neither.
- **F-006 is NOT fixed**, though it was recorded as merged. Measured with a
  control on `cbda9165`: a named `policy` used inside its own context validates
  `0 error(s)`; the same policy referenced from a sibling context still fails,
  and still with the misdirecting `'requires' must be of type 'bool', got
  'unknown'`. Both the bare (`IsAdmin()`) and qualified (`Orders.IsAdmin()`)
  spellings fail. No gate was added — gating a live defect's broken behaviour
  would freeze it.

Out of scope and untouched: **F-008** (live; owned elsewhere), **F-012** (fixed,
gated and mutation-proved under #3049).

## The §118 probe that found nothing — and why it is worth recording

§118's lesson is that a gate can run the right mechanism and still never reach
the defect, because its *fixture* lacks the shape. So the nearest sibling shape
of a fixed finding was probed rather than assumed:

**F-009's fix is `["DisallowedError", "DomainError"].filter(…)`.** The gate pins
`DomainError`. Is `DisallowedError` a reachable, ungated twin? It is emitted by
the `when` state gate, and `CallableGates` — which carries `when` — *is*
grammatically admissible on a `DomainServiceOperation`. So the shape looked
reachable from the grammar alone.

It is not. `when` on a domain-service operation is refused by a validator ("A
domain service is a stateless, context-internal calculator: no instance to gate
…"), so `DisallowedError` can never render into `domain/services.ts` and the
list entry is defensive. **Measured, not reasoned** — the grammar would have
supported the wrong conclusion, which is the §118 failure mode one level up. No
test was added for an unreachable shape; that is padding, not coverage.

## What this does not claim

- It does not audit **fixture-shape coverage across the corpus** — whether the
  per-backend build fixtures carry the feature *crossings* a future regression
  would need. That is a separate question, and the §118 one.
- It does not re-derive that the fixes are *correct*, only that reverting each
  one is caught.
- The mutation for each finding was a revert at **the fix site**. A gate proved
  this way is not proof against every nearby variant — only against the defect
  the finding named.
