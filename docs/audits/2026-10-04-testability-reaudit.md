# Testability re-audit — 2026-10-04

*A re-run of the [2026-09-13 testability audit](2026-09-13-testability-audit.md) on
`main` @ `bce7f409`, three weeks and a fleet of fix PRs later
([fleet plan](2026-09-14-testability-fleet-plan.md)). Every fix in that fleet was proved
against its own fixture. **This audit asks whether the fixes hold for the app that found
the bugs**: the same ~300-line `FieldOps` model, generated, booted and tested end to end —
first as written, then with its workarounds removed, then on four backends instead of one.
Every claim below comes from running the toolchain. The `.ddd` sources are inline or
described exactly enough to reproduce. Output was generated to scratch only, never into a
repo path.*

Scope is unchanged. This covers the **test tier a user gets in their generated project**,
not Loom's internal suite.

---

## Verdict

**The fleet's fixes hold on the app that found the bugs. No finding regressed.** Of the
eleven findings the fleet set out to fix, **nine are fixed end to end**. That means
measured on FieldOps itself, and for every one that has a runtime side, on more than one
backend. **Two are partial** (F8, F12). **F6 is still open, as the owner decided**:
a deferral, not a regression. Every workaround in the original source is now
unnecessary, and the app is green without them on node: unit 6/6, api-e2e 6/6 on three
consecutive runs, ui-e2e 9/9, and `tsc` clean on the backend and on both emitted test
projects. The headline mutation, deleting `complete()`'s precondition, is now **caught**.
It was the one that stayed green in September and became F11.

**It is still not production-ready as a standalone quality gate. The gap has moved off
node.** The original audit booted node only and compiled node + python. Going wider found
three defects on the other backends. In each, the model validates with `0 error(s)` and
the generated backend then misbehaves. Two of them were already in the September output
and the original audit missed them because it never compiled those backends:

1. **Java answers a unique-key `find` with the wrong row** (N2, P1).
   `find byReference(reference: string): WorkOrder?` emits `select e from WorkOrder e`
   with no `where`. A lookup for a reference that does not exist returns **HTTP 200 with
   another work order**.
2. **The FieldOps .NET backend has never compiled** (N3, P1). A domain-service parameter
   named `base` is escaped in the method body (`@base`) but not in the signature
   (`Money base`), so the build fails with `CS1001`. The original audit's ".NET: 107 files,
   0 errors" was a count from `generate`, not a build result.
3. **The .NET unit tests don't compile** (N4, P2), and no per-PR gate builds them.

The fourth new finding is the one this audit most needed to catch: **a test that passes
for the wrong reason, through the gate built to prevent exactly that** (N1, P2). The F4
response-field check models `api.<agg>.create(…)` as returning the full read shape. All
five backends return `{id}`. So `expect(w.note).toBeAbsent()` on a create result validates
clean and **passes**, while the documented contract (RS-35, explicit null) says it has no
passing subject.

---

## Method

Same app, same three test tiers, same mutation proofs as the original, then widened. The
original FieldOps source was run first **as-is**. Then a v2 was run with every
fixed-bug workaround removed and the newly shipped surface exercised: discriminating
`toThrow(precondition|invariant)`, `toBeNull` / `toContain`, the
`api.<workflow>.run(…)` accessor, `verifies` on an e2e block, an exact count instead of
`toBeGreaterThanOrEqual`, and the placeholder UUID that used to 422 on Hono. v2 was then
generated for python, .NET and Java, and every generated tier run on each.

