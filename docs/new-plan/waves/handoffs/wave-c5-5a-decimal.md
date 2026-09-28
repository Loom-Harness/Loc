# Wave C5 · moment 5a (M-T5.22 decimal-exact) — hand-off

*Branch: `claude/c5-decimal`. Base: `4816dda14` (the C5 coordinator head =
`main` @ `fc1880a05` + the wave log). Never pushed; the wave PR (#3054) is the
claim.*

## 1. Scope finding — written BEFORE building (the mission's "scope first")

**Where node computes a `decimal`.** Loom `decimal` is a plain JS `number` on
the Hono backend (`money` is the decimal.js `Decimal`). Every domain-side
expression — aggregate `derived` getters, operation / function / invariant
bodies, value objects, domain services, workflow and projection-fold bodies,
handler bodies, the emitted unit tests — renders through ONE leaf table,
`TS_TARGET` in `src/generator/typescript/render-expr.ts` (the shared TS
emitter; consumed only by `src/platform/hono/**` — the four JS frontends have
their own leaf table, `src/generator/_walker/js-expr-leaves.ts`). So the
"derived-field evaluator" is not a separate site: a `derived` is a getter whose
body is that leaf's output, and the repository persists the getter's value.

**Fence note.** The packet's fence names `src/platform/hono/**`; the node
arithmetic leaf lives one directory over, in `src/generator/typescript/`, which
IS the Hono backend's domain emitter (no other consumer). The edit goes there;
nothing else under `src/generator/**` is touched for node.

**The arithmetic sites (node).**

| site | today | cost |
|---|---|---|
| `renderBinary` (`+ - * / %` whose `resultType` is `decimal`) | native double operators | one arm: lift to decimal.js, carry `Decimal` through a nested chain, `.toNumber()` once at the chain's root |
| `sum` over a `decimal` receiver/λ body | `reduce((a, x) => a + x, 0)` (shared `_expr/js-collection-ops.ts`) | one intercept in the node file before the shared table |
| `decimal.round(n)` | `Math.round(x * 10**n) / 10**n` (shared `_expr/js-intrinsics.ts`) — `1.005.round(2)` = `1` | one intercept in the node file |
| wire codec / repository | `Number(col)` on read, number on write (RS-24) | **unchanged** — RS-24 governs serialization; only computation moves |

**The library threading.** `decimal.js` is already a generated-node dependency,
but only when the project uses `money` (`src/platform/hono/v4/emit.ts`
`withMoney`). A decimal-only project now needs it too, and every emitted file
that renders decimal arithmetic needs the import. The per-file import
decisions are heterogeneous: `value-objects.ts`, `domain-service.ts`,
`tests.ts`, `routes-builder.ts`, `workflow-builder.ts`, `projection-builder.ts`
already decide by scanning the emitted body for `Decimal`; `aggregate.ts`
decides on `usesMoney` alone and must learn to scan. The `package.json` flag
becomes "some emitted file imports decimal.js" (a scan of the emitted map) —
the invariant that actually matters (a file that imports it ⇒ the dependency
is declared).

**Precision.** decimal.js computes at 20 significant digits by default (no
`Decimal.set` is emitted today). The result narrows to a double at the chain
root (RS-24's wire width), and 20 > 17, so the witness shapes agree with the
28/34-digit exact backends after narrowing. Raising node to 28 digits is the
money-precision residue — handed off (§6), not carried (no golden covers it).

**Python.** `decimal` is a Python `float` in the domain (`PY_TYPE_TARGET`; the
column side is already `Numeric`/`Decimal`, M-T6.45). The same three sites live
in `src/generator/python/render-expr.ts` (binary leaf, `sum`, `decimal.round`)
plus the import collector `addPyExprImport` (one `binary` arm), which every
Python file emitter already drives. Lift through `Decimal(str(x))` — the
shortest-repr route that is also a no-op for an operand that already IS a
`Decimal` — and narrow once with `float(...)` at the chain root. Python's
default context is 28 digits, ROUND_HALF_EVEN, matching .NET/Elixir.

**Not in scope (and why).** The wire-boundary zod `.refine` for an invariant
(`src/generator/zod-refine.ts`, shared with the four frontends) still evaluates
in doubles — handed off (§6). Postgres-side arithmetic (find filters, query-time
projection aggregates) is already exact `numeric`.

**Cost verdict: M, not L.** Two leaf tables, one aggregate import scan, one
package.json flag. No wire codec, repository or DTO change — that was the
unknown the mission feared, and it does not materialise because the chain is
narrowed back to a double before it leaves the expression.

**What the build confirmed about the scope.** Held as written, with one
addition: the corpus snapshot (§3) showed only four fixtures' emission moves,
and a scratch probe (value-object `derived`, `domainService` op, aggregate
`invariant`, workflow `create` body, `%`, `int / int`) confirmed the body-scan
imports already cover `value-objects.ts`, `services.ts` and
`http/workflows.ts` — `tsc --noEmit` and `ruff` + `mypy --strict` clean on the
probe. The one site still computing in doubles is the node route-level zod
`.refine` (§6).

## 2. Rows → outcome

| row | outcome |
|---|---|
| scope first | **done** — §1, written before any code. Verdict **M**: no wire codec / repository / DTO change |
| node exact | **done** — `src/generator/typescript/render-expr.ts`: `renderBinary` decimal arm `:563`, `toDecimal` `:642` (the one decimal.js construction site), `isDecimalArithmetic` `:661`, `decimalChainOperand` `:671` (carries a nested chain's `Decimal`, drops its `.toNumber()` through `paren`s), decimal `sum` fold `:437` (`sumBodyIsDecimal` `:406`), `decimal.round` `:380`; the money arms hand a decimal chain over un-narrowed. `src/generator/typescript/emit/aggregate.ts:211` imports decimal.js on a body scan; `src/platform/hono/v4/emit.ts:1318` declares the dependency whenever an emitted module imports it |
| python exact | **done** — `src/generator/python/render-expr.ts`: arm `:780` (before the `%`→`trunc_mod` detour; `Decimal` `%` already truncates), `isDecimalArithmetic` `:889`, `renderDecimalArithmetic` `:905` (`Decimal(str(x))`, numeric literals as `Decimal("0.1")`), `decimalChainOperand` `:930` (also used by the money × decimal lift at `:799`, so a decimal chain reaches money un-narrowed), `sum` `:608` (`sumIsDecimal` `:566`), `decimal.round` `:483` (quantize `ROUND_HALF_UP`; its import `:512` is now `decimal`, not `math`), import collector `:268` |
| corpus witness | **done** — `test/fixtures/corpus/decimal-exact.ddd`, manifest row in `test/fixtures/corpus/manifest.ts` (all five backends). Rows: `0.1 + 0.2`, `1.1³` chained, `0.3 / 0.1`, `(a + b) * 3 - d`, `a / 3 * 3` (chain witness, wire only), `1.005.round(2)`, `parts.sum(…)`, an operation writing `total + x` to a stored column |
| red before / green after | **done** — §3 |
| goldens re-captured | **done** — §4. 63 existing goldens byte-identical, one new (`decimal-exact.json`) |
| RS entry | **done — as RS-37, not RS-38** (§7): `test/conformance/semantics-rules.ts` + `docs/conformance-semantics.md` § RS-37 + `test/conformance/semantics-spec.json` regenerated; prose↔registry parity gate green |
| `docs/migrations.md` | **done** — § "Semantic changes that emit no migration — exact `decimal` arithmetic (RS-37)": no migration, historical rows not rewritten, how a deployment re-aligns a `derived` column and why an operation-written value cannot be |
| money-precision residue + doc drift | **handed off** (§6) — the golden diff covered none of it (zero existing golden bytes moved), so per the packet none rides this PR |
| mutation proof | **done** — §5 |
| mission status | **M-T5.22 → `done`**, section moved verbatim to `docs/new-plan/archive/T5-done.md` with a "Landed" paragraph naming the residue; README mention + counts regenerated |
| existing tests re-pinned | 12 node/python generator tests pinned the float rendering this replaces (native decimal `+ * /` and `int / int`, a native decimal `sum`, `Math.round`/`math.copysign` rounding): `collection-op-value-semantics`, `python/{intrinsic-trim,python-aggregate,python-domain,python-workflow-stmt-collectors,render-expr-kinds}`, `typescript/{avg-desugar,generator-ts,hono-erp-bundle-regressions,intrinsic-trim,render-expr-kinds,toplevel-function}` — each now asserts the exact form and says why in place. `_numeric/boundary-census`: the money mirror arm's inline `new Decimal(${left})` waiver was stale (the line now goes through `toDecimal`, whose body line the existing money-literal waiver already covers) — removed, not replaced. `system/wire-contract-divergence`: the witness's containment adds one row of the existing deliberate `containment-response-suffix` class (B1) |
| per-PR arm test (added) | `test/generator/decimal-exact-arithmetic.test.ts` — 8 tests, no boot. The behavioural legs are path-scoped; this pins the emission shape on every PR, centred on the narrowing COUNT |

## 3. Legs run (all locally, on this tree)

| leg | before the fix | after |
|---|---|---|
| node (`run.mjs`, PGlite) | ✗ api + ✗ unit: `expected 0.30000000000000004 to be 0.3` | ✓ unit, ✓ api, golden captured |
| python (`run-python.mjs`, uv + host Postgres 16) | ✗ unit `assert 0.30000000000000004 == 0.3`, ✗ api `expected 0.30000000000000004 to be 0.3` | ✓ unit, ✓ api, wire matches golden |
| dotnet (EF Core, `/opt/dotnet` SDK 10) | — (exact already) | ✓ unit, ✓ api, wire matches |
| dapper | — | ✓ unit, ✓ api, wire matches |
| mikroorm (node on Postgres) | — | ✓ api, wire matches |
| java (JDK 25 + Gradle 9.1 downloaded to the scratchpad — the host has 21 / 8.14) | — | ✓ unit (`gradle test`), ✓ api, wire matches |
| elixir (toolchain lifted from `hexpm/elixir:1.18.4-erlang-27.3.4…` onto the host, `docs/tools.md` recipe) | — | ✓ unit (`mix test`), ✓ api, wire matches |

Every "after" cell was re-run on the FINAL fixture (the last edit added the
list read; all seven legs re-ran after it). Also re-run with the wire gate on
for the other fixtures whose emission moved
(`domain-services`, `vo-decimal-derived` on python + mikroorm;
`numeric-operands` unit on python) — all match. Compile tiers: node
`corpus-tsc-build` and python `corpus-python-build` (ruff + `mypy --strict` +
pytest) green on `decimal-exact`, `domain-services`, `numeric-operands`,
`vo-decimal-derived`; java/.NET/elixir compiled as part of their boots.

Emission census (`scripts/capture-corpus-snapshot.mjs`, 420 cells; before =
base renderers, after = this branch): **8 cells differ, all expected** —
`decimal-exact` (node `sample.ts` + `package.json`, python `sample.py`),
`domain-services` (node `account.ts` + `package.json`, python `account.py` —
the `Money` VO's `amount: decimal` ± in `withdraw`/`deposit`),
`numeric-operands` (node `order.ts`, python `order.py` — `count + factor`),
`vo-decimal-derived` (node `product.ts` + `package.json`, python
`product.py`). No other backend's output moved.

## 4. Golden review, file by file

Captured with `LOOM_WIRE_UPDATE=1 node run.mjs` over every case (134 passed,
0 failed, 14 skipped — the skips are the authz-ladder "unauthenticated" rungs
the dev-stub verifier cannot express, unchanged), twice: once mid-build and
once on the final tree after `rm -rf .work`. `jq -r .oracle … | uniq -c` →
**64 node**.

- **63 existing goldens: byte-identical.** Not one line changed, so there is
  no diff to explain line by line — and that is the expected result, not a
  vacuous one: the mission's own premise is that NO corpus case carried
  float-error-visible decimal arithmetic. Checked against the one suspicious
  float in the set, `projection-groupby.json`'s `2.3333333333333335`: that is
  a Postgres `avg(numeric)` narrowed by `Number(...)` (the `projection-read`
  codec, untouched), and `2.3333333333333335` is the shortest spelling of the
  double nearest `2.3333333333333333` — already exact. The three fixtures
  whose node emission moved produce identical bytes because their operands are
  binary-exact (`3.5`, `2.5`, `4.5`, `domain-services`' amounts), which is
  exactly why they never exposed the bug.
- **`decimal-exact.json`: new.** 10 requests: create; read by id (`sum 0.3`,
  `cube 1.331`, `ratio 3`, `mixed 0.6`, `thirds 0.1`, `rounded 1.01`,
  `partsWeight 0`); the list route (the same row through the collection
  serializer — added because the api-caller census requires every derived
  route to have a caller); `accumulate`; two `addPart`s; read (`total 0.3`,
  `partsWeight 0.3`); the three framework-fault probes. No `numberFormats`
  entry (every number is its canonical shortest spelling). Diffed green by the
  other six legs.

## 5. Mutation proofs (file-copy revert, never `git checkout --`)

1. **Revert node's leaf** (`src/generator/typescript/render-expr.ts` ← base):
   witness red on both tiers — `[api] … expected 0.30000000000000004 to be
   0.3` and `[unit] … expected 0.30000000000000004 to be 0.3`.
2. **Disable only the chain carry on node** (`decimalChainOperand` returns
   null → narrow per step): witness red — `[api] expected 0.09999999999999999
   to be 0.1` (and `[unit]` the same, before the unit `thirds` assertion was
   dropped — in-process the decimal-typed backends hold the un-narrowed
   `0.0999…9`, so `thirds` is asserted on the wire only). This is the row that
   lets the fixture falsify the chain half; `cube`/`mixed` pass under per-step
   narrowing.
3. **Arm test**: chain carry disabled on both renderers → the two "carries a
   chain's Decimal to its root" tests fail (`Received: "new Decimal(new
   Decimal(this._c).times(this._c).toNumber()).times(this._c).toNumber()"`;
   python `float(Decimal(str(float(Decimal(str(self._a)) / Decimal("3")))) *
   Decimal("3"))`); both renderers reverted → all 8 fail.
4. Python red-before on the base tree is §3's python row.

## 6. Hand-offs outside the fence (none moved a golden)

1. **node precision to 28 digits.** decimal.js computes at 20 significant
   digits (`Decimal.set` is never emitted). Recipe: a module-level
   `Decimal.clone({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN })` that
   the decimal arms (`renderBinary`'s decimal arm, the `sum` fold, `round`)
   construct from, emitted once per project (keeps money's arithmetic
   untouched), or `Decimal.set(...)` at boot in `renderProjectIndexTs`
   (`src/platform/hono/v4/emit.ts`) plus the unit-test setup if money should
   move too. Witness: a division whose 18th–20th digits differ; no current
   golden moves.
2. **Inbound precision skew** (Java unlimited / .NET 28–29 / node + python
   double-clamped at the request) — D-NUMERIC-INGRESS-STRICT territory
   (owner-only, unsigned); unchanged here.
3. **zod `.refine` in doubles.** `src/generator/zod-refine.ts` renders a
   cross-field invariant `a + b >= 0.3` as `data.a + data.b >= 0.3` on node's
   route schema (shared with the four JS frontends), so a boundary tie can
   422 before the exact domain check runs. Recipe: in `refineRenderable`,
   return false for a `binary` whose `resultType` is `decimal` and whose op is
   arithmetic — the invariant then stays server-side (`_assertInvariants`,
   exact); or thread decimal.js into the zod layer (heavier). Witness:
   `invariant a + b <= 0.3` with `a: 0.1, b: 0.2` → today 422 on node, 201
   elsewhere.
4. **Doc drift.** `docs/language.md` host-type table (predates #2575,
   mislabels Java); `src/util/collection-ops.ts:34` declares `sum` as
   `(λ): decimal` while `src/language/type-system.ts:1409` returns the λ body
   type — fix the catalog row, then `npm run docs:stdlib`.
5. **.NET: a create parameter named `e` does not compile.**
   `Create(…, decimal e, …) { var e = new Sample(); … e.E = e; }` → CS0136 +
   CS0029 (the factory's local in `src/generator/dotnet/**`). Recipe: rename
   the factory local to a collision-proof name, or escape colliding params.
   Found by the witness's first draft; the fixture now says `tie`.
6. **java: an int literal against a decimal in a unit `expect`.**
   `expect(s.ratio).toBe(3)` renders `assertEquals(0,
   (s.ratio()).compareTo(3))` — javac: `int cannot be converted to
   BigDecimal`. Recipe: the java unit-test emitter wraps an integral literal
   compared against a `decimal`/`money` receiver as `new BigDecimal("3")` (it
   already does for `3.0`). The fixture says `3.0`.
7. **Uncoded keyword refusal.** The corpus-mutation matrix renaming a field
   to `parent` is refused by a bare "'parent' is a Loom keyword" with no
   `loom.*` code (hit when the first draft reused a part field's name for an
   aggregate `derived`). Recipe: give that message a code in
   `src/diagnostics/messages.ts` + a `code-docs.ts` anchor + a census fixture.
8. **Harness note.** Re-running a behavioural leg after editing a fixture's
   model trips the rebaseline guard from the stale `.work*/<case>/.loom`
   history; `rm -rf test/behavioral/.work*/<case>` first. CI is always fresh.

## 7. Decisions taken, and wanted

- **Taken — RS-37, not RS-38.** D-DECIMAL-EXACT-MOMENT's text says "take
  RS-38" because D-ABSENT-JOIN-DATETIME-WIRE reserved RS-37 for the datetime
  wire form (moment 5b). `semantics-rules.test.ts` requires gap-free ids, so
  an RS-38 is unlandable before an RS-37 exists, and no open PR claims RS-37.
  This rule is RS-37; **the datetime rule takes RS-38 when 5b lands.** The
  coordinator should (a) state "RS-37" in #3054's title/body per the claim
  protocol and (b) amend the two numbers in `docs/decisions.md`
  (D-DECIMAL-EXACT-MOMENT's "take RS-38", D-ABSENT-JOIN-DATETIME-WIRE's
  "Mints RS-37") in the fold — outside this fence.
- **Taken — `decimal.round` and `sum` are decimal arithmetic.** The ruling
  names `+ - * /`; rounding a binary-inexact tie (`1.005 → 1`) and a float
  fold (`[0.1, 0.2] → 0.30000000000000004`) are the same defect, the fix is
  node/python-local (an intercept before the shared JS tables), and the three
  exact backends already answer `1.01` / `0.3`. Included and witnessed.
- **Taken — `int / int` counts** (its result types as `decimal`), matching
  the explicit decimal division .NET/Java/Elixir already emit
  (`isIntDivWidenedToDecimal`).
- **Taken — fence reading.** The node arithmetic leaf lives in
  `src/generator/typescript/` (the Hono backend's own domain emitter, no other
  consumer), not `src/platform/hono/**`; the arm test lives in
  `test/generator/`. Both are the change itself, not neighbouring work.
- **Wanted (owner).** Whether node and python should hold `decimal` as a
  decimal type in the DOMAIN, so in-process values and STORED values match
  .NET/Java/Elixir to 28 digits. Today they narrow at the chain root, so a
  non-terminating result is stored with a double's 17 digits where .NET stores
  28 — RS-24 makes the wire agree, storage does not. Hand-off 1 taken to its
  end; an L.

## 8. Open PRs on the fence (read before touching; cited, not duplicated)

- #3051 (CR1 batch 2) edits `src/generator/python/render-expr.ts`'s
  `addPyExprImport` (a named-kinds exhaustive switch); this branch adds one
  line inside its `binary` arm — composes.
- #2947 and #2918 edit `src/generator/typescript/emit/aggregate.ts`; this
  branch changes one line (the decimal.js import condition).
- #3049 edits `docs/migrations.md` (the drizzle journal); this branch adds a
  separate section.
- #3024 (`handler-triad.json`) and #2945 (new `criterion-current-user.json`)
  touch goldens; neither golden moved here, so no conflict — but whichever
  lands after this branch re-captures only its own file.
- #2945 and #3043 add rows to `test/fixtures/corpus/manifest.ts`; this branch
  adds one row (`decimal-exact`) — textual neighbours only.
- None touches decimal arithmetic or the RS registry.

## 9. Local gates (this branch; `origin/main` has not moved past the base)

| gate | result |
|---|---|
| `npx tsc -b` | exit 0 |
| `node scripts/test-typecheck.mjs` | OK — test/ and src/ clean |
| `npx biome ci . --diagnostic-level=error` | exit 0 |
| `node scripts/mission-counts.mjs --check` | up to date (regenerated with `--write` after the M-T5.22 archive move) |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| `node docs/build.mjs` | exit 0 |
| `npm test` (full, redirected, exit code appended) | **run 1: `NPM_TEST_EXIT=1`** — 19 failures, all real: 12 generator tests pinning the old float rendering, the numeric-codec census (new `new Decimal(` sites + a stale waiver), the api-caller census (no caller for the witness's list route) and the M-T5.40 wire-contract census (the witness's containment). Every one fixed in the commits after it (§2). **Run 2, final tree: 2221 files passed / 89 skipped, 26719 tests passed, 0 failed, `NPM_TEST_EXIT=0`** |
| corpus compile tiers | node `corpus-tsc-build` + python `corpus-python-build` green on the four changed fixtures (§3) |
| behavioural legs | all seven green on the final witness, wire gate on (§3) |

Toolchains used, for whoever reruns: a private Postgres 16 on port 55432
(`/tmp/pg-c5a-data`), `/opt/dotnet` (SDK 10), JDK 25 + Gradle 9.1 and the
lifted Elixir 1.18.4 / OTP 27 under the session scratchpad. None are
committed.
