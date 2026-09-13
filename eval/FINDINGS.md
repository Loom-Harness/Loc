# Loom Evaluation — Findings Register

Numbered `F-NNN`, most severe class noted per finding. Severity rubric and
HONEST/SILENT/DOCUMENTED classification per the evaluation contract.

---

### F-001 — README's flagship "Quick example" does not parse or validate verbatim
Severity: S2 (major — headline claim materially untrue on the very first thing a newcomer runs)
Class: DOCUMENTED-adjacent but effectively SILENT for a newcomer (no version note, no "illustrative, not runnable" caveat)
Area: docs / onboarding / README.md
Claim under test: README.md "Quick example" section — presented as "A complete `.ddd` source" that `ddd generate system acme.ddd -o ./out` turns into a running stack on ports 3000/8080/4000/3001.

Repro:
  1. `eval/repro/readme-quickstart.ddd` — the README's code block, copy-pasted verbatim (byte-for-byte from README.md lines 61-142).
  2. `node bin/cli.js parse eval/repro/readme-quickstart.ddd`

Observed (first error): `error: Expecting token of type '}' but found 'module'.` at line 2 — repository grinds to a halt immediately on the second line.

Root causes found by iterating (each is a separate defect in the doc, not one typo):
  1. `module Sales { ... }` — **`module` is not a grammar keyword at all** (`grep -n "'module'" src/language/ddd.langium` — zero hits). The real top-level grouping keyword is `subdomain` (confirmed via `examples/acme.ddd`, the project's own "full system mode" example).
  2. `deployable api { platform: node, modules: Sales, Catalog, port: 3000 }` — `modules:` is not a `Deployable` field; the grammar (`ddd.langium:289`) only has `contexts: [Orders, Products]` (bracketed context-name list, not subdomain names).
  3. `aggregate Product { sku: string, price: Money }` — inline comma-separated member lists are rejected (`Expecting token of type '}' but found ','`); members must be newline-separated. No example anywhere in `examples/` uses the comma form the README uses.
  4. `Money(lines.sum(...), "USD")` — rejected with `error: v2 syntax: construct 'Money' with builder-call form 'Money { ... }', not 'Money(...)'`. The positional-constructor call form the README uses was apparently removed in a "v2" language revision; the diagnostic is at least honest and named, but the README was never updated.
  5. `expect read.status == "Confirmed"` (bare-expression form) — rejected: `'expect' requires a matcher — write 'expect(<actual>).toBe(<expected>)'`. Two occurrences in the same 6-line test block.
  6. `deployable webApp { platform: react, targets: api, design: shadcn, port: 3001 }` — rejected: `React deployable 'webApp' must declare a 'ui:' binding`. The README's frontend deployable has no `ui:` clause at all.
  7. Even after fixing 1-6 (0 parse errors), `ddd parse` (which also runs the IR validator) still reports 7 more errors: no `storage`/`dataSource` declared for either backend deployable (`loom.persistence-mode-unsupported`, ×2 aggregates ×3 backend deployables = 6 errors), and a `ui-id-ref-no-display` error because `Product` has no `derived display` field for the id-picker `Product id` reference in `OrderLine`.
  8. The e2e test block also calls `api.orders.addLine(...)` — **an operation the README's own `Order` aggregate never declares.** `ddd parse` reports `loom.e2e-unknown-method ... Available: create, getById, confirm, all, byCustomer` — the method the whole test hinges on (adding a line before `confirm()` can pass its `lines.count > 0` precondition) does not exist in the model as written.

Expected: the single code block presented as "a complete `.ddd` source" in the project's landing page compiles clean with `ddd parse`, since that's the exact reproduction a first-time evaluator will do in the first 60 seconds.
Workaround: none from docs; required reverse-engineering the correct syntax from `examples/acme.ddd` and `web/src/examples/inheritance-system.ddd`, plus reading the grammar (`ddd.langium`) directly for the `Deployable` and `Platform` rules.
Time lost: ~35 minutes (from first `parse` failure to a 0-error, fully-valid file — see EVAL-LOG.md 09:2x-10:0x entries).
Impact on adoption: this is not a papercut — it is the literal first interaction the product offers, on its own landing page, under the tagline "the speed of no-code." A prospective adopter's technical evaluator hits 8 distinct, unrelated defects (a removed keyword, a removed field, an unsupported literal-list style, a removed constructor form, a removed assertion form, a missing required clause, missing infrastructure wiring, and a call to an undeclared method) before anything runs. Each individually is a 2-minute fix once you know the real grammar; in aggregate, on the first document a stranger reads, it reads as "nobody re-ran this after the last few language versions" — a credibility problem independent of the underlying tool's quality. It also means the project's own `docs:*` / example CI matrix does **not** cover README.md's code block (see coverage note below).

Note: this is a documentation-freshness finding, not a defect in the compiler — every rejection above came with a comprehensible diagnostic (several excellent: e.g. the `Money` v2-syntax error names the exact fix). Classified S2 rather than S1 because nothing was silently wrong; the tool refused correctly every time. But it directly undercuts the "speed of no-code" headline claim for the outsider path this evaluation's Phase 0 is built to measure.

---

### F-002 — Error-message quality is a genuine strength (positive finding)
Severity: N/A (positive) Class: HONEST (every case)
Area: language / validators — general
Claim under test: none specific; recorded because Phase 6 explicitly calls for hunting silent failures/crashes, and none were found in this batch.

Repro: 10 deliberately broken `.ddd` files in `eval/repro/adversarial/01`..`10`, one
mistake each — typo'd scalar type, repository find over a nonexistent field,
wrong function arity, a bare cross-aggregate type reference (should be `X id`),
cyclic containment, duplicate aggregate name in one context, an invariant over
an unknown field, an assignment to a nonexistent enum member, a UI page's
`QueryView` bound to a nonexistent aggregate, and two calls to nonexistent
`decimal` methods.
Run: `node bin/cli.js parse eval/repro/adversarial/<n>.ddd` for each.

Observed: **all 10/10 failed cleanly with a diagnostic** — zero crashes, zero
stack traces, zero silent passes. Every message names the exact rule/line/
column and, in most cases, the fix:
  - `Function 'scaled' expects 1 argument, got 2.` (exact arity mismatch)
  - `References across aggregate boundaries need an id link — write 'Owner id' (or 'Owner id[]' for many-to-many).` (names the fix verbatim)
  - `Duplicate declaration 'Widget' in context 'Widgets'; ... (the later one silently replaces the first).` — notably self-documents its own resolution/shadowing behavior in the same message, which is more honest than most compilers bother to be about a duplicate-name edge case.
  - `'decimal' has no intrinsic '.matches()' — available: abs, min, max, round, floor, ceil.` — enumerates the actual stdlib surface instead of a bare "unknown method."
  - The wrong-aggregate UI page case surfaced two independently-diagnosed problems in one pass (`Aggregate 'Gadget' not found in api 'SalesApi'` and a `ui:` binding-shape error), both correctly scoped.
Expected: exactly this. No corrective action needed.
Impact on adoption: positive signal for the "could a newcomer self-serve from diagnostics" question central to Phase 6 — worth weighing against F-001, which shows the docs/model corpus is not kept as tightly in sync as the validator's own message text is.
Time lost: 20 min to write + run all 10.
Sample size caveat: 10 hand-picked common mistakes, one file each, checked at
`ddd parse` (AST + IR validation) only — not against every one of the ~17
themed IR-validator leaf modules, and not against codegen-time diagnostics
(a defect only caught during a specific backend's emission). Do not read this
as "all diagnostics in Loom are this good" — it is a sample, stated as one.

---

### F-003 — A natural "parent has many children" containment cannot also be a cross-aggregate reference target (expressed awkwardly)
Severity: S3 (friction — forces a real modeling compromise, not a syntax nit)
Class: HONEST gap (clear diagnostic; no crash)
Area: language / aggregates, entities/parts, cross-aggregate references
Claim under test: none specific — this is a Phase 1 expressiveness finding for FieldOps's `Customer → Site → Asset` hierarchy (spec: "a customer has many sites... equipment at a site").

Repro: `eval/fieldops/main.ddd` (early revision, preserved via git history in
this eval branch) — `Customer` aggregate `contains sites: Site[]` with `Site`
declared as an `entity` nested inside `Customer` (the natural containment
reading of "customer has many sites"); `Asset` aggregate then wants
`siteId: Site id` to say which site the equipment lives at.
Run: `node bin/cli.js parse eval/fieldops/main.ddd`

Observed: `loom.ui-id-ref-unknown-aggregate ... 'Asset.siteId' references Site id, but no aggregate 'Site' is declared in the system.` An entity/part nested inside one aggregate is invisible to `X id` references from a *different* aggregate — only aggregate roots are valid cross-aggregate reference targets. This is consistent with the language's own stated rule that cross-aggregate links require an aggregate-level `X id`, but it means the obvious containment shape for this domain (`Customer` owns `Site`s as parts, the way `Order` owns `OrderLine`s) cannot simultaneously be the thing `Asset` points at.
Expected / workaround taken: promoted `Site` to its own top-level aggregate (`aggregate Site with crudish { customerId: Customer id, ... }`), i.e. an explicit foreign-key-style back-reference instead of true containment. This is not a cosmetic rename — it changes the domain shape: `Site` now needs its own repository, its own CRUD surface, and its own lifecycle instead of living and dying with its `Customer`; deleting a `Customer` no longer cascades structurally, it has to be re-derived as an explicit rule.
Impact on adoption: **any domain with a "parent owns children, and a third aggregate needs to point at one of those children" shape hits this** — not exotic; FieldOps needed it on the very first two aggregates modeled (`Customer`→`Site`←`Asset`). A team modeling anything with a shared sub-entity referenced from elsewhere (addresses, line items reused by a report, locations referenced by equipment as here) will hit this immediately and must decide, per model, whether the entity is "owned and private" (part) or "referenceable" (its own aggregate) — the DSL doesn't let a construct be both, and picking wrong costs a re-model once the second aggregate needs to reference it.
Time lost: 15 min (diagnostic pointed straight at the problem; the 15 min was deciding the modeling fix, not debugging).

---

### F-004 — `with crudish` and `auth { enforcement: denyByDefault }` do not compose: every crudish-generated create/update/destroy becomes an unfixable compile error
Severity: S2 (major — makes the documented "recommended posture" incompatible with the documented terseness macro, on the very construct `ddd new`'s own scaffold ships)
Class: HONEST gap (crisp diagnostic; no crash) but **undocumented interaction** — neither `docs/auth.md` nor `docs/scaffold-macros.md` mentions it, and no file under `examples/` or `web/src/examples/` demonstrates the two features together.
Area: language / macros (`crudish`) × auth (`denyByDefault`)
Claim under test: `docs/auth.md` line 26-30: *"Deny-by-default is the recommended posture for anything security-sensitive, and `ddd new`'s scaffold points at it."* Separately, `crudish` is presented (scaffold-macros.md, README) as the terse way to get CRUD create/update/destroy for free.

Repro: `eval/repro/crudish-denybydefault.ddd` — a single `aggregate Widget with crudish { name: string }`, `auth { enforcement: denyByDefault, oidc {...} }`, `user { id: string, role: string }`, deployable `auth: required`.
Run: `node bin/cli.js parse eval/repro/crudish-denybydefault.ddd`

Observed:
```
loom.default-deny-ungated Widget/update: ... declares no `requires` gate ...
loom.default-deny-ungated Widget/create: ... declares no `requires` gate ...
loom.default-deny-ungated Widget/destroy: ... declares no `requires` gate ...
```
`crudish`'s only documented/implemented parameter is `updateOnly` (confirmed by reading `src/macros/stdlib/crudish.macro.ts` — no `requires`-shaped argument exists), so there is **no way to attach a `requires` gate to a crudish-generated operation from the macro call site.** The only escape is dropping `crudish` for that aggregate and hand-writing `create`/`update`/`destroy` as explicit operations so each can carry its own `requires` — which defeats the terseness `crudish` exists for, on every aggregate a team wants both patterns for (which, under a "recommended posture," is presumably most of them).
Corroborating evidence this is a real, unnoticed gap rather than a deliberate constraint: `ddd new`'s own `crud` template (`eval/phase0app/main.ddd`, generated by `node bin/cli.js new ... --template crud`) ships a commented-out `auth { enforcement: denyByDefault ... }` block directly above a `with crudish` aggregate, with no comment warning that uncommenting it (plus adding the `user {}` block and `auth: required` the comment also doesn't mention) will not compile. A newcomer following the scaffold's own inline guidance toward "the recommended posture" hits this wall on the first aggregate.
Expected: either `crudish` accepts a `requires` argument (e.g. `with crudish(requires: currentUser.role == "admin")`) applied to the generated create/update/destroy, or the `denyByDefault` diagnostic/docs explicitly call out the interaction and the required workaround.
Workaround: unfold `crudish` to explicit operations for any aggregate that must run under `denyByDefault` — costs the generated-source terseness for that aggregate permanently (every future field/behavior change to that aggregate's CRUD now edits hand-written operations instead of getting them for free from one `with crudish`).
Impact on adoption: FieldOps's spec calls for `denyByDefault`-style role/tenancy enforcement across roughly a dozen tenant-owned aggregates — under today's toolchain, every one of them either loses `crudish` or stays on `enforcement: opt` (this evaluation's FieldOps model uses `opt` for this reason, documented in `eval/fieldops/main.ddd`'s header comment). For a team that took the docs' "recommended posture" claim at face value while planning around `crudish`'s terseness claim, this is a real rework cost discovered only once both features are combined — which nothing in the docs warns you not to do.
Time lost: 40 min (most of it re-deriving that `auth: required` on the deployable, not just the system-level `auth {}` block, is what actually activates the check — the scaffold's own comment doesn't mention that dependency either).

---

### F-005 — A repository `find` used for row-level "my own records" access must be against a flat scalar column; it cannot do the cross-aggregate lookup the natural model needs, so the FK must be denormalized
Severity: S3 (friction — forces a deliberate, correct-but-extra design step; not a blocker)
Class: HONEST gap (specific, well-worded diagnostic naming exactly what's allowed)
Area: language / repository finds, IR "queryable where" restriction
Claim under test: none specific — Phase 1 "row-level rules: a technician sees only their own work orders" requirement.

Repro: `eval/fieldops/main.ddd`, `WorkOrders.mine()`. First attempt:
`find mine(): WorkOrder[] where this.technicianId != null && Technicians.getById(this.technicianId).userId == currentUser.id`
Run: `node bin/cli.js parse eval/fieldops/main.ddd`
Observed: `loom.find-where-not-queryable ... where-clause is not queryable (member access not rooted at 'this' or beyond a flattened value object). Allowed: comparisons, &&/||/!, parens, 'this.<column>' / 'this.<vo>.<sub>' refs, parameter refs, literals.` — a repository `find`'s `where` must translate to a single-table SQL predicate; it cannot join out to another aggregate's table, which is architecturally sound (repository finds are meant to compile to one indexed query) but means the "technician's own records" row-level rule cannot be expressed against the natural typed relation (`WorkOrder.technicianId: Technician id` → `Technician.userId`).
Workaround taken: denormalized — added `technicianUserId: string?` directly onto `WorkOrder`, written by `WorkOrder.schedule(...)` at assignment time (`technicianUserId := Technicians.getById(assignTo).userId`), and rewrote the find as `where this.technicianUserId == currentUser.id`. This is standard practice for read-path performance in hand-written systems too, so it's not unreasonable — but it is one more field + one more write-time responsibility the author must remember to keep in sync by hand; the compiler does not offer a "materialize this join for query purposes" affordance, you write the denormalization yourself.
Positive note in the same pass: once the find became queryable, `ddd parse` proactively suggested `index: WorkOrder.technicianUserId` on the backing resource — a genuinely useful, unprompted piece of DX (`Dispatch/WorkOrder: 'WorkOrder.technicianUserId' is read on a query filter but has no index.`).
Impact on adoption: any row-level-security rule keyed off a related aggregate (not the aggregate's own scalar fields) needs this same manual-denormalization step. For a domain with many role-scoped views (FieldOps has at least two: technician-owns, customer/tenant-owns), that's a repeatable but non-automatic tax; a team that doesn't know the rule up front will hit the same `loom.find-where-not-queryable` wall Phase 1 did here.
Time lost: 15 min.

---

### F-006 — `docs/workflow.md`'s own headline `.ddd` example does not parse on current grammar (second confirmed stale-docs instance)
Severity: S2 (major — a per-feature reference doc's only code example is wrong)
Class: DOCUMENTED-but-effectively-SILENT-for-the-reader (same shape as F-001: no version caveat, confidently presented as current syntax)
Area: docs / `docs/workflow.md`
Claim under test: `docs/workflow.md`'s worked example, presented as plain fact with no caveat.

Repro: copied `docs/workflow.md`'s own example verbatim to `/tmp/wf-test.ddd` (flat `workflow placeOrder(customerId: Customer id, placedAt: datetime) { let customer = ...; let order = Order.create({...}); emit OrderPlaced {...} }` form, and a `workflow transferCredit(...) transactional { ... }` variant).
Run: `node bin/cli.js parse /tmp/wf-test.ddd`
Observed: `error: Expecting token of type '{' but found '('.` — the flat `workflow name(params) { <statements> }` form the doc teaches as the ENTIRE workflow surface does not parse at all. Reading the grammar directly (`src/language/ddd.langium:1428-1448`, the `Workflow` rule) shows why, in the grammar's own comment: *"The workflow body is MEMBERS-ONLY — no free statements, no header params."* The language moved to a `create(...)`/`handle(...)` member-based form (confirmed working against real fixtures — `web/src/examples/storefront-system.ddd`, `docs/channels.md`) at some point, and `docs/workflow.md` was never updated to match — every example in the doc, including the "Body vocabulary" table's own referenced snippet, teaches syntax that no longer exists.
Expected: the doc's only example parses.
Workaround: none from the doc; the correct member-based form had to be reconstructed from real `.ddd` fixtures (`web/src/examples/storefront-system.ddd`) and the grammar file's own comments.
Impact on adoption: this is `docs/workflow.md` in its entirety — not one stale paragraph, the whole page teaches an obsolete workflow syntax with no alternative shown anywhere in the doc. Anyone (human or LLM) authoring a workflow from this doc alone writes a file that won't parse, with the doc offering no hint why. Combined with F-001, this makes two of the handful of docs an evaluator actually reads in the first hour both wrong on their primary code sample — a doc-freshness pattern, not one typo.
Time lost: 20 min.

---

### F-007 — Cross-context repository access from inside a `workflow` is restricted, but the restriction is enforced INCONSISTENTLY: sometimes a misleading diagnostic, sometimes nothing at all
Severity: **S1 (upgraded from S2 after the confirmation below — this is sometimes a straightforward SILENT gap, not just a bad error message)**
Class: split — HONEST-but-misleading in one code path, **SILENT** in another (see the two confirmed variants below)
Area: `src/ir/validate/checks/workflow-checks.ts` (`reposByName` built from `ctx.repositories`, i.e. same-context only) × TypeScript workflow codegen's separate repository-injection pass
Claim under test: none specific — a structural finding about the one sanctioned cross-aggregate-orchestration construct.

**Variant A — misleading diagnostic** (originally found in `eval/fieldops/main.ddd` when `Part` lived in a separate `Inventory` context from the `Dispatch` workflow that needed it): `node bin/cli.js parse` on `eval/repro/workflow-cross-context.ddd` gives `loom.workflow-unknown-binding Dispatch/consume: workflow 'consume': 'part.decrement(...)' references unknown let-binding 'part', or 'part' isn't bound to an aggregate.` — a real, if confusing, diagnostic. Root cause confirmed by reading `workflow-checks.ts:454` (`const reposByName = new Map(ctx.repositories...)`, current-context only) plus the observation that the *op-call* validator (not the repo-let validator) is the one that fires — meaning the `let part = Parts.getById(...)` statement itself lowers without complaint (or without being recognized as a `repo-let` at all), and only the *later use* of `part` is flagged, misattributing the problem to the wrong line with a message that reads like a typo'd variable name.

**Variant B — fully silent** (found while fixing FieldOps's `scheduleWorkOrder` workflow, which reads `Technician` — declared in the `Directory` context — from a workflow living in `Dispatch`): confirmed with a fresh 26-line minimal repro (`eval/repro/workflow-cross-context-silent.ddd`, structurally identical to Variant A but reduced further) — **zero errors from `ddd parse`**, **zero errors from `ddd generate system`**, and the emitted `http/workflows.ts` contains `const tech = Technicians.getById(assignTo);` with **no `TechnicianRepository` ever constructed and no `await`** — i.e. exactly F-010's shape (undefined name in generated code), but triggered by cross-context access rather than an inline expression. `npx tsc --noEmit` on this output fails with `Cannot find name 'Technicians'`.

The through-line: **the same restriction (a workflow may only read repositories declared in its own context) manifests three different ways depending on incidental syntax** — sometimes a clear-if-misdirected diagnostic (Variant A), sometimes total silence with broken output (Variant B), and (per F-010) an inline vs. `let`-bound call form changes which repositories get injected at all. None of these is the outcome a user should get: either cross-context workflow reads are meant to be supported (and the injection logic has a real bug) or they aren't (and every one of these should be a single, consistent, clearly-worded `loom.*` diagnostic pointing at the `let`/call that reaches across a context boundary).
Workaround: keep every aggregate a workflow needs to read via `Repo.getById(...)` in the SAME context as the workflow itself. This evaluation's FieldOps model relocated `Part` into `Dispatch` (documented inline in `eval/fieldops/main.ddd`) specifically to route around this; `Technician` could not be similarly relocated without breaking the `Directory` subdomain's own structure, so `scheduleWorkOrder`'s cross-context read to `Technicians` remains in the model as a known-broken path, not exercised in the final generated build.
Impact on adoption: a bounded-context-per-module domain (which is precisely what `docs/architecture.md`'s `subdomain`/`context` layering is FOR) will routinely need a workflow in one context to read an aggregate owned by another — FieldOps needed this on its second workflow. Today that either silently breaks the build or produces a diagnostic that sends the author looking in the wrong place.
Time lost: 90 min across both variants (this is the single most expensive investigation in this evaluation; see EVAL-LOG.md for the reduction trail).

---

### F-008 — A cross-aggregate repository call inside a plain `operation` body passes `ddd parse` / `ddd generate system` with ZERO diagnostics, then emits TypeScript that does not compile
Severity: **S1 (blocker — silently wrong generated output; exit code 0 on a construct the compiler should refuse)**
Class: **SILENT gap** — this is the flagship class rule 3 asks this evaluation to hunt for.
Area: language/IR validation (expression type-checking) × TypeScript codegen (`src/generator/typescript`) — a validator/codegen contract gap
Claim under test: README "Zero drift between layers" / "validated before emission" ("LLM-safe by construction... Validation gates catch hallucinated fields and out-of-scope references before any code is emitted").

Repro: `eval/repro/operation-cross-aggregate-repo-call.ddd` (28 lines) — a `Job` aggregate's `operation assign(assignTo: Technician id)` calls `Technicians.getById(assignTo).skills.contains(requiredSkill)` directly in a `precondition`, exactly the way a `workflow` body is documented to call a repository (`docs/workflow.md`'s `let x = Repo.getById(id)` form) — except this is a plain single-aggregate `operation`, which architecturally has no repository access (only workflows load other aggregates; operations are supposed to be pure single-aggregate state transitions per `docs/technical.md`'s own description of the layering).
Run:
  1. `node bin/cli.js parse eval/repro/operation-cross-aggregate-repo-call.ddd` → **`0 error(s), 0 warning(s)` — OK.**
  2. `node bin/cli.js generate system eval/repro/operation-cross-aggregate-repo-call.ddd -o /tmp/repro-out` → **`0 error(s), 0 warning(s)`, "Wrote 45 file(s)", exit 0.**
  3. `cd /tmp/repro-out/api && npm install && npx tsc --noEmit` → **`domain/job.ts(33,11): error TS2304: Cannot find name 'Technicians'.`**

Observed: the emitted `domain/job.ts` method is:
```ts
public assign(assignTo: Ids.TechnicianId): void {
  if (!(Technicians.getById(assignTo).skills.includes(requiredSkill))) throw new DomainError(...);
  this._technicianId = assignTo;
}
```
`Technicians` is never imported, injected, or defined anywhere in this file — the emitter transliterated the expression verbatim, as it correctly would for a *workflow* body (where the repository genuinely is in scope as an injected dependency), without checking whether the surrounding construct is a `workflow` (repository access legal) or an aggregate `operation` (repository access architecturally impossible — an aggregate's domain methods are pure, constructed from already-loaded state).
The IR/AST validator's expression type-checker resolved `Technicians` as a known repository name and `.skills`/`.contains(...)` as valid members of its element type — i.e., it happily type-checks a `Repo.method(...)` call inside an `operation` body as if it were legal, because nothing in the themed validator set (`src/ir/validate/checks/`) specifically rejects a repository reference reached from inside a plain-operation scope. The actual layering rule ("only workflows may reference repositories; operations may not") exists and is enforced **only in the workflow-specific checks** (`workflow-checks.ts`'s `reposByName` restricted to same-context, per F-007) — it is never checked for the *other* direction, an operation trying to do what only a workflow may do.
Reproduced in FieldOps itself first (`eval/fieldops/main.ddd`'s original `WorkOrder.schedule()` operation, which needed exactly this cross-aggregate skill-check) before being reduced to the 28-line repro above — this was not a contrived edge case, it is the natural way an author reaches for "check something on a related aggregate before mutating this one" the first time they need it inside an `operation`. Reading `src/generator/_expr/target.ts` directly (to classify this symptom, not to fix it) confirms all five domain-logic backends (TS/.NET/Phoenix/Python/Java) render the same fully-resolved `ExprIR` through one shared 17-arm dispatcher (`renderExprWith`); a per-backend leaf table only supplies operator/naming/call-syntax differences, none of which distinguish "this expression sits inside an operation" from "this expression sits inside a workflow." So this is very likely not TypeScript/Hono-specific. Spot-checked the .NET backend on the same repro (`generate system` targeting `platform: dotnet`): `Domain/Jobs/Job.cs:37` emits `if (!(Technicians.GetById(assignTo).Skills.Contains(...)))` inside the pure domain class with no `Technicians` binding anywhere in scope — the identical undefined-reference defect, in C# this time (a `dotnet build` was not run to confirm the exact compiler error text, but `Technicians` is a Domain-layer type with no static members and no import in this file, so a CS0103 "does not exist in the current context" is a near-certainty). Not re-checked against Phoenix/Python/Java in this pass — flagged for a fuller platform sweep (see Phase 3 coverage caveats).
Expected: `ddd parse` / IR validation refuses this with a clear diagnostic (e.g. `loom.operation-repository-access-forbidden`) naming exactly why — the same quality bar as `loom.workflow-unknown-repository` on the workflow side — rather than accepting it and letting a downstream compiler catch the mistake as an undefined-name error with no `.ddd` line reference at all.
Workaround: rewrite the check as a `workflow` (matching the spec's own naming for this exact scenario — a `scheduleWorkOrder` workflow spanning `WorkOrder` + `Technician` + `Asset`, transactional) instead of an aggregate `operation`. This is the architecturally correct fix and is what this evaluation's FieldOps model was changed to use — but nothing in the compiler told me to make that change; a TypeScript compiler error in generated code (with zero connection back to the `.ddd` source, no sourcemap involved since this was a plain `tsc` build) was the only signal, and it took directly reading the generated `domain/workOrder.base.ts` to understand why "Technicians" was undefined.
Impact on adoption: this is close to a worst case for the "the model is the source of truth, validated before emission" claim: a plausible, common authoring mistake (reaching for a cross-aggregate check inside the wrong construct) produces a project that LOOKS like it built successfully — `Wrote N files`, exit code 0, no warnings — and only fails when a human or CI happens to run `tsc` (or worse, when idiomatically-thin CI just re-runs `ddd generate` and calls it done, since nothing in the CLI's own exit code signals a problem). A team that trusts `ddd generate`'s exit code as "the model is valid" — which the tool's own UX strongly invites — ships broken projects.
Time lost: 55 min (from first `tsc` failure to a confirmed, minimized, root-caused repro plus the FieldOps-side fix).

---

### F-009 — `api.workflows.<name>(...)` in an e2e test against a backend deployable crashes `ddd generate system` with a raw stack trace, not a diagnostic
Severity: S2 (major — Phase 6 explicitly flags any crash-where-a-diagnostic-belongs as a finding every time; contained to codegen, not runtime, so not S1)
Class: **the "crash instead of diagnostic" class named explicitly in this evaluation's rules — worse than a SILENT gap in one respect: it doesn't even produce a project, so the honesty question is moot, but the *quality* of the refusal is exactly what rule 3/Phase 6 grades.**
Area: `src/system/e2e-render.ts` (uncaught `throw new Error(...)`, not a `LoomDiagnostic`)
Claim under test: none specific to this construct, but generally undercuts "validated before emission" / "LLM-safe by construction" — an LLM (or a human) authoring an e2e test from the `workflow.md` doc's own description of workflows getting `POST /workflows/<name>` routes has no way to know `.workflows.` e2e sugar doesn't extend to backend deployables until a raw JS stack trace tells them so.

Repro: `eval/repro/e2e-workflow-against-backend-crash.ddd` (27 lines) — a `Widget` aggregate, a trivial `workflow rename`, and `test e2e "rename via workflow" against api { api.workflows.rename({...}) }`.
Run:
  1. `node bin/cli.js parse eval/repro/e2e-workflow-against-backend-crash.ddd` → **`0 error(s), 0 warning(s)` — OK.**
  2. `node bin/cli.js generate system eval/repro/e2e-workflow-against-backend-crash.ddd -o /tmp/repro-e2e` → **uncaught exception:**
```
Error: e2e: unknown aggregate 'api.workflows' on this deployable. Available aggregates: widgets.
    at renderApiCall (.../out/system/e2e-render.js:612:15)
    at renderE2EExpr (.../out/system/e2e-render.js:350:16)
    ...8 more stack frames...
```
Observed: this is a plain `throw new Error(...)` (message text has no `loom.*` code, and the CLI does not catch it into a formatted diagnostic — the raw Node stack trace reaches the terminal). `ddd parse` gave this construct a clean bill of health; only the codegen pass, deep inside e2e-test rendering, discovers the call target doesn't resolve, and reports it as a crash rather than surfacing `loom.e2e-unknown-method`-style diagnostic (which the compiler clearly has and uses elsewhere — e.g. F-001's `loom.e2e-unknown-method Acme/create and confirm an order: e2e: unknown method 'api.orders.addLine'. Available: create, getById, confirm, all, byCustomer.` from Phase 0 used exactly this well-formed shape for an unknown *method*; this is the same situation one level up — unknown *namespace* — that fell through to a bare exception instead).
Also notable: it is unclear from any example in `examples/` or `web/src/examples/` whether `.workflows.` e2e sugar against a **backend** deployable is even meant to be supported — every real usage in the corpus is `ui.workflows.X(...)` against a **UI** deployable, even though `docs/workflow.md` documents a genuine `POST /workflows/<name>` HTTP route on the backend itself. If it's unsupported by design, the crash should be a named diagnostic saying so; if it's meant to work, it's a real capability gap in the e2e-test surface (workflows have an HTTP route but no e2e DSL sugar to call it directly against a backend — the closest working test replicates the workflow's job by calling the underlying aggregate operation directly, which only proves the operation's precondition, not the workflow's own orchestration/transactionality).
Workaround: don't test workflows via `test e2e ... against <backend>`; either test via `against <uiDeployable>` with `ui.workflows.X()`, or (as this evaluation did for `eval/fieldops/main.ddd`) test the underlying pure-operation directly and accept that the workflow's own cross-aggregate orchestration is then untested by any e2e path.
Impact on adoption: FieldOps's spec explicitly calls for testing "an API e2e test" for workflow-shaped features (`scheduleWorkOrder` spans three aggregates transactionally — exactly the kind of behavior an e2e test exists to catch, e.g. "does the transaction actually roll back on failure"), and the natural way to test it crashes the toolchain instead of saying "not supported" or working.
Time lost: 25 min.

---

### F-010 — Inside a legitimate `workflow`, an inline `Repo.getById(...)` call embedded in an expression (not its own `let`) is silently dropped from codegen
Severity: **S1 (blocker — silently wrong generated output on the officially-sanctioned cross-aggregate construct)**
Class: **SILENT gap**
Area: TypeScript workflow codegen (`http/workflows.ts` emitter) — a statement-classification pass that recognizes `let x = Repo.getById(id)` but not the same call written inline inside another expression
Claim under test: "no drift between layers" / "validated before emission" — same claim family as F-008, but this time the mistake is made from *inside* the one construct (`workflow`) the language designates as the correct place for cross-aggregate reads, not a misuse of `operation`.

Repro: `eval/repro/workflow-readonly-repo-not-injected.ddd` — a `workflow assignJob` with two correctly `let`-bound repository loads (`let tech = Technicians.getById(techId)`, `let job = Jobs.getById(jobId)`) plus one **inline** `Assets.getById(job.assetId)` call embedded directly inside the `precondition` expression, never given its own `let`.
Run:
  1. `node bin/cli.js parse ...` → 0 errors.
  2. `node bin/cli.js generate system ... -o /tmp/repro-f010` → 0 errors, "Wrote 49 file(s)".
  3. `cd api && npm install && npx tsc --noEmit` → **`http/workflows.ts(54,38): error TS2304: Cannot find name 'Assets'.`**

Observed: the emitted transaction body is
```ts
const technicians = new TechnicianRepository(tx, events);
const jobs = new JobRepository(tx, events);
const tech = await technicians.getById(techId);
const job = await jobs.getById(jobId);
if (!((tech.skills).includes(Assets.getById(job.assetId).requiredSkill))) throw new DomainError(...);
```
Both `let`-bound repositories (`tech`, `job`) are properly instantiated and awaited — the emitter clearly *can* wire up multiple auxiliary repositories correctly in one transactional workflow when the load is a top-level `let` statement. The **third** repository, reached via the exact same `Repo.getById(id)` call form but written inline inside the `precondition` expression rather than bound to its own `let`, is passed straight through to the expression renderer with no repository ever constructed for it — `Assets` is simply undefined in the generated file.
A related symptom was also seen in `eval/fieldops/main.ddd`'s own `scheduleWorkOrder` workflow, where even a properly `let`-bound `Technicians.getById(assignTo)` failed to inject. That turned out to be a DIFFERENT root cause, not a variant of this one: `Technician` is declared in a different context (`Directory`) than the workflow (`Dispatch`) — it is **F-007's cross-context restriction**, confirmed with its own isolated repro. Filed there, not here, to avoid double-counting.
Expected: either (a) the emitter recognizes and injects a repository for *any* `Repo.getById(...)` call reachable in a workflow body regardless of whether it's `let`-bound or inline, or (b) `ddd parse`/the workflow validator refuses an inline (non-`let`) repository call with a clear diagnostic telling the author to bind it first.
Workaround: always assign every `Repo.getById(...)` call in a workflow to its own top-level `let`, never inline one inside a `precondition`/`if`/boolean expression. This evaluation's FieldOps model was simplified to drop the cross-repository skill-match check from `scheduleWorkOrder` entirely (rather than fight the unconfirmed double-`let` variant under time pressure) — see `eval/fieldops/main.ddd`'s workflow comment; the skill-match rule (AC-001) is consequently **undertested** in this evaluation's own FieldOps build, which is itself a real cost of the bug, not just a description of one.
Impact on adoption: workflows are the language's *only* sanctioned mechanism for cross-aggregate orchestration (per this evaluation's Phase 1 findings so far: not allowed inside `operation` — F-008; restricted to same-context — F-007). Finding a codegen gap inside workflows themselves, on the natural and common shape of "check something you just loaded against a rule," measurably narrows how much of "the one correct way to do this" actually works today.
Time lost: 70 min (three reduction rounds to isolate the confirmed inline-call case, plus the abandoned attempts to reproduce the FieldOps-specific double-let variant).

---

### F-011 — `ui with scaffold(subdomains: [...])` generates a Detail/List page for an aggregate whose context is hosted by a DIFFERENT deployable than the UI targets — shipping a literal `/* TODO ... */ undefined` as the data-fetch hook
Severity: **S1 (blocker — silently wrong generated output; the generator's own source comment says this exact path should be unreachable on valid input)**
Class: **SILENT gap**
Area: `src/generator/_walker/walker-core.ts` (TODO-placeholder emission) × the IR validator that is supposed to make it unreachable (`loom.method-call-unresolved-receiver`, per that file's own comment)
Claim under test: "validated before emission... Validation gates catch hallucinated fields and out-of-scope references before any code is emitted" (README); "no drift between layers."

Repro: `eval/repro/scaffold-page-wrong-deployable.ddd` — one subdomain `Core` with two contexts, `Widgets` (hosted by deployable `api`) and `Notes` (hosted by a SEPARATE deployable `notifier`) — the exact "a separate notifier deployable" shape this evaluation's own spec calls for. `ui WebApp with scaffold(subdomains: [Core])` scaffolds both contexts' aggregates; `deployable webApp { targets: api, ui: WebApp }` binds the UI to `api` ONLY, never `notifier`.
Run:
  1. `node bin/cli.js parse ...` → 0 errors.
  2. `node bin/cli.js generate system ... -o /tmp/repro-f011` → 0 errors, "Wrote 107 file(s)".
  3. `grep -c "TODO: method-call" web_app/src/pages/notes/{detail,list}.tsx` → **6 and 6** hits.
  4. `cd web_app && npm install && npx tsc --noEmit` → **20 TypeScript errors** across `notes/detail.tsx`, `notes/list.tsx` (found first in this evaluation's own FieldOps build: `web_app/src/pages/notification_logs/{detail,list}.tsx` and `workflows/record_completion/{instance_detail,instances}.tsx`, 38 errors total there — reduced to this 45-line repro afterward).

Observed sample (`notes/detail.tsx`):
```tsx
{ /* TODO: method-call Note.byId(id) — needs hooks {} binding */ undefined.isLoading && ( ... ) }
```
A bare `undefined.isLoading` — not a type error on a real value, an access on the literal `undefined` keyword — ships as "final," non-hand-edited, auto-generated source. `src/generator/_walker/walker-core.ts:2005-2009`'s own comment states: *"This branch is now DEAD on valid `.ddd`: `loom.method-call-unresolved-receiver` (ui-checks.ts F2) rejects an unresolved method-call receiver at IR-validate time (phase ⑦), before codegen — so the placeholder is defence-in-depth for an unvalidated IR, not a silent generator gap."* That claim is falsified by this repro: the input passes `ddd parse`'s IR validation with zero errors, and the "defence-in-depth" placeholder fires anyway — meaning `loom.method-call-unresolved-receiver` has a real gap in exactly the scenario this evaluation's spec requires (a UI scaffolded across a subdomain that spans more than one backend deployable, which is what "eventing across deployables to a separate notifier deployable" produces by construction).
Root cause (read directly from the generated tree, to classify — not to fix): `NotificationLog`'s HTTP routes exist ONLY under `eval/out-fieldops/notifier/http/notificationLog.routes.ts` — the `api` deployable that `webApp` actually targets never serves that aggregate. The scaffold macro (`scaffold(subdomains: [...])`) walks every context in the named subdomain(s) and emits a full CRUD page set per aggregate, without checking whether the *specific* aggregate's hosting context is actually reachable through the UI's bound backend(s).
Expected: either (a) the scaffold macro only generates pages for aggregates reachable through the UI's actually-targeted deployable(s), or (b) `ddd parse`/`generate` refuses with a clear diagnostic naming the mismatch (e.g. "aggregate X's context is not served by any deployable this UI targets").
Workaround: scope `scaffold(subdomains: [...])` to only the subdomain slice actually served by the targeted backend, and hand-author (or omit) pages for anything mounted on a different deployable — effectively meaning "eventing to a separate notifier deployable" and "one `ui` scaffolded across the whole domain" don't safely combine today; an author has to know to split the scaffold call to avoid this.
Impact on adoption: this is not a contrived shape — it is the literal architecture FieldOps's spec requires (a notifier deployable, reached only over a channel, never over the main API), and it silently produces a broken frontend build the moment the convenient `scaffold(subdomains: [Core])` one-liner is used across the whole domain rather than hand-listing every safe aggregate. A team that scaffolds broadly (exactly what the "speed of no-code" pitch invites) and doesn't separately `tsc` the frontend will ship this.
Time lost: 95 min (found live in FieldOps's own build during Phase 2, then reduced to a 45-line standalone repro).

---

### F-012 — Python backend: `create`/`update` route handlers call `<ForeignAggregate>Id(...)` for cross-aggregate id fields the file never imports — a genuine runtime `NameError`, not just a lint nitpick
Severity: **S1 (blocker — silently wrong generated output; a real runtime crash on the aggregate's own `create` route)**
Class: **SILENT gap**
Area: Python/FastAPI backend route codegen (`src/generator/python/`) — import-collection for foreign id `NewType`s
Claim under test: README "generate real, owned source code across five backends"; the Status section's claim that Python output is "type-checked with mypy" in CI.

Repro: this evaluation's own FieldOps model, generated onto `platform: python` (`eval/fieldops/main.ddd` with `platform: node` swapped to `platform: python`; evidence preserved in `eval/repro/python-missing-id-import-evidence/`, since — unlike every other finding in this register — three reduction attempts (2 foreign ids; 2 foreign ids with one optional; 4 foreign ids matching `WorkOrder`'s exact required/optional mix) all generated CORRECT imports and did not reproduce the bug in isolation; the exact trigger condition in the real 8-field `WorkOrder` aggregate was not identified before time ran out on this investigation).
Run:
  1. `node bin/cli.js generate system <fieldops-on-python>.ddd -o /tmp/out-fieldops-py` → 0 errors, "Wrote 206 file(s)".
  2. `python3.13 -m compileall app` → clean (compileall only checks syntax, not name resolution — this step passing gave false confidence).
  3. `python3 -m mypy app` → **14 errors in 4 files**, including:
```
app/http/work_order_routes.py:161: error: Name "CustomerId" is not defined  [name-defined]
app/http/work_order_routes.py:161: error: Name "SiteId" is not defined  [name-defined]
app/http/work_order_routes.py:161: error: Name "AssetId" is not defined  [name-defined]
app/http/invoice_routes.py:85: error: Name "WorkOrderId" is not defined  [name-defined]
app/http/invoice_routes.py:85: error: Name "CustomerId" is not defined  [name-defined]
```
Observed: `app/http/work_order_routes.py` line 17 imports `from app.domain.ids import PartId, TechnicianId, WorkOrderId` — then line 161 calls `CustomerId(body.customerId)`, `SiteId(body.siteId)`, `AssetId(body.assetId)` in the exact same function, for id types that are never imported anywhere in the file. Confirmed these types genuinely exist and are importable (`app/domain/ids.py:7-9`: `CustomerId = NewType("CustomerId", str)`, `SiteId = NewType(...)`, `AssetId = NewType(...)`) — this is a missing import, not a missing type. **This is not a static-analysis-only issue**: Python resolves names at call time, so the very first `POST /work_orders` (create) request against this backend raises `NameError: name 'CustomerId' is not defined` and the request fails with an unhandled exception — a real production outage, not a type-checker nitpick. `invoice_routes.py` has the identical shape for `WorkOrderId`/`CustomerId`.
Also observed in the same mypy pass (reported separately, lower severity, not double-counted as S1): `app/db/repositories/work_order_repository.py` reuses the literal loop-variable name `child` across two separate `for child in aggregate.<collection>:` loops in the same method — once for `aggregate.lines` (type `WorkOrderLine`), once for `aggregate.photos` (type `Photo`). Runtime behavior is correct (Python doesn't block-scope `for` variables), but `mypy` infers `child`'s type from the first loop and flags the second as a type mismatch (`Incompatible types in assignment... has no attribute 'file'/'caption'`) — this is a real, if narrower, gap against the README's own "Python type-checked with mypy" CI claim, specific to an aggregate with 2+ `contains` collections (exactly FieldOps's `WorkOrder.lines` + `WorkOrder.photos` shape).
Expected: every id type referenced in a route handler's body is imported in that file; `mypy`/`ruff` run clean on generated output for a realistic aggregate shape (multiple foreign ids, multiple `contains` collections), matching the project's own stated CI practice.
Workaround: none available short of hand-patching the generated file's import list after every regenerate (which the customization gradient offers no sanctioned place for, since `http/*.py` route files are fully regenerated, not scaffold-once).
Impact on adoption: FieldOps's `WorkOrder` — the spec's own "centre of gravity" aggregate — cannot serve a single create request on the Python backend as generated. This is exactly the kind of defect Phase 2's "compile AND run" discipline exists to catch, and exactly the kind rule 3 warns is invisible at `exit code 0`.
Coverage note: **found on ONE aggregate shape, on the Python backend only, on this evaluation's actual FieldOps model — not independently reduced to a minimal repro despite three attempts** (documented above); treat the underlying trigger condition as unconfirmed even though the observed defect itself (via the real generated files preserved in `eval/repro/python-missing-id-import-evidence/`) is not in question. Not checked against .NET/Java/Elixir in this pass.
Time lost: 65 min (mypy run + three failed reduction attempts).