| Leg | Result |
|---|---|
| `ddd parse` / `generate system`, original FieldOps | `0 error(s), 1 warning(s)` (an honest scaffold-filter warning); 110 files, and a root `README.md` |
| node backend `npx tsc --noEmit` | **exit 0** (was 3 errors: F1, F2) |
| node unit `vitest run` | **6/6** |
| node api-e2e, original source, same DB twice | **4/4, 4/4** (was 4/4 then 1 failed — F3) |
| …the same, `E2E_RESET=off` | `1 failed \| 3 passed` — `expected 2 to be 1`, the original F3 failure, verbatim |
| node ui-e2e (Playwright, headless Chromium) | **9/9** |
| `tsc --noEmit` on the emitted `e2e/` and `web_app/e2e/` projects | **exit 0, exit 0** |
| FieldOps **v2** (workarounds removed) on node | `tsc` 0 · unit **6/6** · api-e2e **6/6 ×3** · ui-e2e **9/9** |
| v2 on **python** (native `uv`) | `mypy --strict` **1 error** (was 6) · pytest **6/6** · api-e2e **6/6 ×2** · ui-e2e **9/9** |
| v2 on **.NET** (SDK 10 container) | backend **does not compile** (N3); after a source rename: `dotnet build /warnaserror` ✅ · unit tier **does not compile** (N4) · api-e2e **6/6 ×2** · ui-e2e **9/9** |
| v2 on **Java** (`gradle:9-jdk25`, cached gradle home) | `gradle test` **6/6** · api-e2e **4/6** on both runs (N2) · ui-e2e **9/9** |
| v2 on **elixir** | generated only. **Not compiled or booted**: it needs the hex loopback mirror, and four backends already answered the question. F1's emission was checked statically (`Enum.count(matches) > 0`) |
| `ddd verify` on real runner reports | e2e join **resolves** (TC-102 VERIFIED); unit + e2e merged: **4/4, exit 0** (F8) |
| Mutation proofs | 5 of 6 red, as designed; one green that is a documented limit (below) |

Backends were booted natively or in their SDK container against one `postgres:18-alpine`,
started with the README's own `docker run … db-init` recipe. Each backend got its own
database. The api-e2e and ui-e2e suites are byte-identical across all four generations,
so the same two suites were pointed at each backend in turn.

---

## F1–F12

