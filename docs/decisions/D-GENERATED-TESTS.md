# D-GENERATED-TESTS — a `.ddd` test means the same thing on every backend

**Status:** PINNED (owner rulings 2026-11).

**Question.** A `test` block is emitted to five test frameworks (vitest, xUnit +
AwesomeAssertions, JUnit + AssertJ, pytest, ExUnit). Each backend's test emitter
decided on its own what `toBe` compares, what the ordering matchers accept, what
`toThrow()` catches, who the test runs as and what state a context-integration
test starts from. The same test passed on one backend, failed on another and did
not compile on a third.

**Decision.** The meaning of a generated test is decided once, as facts in
`src/ir/plan/` (`assertionPlan`, `testPrincipal`, `rejectionPlan`,
`integrationIsolation`), and each framework renders those facts from a leaf
table under `src/generator/_test/`. A test emitter never re-derives one.

| Construct | Meaning on every backend |
|---|---|
| `expect(m).toBe(15)`, `m: money` / `decimal` | Equal by value, scale-insensitive: `15` equals `15.00`. |
| `expect(vo).toBe(Vo { … })` | Structural: equal when every field is equal (decimals inside by value). |
| `expect(xs).toBe([…])` | Structural and ordered: same length, equal element by element, in order. |
| `expect(ref).toBe("<uuid>")`, `ref: X id` | Equal by value: the id equals the id the string names. |
| `toBeGreaterThan` / `…OrEqual` / `toBeLessThan` / `…OrEqual` on `money` / `decimal` | Numeric ordering. |
| the same on `datetime` / `date` | The literal is parsed as an instant (a calendar day for `date`) and compared in time. |
| `expect(x).toThrow(<named rule>)` | Passes only when that named rule rejects. |
| `expect(x).toThrow()` | Passes on any thrown domain rejection — an invariant, a precondition, a `when` state gate, a `requires` gate. A programming error fails the test. Both tiers catch the same set. |
| a declared error an operation returns (`string or Closed`) | Not a throw: the call answers it as a value. A `toThrow` over a call that can only answer that way is a validation error (`loom.test-throw-returned-error`). A unit test cannot assert a returned arm yet ([#6068](https://github.com/Loom-Harness/Loc/issues/6068)); a `test e2e` asserts it at its mapped status, `toThrow(<status>)`. |
| a not-found | Not reachable under `toThrow`: a repository read inside `expect(…)` must be let-bound (`loom.integration-find-must-bind`). A test asserts absence with `find` and `toBeNull()`. |
| `o.take(n)` where `take` is an operation of `o` | The operation, never the collection op of the same name. |
| a test shape a backend cannot express | A validation error naming the test. A test is never skipped and never crashes generation. |
| a context-integration test | Starts from a clean store: each test runs in a transaction rolled back after it. |
| the test actor | One actor, built from `user { … }`, identical in both tiers. The default has full access: a fixed id, a string claim's own name, every permission the catalogue declares for `permissions`, the first enum member, zero, `false`, the epoch, nothing for an optional claim. A test about authorization states its actor with `as { … }`. |
| `requires` inside an operation, unit tier | Enforced on every backend: the default actor passes, `as { permissions: [] }` is refused. |

**Consequences.** A fact a test framework disagrees on is a bug in that
framework's leaf table, fixed there. A new matcher, rejection kind or claim type
lands in the plan first and in every leaf table with it; the census refuses a
test emitter that dispatches on a matcher name, spells a claim value, or
re-derives a rejection class or the isolation strategy.

**Enforced by:** `test/fixtures/corpus/test-assertions.ddd`, `test/system/test-plan-census.test.ts`
