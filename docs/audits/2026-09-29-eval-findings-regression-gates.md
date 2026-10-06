# Regression-gate audit — the Meridian eval findings — 2026-09-29

**Question.** Not "is the finding fixed?" but **"would a gate go red if the fix
were reverted?"** A fix that landed without a gate is a defect with a timer on
it, so every already-fixed row of the Meridian evaluation
(`eval-cargo/FINDINGS.md`, branch `claude/loom-platform-eval-mc2v5j`, 13
findings) was checked on `main` and then **mutation-proved**.

**Method, per finding.** (1) Re-verify the fix is actually on `main` — by
generating and reading the emitted output, not by reading the PR. (2) Find the
gate that claims to cover it. (3) **Seed the original defect** at the fix site.
(4) Run the gate and read *which* assertion fired. (5) Revert the seed **by file
copy** (`cp` aside → mutate → `cp` back), never `git checkout -- <path>` (§84).
`git status --porcelain` was verified empty after every proof, including the two
that regenerate the Langium parser.

**Commits.** First measured on `cbda9165`; **every proof re-run on `bce7f409`**
(fresh `main`, after `#3063` reshaped `CommonSoftKeywords` and moved the
`Create` rule) before filing. Line numbers below are `bce7f409`'s.

Companion audit: [`2026-09-29-fixture-shape-coverage.md`](2026-09-29-fixture-shape-coverage.md)
asks the other question — why the *fixtures* never had the shapes these defects
needed. This one asks whether the *fixes* can silently regress.

## Headline

**Ten findings are fixed on `main` (one in part). All ten are already genuinely
gated — every gate failed on its seeded defect, with the assertion under test
being the one that fired. No gate was missing, so none was written.**

That is a result about *process*, not luck: each gate is a purpose-built file
whose header states the defect in the emitted-code terms the finding used, and
**nine of the eleven gate files carry an explicit vacuity guard or a named
control** — an assertion that the defect-bearing construct still reaches the file
under test, so the real assertion cannot pass over a fixture that quietly stopped
exercising it. The other two are two-sided by construction:
`keyword-identifier-completeness` is a committed coverage snapshot that fails on
drift in *either* direction plus a snapshot-independent "domain-word floor", and
`interp-format-hole-conversion` pairs each positive assertion with a negative one
("the raw (unconverted) read should be gone").

## The table

| # | Fixed on `main`? | Gate | Seeded defect (`bce7f409`) | Result |
|---|---|---|---|---|
| **F-001** `route` unusable as a field name | yes — parses `0 error(s)` | `test/language/parsing/keyword-identifier-completeness.test.ts` (+ committed coverage snapshot) | drop `'route'` from `CommonSoftKeywords` (`ddd.langium:2092`), regenerate | **RED** — "Keyword identifier-coverage drifted from the snapshot" |
| **F-002** ICU `{at, date}` emits uncompilable TS | yes — emits `.toISOString()` | `test/ir/interp-format-hole-conversion.test.ts` | drop `&& !hole.format` (`lower-expr.ts:3119`) | **RED ×4** (node/dotnet/java/python) — "the formatted datetime hole is emitted raw" |
| **F-003** uncallable aggregate is silent | yes — `loom.aggregate-not-constructible` | `test/ir/aggregate-constructible-checks.test.ts` | comment out the `diags.push` (`:123–128`) | **RED ×2** — `expected [] to deeply equal [ 'Policy' ]` |
| **F-004** `denyByDefault` ⊗ `eventLog` | yes (#3048) — two halves | grammar: `test/language/validation/callable-sites.test.ts`; warning: `test/ir/default-deny.test.ts` | (a) strip `CallableGates` from `Create` (`ddd.langium:1522`), regenerate; (b) comment out the warning (`default-deny-checks.ts:111–120`) | **RED** both — (a) "the widened spelling must PARSE"; (b) `expected undefined to be defined` |
| **F-005** `tenancy by` unreachable across `import` | yes — parses `0 error(s)` | `test/language/validators/tenancy-multifile.test.ts` | `roots = [model]` (`tenancy.ts:84`) | **RED** — "the tenancy line is declared in main.ddd, one import away" |
| **F-007** root-level VO emits out-of-order Zod | **frontend half** (see below) | `test/generator/_frontend/vo-schema-dependency-order.test.ts` | drop `orderValueObjectsByDependency` (`zod-schemas.ts:409`) | **RED ×3** (react/vue/svelte) — "CodeSchema is declared AFTER the OuterSchema" |
| **F-009** `domainService` precondition → unimported `DomainError` | yes | `test/generator/domain-service-precondition-error-import.test.ts` | drop `"DomainError"` from the candidate list (`domain-service.ts:90`) | **RED**, node only — the other four backends stayed green, which is the file's parity claim |
| **F-010** query-time projection publishes an empty row schema | yes | `test/generator/projection-select-only-wire-shape.test.ts` | drop the `selectDerivedFields` fallback (`enrichments.ts:1267`) | **RED ×4** (node/java/dotnet/python) — "the row type is missing the declared column" |
| **F-011** generated realm cannot satisfy its own model | **in part** (see below) | `test/system/keycloak-compose.test.ts` | (a) empty `claimMappers` (`system/index.ts:1085`); (b) skip the demo-attribute seed (`:1131`) | **RED** both — (a) four assertions incl. "the realm mints a claim the verifier does not read"; (b) `expected undefined to deeply equal [ 'demo-tenant-id' ]` |
| **F-013** .NET wire validators miss the `Regex` using | **.NET half** (see below) | `test/generator/dotnet/request-validator-usings.test.ts` | drop the `usings` propagation at the Requests site (`validator-emit.ts:375`) | **RED** — "Regex.IsMatch is emitted without its namespace (CS0103)" |

All eleven gate files run **unconditionally in `npm test`** — confirmed by
`vitest list --filesOnly`, not inferred from the config: no `LOOM_*` env gate, no
`describe.skipIf`, no exclude. (The only `process.env` reference among them is
`LOOM_UPDATE_KW_SNAPSHOT`, the snapshot-refresh path.)

## What "fixed" means on three of the rows

A gate proves its own half. Three findings were wider than the half that landed:

- **F-007** — the **frontend** half is fixed and gated. The companion audit's
  `vo-root-kernel` fixture found the same ordering defect live on the **node and
  python backends**; those are excluded by name (`ORDERED_ROOT_VO_EMISSION`) and
  drain through M-T9.13.
- **F-013** — the **.NET** half is fixed and gated. The companion audit found the
  same class on **python** (`re.search` with no `import re`), excluded as
  `WIRE_REGEX_IMPORT`, also draining through M-T9.13.
- **F-011** — the realm now mints **one mapper per declared claim** on the path
  the verifiers read, and **seeds the demo user's identity claims** (so the
  tenant filter matches rows). It does **not** grant the demo user the declared
  *permissions*, and the emitter says why: a dev principal holding every
  permission cannot demonstrate denial, and the first version of that fix made it
  a superuser that the cross-backend authorization gate caught answering `204`
  where `403` was the point. So F-011's "every gated command 403s" is now a
  stated design choice; its "every list is empty" is fixed.