| F | Status | Evidence (commands run on `bce7f409`) |
|---|---|---|
| **F1** repo-read binding in a `domainService` | **FIXED** | FieldOps `Dispatch.hasTechnician` now emits `matches.length > 0` (node), `len(matches)` (python), `matches.Count` (.NET), `matches.size()` (Java), `Enum.count(matches)` (elixir). `repro.ddd`: node `tsc` exit 0, python `mypy --strict` "Success: no issues found in 34 source files". `f1-scope.ddd`: ops `a` and `b` both emit `f.length > 0` (b was `[...f].length`); op `c` (`f.totallyInvented`) is now refused: `'totallyInvented' is not a member of 'Owner[]'` (#3078) |
| **F2** id/datetime literals in emitted unit tests | **FIXED** on node + python; .NET unit tests fail to compile **for a different reason** (N4) | node: `wo.schedule(Ids.TechnicianId("0000…01"), new Date("2024-05-01T09:00:00Z"))`, `tsc` exit 0. python `mypy --strict`: **1 error** (was 6) — the remaining one is the `comparison-overlap` sidecar the original F2 flagged, `tests/test_work_order.py:27: error: Non-overlapping equality check`, which #2957 diagnosed and deferred and open PR #3086 targets |
| **F3** e2e suite not idempotent | **FIXED** | Original source: run 1 **4 passed**, run 2 **4 passed**. Server log: two `POST /__loom/test-reset` → 200. `E2E_RESET=off` brings the original failure back: `expected 2 to be 1`. v2's exact `toBe(2)` (was `toBeGreaterThanOrEqual(2)`): 6/6 on three consecutive node runs, two python and two .NET |
| **F4** e2e payload unchecked | **FIXED** — residue → **N1** | `probe-e2e.ddd`: **7 of 7** defects refused (was 2 of 7) — `e2e-unknown-body-key` ×2, `e2e-unknown-response-field`, `e2e-unrouted-verb`, `e2e-unknown-aggregate`, `e2e-body-type-mismatch`, `e2e-missing-required-field`. Probes 1, 6 and 7 also read `w.code` / `w.qty` off a **create** result. The gate allows those reads, and at runtime they are `undefined` (N1) |
| **F5** workflows not drivable | **FIXED** | v2 block: `api.scheduleVisit.run({…})` → `byReference` reads `status "Scheduled"`, `taskCount 1`. An empty `label` → `toThrow(422)`, then `byReference("WO-501")` → 404 (nothing written). Green on node, python, .NET. Mutation M5 (delete `wo.schedule(…)` from the generated workflow) → red. `.instances()` is honestly refused here: `scheduleVisit` has no correlation field, as documented |
| **F6** no principal in `test e2e` | **NOT FIXED — owner-deferred** | `src/language/ddd.langium:251` is still `'test' 'e2e' name 'against' deployable ('verifies' …)? '{' … '}'`. Draft #2976 (a second principal) is harness-side only and has been idle since 2026-09-20 |
| **F7** UI negative path | **FIXED** (honest refusal, D-3) | `fieldops-uiprobe.ddd`: `342:78 error: 'toThrow(422)' pins an HTTP status, but this 'test e2e' block targets a frontend …` |
| **F8** `verifies` on e2e never joins | **PARTIAL** — join fixed; residue → **N6** | A real vitest JSON from the v2 run → `TC-102 \| VERIFIED`. Unit + e2e reports merged by hand → **Verified 4/4, exit 0**. The `probe-verify.ddd` join resolves too: its requirement now reads FAILING, not UNVERIFIED. The gate's diagnostic still names the wrong cause, and a whole-system verdict needs hand-merged reports (N6) |
| **F9** `auditable` + any frontend | **FIXED** | The 12-line repro plus the auth that `loom.stamp-principal-without-auth` now requires (a separate honest gate, documented at `docs/capabilities.md:29–33`): parse `0 error(s)`; React `tsc --noEmit && vite build` exit 0; backend `tsc` exit 0. No `User` aggregate needed |
| **F10** `toThrow(404)` parity | **FIXED** | `getById("00000000-0000-0000-0000-0000000000ff")` → 404 on node, python, .NET and Java. That is the UUID that answered 422 on Hono in September; v2 asserts `toThrow(404)` on it and is green on all four |
| **F11** unit tier can't say which rule | **FIXED** | M2 below: deleting `complete()`'s precondition now fails with `expected … /^Precondition failed: / but got 'Invariant violated: tasks.count > 0'` on node and `Regex pattern did not match` on python. Control: the same mutation against the original bare `toThrow()` stays **6 passed** |
| **F12** no README | **PARTIAL** — residue → **N5** | `README.md` exists and is substantive. Its node recipe works **verbatim**: this audit booted from it. Its python recipe fails at step 1, its .NET unit-test recipe runs zero tests and exits 0, and Java gets no recipe at all, nor any mention of its JUnit tests (N5) |

### Workarounds — which could be removed

Every fixed-bug workaround in the original source is now unnecessary. The diff from
v1 to v2:

```diff
-    expect(Money { amount: -1.0, currency: "USD" }).toThrow()
+    expect(Money { amount: -1.0, currency: "USD" }).toThrow(invariant)          // F11
-    expect(wo.complete()).toThrow()
+    expect(wo.complete()).toThrow(precondition)                                  // F11
+    expect(wo.technicianId).toBeNull()                                           // F11
-    // no per-test isolation … this count cannot be exact.
-    expect(active.length).toBeGreaterThanOrEqual(2)
+    expect(active.length).toBe(2)                                                // F3
-    expect(api.workOrders.getById("a1b2c3d4-e5f6-4789-a012-3456789abcde")).toThrow(404)
+    expect(api.workOrders.getById("00000000-0000-0000-0000-0000000000ff")).toThrow(404) // F10
+  test e2e "the scheduleVisit workflow …" against api verifies TC-102 { api.scheduleVisit.run({…}) … }   // F5, F8
+  test e2e "an unscheduled work order has no technician" against api { … toBeNull() … toContain("Gu") } // F11
```

The F2 id/datetime literals (`wo.schedule("0000…01", "2024-05-01T09:00:00Z")`) were never
a workaround. They were the defect. The same source line now type-checks on node and
python. **The only workaround still needed is a .NET one:** renaming the `base` parameter
(N3), applied to a .NET-only copy so the remaining .NET tiers could be measured.

---

## Mutation proofs

The original's proofs were repeated on today's v2 output, and two were added for the
workflow tier. Each file was copied aside, mutated with `sed`, and restored **by file
copy**. The backend was restarted around each api-e2e mutation.

| # | Mutation (generated code) | Tier | Result | Failing assertion |
|---|---|---|---|---|
| M1 | delete `isEditable()` precondition from `addTask` | unit (node) | **red** | `tasks cannot be added once work has started` → `expected [Function] to throw an error` |
| M2 | delete `status == InProgress` precondition from `complete()` — **the F11 case** | unit (node) | **red** | `expected [Function] to throw error matching /^Precondition failed: / but got 'Invariant violated: tasks.count > 0'` |
| M2c | same mutation, **original** source (bare `toThrow()`) | unit (node) | green — the control | `6 passed (6)`: September's blind spot, reproduced |
| M2py | same mutation | unit (python) | **red** | `AssertionError: Regex pattern did not match. Regex: '^Precondition failed: '` |
| M3 | drop the `WorkOrderCompleted` arm of the projection fold | api-e2e (node) | **red** | `expected 'Scheduled' to be 'Completed'` |
| M4 | render a constant instead of the technician's name on the detail page | ui-e2e (node) | **red** | `toHaveText` — `Expected: "Hopper"`, `Received: "Nobody"` |
| M5 *(new)* | delete `wo.schedule(tech.id, at)` from the generated workflow handler | api-e2e (node) | **red** | `expected 'Draft' to be 'Scheduled'` |
| M6 *(new)* | delete the workflow's own `label.length > 0` precondition | api-e2e (node) | **green** | — see below |

**M6 is F11 one tier up, and it is a documented limit, not a defect.** With the
workflow's precondition gone, `addTask`'s own `label.length > 0` precondition throws.
Both the message (`Precondition failed: label.length > 0`) and the status (422) are
identical, so the test cannot tell which guard fired. The e2e tier deliberately refuses
rung-pinning (`loom.e2e-throw-kind-invalid`: over HTTP both rungs answer 422). It is
recorded here because it is the same blind spot F11 closed for unit tests. **A
`toThrow(422)` on a workflow proves that *some* guard rejected, not that the workflow
has one.** The fix belongs in the author's test, as a unit `test` on the guard, rather
than in the matcher.

---

## Per-backend results

| Backend | Booted? | Compile | Unit | api-e2e | ui-e2e |
|---|---|---|---|---|---|
| node (Hono) | ✅ native, README recipe verbatim | `tsc` 0 (backend + both test projects) | 6/6 | 6/6 ×3 | 9/9 |
| python (FastAPI) | ✅ native `uv run uvicorn` | `mypy --strict` 1 error (#3086's sidecar) | 6/6 | 6/6 ×2 | 9/9 |
| .NET | ✅ SDK 10 container, `dotnet run` | ❌ **N3** — then ✅ after a source rename | ❌ **N4** — test project does not compile | 6/6 ×2 | 9/9 |
| Java (Spring) | ✅ `gradle bootRun`, Flyway applied 1 migration | ✅ | 6/6 | ❌ **4/6** ×2 — **N2** | 9/9 |
| elixir | ❌ not run (hex mirror) | — | — | — | — |

`ddd verify`'s F8 path was exercised on node's reports only.

---

## New findings

### N1 — The e2e response-field gate models a `create` result as the full entity; every backend returns `{id}` · **P2**

`loom.e2e-unknown-response-field` (F4's gate) judges a read off
`let w = api.<agg>.create(…)` against the api-read wire shape. On all five backends the
create route answers **`201 {"id": …}`** and nothing else:

```
node    c.json({ id: created.id as string }, 201)
python  {"id":"01a107ae-…"}                              (curl, booted)
java    record CreateTechnicianResponse(UUID id)         {"id":"01a107bd-…"} (curl, booted)
.NET    record CreateTechnicianResponse(Guid Id)
elixir  json(%{"id" => record.id})
```

So every field the gate accepts, other than `id`, is `undefined` at run time. Repro
(`0 error(s)`):

```ddd
aggregate Widget with crudish { code: string  note: string? }
test e2e "create result carries code" against api {
  let w = api.widgets.create({ code: "A" })
  expect(w.code).toBe("A")
}
test e2e "create result: optional note is absent" against api {
  let w = api.widgets.create({ code: "B" })
  expect(w.note).toBeAbsent()
}
test e2e "getById: optional note is absent" against api {      // control
  let w = api.widgets.create({ code: "C" })
  let r = api.widgets.getById(w)
  expect(r.note).toBeAbsent()
}
```

```
 × create result carries code              → expected undefined to be 'A'
 ✓ create result: optional note is absent                    ← green for the wrong reason
 × getById: optional note is absent        → expected true to be false
      Tests  2 failed | 1 passed (3)
```

The middle test is the F4 failure shape exactly: it passes because the field is missing
from the response, not because of the property it claims to check. The control proves
it: the documented contract (RS-35, explicit null) makes the same claim fail where the
entity is actually returned.

The design is deliberate, but the premise it rests on is false.
`src/ir/validate/checks/e2e-route-checks.ts:1084–1092` says `create` "answers an id
envelope that every backend widens at most to that same shape … without this gate having
to adjudicate which backends return the whole entity on 201". **None do.** And the
user-facing diagnostic says the opposite of the truth: *"'w' is 'api.widgets.create(…)',
whose body is the api-read wire shape of 'Widget'. … Readable: id, code, note, version."*

The original F8 repro (`probe-verify.ddd`) has this shape, which corrects the record: its
"one passing e2e test" was a hand-written results file (`vresults.json`). Run for real,
the test fails (`expected undefined to be 'A'`). The F8 diagnosis itself stands.

### N2 — Java: a unique-key `find` drops its implicit filter — 500, or the wrong row with a 200 · **P1**

`find byReference(reference: string): WorkOrder?`, the documented "unique-key
reconstitution" form (`docs/language.md` § Repositories), has no explicit `where`. Java
emits:

```java
@Query("select e from WorkOrder e")
WorkOrder byReference(@Param("reference") String reference);
```

.NET (`Where(x => x.Reference == reference)`) and elixir
(`where: record.reference == ^reference`) derive the key match. Java renders only an
explicit `f.filter` (`src/generator/java/emit/repository.ts:405–428`), so for a
filterless find it emits no `where` at all. Measured on the booted Java backend:

```
GET /api/work_orders/by_reference?reference=WO-200 → 500
  org.hibernate.NonUniqueResultException: Query did not return a unique result: 2 results were returned
# after a reset, with exactly ONE work order ("ONLY-ONE") in the table:
GET /api/work_orders/by_reference?reference=DOES-NOT-EXIST
  → HTTP 200 {"id":"01a107bd-…","reference":"ONLY-ONE",…}
```

It validates clean, compiles, and passes `gradle test`. The FieldOps api-e2e suite
catches it (4/6 on Java, both runs), and so would any Java user's first lookup. The
September output has the identical line; the original audit never booted Java. The
only checked-in model with this shape is `examples/inventory.ddd:38`
(`find byCode(code: string): Warehouse?`), so no Java runtime leg covers it.

### N3 — .NET: a domain-service parameter named a C# keyword is unescaped in the signature · **P1**

```ddd
domainService Pricing {
  operation bump(base: Money): Money { return Money { amount: base.amount + 1, currency: base.currency } }
}
```

```csharp
public static Money Bump(Money base)          // declaration: bare
    return new Money(@base.Amount + 1m, @base.Currency);   // body: escaped
```

```
Domain/Services/Pricing.cs(13,36): error CS1001: Identifier expected
Domain/Services/Pricing.cs(13,36): error CS1003: Syntax error, ',' expected
```

The model validates with `0 error(s)`. `src/generator/dotnet/emit/domain-service.ts:230`
renders `${p.name}` raw, while the expression renderer escapes the same name in the body.
FieldOps has had this since September (`withSurcharge(base: Money, pct: decimal)`), so
**the FieldOps .NET backend has never compiled**. Open PR #3102 escapes python member
names and the .NET invariant-helper collision. It does not cover .NET domain-service
parameter declarations.

### N4 — .NET: emitted unit tests don't compile when a `create({…})` omits an optional field — and no per-PR gate builds them · **P2**

```ddd
aggregate W with crudish {
  code: string
  note: string?
  test "create omitting an optional field" { let w = W.create({ code: "a" })  expect(w.code).toBe("a") }
}
```

```csharp
public static W Create(string code, string? note)   // domain: no default for the optional
var w = W.Create(code: "a");                         // emitted xUnit test
```

FieldOps, measured: `WorkOrderTests.cs(18,28): error CS7036: There is no argument given
that corresponds to the required parameter 'technicianId' of 'WorkOrder.Create(string,
string, WorkOrderStatus, TechnicianId?, DateTime?)'` (×3). The workflow-handler emitter
fills the omitted optionals with `technicianId: null, scheduledFor: null` for the same
`.create({…})` shape. The test emitter does not.

Why no gate sees it: the .NET compile gates run `dotnet build` at the project root, where
`Api.csproj` carries `<Compile Remove="Tests/**" />`. The gate's exact command exits 0 with
"Build succeeded." on this project, while `dotnet build Tests/Api.Tests` fails.
`test/e2e/generated-dotnet-build.test.ts:765–775` documents the omission ("do NOT
`dotnet build` it in CI … a Tier-1 follow-up"). The behavioural `run-dotnet.mjs` leg
does run `dotnet test`, but only on corpus cases. This is the original audit's
cross-cutting shape exactly: the gate that would catch it exists, and it does not reach
the artifact. #2957 (F2) said honestly that it never compiled .NET or Java.

### N5 — The generated README's non-node recipes don't work (F12 residue) · **P2**

#2971 (F12) states *"Every command in it, actually run"*. That was measured on a
node + React example. The recipes for the other backends, run here:

| Backend | README says | Run |
|---|---|---|
| python | `pip install -r requirements.txt` | `ERROR: Could not open requirements file: [Errno 2] No such file or directory: 'requirements.txt'`. The project is `pyproject.toml` + uv, and its own Dockerfile runs `uv sync`. The unit recipe is a bare `pytest` with no install step |
| .NET | `cd api && dotnet test` | **exit 0, zero tests run**. It targets the non-test `Api.csproj`, so a reader sees green for a suite that never compiled (N4) |
| Java | *(nothing)* | No run recipe and no unit-test recipe. The README says "Two separate projects in this tree carry tests" and omits `src/test/java/**/{Money,Pricing,WorkOrder}Tests.java`, which is F12 itself, on Java. `src/system/readme.ts` detects Java by `pom.xml`, and the Java backend emits Gradle (`build.gradle.kts`) |

`src/system/readme.ts:306–309` matches `requirements.txt || pyproject.toml` and then
hard-codes `pip install -r requirements.txt`. A cosmetic one too: the README's sample
reset warning names `http://localhost:4000` (elixir's port) in a model whose only backend
is on 3000.

### N6 — `ddd verify` can't take a generated tree's reports, and its diagnostic still names the wrong cause (F8 residue) · **P3**

A generated tree has its unit and e2e tests in **separate runner projects**, so they
produce separate reports. `ddd verify` takes one `--from-vitest`. A second one is
silently ignored, last wins, and the dropped report's requirements go UNVERIFIED with no
warning:

```
$ ddd verify fieldops-v2.ddd --from-vitest unit-report.json --from-vitest e2e-report.json
Verified 1/4 requirements (0 failing, 3 unverified, 0 untested) — 2 declared test(s) with no result, 5 result(s) matching no declared test.
Verification gate failed: … — the SUITE does not match: reported {name: "the work-order lifecycle round-trips over HTTP against api", suite: "FieldOps e2e"} (whose declared name is "the work-order lifecycle round-trips over HTTP"), but that test is declared with suite "FieldOps e2e"; …
$ # the same two reports merged by hand:
Verified 4/4 requirements (0 failing, 0 unverified, 0 untested) — 9 result(s) matching no declared test.
```

The diagnostic contradicts itself: it says the suite does not match, then quotes two
identical suites. The fleet plan asked P1 to fix exactly this misdiagnosis. The cause is
in `describeJoinMismatch` (`src/cli/main.ts:1274–1328`). It assumes an unmatched result
is a broken join, but here the unmatched results are e2e blocks that simply carry no
`verifies`. Their names resolve, so the classifier lands in the "SUITE does not match"
arm. The real failure is the missing unit report. "Results matching no declared test"
is also inaccurate: those tests *are* declared; they verify nothing.

### N7 — A Chevrotain grammar-ambiguity warning prints on every `parse`/`generate` of the documented `toThrow(precondition)` form · **P3**

```ddd
expect(w.close()).toThrow(precondition)
expect(w.code).toBe("a")
```

```
Ambiguous Alternatives Detected: <0, 1> in <OR1> inside <PostfixSuffix> Rule,
<precondition, ), expect> may appears as a prefix path in all these alternatives.
See: https://chevrotain.io/docs/guide/resolving_grammar_errors.html#AMBIGUOUS_ALTERNATIVES
```

The parse is correct: the emitted test is
`expect(() => { w.close(); }).toThrow(/^Precondition failed: /)`. But the user sees parser
internals on stdout from `ddd parse`, `ddd generate` and `ddd verify`, for any model that
follows the docs' own F11 example with a second statement.

### N8 — `docs/language.md` omits the workflow accessor from the e2e verb table · **P3 (docs)**

The formal reference's "End-to-end tests against a deployable" section lists aggregate,
projection and routed-handler verbs, and never mentions `api.<workflow>.run()` /
`.instances()` / `.instance(key)`. Only
`docs/language-reference/18-testing.md:171,253–287` documents them.

---

## Cross-cutting observation

The pattern from the original audit, "the gate that would have caught it exists, and
doesn't reach the artifact", is **mostly drained on node and python, and intact on the
other three backends**:

- **Fixes were proved on the backends their authors could compile.** #2957 (F2) says
  outright that .NET and Java were never compiled, and the .NET unit tier still does not
  compile (N4). #2971 (F12) ran its recipes on node, and the python, .NET and Java
  recipes are broken (N5).
- **The audit itself had the same blind spot.** ".NET: 107 files, 0 errors" was a
  `generate` count, and that backend did not compile (N3). "One e2e suite, byte-identical
  on five backends" was true at the source level. Java fails two of its tests (N2).
  Byte-identical tests are only as portable as the backends they run against.
- **The F4 gate's denominator is the corpus, not the runtime.** The P3 sweep proved that
  the gate turns no valid model red. It could not show that the reads it *accepts* are
  real, because nothing ran them. N1 sat in a gate built to stop wrong-reason passes.

A test that would have caught N1–N4 together is one booted, non-node behavioural leg over
a model like FieldOps: one domain service, one unique-key find, one optional field
omitted in a unit test, and one create result read back. Each of the four turns red on
first contact.
