Both trees untouched; all work in `/tmp/agentD/`. No PRs, pushes, or commits.

---

# 1. Verification table

| Finding | Verdict | Claimed? | Evidence (fresh `main` @ `9a8f2fe0`) |
|---|---|---|---|
| **F-027** cross-context `X id` un-imported in a python route | **LIVE** | **UNCLAIMED** | `ruff`: `F821 Undefined name \`FooId\`` at `app/http/bar_routes.py:64:33`; `mypy`: `Name "FooId" is not defined [name-defined]`. `compileall` → `COMPILEALL OK`, `import app.main` → `IMPORT OK`. **Also reproduces twice on `eval/matrix/be-python.ddd`** (`invoice_routes.py:106` → `WorkOrderId`, `CustomerId`) — the same tree the F-034 probe booted. |
| **F-026 (python half)** workflow calls a `private` aggregate `function` | **LIVE** | **UNCLAIMED** | `mypy`: `app/http/workflows_routes.py:41: error: "Tech" has no attribute "has_skill"; maybe "_has_skill"? [attr-defined]`. `compileall` OK, `import app.main` OK, **`ruff check` → `All checks passed!`**. Also live on the matrix model (`workflows_routes.py:57`, `"Technician" has no attribute "has_skill"`). |
| **F-034a** `"quantity": 2` (node) vs `2.0` (python) | **LIVE but NOT A DEFECT — already adjudicated** | n/a | Reproduces (`quantity=float(row.quantity)`, `work_order_repository.py:223`), but the wire-differential gate **deliberately** tolerates it. See §2 below — this finding should be withdrawn. |
| **F-034b** python returns pydantic's raw message instead of Loom's derived text | **LIVE** | **UNCLAIMED** (no mission, no RS rule) | Emitter: `customer_routes.py:50` → `billingEmail: WireStr = Field(pattern=r"^[^@]+@[^@]+\.[^@]+$")` vs node `customer.routes.ts:14` → `.regex(/…/, { message: "Billing Email is not in the expected format" })`. Pydantic's default confirmed live: `('billingEmail',) | String should match pattern '^[^@]+@[^@]+\.[^@]+$'`. |

**Claim check details.** #2901 (nested VO → python phantom column), #2907 (Wave C2 draft), #2862/#2864/#2865/#2861 (defect logs) — none claims any of these. `search_issues` for F821 → `total_count: 0`. **#2881 is the closest prior art and is the same defect class in a different file**: it fixed `src/generator/python/repository-builder.ts` so a VO-reached id brand gets imported (`ruff F821 Undefined name`, four times). It does **not** touch `routes-builder.ts`, and its own follow-up note names the right durable shape — *"One neutral `idTargetsOf(type)` in `src/ir/util/` is the right home"*. Note also that #2881's body says *"wave 0's unresolved-symbol gate (**M-T9.59**) has not landed"* — **that is a misattribution**: M-T9.59 is the `*-unsupported` suffix-register entry hole (`docs/new-plan/T9-toolchain-health.md:757`). **There is no unresolved-symbol gate mission anywhere in `docs/new-plan/`.** F-027's plan below is that missing mission.

**Coordination:** #2907 packet **2e** fences `src/generator/python/**`. It claims different rows (pairwise F12/F13/F15, Schemathesis F17 residue, M-T5.14, G2646) but the file fence overlaps `routes-builder.ts`. Land F-027 before batch 1 folds, or hand it to 2e.

---

# 2. F-034a — withdraw it

`test/_helpers/wire-record.ts:352` already rules on exactly this, in prose:

> *What neither rule fires on is the cosmetic case: python renders a float64 as `10.0` where V8 renders `10`, and .NET/java render a `NUMERIC(19,4)` column as `12.5000`. Same value, well inside float64's width, and no client can tell after parsing. Those produced 23 divergences per python run on the first cut of this field — a bill payable only in permanent waivers, since neither backend is wrong.*

