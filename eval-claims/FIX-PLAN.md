# Claims eval: fix plan (bug fixes and silent gaps only)

Every item was re-verified on fresh `main` @ `d3f226765` (2026-10-06, 307 commits after the eval), using the minimal repros in [`repro/`](repro/).

**Scope rule.** No new language surface and no new runtime mechanism. A silent gap is closed in one of two ways:

- **(a)** make the existing construct emit correctly, or
- **(b)** turn it into an *existing* honest diagnostic (a `loom.*` code that already exists) and correct the docs.

## 0. What dropped out, and why

| Item | Status on fresh main |
|---|---|
| X id shows a truncated UUID (F9) | **fixed**: #3113 merged |
| 403 detail echoes gate source (F42) | **fixed**: #3104 merged (dev-stub only) |
| Op buttons ignore `when` state (F11, `when` half) | **fixed**: #3112 merged |
| Chevrotain "Ambiguous Alternatives" leak (B-07) | **not reproducible** on main |
| Workflow `precondition message` dropped (F21) | still broken; **claimed by draft #3139** |
| `expect(money).toBe(money)` (F47) | still broken; **claimed by draft #3139** |
| Workflow returns 204, no id (F22) | **claimed by #3140**. Out of scope anyway: opt-in new surface |
| `unique` added over duplicate rows (F19) | **claimed by draft #3141** |
| By-id and list reads ungated (F36) | **claimed by draft #3109 + #3143** |
| Cross-context `policy` → undefined call (F33) | **claimed by #3143** (`loom.policy-out-of-scope`) |
| Reactor calling a gated op → `currentUser is not defined` (F40) | still broken; **claimed by #3103** |
| Failed channel consume dropped (F41) | **claimed by #3161** |
| python `User` not imported in `workflows_routes.py` | likely closed by **#3144** (python imports derived from use). Re-check after merge; owned by P6 if not |

**Excluded (needs a new mechanism; each one needs a ruling first):**

- C-08: workflow-only / internal operations. This includes the op-gate vs create-gate inconsistency inside workflows.
- C-10: replay / backfill for a new subscriber.
- C-11: `Repo.count(Criterion)`.
- C-14: `requires … message`.
- C-17: un-reserving `covers` / `from` / `to`.
- B-08: structural throw kinds, so that `toThrow(precondition)` survives a custom `message`.
- Precondition-driven button enablement.
- Long-text fields, money display format, and the "AGGREGATES" label.

## 1. Defects to fix (all reproduced on fresh main)