## Corrections to the finding-status record

These moved under the audit — which is why "re-verify, `main` moves fast" is not
boilerplate:

- **F-004 is fixed.** #3048 **merged**; it was recorded as an open claim. It is
  gated on both halves. (The companion audit's note that "`requires` has no
  grammar slot on `create`" predates #3048; it is stale.)
- **F-006 is NOT fixed**, though it was recorded as merged. Measured with a
  control, on both commits: a named `policy` used inside its own context validates
  `0 error(s)`; the same policy referenced from a sibling context still fails
  with the misdirecting `'requires' must be of type 'bool', got 'unknown'`, in
  both the bare (`IsAdmin()`) and qualified (`Orders.IsAdmin()`) spellings. **No
  gate added** — gating a live defect's broken behaviour would freeze it.
- **F-011 was already partly fixed when this audit began** — and the first draft
  of this audit said the opposite. #2948 had been closed without merging, and the
  draft recorded F-011 as "still live" **from that fact alone**, without
  generating a realm. The claim-mapper fix was already on `cbda9165`, having
  landed under a different evaluation's number (Commons F-022). Generating one
  realm and reading it took a minute; the inference from PR state took none and
  was wrong. It is kept here because it is this audit's own thesis one level up:
  *a status record is a gate too, and it can fail to reach the thing it names.*

Out of scope and untouched: **F-008** (live; the companion audit's three
`SIBLING_VO_RESOLUTION` exclusions track it), **F-012** (fixed, gated and
mutation-proved under #3049).

## The §118 probe that found nothing

§118 says the question of an existing gate is not "does it run the right
mechanism" but "does its **fixture** have the shape the defect needs". So the
nearest sibling of one fixed finding was probed rather than assumed:

**F-009's fix is `["DisallowedError", "DomainError"].filter(…)`.** The gate pins
`DomainError`. Is `DisallowedError` a reachable, ungated twin? It is emitted by
the `when` state gate, and `CallableGates` — which carries `when` — *is*
grammatically admissible on a `DomainServiceOperation`. So the shape looked
reachable from the grammar alone.

It is not. `when` on a domain-service operation is refused by a validator ("A
domain service is a stateless, context-internal calculator: no instance to gate
…"), so `DisallowedError` can never render into `domain/services.ts` and the
list entry is defensive. **Measured, not reasoned** — the grammar would have
supported the wrong conclusion. No test was added for an unreachable shape; that
is padding, not coverage.

## What this does not claim

- It does not audit **fixture-shape coverage across the corpus** — that is the
  companion audit.
- It does not re-derive that the fixes are *correct*, only that reverting each
  one is caught.
- Each mutation was a revert at **the fix site**. A gate proved this way is not
  proof against every nearby variant — only against the defect the finding named.