And the upstream `float` hydration is equally deliberate (`src/generator/python/numeric-codec.ts:31`): *"`numeric` hydrates lossy through Python `float` by design — money exists precisely for the case that can't afford this (mirrors the TS hydration split)."* The TS codec says the same at `typescript/numeric-codec.ts:40`, so node and python have **identical precision**; only the JSON spelling differs. No golden in `test/behavioral/wire-golden/` carries a `numberFormats` key, confirming the tolerance is active and intended. **No fix plan. The finding as filed is wrong.**

---

# 3. Fix plans (LIVE + UNCLAIMED)

## F-027 — cross-context `X id` un-imported in a python route

**Root cause.** `src/generator/python/routes-builder.ts:269-274`:

```ts
const idNames = [
  ...ctx.aggregates.map((a) => `${a.name}Id`),
  ...extraIdNames.map((n) => `${n}Id`),
]
  .filter((n, i, arr) => refersTo(n) && arr.indexOf(n) === i)
  .sort();
```

The candidate pool is built on the wrong axis. `ctx` is the **per-context** IR (`index.ts:733 for (const ctx of args.contexts)`), so `ctx.aggregates` for context B is `[Bar]`; `extraIdNames` is `foreignIdNames`, which by construction holds only brands the deployable **does not host** (`index.ts:532`, `foreignIdBrandNames(hostedIdNames, …)`). An id that is hosted by the deployable but declared in a **different context** falls in the hole between the two sets. The aggregate and repository emitters get this right because they derive from *field types* (`emit/aggregate.ts:213 types.idNames`, `repository-builder.ts:348 idFieldTarget`), not from a name list.

The emitter's own comment shows this is a **repeat**: *"The old `agg.name + agg.fields` set missed those … → NameError at runtime (found by the python behavioral tier)"*. That prior fix widened the pool from *fields* to *context aggregates* — one axis short.

**Concrete change** (`src/generator/python/index.ts`, ~line 532 and 795): the pool should be exactly the set `renderPyIds` *declares* in `app/domain/ids.py` — derive it once and thread it:

```ts
const foreignIdNames = foreignIdBrandNames(hostedIdNames, [...]);
// Every brand app/domain/ids.py declares. A routes module may reference any of
// them — an `X id` create/operation param resolves across the deployable's
// contexts, not just its own — so the candidate pool is the DECLARED set, and
// `refersTo` narrows it. Anything narrower has a hole (see M-T?.?? / §104).
const declaredIdNames = [...hostedIdNames, ...foreignIdNames];
out.set("app/domain/ids.py", renderPyIds(merged, foreignIdNames));
…
const routesContent = buildPyRoutesFile(agg, repo, ctx, hasDispatch, declaredIdNames);
```

**Prototyped and verified** (on a copy at `/tmp/agentD/proto`, patched compiled JS — the pristine tree was not touched):

- repro: `bar_routes.py:13` → `from app.domain.ids import BarId, FooId`; sweep clean.
- `eval/matrix/be-python.ddd`: the **only** file that changes across all 189 is `invoice_routes.py:23`, `from app.domain.ids import InvoiceId` → `from app.domain.ids import CustomerId, InvoiceId, WorkOrderId`. After: `ruff` → `All checks passed!`, `mypy` → down from 3 errors to the 1 F-026 error. Every other file byte-identical, so `refersTo` genuinely narrows and no golden moves.

**Test to add — a sweep, not a case** (this is the §104 instruction applied to the namespace the last four instances travelled on):

`test/generator/python/module-symbol-resolution.test.ts`

The existing sweep, `test/generator/python/wire-alias-imports.test.ts`, is the right *shape* but the wrong *scope*: its universe is a hardcoded six-name literal (`const WIRE_ALIASES = ["Int32", "WireNum", "WireInt", "WireStr", "MoneyStr", "UuidStr"]`) over one module (`app.http.wire_models`). F-027's name lives in `app.domain.ids`, so it is outside the sweep by construction. **Extend it by deriving the universe from the emitted tree instead of from a list**:

1. For every emitted `.py`, collect the PascalCase names it **defines** at module level (`^class X`, `^X = NewType(...)`, `^X: … = …`) → `module → {names}`.
2. For every emitted `.py`, collect what it **imports** from any `app.*` module (join parenthesised multi-line imports first — `problem.py` is one).
3. Strip docstrings, string literals and comments; drop import lines; then for every name in the universe not imported and not self-defined, flag a reference matching `(?<![.\w])Name\b(?!\s*=(?!=))` (the lookbehind excludes attribute access, the lookahead excludes kwargs).

This was implemented and measured (`/tmp/agentD/sweep-proto2.mjs`):

| tree | result |
|---|---|
| `be-python.ddd` (189 files, pre-fix) | exactly 2 offenders — `invoice_routes.py → CustomerId`, `→ WorkOrderId` |
| `be-python.ddd` post-fix | `(none)` |
| F-027 repro pre-fix / post-fix | `bar_routes.py → FooId` / `(none)` |
| corpus `inheritance`, `embedded`, `validation-messages`, `domain-services`, `api-call` (both deployables) | `(none)` — **zero false positives** |

Restricting the universe to PascalCase is what makes it noise-free: an earlier cut that included snake_case defs produced ~40 false hits from parameters named `current_user` / `app` / `parent_id`. The names that actually break (`FooId`, `Int32`, `FileRef`, `ThingBaseRow`, `PagedResult`, `DomainError`, `Geo`) are all PascalCase, so the narrowing costs nothing.