| Id | Defect | Targets broken (verified) | Fix shape |
|---|---|---|---|
| **D1** | **Cross-context enum** (`Clm.kind: Kind`, with `Kind` declared in a sibling context) is resolved against `ctx.enums` instead of `enumPool(ctx)`. | **node:** domain, repository and unit-test emitters (tsc TS2304).<br>**python:** domain + routes + repo (mypy name-defined, an ImportError at boot).<br>**react:** form default `""` (tsc) and a TextInput instead of a Select.<br>**angular:** empty option list.<br>**elixir:** `:string` instead of `Ecto.Enum` (silent).<br>**java/dotnet:** only workflow-state / seed sites. | (a) Sweep every name-resolution `ctx.enums` site to `enumPool(ctx)`, plus a census ratchet. **Supersedes and widens M-T6.80**, which lists 6 of ~20 real sites and misses the node ones that break the build. |
| **D2** | **A bare `toThrow()` is satisfied by any error.** Through D1, a `ReferenceError` from broken codegen makes a negative test pass. | node, python. .NET already asserts `DomainException`, and elixir's #3108 made it invariant-only. | (a) Parity: lower a bare `toThrow()` to the domain-error base class (node `DomainError`, python `DomainError`). |
| **D3** | **`let s = Projection.byKey(k)` in a workflow** validates, and every backend emits an undefined receiver (node `Seen.byKey`, .NET `Seen.ByKey`, java `Seen.byKey`, elixir `seen.by_key`, python `Seen`). Unresolved typing then cascades: `datetime + days()` renders as raw `+`. | all 5 | (b) Fire the existing `loom.workflow-unknown-name` for a projection receiver. Correct `workflow.md` / `domain-services.md`, which promise "read a local projection" from a workflow. |
| **D4** | **`emit` inside an `if let` (and `for`) branch of a workflow** pushes onto a `workflowEvents` array that is never declared or dispatched. The event's type is not imported (python). | node, python. dotnet/java/elixir are correct. | (a) Make the workflow event collector ride `walkWorkflowStmtsDeep` (`src/ir/util/walk.ts`) instead of a top-level-only scan. This is the CLAUDE.md "no hand-rolled IR walks" class, so the walk census must not need a waiver. |
| **D5** | **A workflow calls `Agg.create({…})` on an aggregate classified NOT CONSTRUCTIBLE** (an invariant reads a `managed` field such as `reportedAt`). node emits `Claim.create` with no factory (TS2551). The same call in a `test` body is already refused by `loom.create-call-not-constructible`. | node (others to be confirmed by the packet) | (b) Extend the existing `loom.create-call-not-constructible` to workflow / reactor bodies. Also decide, with evidence, whether a `managed` field with a server default (`now()` / literal) should count as supplied for constructibility. If yes, that is a classification bug, and the factory is emitted. |
| **D6** | **A system `user { agentId: Agent id? }` claim on a deployable that doesn't host `Agent`**: `ids.AgentId` is never emitted, but `auth/user-types` / `oidc` reference it. | node (TS2694), python (ImportError at boot). Other backends to be confirmed. | (a) The id-type collector includes aggregates referenced by the `user {}` claim shape. |
| **D7** | **`audience: env("OIDC_AUDIENCE")` with the env var unset**: python verifies against `""` and rejects every token. node treats `""` as "skip" (the documented opt-out). The verify exception is swallowed with no log line. | python (others to be checked for `""` handling) | (a) Python treats `""` as unset, matching node. Log the rejection reason at `debug` on every backend that swallows it. |
| **D8** | **The generated Keycloak realm is unusable under denyByDefault**: <br>• the demo user has no `permissions`;<br>• id-typed claims get a non-UUID (`"demo-adjuster-id"`);<br>• `unmanagedAttributePolicy` isn't enabled, so attributes added via the admin API are silently dropped;<br>• no audience mapper when `audience:` is declared. | compose / keycloak (all) | (a) Fix the realm emitter: the demo user carries the full permission catalogue, id claims get a valid UUID, the realm enables `unmanagedAttributePolicy`, and the client gets an audience mapper when an audience is declared. |
| **D9** | **A named `policy` in a workflow/find header `requires`** is copied verbatim into the scaffolded page gate and refused (`loom.page-gate-not-client-evaluable`), although its body is client-evaluable. The server side inlines it. | all frontends (macro) | (a) Inline the policy body when the scaffold copies the header gate to the page gate, using the same inlining the server path uses. The diagnostic stays for genuinely non-client-evaluable bodies. |
| **D10** | **`loom.create-params-not-wire` warns only when a *required* field is missing** from a narrowed `create(…)`. Optional operation-owned fields (`approvedAmount`) are silently accepted on `POST`. | validator | (b) Extend the existing warning to optional fields the declared params omit, and name the `managed` remedy. |
| **D11** | **`status: S = Draft managed`** gives "Expecting ':' but found `<next field>`". | parser | (b) Add a case to the merged #3115 parse-error rewriter: "access modifier goes before the default: `status: S managed = Draft`". |
| **D12** | **The workflows index shows a "Run →" card** for an event-only saga with no command starter. The link 404s. | react (+ the other static frontends via the shared module) | (a) The index lists only command-startable workflows. Instance list/detail pages are unchanged. |
| **D13** | **Generated names**: the saga table for `workflow replicatePolicies` is `replicate_policieses` (camelCase `-ies` double plural), and a redundant `_idx` is emitted beside the `_uq` index on the same column. | all SQL backends | (a) Fix `plural` on camelCase input, and drop the index already implied by the unique index. **Must prove the delta over an existing snapshot is a RENAME / DROP INDEX, not a drop+create table.** If it can't be, this becomes a ruling. |
| **D14** | **Docs**: `language-reference/18-testing.md` says tests may live in `tests/*.ddd`, but such a file is ignored until it's `import`ed. | docs | Docs only: state the import requirement. |

## 2. Fleet layout

Packets are cut so that **write sets are disjoint within a wave**. Each packet follows CLAUDE.md:

- re-sync and re-verify on fresh `main`;
- check open drafts;
- **open a draft PR first** naming the files it touches;
- implement;
- mutation-prove each new gate or test (revert by file copy, and read which assertion failed);
- run the affected generated-backend compile legs locally;
- flip to ready.

### Wave 0 (one small PR; everything else drains it)

