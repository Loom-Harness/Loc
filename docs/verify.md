# Verify

`ddd verify` joins test-execution results — one or more runner reports — onto the requirements graph and stamps every requirement with a Definition-of-Done verdict. It is the last link in Loom's quality chain:

```
requirement  →  solution  →  testCase  →  test / test e2e  →  ddd verify  →  DoD verdict
 (work item)   (rationale)   (verifies)   (executable)        (the join)    VERIFIED / FAILING / …
```

The graph already knows which `testCase`s verify each `requirement` and which runnable `test`s back each `testCase` (that's [`traceability.md`](traceability.md)). `verify` is the runtime overlay: it answers "did those tests actually pass?". It **does not run any suite** — you run them with your own runner, then feed the results in.

## The command

```bash
ddd verify <file.ddd> [--results <results.json>]... [--from-vitest <report.json>]... \
           [--from-playwright <report.json>]... \
           [--out <dir>] [--require-all] [--min <pct>] [--allow-missing] [--json]
```

| Flag | Effect |
|---|---|
| `--results <file>` | a test-results JSON (contract below). Repeatable. |
| `--from-vitest <file>` | a vitest / jest `--reporter=json` report, adapted for you (see [From your runner](#from-your-runner)). Repeatable. |
| `--from-playwright <file>` | a Playwright `--reporter=json` report — the generated ui-e2e suite's runner. Repeatable. |
| `--out <dir>` | output dir for the `.loom/` artifacts (default: the `.ddd` file's directory). |
| `--require-all` | fail the gate unless *every* requirement is `VERIFIED`. |
| `--min <pct>` | fail if the verified percentage is below `<pct>`. |
| `--allow-missing` | accept declared tests that produced **no** result. Without it they fail the gate — see [Missing evidence](#missing-evidence-is-not-a-pass). |
| `--json` | also print `verification.json` to stdout. |

At least one report is required, and every flag is **repeatable and mixable**: a
generated tree runs its unit tests and its e2e tests in separate runner projects,
each writing its own report, so a whole-system verdict passes all of them:

```bash
ddd verify fieldops.ddd --from-vitest api/unit-report.json \
                        --from-vitest e2e/e2e-report.json \
                        --from-playwright web_app/e2e/ui-report.json
```

Every report given is read — none is preferred, none is dropped. The reports are
merged by concatenation; when two reports carry a run of the same test, the
**most pessimistic** run wins (`fail > skip > pass`), the same rule that settles
an api-e2e block replayed against two backends. A report that contributed
nothing to the join — empty, or none of its results matching a declared test —
is named in a `warning:` line on stderr, so a wrong file never vanishes silently.

It writes `.loom/verification.{json,md,mmd}`, prints a one-line summary, and **gates the exit code**:

- exit `0` — gate passes;
- exit `1` — a requirement is `FAILING`; **or a declared test produced no result** (unless `--allow-missing`); or verified % is below `--min`; or not all requirements are `VERIFIED` under `--require-all`;
- exit `2` — bad input: the `.ddd` failed to parse/validate, there were no `requirement` declarations, no report was given, or a report file was missing or malformed (the message names the file).

```console
$ ddd verify shop.ddd --results out/results.json
Verified 3/5 requirements (1 failing, 1 unverified, 0 untested).
Verification gate failed: 1 requirement(s) failing.
$ echo $?
1
```

### Missing evidence is not a pass

A declared `test` with no matching row in the results file lands in the join as
`missing`. **Missing evidence fails the gate**, because "we have no result for
this test" is not the same claim as "this test passed", and a CI gate that
cannot tell those apart is not a gate. The failure mode this closes, measured:

```console
$ printf '{"version":1,"results":[]}' > empty.json
$ ddd verify shop.ddd --results empty.json          # ← before
Verified 0/2 requirements (0 failing, 2 unverified, 0 untested).
$ echo $?
0                                                    # nothing verified, gate green
```

The same exit `0` came back when the `suite` convention had drifted — a
results file using the test *file name* where the join wants the **aggregate**
name verified nothing, reported every declared test as `(missing)`, and
exited `0`, exactly like a clean full pass.

Today the counts reach the summary line, and the failure names the cause
that actually holds. A test both `missing` **and** present in
`diagnostics.unknownTests` is a drifted title:

```console
$ ddd verify shop.ddd --results drifted.json
warning: none of the 1 result(s) in --results drifted.json matched a declared test — check it is a report of this model's generated suites.
Verified 0/2 requirements (0 failing, 2 unverified, 0 untested) — 1 declared test(s) with no result, 1 result(s) matching no declared test.
Verification gate failed: 1 declared test(s) had no matching result (TC-001 → "go works") — no result was attributed to ANY unit test (1 of the missing test(s) are unit): either the backend unit-test runner's report was not passed, or it was and its titles do not match; and 1 result(s) matched no declared test — the NAME does not match: reported {name: "go works!", suite: "A"}; suite "A" is correct, but no declared test in it is called that (declared there: "go works"); pass --allow-missing to accept a partial run.
$ echo $?
1
```

The message names **which field actually differs** (`name`, `suite`, both, or
an unresolvable ` against <deployable>` replay suffix) rather than asserting
one — an api-e2e result's suite is usually *correct* while its name carries
the replay suffix below.

When **no result at all** reached a whole tier — not one unit test, say — the
cause is a report that was not passed, and the message says so:

```console
$ ddd verify fieldops.ddd --from-vitest e2e-report.json
Verified 1/2 requirements (0 failing, 1 unverified, 0 untested) — 1 declared test(s) with no result, 1 result(s) from declared tests with no `verifies`.
Verification gate failed: 1 declared test(s) had no matching result (TC-001 → "complete works") — no result for ANY unit test was supplied (1 of the missing test(s) are unit), so the backend unit-test runner's report was most likely not passed — each runner project writes its own report, and --from-vitest / --from-playwright / --results are repeatable: pass every one; pass --allow-missing to accept a partial run.
```

And when every supplied result *was* attributed to a declared test, the
missing test simply did not run in the reports given (filtered out, or in a
report not passed) — the message says that instead of guessing at a join
failure.

A result of a declared test whose block carries **no `verifies`** is not an
evidence problem: the test is declared, it just backs no test case. It is
counted separately (`… result(s) from declared tests with no \`verifies\``,
`diagnostics.unlinkedTests`) and never as "matching no declared test".

`--allow-missing` is the opt-out for a deliberately partial run (one suite of
many, a staged rollout). It is *narrower* than `--require-all`: the missing
gate fires only on absent evidence, while `--require-all` also fails on skips
and on requirements no test case covers — so a pipeline already passing
`--require-all` is unaffected by this default.

Because it only gates and never runs suites, the CI shape is: run your tests → emit their JSON → `ddd verify`. The pure rollup (`computeVerification`, `src/verify/verification.ts`) is dependency-free (no fs, no Langium, no `Date`), so the browser playground's **Tests** panel uses the same function to update verdict badges live — see [`traceability.md`](traceability.md#in-the-playground).

## The `results.json` contract

A top-level `results` array of normalized outcomes. One row per executed test:

```json
{
  "version": 1,
  "results": [
    { "name": "successful login",        "status": "pass", "suite": "Account" },
    { "name": "rejects bad password",    "status": "fail", "suite": "Account" },
    { "name": "lists open orders",       "status": "skip", "suite": "Order"   },
    { "name": "checkout happy path",     "status": "pass", "suite": "Shop e2e" }
  ]
}
```

| Field | |
|---|---|
| `name` | **required** — the title as the runner reports it (`it("…")` / `[Fact(DisplayName="…")]` / `test("…")`). Usually the DSL `test` / `test e2e` string verbatim; for an **api e2e** test it is that string plus ` against <deployable>` (see *Reported titles* below), which the join undoes for you. |
| `status` | **required** — `"pass"` \| `"fail"` \| `"skip"`. Anything else (a runner's `"passed"` / `"failed"`, say) is malformed input: `ddd verify` exits **2** naming the entry index and value and the spelling it expected — it is never read as "no result", which would let a failed test leave its requirement merely unverified. |
| `suite` | optional disambiguator. Unit-test names are unique only *within* an aggregate, so the join is by `(suite, name)`. Pass the runner's reported suite: the **aggregate name** for a unit test, `"<System> e2e"` for an api e2e test, and for a **ui** test either that or the `<System>.ui.spec.ts` spec-file title Playwright reports. |
| `kind` | optional, informational. |

#### Reported titles — what the join normalizes

Two emitters deliberately report something other than the declared
`(suite, name)`, and the join undoes both, so you feed it what your runner
actually printed:

| Tier | Reported | Why |
|---|---|---|
| unit | `describe("<Aggregate>")` / `it("<name>")` — verbatim | — |
| api e2e | `describe("<System> e2e")` / `it("<name> against <deployable>")` | one `test e2e` block is **replayed against every compatible backend** (`src/system/e2e-render.ts`), and the suffix is what names the diverging backend in a multi-backend failure |
| ui e2e | no `describe` — Playwright reports the **spec file** (`<System>.ui.spec.ts`) as the suite; `test("<name>")` verbatim | the generated `.ui.spec.ts` has no wrapping `describe` (`src/system/ui-e2e-render.ts`) |

The ` against <deployable>` suffix is stripped only when the remainder is a
real deployable slug of *this* model and resolves to exactly **one** declared
api-e2e test — a title that could be a replay of two declared tests is
reported as unmatched rather than guessed. Before this normalization existed
every `verifies` on a `test e2e` block was inert: the test passed, its
requirement stayed `UNVERIFIED`, and the gate exited 1 claiming no result.

### From your runner

For **vitest / jest** and **Playwright**, don't write the mapping — `ddd verify` ships it:

```bash
npx vitest run --reporter=json --outputFile=results.json   # in the generated project
ddd verify shop.ddd --from-vitest results.json
```

`--from-vitest` reads the jest-compatible document (`testResults[].assertionResults[]`) and applies the join convention for you: an assertion's `title` is the `name`, its **innermost** `describe` is the `suite`, and `passed`/`failed`/`pending`/`skipped`/`todo` map to `pass`/`fail`/`skip`. That lines up exactly with what Loom emits — `describe("<Aggregate>") { it("<test name>") }` for a unit test, `describe("<System> e2e") { it("<test name> against <deployable>") }` for an api e2e one, whose replay suffix the join then undoes. (Pure and dependency-free: `src/verify/from-vitest.ts`. A vitest report handed to `--results` is detected and points you at this flag rather than failing with a shape error.)

For **Playwright** (the generated ui-e2e suite), run it with the JSON reporter and pass the report with `--from-playwright`:

```bash
npx playwright test --reporter=json > ui-report.json         # in <ui-deployable>/e2e
ddd verify shop.ddd --from-vitest results.json --from-playwright ui-report.json
```

Each spec's title is the `name`, its innermost enclosing suite is the `suite` (the spec **file** for the generated `.ui.spec.ts`, which the join maps back onto `"<System> e2e"`), one outcome per project run; `expected`/`flaky` map to `pass`, `unexpected` to `fail`, `skipped` to `skip`. (Pure: `src/verify/from-playwright.ts`.)

For every other runner (`dotnet test` trx, `mix test`, pytest / Gradle JUnit XML, the playground harness's own `TestResult`) you still map it yourself into a `--results` document — the only top-level shape `verify` requires is `{ results: [...] }`, and the `suite` column above is the part to get right. A `--results` document mixes freely with the runner reports, so a node unit report plus a hand-mapped JUnit file is one `ddd verify` call.

**Join rules** (`attributeResults` / `resolveResults` / `outcomesFor` / `worst`, `src/verify/verification.ts`): each result's reported title is first normalized back onto the declared `(suite, name)` per *Reported titles* above, then matched by exact `(suite, name)`; a `suite`-less result is attributed only when its bare `name` is unambiguous. Every result so attributed is that test's evidence; of several runs of one test, the **most pessimistic** sets its status (`fail > skip > pass`) — which is how an api-e2e block that passes on one backend and fails on another lands `FAILING`, and how two reports disagreeing on one test resolve. Results of declared tests with no `verifies` land in `diagnostics.unlinkedTests` (run, not scored). Results that match no declared executable test land in `diagnostics.unknownTests` — never *scored*, but the clearest symptom of a drifted `suite` convention. Both are **counted in the summary line**.

## The verdict model

The rollup is two levels. Each `testCase` first collapses its backing tests to a **status**:

| `TestCaseStatus` | When |
|---|---|
| `VERIFIED` | every backing test ran and passed. |
| `FAILING` | any backing test failed. |
| `UNVERIFIED` | a backing test was skipped or had no matching result (`missing`) — but none failed.  The `missing` half of that also **fails the exit code** unless `--allow-missing`; the verdict model itself is unchanged. |

Each `requirement` then rolls up its test cases (its own *and* its transitive children's, already flattened in the traceability index) to a **verdict**:

| `RequirementVerdict` | Glyph | When |
|---|---|---|
| `VERIFIED` | ✅ | the requirement has test cases and *all* of them are `VERIFIED`. |
| `FAILING` | ❌ | any backing test case is `FAILING`. |
| `UNVERIFIED` | 🟡 | it has test cases, but they didn't all run/pass (no failures). |
| `UNTESTED` | ⚪ | no test case verifies it or any child. |

`FAILING` dominates `UNVERIFIED` dominates `UNTESTED` — a single failure colors the requirement red. These four states are the only ones a requirement can be in.

## The emitted artifacts

`verify` writes three files into `<out>/.loom/` (see the full bundle in [`loom-artifacts.md`](loom-artifacts.md)):

- **`verification.json`** — the machine-readable `VerificationIR`: per-test-case status + backing detail, per-requirement verdict with `testCaseIds` / `failingTestCaseIds`, a `summary` count, and `diagnostics`.
- **`verification.md`** — the human report.
- **`verification.mmd`** — a verdict-colored Mermaid requirements graph (nodes tinted by verdict, parent→child edges).

`verification.json`:

```json
{
  "version": 1,
  "testCases": {
    "TC-001": { "status": "VERIFIED", "backing": [{ "name": "successful login", "status": "pass" }] },
    "TC-002": { "status": "FAILING",  "backing": [{ "name": "rejects bad password", "status": "fail" }] }
  },
  "requirements": {
    "US-001": { "verdict": "FAILING", "testCaseIds": ["TC-001", "TC-002"], "failingTestCaseIds": ["TC-002"] }
  },
  "summary": { "verified": 3, "failing": 1, "untested": 0, "unverified": 1, "total": 5 },
  "diagnostics": { "unknownTests": [], "unlinkedTests": [], "unmappedTestCases": [] }
}
```

`verification.md`:

```markdown
# Verification

_Generated by Loom. Derived view — do not edit._

Verified **60%** of requirements — 3 verified, 1 failing, 1 unverified, 0 untested (of 5).

## Requirements

- ❌ **US-001** (FAILING) User can sign in — failing: `TC-002`
  - ✅ **AC-001** (VERIFIED) Valid credentials are accepted
  - ❌ **AC-002** (FAILING) Bad password is rejected — failing: `TC-002`

## Test cases

| Test case | Status | Backing tests |
| --- | --- | --- |
| `TC-001` | VERIFIED | successful login (pass) |
| `TC-002` | FAILING | rejects bad password (fail) |

## Diagnostics

_No unknown results._
```

## Related

- [`traceability.md`](traceability.md) — the requirement / solution / test-case graph and the coverage report (does a requirement *have* a test); verification is the runtime overlay (did it *pass*).
- [`loom-artifacts.md`](loom-artifacts.md) — the full `.loom/` artifact bundle, including these `verification.*` files.
- `ddd snapshot` is a separate provenance command (`<out>/.loom/snapshots/`) and is unrelated to the verify gate; see [`provenance.md`](provenance.md).