**Vacuity guard** (§104's second lesson — the sweep must be shown to *meet* its universe): a second case pinning that the fixture actually produces cross-module references of each namespace, e.g. `expect(referencedNamespaces).toEqual(["app.domain.errors","app.domain.ids","app.domain.value_objects","app.http.wire_models"])`, plus a third, named case pinning `bar_routes.py` carries `FooId` in its `from app.domain.ids import` line — the specific emitter that shipped broken, so a future refactor fails *here* with the reason.

**Corpus fixture** — the second half, and the one that brings the *real* oracle to bear. `ruff` is already wired into `corpus × python` and reports this exact F821; the gate never fired because **no `.ddd` in the corpus has the shape**. Verified by scanning all 371 fixtures for a `X id` whose target aggregate lives in a different `context`: exactly one hit, `api-call.ddd` (`Order` in `Orders`, referenced from `Shipping`) — and its manifest entry puts the two contexts in **separate deployables** (`deployables: ["orders_svc", "shipping_svc"]`), which is the case `extraIdNames` already covers. **The one-deployable / two-context / cross-context-`X id` shape is absent from the corpus entirely.** Add `test/fixtures/corpus/cross-context-id.ddd` + its `manifest.ts` row, declared on all five backends so it enters all five compile tiers from one source.

**Mutation proof.** Copy `src/generator/python/index.ts` aside (`cp`, **never** `git checkout -- <path>` — §84), revert the `declaredIdNames` thread, rebuild, re-run, copy back. Expect:
- `module-symbol-resolution.test.ts` case 1 fails with `app/http/bar_routes.py → FooId (defined in app.domain.ids)`;
- `LOOM_PYTHON_BUILD=1 LOOM_CORPUS_PYTHON_CASE=cross-context-id` fails with `F821 Undefined name \`FooId\``;
- the vacuity case and the corpus-fixture existence case still **pass** under the revert (that asymmetry is what proves the sweep is not passing by construction).

Prove each half separately — §104's fourth lesson found a *second* bug that way.

**Blast radius.** One thread of one argument. Empirically: 1 of 189 files changes on a realistic multi-context model; 0 of 53 on single-context repros; 5 corpus fixtures regenerate byte-identically. No wire golden moves (import lines are not on the wire). No other backend touched. Conflicts only with #2907 packet 2e's fence.

**Effort: S** (fix + fixture), **M** with the sweep test and its vacuity guard.

---

## F-026 (python half) — workflow calls a `private` aggregate method

**Root cause, two halves that disagree.**

- `src/generator/python/emit/aggregate.ts:516` emits every aggregate `function` **unconditionally private**:
  ```ts
  const head = `    def _${snake(fn.name)}(${params.join(", ")}) -> ${renderPyType(fn.returnType)}:`;
  ```
- `src/generator/python/render-expr.ts:518` — the final fall-through of `renderMethodCall` — renders a method call on an **external receiver** with no prefix:
  ```ts
  return `${recv}.${snake(e.member)}(${args.join(", ")})`;
  ```
  producing `t.has_skill(skill)`.

The self-call path is correct (`render-expr.ts:606`, `` `${ctx.thisName}.${ctx.fnPrefix ?? "_"}${snake(e.name)}(…)` `` — comment: *"Helper functions are always emitted as private methods (`def _is_draft`)"*). Only the external-receiver path lost the prefix, and it cannot recover it: **`MethodCallExpr` carries no member-kind or `targetPrivate` flag** (`src/ir/types/loom-ir.ts:3546-3571`), unlike `CallExpr`, which has `targetPrivate` and uses it at `render-expr.ts:616`. The same fall-through correctly serves `j.assign()` (a public operation), so the renderer cannot just prefix everything.

**Severity escalation, which is the python-specific point.** Node emits `private hasSkill(...)` + `t.hasSkill(skill)` → `tsc` TS2341 at build, caught by `ts-build`/corpus before anything ships. Python has **no compile gate that sees it**: `compileall` passes, `import app.main` passes, **`ruff check` → `All checks passed!`**. Only `mypy --strict` reports it — and the generated `Dockerfile` runs `uv sync --no-dev`, so `mypy` is not in the image. The service boots, serves `/ready`, and answers `AttributeError: 'Tech' object has no attribute 'has_skill'` → 500 the first time that workflow is invoked. Same defect, one tier of latency worse.

**Cross-backend ruling is not mine.** `docs/language.md:430` defines `function` as *"Pure helper (expression form); **callable from any expression in the same aggregate**"* — a workflow calling it is out of the documented scope, and yet nothing refuses it (`0 error(s), 0 warning(s)`). So there are two coherent answers, and the node agent owns picking one:

- **(A) Refuse it.** New `loom.*` code in an IR check leaf rejecting a `function` member call whose receiver is outside the declaring aggregate, wording in `src/diagnostics/messages.ts`. Zero emitter change, honest gap, no wire movement. **Effort: S.**
- **(B) Admit it.** Widen the language: stamp the member kind on `MethodCallExpr` at lowering (`src/ir/lower/lower-expr.ts`) — a genuine IR *input*, not derivable from the node alone, so it does not violate "derive, don't stamp" — then have each backend's external-receiver arm honour it. On python that is one line at `render-expr.ts:518`; on node the `private` modifier at the def site has to drop. **Effort: M** (five backends), plus a wire-golden review if any denial path moves.

**Python-local plan, either way.**
- Under (A): add the fixture below and assert the diagnostic.
- Under (B): thread the flag; `render-expr.ts:518` becomes `` `${recv}.${e.targetPrivate ? "_" : ""}${snake(e.member)}(${args.join(", ")})` ``.

**Test to add:** `test/generator/python/workflow-calls-aggregate-function.test.ts` — assert the workflow route's call spelling agrees with the aggregate module's `def` spelling, derived from the emitted source rather than hardcoded (`const defined = /def (_?has_skill)\(/.exec(domain)` → `expect(routes).toContain(\`t.${defined}(\`)`). That phrasing survives whichever ruling lands.

**Corpus fixture:** `test/fixtures/corpus/workflow-calls-function.ddd`. Verified hole: scanning all corpus `.ddd` for a file containing both `workflow ` and `function ` returns **nothing**. Not one fixture in the repo combines the two, on any backend — which is why five compile tiers and seven behavioural legs are all silent. The fixture needs a `test e2e` block that actually **invokes** the workflow, or python stays green (the defect is at request time).

**Mutation proof:** revert by file copy; the generator test fails on the spelling mismatch, and `LOOM_PYTHON_BUILD=1 LOOM_CORPUS_PYTHON_CASE=workflow-calls-function` fails on `mypy`'s `"Tech" has no attribute "has_skill"; maybe "_has_skill"?`. Note explicitly in the PR body that **ruff stays green under the mutation** — that is the finding, not an accident.

**Blast radius:** (A) none on emitters. (B) touches `MethodCallExpr` (an IR type — all five backends recompile) and one arm per backend renderer.

---

## F-034b — python answers pydantic's raw message, not Loom's derived text

**Root cause — a one-sided node improvement, admitted in its own docstring.**

`src/generator/zod-refine.ts:154` derives a human message for every **message-less single-field** rule (`singleFieldMessage`), including `case "regex": return \`${label} is not in the expected format\``. Its docstring (`:141-152`) states the asymmetry outright:

> *This is the NATIVE-CHAIN carrier only, which is **node-local**: each backend's own chain (`FluentValidation`, `Field(min_length=…)`, `validate_length`) carries **that framework's default text**.*

`chainSingleFieldNative` has exactly two consumers, both node (`src/platform/hono/v4/routes-builder.ts:2750`, `src/generator/_frontend/api-module.ts:686`). Python's counterpart, `src/generator/python/emit/wire-constraints.ts:36`, is correct on its own terms and says why:

> *A messaged rule carries author text, so it routes through the `@model_validator` refine carrier (which has a message slot) rather than a native `Field(...)` constraint (whose message is Pydantic's default) — mirroring the .NET/Hono carriers.*

So the emitter is doing what it was designed to do; what changed is that node grew a derived message (for "field-test finding D2") and the other four did not. The observable result is three different user-facing strings for one `.ddd` rule — node `"Billing Email is not in the expected format"`, dotnet `"'Billing Email' is not in the correct format."`, python `"String should match pattern '^[^@]+@[^@]+\\.[^@]+$'"` — of which only python's is both untranslatable **and** pattern-leaking.

**On the regex-disclosure severity.** Downgrade it, but do not dismiss it. FastAPI publishes `Field(pattern=…)` into `/openapi.json` as `pattern`, and zod-openapi does the same for node's `.regex`, so the pattern is already discoverable by any client that reads the spec. What survives is the real problem: **the message is not a Loom string**, so it carries no `msg.<hash>` code, cannot be resolved through the M-T1.11 backend validation catalog, and cannot be localised.

**Concrete change, two halves.**

1. **Shared:** `singleFieldMessage` is language-neutral text — it currently lives inside a browser-JS renderer. Lift it into a neutral home (`src/generator/_i18n/` is the natural one, since the catalog collector already lives there) and export it. `zod-refine.ts` keeps calling it; no node output moves.
2. **Python:** in `createFieldConstraints` (`emit/wire-constraints.ts:29`), stop dropping the message-less single-field rule onto a bare `Field(...)`. Pydantic's `Field()` has **no per-constraint message slot**, so route it through the **same `@model_validator` refine carrier the emitter already uses for messaged rules**, synthesising `singleFieldMessage(field, pattern)` as the text and minting its `msg.<hash>` via `messageCode()` (already imported at `wire-constraints.ts:21`) so the catalog can resolve it. The mechanism exists; only the routing decision changes.

Java/.NET/elixir need the same treatment for full parity — which is what makes this a **cross-backend mission, not a python patch**. Recommend filing it as one, with python as the first slice.

**Test to add:** `test/generator/validation-message-parity.test.ts` (cross-backend, not python-local) — for one model carrying a message-less rule of every `SingleFieldPattern` kind (`min`/`max`/`between`/`len-*`/`regex`), assert each backend's emitted wire validator carries the **same** `singleFieldMessage(...)` string, and that no emitted validator text contains the rule's regex source. Plus the runtime half below.

**Mutation proof:** revert the python routing by file copy → the parity test fails naming the `regex` arm, and the behavioural leg's recorded 422 body reverts to `String should match pattern '…'`, which the golden now forbids.

**Blast radius: large, and it is a deliberate rebaseline.** Every message-less single-field denial on four backends changes text. `wire-golden/validation-messages.json` must be rebaselined with `LOOM_WIRE_UPDATE=1 node run.mjs` and reviewed as the wire-contract change it is. **Effort: L** for all four backends; **M** for the python slice alone.

---

# 4. Why the existing gates did not catch these

This is the most useful part, and it splits cleanly: **for F-027 the right gate exists and the corpus starved it; for F-034b the right gate exists and the fixture never pulls its trigger; for F-026 neither exists.** None of the three is a case of "we need a new kind of test" — all three are a case of the oracle never being handed the shape.

### F-027 — `experience_gathered.md` §104 diagnosed this class exactly, and the fix it chose was scoped one namespace too narrowly

§104's own words apply verbatim: *"`npm test` cannot catch this class, structurally. It compares strings. The question 'does this name resolve in the module that uses it?' is answered by the target language's own toolchain, and that runs one tier up."* Confirmed here: `ruff check` on the generated project reports `F821 Undefined name \`FooId\`` with a caret under the exact call — the **same signature** as §104's `F821 Undefined name \`Int32\``. The oracle is right, is already wired into `corpus × python`, and would have caught this on the first run.

§104's prescription was *"Gate it as a sweep, not as a case"* and *"A sweep needs its own vacuity guard."* Both were honoured — `test/generator/python/wire-alias-imports.test.ts` is a genuine sweep with a genuine vacuity case. But its universe is a six-element literal scoped to one module:

```ts
const WIRE_ALIASES = ["Int32", "WireNum", "WireInt", "WireStr", "MoneyStr", "UuidStr"];
```

`FooId` lives in `app.domain.ids`. It is outside the sweep **by construction** — not by oversight, by scope. The lesson generalises one step further than it was applied: **the sweep must be over the axis the bug travels (a module's symbol resolution), not over the symbol family that happened to break that day.** The python generator assembles `from app.domain.ids import …` at **27** independent sites and dynamic `from app.…` import lines at **111**; a per-namespace literal list cannot keep up with that, and the §104 entry is itself the evidence — its own mutation proof found a *second* un-swept emitter the moment the fixture was extended.

The per-case defence that *was* in place failed the same way for the same reason. `test/generator/python/routes-cross-aggregate-id-import.test.ts` is this bug's ancestor, verbatim in its header: *"the route collector now draws from every context aggregate."* One axis short — it is a single-context fixture, so *"every context aggregate"* looked complete. That is a case, not a sweep, and §104 said so in advance.

And the corpus starved the good gate: **zero fixtures** put two contexts in one python deployable with a cross-context `X id`. The only cross-context reference in 371 fixtures (`api-call.ddd`) splits the contexts across two deployables, landing it in the `extraIdNames` path that already works. One fixture converts a latent runtime 500 into a `ruff` failure on the PR that introduces it.

This is precisely the class #2881 called *"wave 0's unresolved-symbol gate (M-T9.59)"* — **and no such mission exists.** M-T9.59 is the `*-unsupported` suffix register. The recurrence log is long enough to justify minting it: §104 (`Int32`, projections ×2) · #2412 (`mask unless` + `audited`) · #2618/#2652 (resource ops in handler / domainService bodies) · `python-resource-import-coverage.test.ts` (`if-let` branches) · `routes-cross-aggregate-id-import.test.ts` (operation params) · #2787/M-T6.53 (`FileRef`) · M-T1.2 (`FileRef` again) · `pairwise-corpus-findings-2026-08.md:757` (`ThingBaseRow`, `PagedResult`) · M-T1.11 (messaged precondition rendering params bare) · #2881 (VO-reached ids) · and now F-027. **Eleven instances of one sentence: "a python emitter referenced a name it did not import."** The sweep prototyped above runs in the fast tier, needs no python, found all three live instances across two trees, and produced **zero false positives on six generated trees** — it is not a research project.

### F-026 — the only gate that sees it is not in the image, and the corpus has no fixture for the shape at all

The severity is a direct consequence of *which* checker catches it. Node's version is `tsc`-visible, so `ts-build` and `corpus × node` refuse it at build. Python's is neither a syntax error nor an unresolved name: `compileall` OK, `import app.main` OK, **`ruff check` → `All checks passed!`**. `mypy --strict` is the only tool that reports it, it runs only under `LOOM_PYTHON_BUILD=1` (`corpus × python`), and the generated `Dockerfile` installs with `uv sync --no-dev`, so it is absent from the shipped image. **A dynamically-typed target turns a compile error into a production 500, and only the opt-in tier stands between the two.**

Even that tier is unarmed here: **no corpus fixture contains both a `workflow` and a `function`** — verified by scanning every `test/fixtures/corpus/*.ddd`. Five compile tiers and seven behavioural legs have never compiled the shape on any backend. And because the failure is at *request* time, a compile-only fixture is not enough: the fixture needs a `test e2e` block that actually invokes the workflow. This is §105's rule restated — *"If a narrowing is enforced by the framework rather than the compiler, the gate that proves it has to boot something."*

### F-034b — the cross-backend differential is exactly the right gate, is wired into **seven** legs, and has never once been handed a message-less denial

The wire-golden differential (M-T9.11) is built for this: five backends record at their `fetch` chokepoint and diff against a reviewed oracle, with a ratcheting waiver registry whose current contents are `export const WIRE_WAIVERS: readonly WireWaiver[] = [];` — **empty**. A python message diverging from node's is precisely what it is designed to name. It did not, for one reason:

**Across the entire `test/behavioral/wire-golden/` corpus there are exactly three distinct validation messages, and all three are authored:** `"Estimate cannot be negative"`, `"Label needs at least 3 characters"`, `"Restock amount must be at least 1"`. Only three goldens carry a 422 at all (`absent-optional`, `validation-messages`, `wire-contract`). The one fixture built for this — `test/fixtures/corpus/validation-messages.ddd` — is deliberately careful to *compile* both carriers (*"a message-less rule must stay on its native validator chain… so this fixture compiles both paths rather than only the new one"*), and its `test e2e` block *does* deny on the messaged carrier (`expect(api.products.restock(p, { amount: 0 })).toThrow(422)`). But **it never denies on the message-less one**: `ship`'s precondition, `reorderLevel >= 1` and `label.length <= 16` are all exercised on their *admitting* side only. The divergent bytes are never produced, so the differ never sees them. On top of that the fixture carries **no `regex` / `matches` rule at all**, so the worst-spelled arm — the one that echoes the pattern — has no coverage in any tier.

Two lines in one existing fixture close it: a `matches(...)` rule with no `message` clause, and one `expect(...).toThrow(422)` that violates a message-less bound. That converts an invisible four-backend divergence into a five-way diff on the next PR, at zero new CI boot cost, which is exactly the property the differential was built for.

**The pattern across all three.** Not one of these needed a gate that does not exist. F-027's oracle (`ruff`) ships in the corpus tier; F-026's (`mypy`) ships in the same tier; F-034b's (the wire differential) runs on seven legs per PR. All three failed on **reach**, not on power — and in each case the reach is fixed by a fixture, plus (for F-027) generalising a sweep that was already written to the right template but scoped to the wrong axis. §104 got the method right on the first try. What it under-specified, and what the eleven-instance recurrence log now settles, is that the axis to sweep is *"does every name in this module resolve"*, not *"is this particular alias imported"*.