| Packet | Items | Write set |
|---|---|---|
| **P0: enum census** | D1 ratchet | `test/system/` census banning name-resolution `ctx.enums` outside `src/ir/util/reachable-types.ts`, seeded with one **deferred** waiver per current site (`reviewUntil`), grouped by tree. M-T6.80 row in `docs/new-plan/T6-backend-parity.md` rewritten to the full site list. |

### Wave 1 (parallel, disjoint trees)

| Packet | Items | Write set | Proof |
|---|---|---|---|
| **P1: TS/Hono enum pool** | D1 | `src/generator/typescript/**`, `src/platform/hono/**` (domain, repo imports, tests, workflow / projection / explicit-handler builders); deletes those waivers | `repro/r01` node tsc clean; unit tests run green; two-context fixture added to `test/system/cross-context-type-pool.test.ts` |
| **P3: JVM/.NET/Elixir enum pool** | D1 | `src/generator/{elixir,java,dotnet}/**` enum sites; deletes those waivers. Java part rebased on #3164 if it has merged | elixir schema shows `Ecto.Enum`; `gradle testClasses`, `dotnet build`, `mix compile` on `repro/r01` |
| **P4: frontend enum pool** | D1 | `src/generator/_frontend/form-helpers.ts`, `_walker/form-fields-vm.ts`, `_frontend/workflows-module.ts`, `angular/**`; deletes those waivers | react / vue / svelte / angular `tsc` on `repro/r01`; an enum Select renders |
| **P5a: workflow validator gaps** | D3, D5 | `src/ir/validate/checks/{workflow,create-call,constructibility}-checks.ts`, `src/diagnostics/messages.ts` (existing keys only), `docs/workflow.md`, `docs/domain-services.md` | `repro/r03` refused on all 5 backends; D5 refused or emitted, decided by evidence; mutation-proved |
| **P6: auth / identity** | D6, D7, D8 | id-type collectors + auth emitters per backend (`src/generator/*/` ids + `auth/`), the keycloak realm emitter | `repro/r06` node tsc + python mypy clean; Keycloak boot with the realm: a demo token passes `denyByDefault` gates on node **and** python with `OIDC_AUDIENCE` unset and set (generated-stack-verifier) |
| **P7: diagnostics + scaffold** | D9, D10, D11 | `src/macros/stdlib/scaffold/**` (gate copy), the create-params validator, the #3115 parse-error rewriter, `messages.ts` | B-19 / H-12 repros generate; the D10 warning fires on `repro/r08`; D11 message test; diagnostic-catalog test green |
| **P8: naming / indexes** | D13 | `src/util/naming.ts`, `src/system/migrations-builder.ts` | `repro/r09` table `replicate_policies`; migration-evolution test over a v1 snapshot shows RENAME / DROP INDEX only |

### Wave 2 (stacked on in-flight work)

| Packet | Items | Waits on | Write set |
|---|---|---|---|
| **P2: python enum pool** | D1 | **#3144** (python imports derived from use), which rewrites the same import blocks; stack on it if it hasn't merged | `src/generator/python/**` enum sites; deletes the last waivers, so the census goes to zero; re-check the `User` import |
| **P5b: workflow emit in branches** | D4 | **#3142** (node workflow event dispatch after commit), which owns the same node code; plus P1 / P2 for the shared builder files | node + python workflow builders → `walkWorkflowStmtsDeep`; `repro/r04` tsc + mypy clean; ir-walk census without a new waiver |
| **P9: test-matcher fidelity** | D2, D14 | **#3139** (type-aware test matchers), same test emitter | node + python test emitters; a seeded `ReferenceError` makes a bare `toThrow()` fail; testing-doc fix |
| **P10: workflows index** | D12 | P4 (shares `_frontend/workflows-module.ts`) | `scaffoldWorkflowsIndex` macro + the frontend workflows module; the event-only saga is absent from the index on react / vue / svelte / angular |

### Acceptance (closing packet, after all waves)

Regenerate `eval-claims/v3` on `main` **with zero hand patches**:

- node `tsc`, python `mypy` and react `tsc` are clean;
- `smoke3.sh` passes against Keycloak with `OIDC_AUDIENCE` unset;
- the unit tests in `v3/tests/claim.ddd` run, and a ReferenceError cannot turn them green.

Record the result in `eval-claims/FINDINGS.md`, with each finding marked fixed / claimed / excluded.

## 3. Sizing

The fleet is 11 packets, about 7 running at once in wave 1. Most are S–M. D1 is the largest by site count but mechanical. D5 and D13 each carry one evidence-based decision inside the packet; if the evidence says "behaviour change", the packet stops and reports instead of choosing.
