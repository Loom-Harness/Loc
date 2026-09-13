# Wave C0 — packet 0.2(a) hand-off: Schemathesis nightly (#2579, M-T9.21)

*Branch `claude/c0-schemathesis` (`b08c7ac`, `272832e`), folded 2026-09-10 with one conflict against #2857 (composed, see below). Every root cause measured on booted apps.*

## Root cause, per backend

`node`, `python`, `dotnet` are clean and always were (local runs reproduce CI run 47: node/python/dotnet green, java 12 problems, elixir red). The nightly is red because of **java**; elixir is a `continue-on-error` discovery cell and does not gate. Every java problem: **the wire boundary answered 500 (or published a status it never answers) for a body its own emitted OpenAPI already describes** — three emitter defects:

- **F31 — the invariant validator dereferenced values it was not guarding.** The single-field arms asked the *pattern* whether a slot was nullable (true of a create body's unboxed `int qty`, false of an operation body's, which RS-26 boxes) → `NullPointerException: … "qty" is null` on `add_line` — **this is what W11/W12 were absorbing** under a reason that said the cause was "genuinely unknown". The generic-predicate arm had no guard at all (`balance.amount().compareTo(...)` on an omitted nested field). Nullability is now the DTO's own boxing answer (`wireComponentNullable`), and guards cover every member step of a chain rooted at a nullable param, shallow first.
- **F32 — the workflow body had no wire boundary.** `CheckoutRequest` emitted bare components and the controller bound a plain `@RequestBody`.
- **F33 — every create route published 200 and answered 201** (springdoc infers from `ResponseEntity<…>`; node/python/dotnet publish 201). Deterministic on every generated java create route — the #2472 class.

## Row table

| row | disposition | mutation proof (file-copy reverts) |
|---|---|---|
| F31 boxed-param arm | fixed (`emit/validator.ts`, `emit/wire.ts`) | `nullSkip` back to the heuristic → `wire-boundary-null-skip.test.ts:111` |
| F31 generic-predicate chain | fixed | drop the member-step guards → 3 failures incl. "guards are ordered SHALLOW FIRST" |
| F32 workflow body | fixed (`emit/workflow.ts`) | remove `@NotNull`/`@Valid` → both F32 assertions |
| F33 create 201 | fixed (`emit/openapi-customizer.ts`) | drop `successStatus: 201` → the F33 literal + the pre-existing `create → 400, 422` assertion |
| W11, W12 | deleted with F31; F11's entry rewritten (the java arm was never int32 overflow) | with the fix reverted, java goes 0 → 12 problems |
| W8, W27, W34, W35 | kept, all still reproduce | |
| python `uv sync` / Maven 429 read as "STALE WAIVER" | harness fixed (`schemathesis-core.mjs`): a leg that never ran must not report a waiver stale | `schemathesis-leg-ratchet.test.ts` |
| elixir cell | handed off; stays `discovery: true` | inventoried: 52 findings / 25 distinct exceptions in six clusters — E1 `TRACE` → 501 ×29, E2 non-uuid `{id}` → `Ecto.Query.CastError` ×7 (incl. static sub-paths swallowed by `/{id}`, the F8/F18 shape), E3 undeclared success Content-Type ×7, E4 wrong-verb 405 ×6, **E5 a real defect** — `GET /wallets?page=1&pageSize=1&dir=` → `ArithmeticError :erlang.-("", 1)` ×52, one F9-class row. Binding it today swaps a one-backend red for a two-backend red. |

## Fold note — composition with #2857 (M-T6.54 F19)

`main` had meanwhile landed "a guarded invariant crosses the wire WITH its guard" in the same `buildChecks` arm. Composed: the null-skip wraps the guarded `!(guard) || (body)` predicate and its member walk covers the guard too. That exposed a latent flaw in the walk: a member off a **scalar** receiver (`note.length`, rendered `((int) note.codePoints().count())`) is an intrinsic, not a record field, and got an `int == null` guard that does not compile — the walk now skips primitive receivers. #2857's pinned string became `if (!(note == null || !(taxRate > 0) || (…)))`, which is both rules at once.

## Gates

Legs, 3 consecutive local runs each: node 3/3, python 3/3, dotnet 3/3, java 4 clean runs (one intervening `gradle bootJar` 429 from Maven Central on a fresh container; CI's `setup-gradle` cache resolved fine). `tsc -b`, lint, `test/system` 91 files, `test/generator/java` 96 files / 577 green after the composition.

## Out of fence / next

1. **Elixir triage packet** (six clusters; E5 fixed, not waived) — `src/generator/elixir/vanilla/*`, the waivers file. Follow-up slice 1 in the register.
2. **Box a workflow's primitive params the way RS-26 boxes an operation's** (java `emit/workflow.ts` + `dto.ts`) — an absent `int` workflow param still deserializes to `0`. Follow-up slice 2.
3. Mission affected: M-T9.21; register ids F11, F31, F32, F33.
