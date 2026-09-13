# Loom — fix plan for the defects found in the FieldOps evaluation

**Base:** re-synced to fresh `main` @ `2d2a87d32` for the fix work (the plan was written against
`9a8f2fe0`; `main` moved another 126 commits under it, and every wave-0 defect was re-verified on the
newer base before being touched).
**Method:** every finding was **re-verified against fresh main before any fix was planned**, and
cross-checked against the ~30 open PRs for an existing claim. Nothing here is planned from memory of
the evaluation; a finding that no longer reproduces is marked FIXED and dropped.

> **Status: planned in full; wave 0 implemented.** Ten agents re-verified and root-caused in
> parallel, one per subsystem; their per-cluster plans are in [`eval/fix-plans/`](fix-plans/).
> §0 records what has actually landed and how each fix was proved. Waves 1–5 are still plans.

---

## 0. Progress

**Wave 0 is landed** (PR #2911). Nine defects, each verified against fresh `main` before the fix,
each with a test **mutation-proved to fail when the fix is reverted** (reverted by file copy, never
`git checkout --`), and — where a real toolchain could answer — each **compiled**:

| Finding | Fix | Proof |
|---|---|---|
| **F-035** .NET drops a second `onCreate` stamp | `.find()` → `.filter().flatMap()` in `auditable-interceptor.tpl.ts` | `dotnet build` in `sdk:10.0`: `Build succeeded, 0 Error(s)`. Mutation → `AssertionError: create stamp for CreatedAt was dropped`, other 4 cases still green. |
| **F-025 + F-025b** .NET unqualified namespace | `global::` at both sites | `dotnet build` **before**: `CS0234 … in the namespace 'Api.Api'` ×2 → **after**: `0 Error(s)`. |
| **F-030A** elixir underscored-but-read bindings | `__dt`/`__s`/`__d`/`__other` → plain names | `mix compile --warnings-as-errors` in `hexpm/elixir` via the repo's own hex mirror. |
| **F-030B** elixir dead `if not (true)` | new `vanilla/gate.ts`; `requires true` emits no guard, at **all six** gate sites | **before**: `EXIT=1`, `typing violation … 106 │ if not (true) do`. Output is byte-identical to the ungated spelling. |
| **F-017** mantine `Chart` emits `={{{` | 4 lines across `mantine/v{7,9}` | `tsc` **before**: 7 parse errors → **after**: 0. |
| **F-020** compose pulls a withdrawn image | `minio/minio` → `quay.io/minio/minio` | `docker manifest inspect`: `minio/minio` **GONE**, `quay.io/minio/minio` **OK**. All 11 compose images now resolve. |
| **F-042** `ddd trace` blind in production | `--enable-source-maps` on the bundled node CMD | invariant over every emitted Dockerfile. |
| **F-043 / F-045 / F-021** doc drift | stale-org URLs (26 live files incl. **every scaffolded project's** `new-templates.ts` and the playground's crash-report target), the LICENSE claim, the base64 dev-claims header | `lemmit.github.io/Loc/ → 404`, `loom-harness.github.io/Loc/ → 200`; `ddd new` emits `LICENSE`, `generate system` does not. |

**Three of the four gates §5 asked for landed with it**, each mutation-proved:
`test/generator/_packs/tsx-parse-gate.test.ts` (TSX **syntax** floor over all 8 React packs — no
`npm install`, fast tier), `test/system/compose-images.test.ts` (pin table + an opt-in
`LOOM_IMAGE_CHECK=1` registry leg), `test/generator/dotnet/dotnet-namespace-qualification.test.ts`
(a **sweep** for unpinned root-namespace refs, not the two lines that were wrong), plus
`test/generator/elixir/vanilla-compile-hygiene.test.ts`.

**Two goldens had frozen the broken output and had to be rewritten** — which is why the defects
survived: `phoenix-find-gate.test.ts` asserted `if not (true) do` (output that does not compile under
the project's own strict flag), and `storage-sidecars.test.ts` asserted `image: minio/minio:latest`.
A third gap: the node/Hono Dockerfile is a `const`, not a renderer, so it sat outside
`generation-defaults.test.ts`'s `allDockerfiles()` sweep and inherited none of its invariants. It is
in the list now.

**One new S1 was found while verifying — F-046** (`auditable` without `auth:` emits an unbound
`currentUser` on **all five** backends). Root-caused to a single word in lowering; planned in §3.8,
deliberately **not** bundled into wave 0.

---

## 1. The census that should drive the plan

My evaluation was not the only one. Four other agents built a different application end to end over
the same weekend, compiled the output, and filed what broke. Each explicitly deduped against the
others:

| Audit | Domain | Distinct defects filed | Overlap with the other builds |
|---|---|---|---|
| [#2861](https://github.com/Loom-Harness/Loc/pull/2861) | Jira-like tracker | 4 defects + 4 minted missions | negotiated, ~none |
| [#2862](https://github.com/Loom-Harness/Loc/pull/2862) | e-shop | 21 (D1–D10, P1–P11) → **8 fix PRs** | negotiated, ~none |
| [#2864](https://github.com/Loom-Harness/Loc/pull/2864) | freight forwarding | 7 defects + 4 design gaps | "none of the following is re-claimed here" |
| [#2865](https://github.com/Loom-Harness/Loc/pull/2865) | insurance claims | 4 defects | "**none of my four defects appear in any of their claimed slices**" |
| **this one** | multi-tenant field service | **45 findings, 16 S1** | partial — a handful already claimed |

**Five independent builds. Roughly eighty distinct defects. Near-zero mutual overlap.**

That is the number the plan has to answer to. It means the defect surface is **not being sampled to
exhaustion** — each new domain model finds a fresh set of emitter bugs, because each exercises a
different corner of the type × access-modifier × capability × target matrix. Patching the eighty does
not converge; the sixth build will find another forty.

Two of the other audits reached the same conclusion independently and said it plainly:

> #2864: *"D2, D3 and D4 are each **one fixture** away from being impossible. The per-PR
> `hono-build.yml` corpus carries no value object holding an `X id`, no workflow whose state field is
> an enum, and no `managed` field with a declared default — so three emitters can emit non-compiling
> TypeScript with every gate green. **The durable fix is one fixture carrying all three shapes plus a
> ratchet on the ts-build set's coverage of the type × access-modifier matrix, not three patches.**"*

> `experience_gathered.md` §104: *"**`npm test` cannot catch this class, structurally.** It compares
> strings. The question 'does this name resolve in the module that uses it?' is answered by the
> target language's own toolchain, and that runs one tier up — an opt-in corpus leg, not the per-PR
> fast suite."*

So this plan is in two halves, and **the second half is the one that matters**:

- **(A) Land the individual fixes** — necessary, bounded, mostly small. §3.
- **(B) Change what the gates measure** so the class stops regenerating. §5.

Doing only (A) is the failure mode this project is already in: 50 of its 92 issues are auto-filed
"🔴 main is red", and five independent audits in one weekend each found a disjoint set of the same
kind of bug.

---

## 2. What "already claimed" means here, and why it is checked first

`main` moved 93 commits under my evaluation while I was writing it, and several findings were fixed
or claimed in that window. Claiming work someone else has in flight is the most expensive mistake
available in this repo (CLAUDE.md devotes a whole section to it). So every row below carries one of:

- **FIXED** — no longer reproduces on `9a8f2fe0`; the fixing commit is named. No work planned.
- **CLAIMED BY #NNNN** — an open PR covers it; the PR is named and read. No work planned; if my repro
  adds a case the PR misses, that is noted as a comment to leave, not a new PR.
- **LIVE + UNCLAIMED** — reproduces, nobody owns it. These get a fix plan.

Known-or-suspected claims going in (to be confirmed per-finding by the fleet):

| My finding | Likely claim |
|---|---|
| F-006 `create(...)` params silently ignored | **#2861 slice 4** — adds `loom.create-params-not-wire`; mission **M-T5.32** makes the params *become* the contract and deletes the gate |
| F-008 `crudish` ⊥ `denyByDefault` | **#2877** — `with crudish(requires: <Policy>)` |
| F-010 deny-by-default forces the deprecated `find all` | **#2874** — "a `find` deprecation with nothing to migrate to"; also #2861 slice 3 |
| F-014 FK vs nullable user claim | **#2869** — "an `X id?` claim in `user {}` broke node, java, python and dotnet, four different ways" |
| F-032 vue nullable `IdLink` | **#2885** / commit `d8b5f7c1`, and #2861 commit 5 |
| F-011 / F-041 page-gate + page-body holes | **#2871** — "three page-body/gate holes that validate clean and then break codegen" |
| F-001 starter warns on its own output | **#2861 slice 3** |
| the `this.x :=` parse failure I hit | **#2873** |

**One finding is confirmed novel by their own admission.** #2862 states: *"**Angular is unverified
throughout.** Its plain `tsc` is clean and its emitters are untouched, but `ng build` — the half that
would catch the Vue class — could not be run: the generated project's Angular CLI wants Node ≥ 22.22.3
and this host caps at 22.22.2. **Nothing here claims Angular is clean.**"* I ran `ng build` in a
Node 24 container and it fails (F-033). That gap is mine to close.

---

## 3. Per-finding fix plans

**Method.** Ten Opus agents, one per subsystem, each re-ran its findings' repros against fresh `main`
`9a8f2fe0` in a throwaway clone (`/tmp/loom-main`), root-caused to a `file:line`, checked all ~30 open
PRs for a claim, and wrote a plan with a named diagnostic (or a reasoned "no new code"), a test, a
**mutation proof**, and a blast radius. **Nothing in this repository or the Loom tree was modified, and
no pull request was opened** — per the evaluation contract. Per-cluster reports, with full command
transcripts, are in [`eval/fix-plans/`](fix-plans/).

| Agent | Cluster | Report |
|---|---|---|
| A | node / Hono emitter | [`A-node-hono.md`](fix-plans/A-node-hono.md) |
| B | .NET emitter | [`B-dotnet.md`](fix-plans/B-dotnet.md) |
| C | Java + Elixir emitters | [`C-java-elixir.md`](fix-plans/C-java-elixir.md) |
| D | Python emitter + wire parity | [`D-python.md`](fix-plans/D-python.md) |
| E | React emitter + page walker | [`E-react.md`](fix-plans/E-react.md) |
| F | Vue / Angular + scaffold topology | [`F-vue-angular-topology.md`](fix-plans/F-vue-angular-topology.md) |
| G | generator crashes + validator gaps | [`G-crashes-validator-gaps.md`](fix-plans/G-crashes-validator-gaps.md) |
| H | systems / ops / auth stack | [`H-systems-ops-auth.md`](fix-plans/H-systems-ops-auth.md) |
| I | structural / language-design limits | [`I-language-design.md`](fix-plans/I-language-design.md) |
| J | documentation contradictions | [`J-docs.md`](fix-plans/J-docs.md) |

### 3.0 Disposition of all 45 findings

**FIXED on fresh `main` — no work (2)**

| Finding | Fixed by |
|---|---|
| F-032 vue nullable `X id` breaks `vue-tsc` | `d8b5f7c1` / **#2885**. Verified green end to end. #2885 also added the missing *shape* (`placedBy: Customer id?`) to the vue build gate — the precedent §5 generalises. |
| F-034a `"quantity": 2` vs `2.0` | **Withdrawn, not fixed.** Already adjudicated as a deliberate tolerance (`test/_helpers/wire-record.ts:352`, `python/numeric-codec.ts:31`). My finding was wrong. |

**CLAIMED BY AN OPEN PR — no competing work (6)**

| Finding | Claim | Residual to leave as a comment, not a PR |
|---|---|---|
| F-001 starter warns on its own output | **#2874** (open, `mergeable_state: clean`; its body quotes `0 error(s), 0 warning(s)`) | none — resolves on merge |
| F-006 `create(...)` params silently ignored | **#2861 slice 4** → `loom.create-params-not-wire`; **M-T5.32** makes params *become* the contract | **yes.** The gate fires on a *missing required* create-input field. The converse — a declared param matching **no** field (`create(name, n)` on `{ name }`) — yields `missing = []` and stays silent while `n` is still dropped. One clause in the same block closes it. |
| F-008 `crudish` ⊥ `denyByDefault` | **#2877** (`with crudish(requires: <Policy>)`) | none |
| F-010 deny-by-default forces the deprecated `find all` | **#2874**, also #2861 slice 3 | none |
| F-011 page-gate crash on `permissions.<x>` | **#2871** — walks every `ui.pages[].requires` | none; crash reproduced verbatim, the PR's check covers it |
| the `this.x := …` parse failure | **#2873** | none |

F-014 was *expected* to be claimed by #2869 and is **not**: #2869/#2900 fix the `user {}` **declaration**
site; F-014 is the **use** site (a find comparing an FK to the nullable claim). It is LIVE and unclaimed.

**LIVE + UNCLAIMED — 37 findings, planned below.**

---

### 3.1 Backend emitters — uncompilable output from valid models

Every one of these passes `ddd parse` with `0 error(s)` and then fails the target language's own
compiler. All are per-backend and small.

| # | Finding | Root cause (`file:line` on `9a8f2fe0`) | Fix | Effort |
|---|---|---|---|---|
| 1 | **F-013** `!=` in a projection `where` → `ne(...)` un-imported (node) | `typescript/repository-builder.ts:79-90` seeds the drizzle-op candidate set from `repo.finds` + context filters; projection-synthesised finds are computed 71 lines later (`:160`) and rendered at `:180` **without feeding the set**; the narrower at `:241-244` then drops `ne`. Twin at `repository-embedded-builder.ts:119`. | Feed synthesised finds into the candidate set before narrowing — one ordering fix, not a per-operator patch. | S |
| 2 | **F-014** find comparing an FK to a **nullable** claim → uncompilable Drizzle (node) | `typescript/repository-find-predicate.ts:517` passes `TechnicianId \| null` into `eq()`, which takes `string \| SQLWrapper`. | Narrow at the predicate: a nullable claim compared to a non-null column is `isNull`-or-`eq`, or the find is statically empty. **See §3.5 — the *language* question it exposes is separate.** | S |
| 3 | **F-025 + F-025b** missing `global::` → `CS0234 … in the namespace 'Api.Api'` (.NET) | `dotnet/emit/channels.ts:949,954` and a **second, previously unreported site** at `dotnet/emit/messages.ts:74`. Fires only when the deployable is *named* `api` — which is what `ddd new` scaffolds and what no corpus fixture uses. | Prefix both with `global::`. Ratchet with the reusable namespace sweep agent B wrote (`/tmp/agentB/sweep.py`). | S |
| 4 | **F-035** two capabilities contributing `onCreate` stamps → one dropped → every create 500s (.NET) | `dotnet/emit/auditable-interceptor.tpl.ts:157-158` uses `.find()` on the stamp-rule array and discards the rest. **Every other consumer collects** — python `routes-builder.ts:813`, elixir `stamp-emit.ts:43,159`, and .NET's own Dapper adapter `dapper.ts:1041`, all `.filter().flatMap()`. | `.filter(r => r.event === "create").flatMap(r => r.assignments)` on both lines. **Per-backend; no shared file changes.** | S |
| 5 | **F-028** java: a repository used only inside `if let` (or nested in `for`) is never injected | `java/emit/workflow.ts:169-183` `reposUsed()` hand-rolls its own child enumeration: `if-let` is not in the kind set, and recursion descends only into `for-each.body`. | Migrate onto `walkWorkflowStmtsDeep` — **the correct migration already exists 400 lines away** in the same backend (`explicit-handlers-emit.ts:78-97`). Add the `DELEGATES_TO_SANCTIONED_WALKER` waiver beside its sibling. | S |
| 6 | **F-029** elixir: `currentUser` in a find filter → unbound Ecto var | Two independent halves. (i) `elixir/vanilla/repository-emit.ts:180` derives `principal` from the *aggregate's capability filter only*, never asking whether this find's own filter reads the principal — same predicate keys `context-emit.ts:386` and `find-controller.ts:191`. (ii) `repository-emit.ts:609-610` renders the declared filter raw, so `render-expr.ts:500` returns bare `current_user` instead of pinning `^`. | Pass `principal \|\| findUsesCurrentUser(f)` per-find and route the filter through `pinPrincipal`. **`findUsesCurrentUser` already exists** (`loom-ir.ts:4158`) and is used by node, python and .NET — `src/generator/elixir/` is the only backend that never imports it. | M |
| 7 | **F-030** elixir: generated Phoenix fails `mix compile --warnings-as-errors` | (A) `elixir/vanilla/context-emit.ts:243` emits `__dt`/`__s`/`__d`/`__other` — underscored names that are then *read*. (B) `find-controller.ts` emits `if not (true)` for `requires true`, which Elixir 1.18 reports as a **typing violation**. | (A) drop the underscores. (B) skip the guard entirely when `requires` is the literal `true` — byte-identical to an ungated find and semantically exact. **Rejected alternative, named in the PR body:** constant-folding literal-`true` in phase ⑤ would fix all five backends but rewrites four backends' goldens for zero defect on those four. | S |
| 8 | **F-027** python: cross-context `X id` un-imported in a route | `python/routes-builder.ts:269-274` builds the id-import list from `ctx.aggregates` + `extraIdNames` only. `ruff F821`, `mypy name-defined`. **This is the 11th instance of "a python emitter referenced a name it did not import"** (#2881 was #10 and its own note named the right home: *"one neutral `idTargetsOf(type)` in `src/ir/util/`"*). | Do what #2881's note says, then close the class with the module-symbol sweep in §5. | S + the sweep |
| 9 | **F-026 (python half)** workflow calls an aggregate `function` | `python/emit/aggregate.ts:516` emits `def _has_skill`; `render-expr.ts:518` calls `t.has_skill(...)`. **A name mismatch — strictly worse than .NET's `CS0122`:** `compileall` OK, `import app.main` OK, **`ruff check` → All checks passed**, and it is an `AttributeError` at *request* time. Only `mypy --strict` sees it, only under `LOOM_PYTHON_BUILD=1`, and the shipped Dockerfile runs `uv sync --no-dev`. | Blocked on the §3.5 ruling. Under refusal → no emitter change on any backend. | S once ruled |
| 10 | **F-034b** python returns pydantic's raw message, echoing the regex to the client | `python/emit/wire-constraints.ts:29,36` emits `Field(pattern=…)` with no message; node's `zod-refine.ts:141-154 singleFieldMessage` derives `"Billing Email is not in the expected format"`. | Render the derived text on the python side. The real fix is the fixture in §5 that makes the wire differential *see* it. | S + fixture |

### 3.2 Frontend emitters — uncompilable output from valid models

| # | Finding | Root cause | Fix | Effort |
|---|---|---|---|---|
| 11 | **F-016** a reserved word as an operation name → `const void = …` | `react\|vue\|svelte/walker/page-shell.ts:814\|442\|233` (`opCamel`) and `_walker/primitives/forms.ts:289,1053` emit the op name straight into a **binding** position. | Apply the doctrine already written at `src/util/naming.ts:360-380` (`escapeTsIdent`, `TS_KEYWORDS`) at the five frontend producers. **Cross-target probe (agent E, all 5 backends × 4 keywords):** node/dotnet/elixir/java are safe by naming convention or already refuse — `java` refuses with `loom.java-reserved-identifier-unsupported`, a model diagnostic. **Python is BROKEN and silent**: `def class(self)` → `SyntaxError`. Two PRs, one per language, plus a correction to the java diagnostic, which currently advertises python as a safe host. | S each |
| 12 | **F-017** `Chart` emits a stray `{` → 7 TS parse errors | `designs/mantine/v{7,9}/primitive-chart.hbs:9,10` — a typo in **one pack family**, 4 lines. Proven by rendering the same `.ddd` against all eight React packs: chakra/mui/shadcn are fine. | Fix 4 lines. **The sweep-shaped work is the missing gate, not the missing fixes** — see §5's TSX parse gate. | S |
| 13 | **F-018** a declared `find all(): T[]` breaks the FK picker | `_walker/form-fields-vm.ts:83-91` assumes the picker's source find returns a **paged** envelope; a declared array-returning `find all` gives `{…}[]`, so `.items` does not exist. Angular twin at `angular/form-fields.ts:220`. | One helper that asks the IR whether the find is paged or array-shaped, threaded through the VM. **Blast radius measured:** react, vue, svelte, angular all broken (they share the VM); **feliz and flutter are already correct**, by two different routes — feliz re-derives the call shape, flutter sniffs at runtime (`decoded is Map<String,dynamic> ? decoded['items'] : decoded`). | M |
| 14 | **F-033** angular: `string[]` → `FormControl(null)` → `ng build` fails | `angular/form-fields.ts:242-245,336-342,596-599`. | Initialise scalar arrays to `[]`, or reproduce React's honest disabled-input gap. **Note the stale honesty:** the React placeholder says *"(arrays not yet supported in forms)"* — which is false on Feliz and Flutter, both of which ship working scalar-array editors. | S |
| 15 | **F-019** a `ui` scaffolds a subdomain no target deployable serves | `src/ir/validate/checks/ui-checks.ts:75-79,141-148` scopes its reachability check to the ui's own module set, never intersecting it with the `targets:` deployables' hosted contexts. | A new **error**-severity IR gate. Corpus pre-flight run: **zero** existing fixtures trip it (including `showcase.ddd` and `vanilla-daisyui-pack.ddd`, which scaffold strict subsets). Target-agnostic, so it fires for all six frontends and HEEx. | M |

### 3.3 Crashes and silent validator gaps

| # | Finding | Root cause | Fix | Effort |
|---|---|---|---|---|
| 16 | **F-012** a multi-word e2e slug crashes codegen | **Three copies of one slug resolver, and they disagree.** `system/e2e-render.ts:860` matches three spellings; `:260 findContextForSlug` matches **one**; `ir/validate/checks/test-checks.ts:438` is a fourth copy. For a single-word name the spellings coincide — which is why every single-word fixture passes. `compatibleBackends` (`:287`) then **fails open** on the miss, admits every backend, and `renderApiCall` throws. | Extract `aggregateMatchesSlug` to `src/ir/util/api-slug.ts`; rewrite all three call sites onto it; **fail closed** in `compatibleBackends`. **No new diagnostic, deliberately** — once the resolvers agree, `loom.e2e-unknown-aggregate` at phase ⑦ already covers the reachable case, and a new code could not fire. | S |
| 17 | **F-040** cyclic containment → stack overflow | `typescript/repository-find-builder.ts:216-232 nestedContainLoads` recurses with no visited set; same shape in `dotnet/emit/efcore.ts:1000`, `python/repository-builder.ts:1051`, `elixir/vanilla/read-preload.ts:82`. **Wider than filed: four of five backends blow the stack; java does not — it writes an infinitely-recursive wire schema** (`record ChildResponse(UUID id, String label, List<ChildResponse> kids)`). A **mutual** cycle crashes identically, so self-reference is not the class. | New phase-⑦ check → **`loom.containment-cycle` (error)**, reporting the **cycle path**, not just the part. Deliberately *not* `-unsupported`-suffixed: this is a modelling rule (a containment is a child table; a cyclic one has no finite eager-load), not a drainable emitter gap, so it must not enter `MAX_OPEN_GAPS`. **A depth cap is explicitly not the fix** — it silently truncates the user's model. | S–M |
| 18 | **F-041** a typo'd field in a page body is unvalidated | **The root cause moved.** `language/validators/types.ts:171 checkUnknownMemberAccess` already streams the whole model, `ui` included, and *does* fire on a typed `component Row(o: Order)` param. The gate is blind for exactly one reason: **a `QueryView { data: o => … }` lambda param has no type** — the IR records `receiverType: {kind:"primitive",name:"string"}`, and `_walker/shared/row-field-type.ts:1-8` already documents this hole in prose. | **No new check and no new code** — teach `type-system.ts` to type walker-primitive row lambdas (it already does contextual lambda typing for collection ops at `:1296-1350`), sourcing the slot table from `walker-primitive-names.ts` so it cannot drift. Then the existing `loom.unknown-member` fires, plus one `#hint` catalog variant. **Honest cost:** this is a one-way door — every `o.<x>` in every shipped page becomes checkable in the same commit, so a wire-shape read the env types differently becomes a **false error on shipped source**. Must be measured across all 280+ `.ddd` first, and land as a **warning** if the sweep is not clean. Two designed-in escapes: an unresolvable `of:` yields no type (never guess), and the row record must be the **wire** shape, not the domain shape. | M–L |
| 19 | **F-004** `loom.transactional-no-effect` fires on a workflow that demonstrably mutates | `ir/validate/checks/workflow-checks.ts:559` iterates **top-level statements only**; its `for-each` arm (`:908-942`) hand-rolls one level of descent and recognises **one** kind (`op-call`). **Wider than filed:** `emit` inside a `for` is equally uncounted, so the message's own *"or emit any event"* clause is false too. The emitter disagrees visibly — it wraps the identical body in `db.transaction(...)`. | Compute `mutated` once with `walkWorkflowStmtsDeep` over the same kind set `api-checks.ts:37 handlerMutates` already uses. Delete `forEachStmtDeep` from `api-checks.ts` — **two checks in one directory hand-rolled two different depths over the same union.** No new diagnostic. | S–M |
| 20 | **F-005** an aggregate with no `create` yields a silently read-only API | `emitsRestCreate` (`ir/enrich/wire-projection.ts:300`) is the single gate every backend's create route hangs off, and nothing tells the author. | Phase-⑦ **warning** `loom.aggregate-not-constructible`, **reusing `emitsRestCreate`** rather than re-deriving it, and treating workflow `factory-let` (via `walkWorkflowStmtsDeep`), seeds, and `isAbstract` as constructors. **Corpus measured, not guessed: 9 of 161 shipped aggregates (5.6%) are unconstructible**, one deliberately (`crudish(updateOnly: true)`). Warning-not-error is deliberate: the three `playground-*-examples` suites assert only `severity === "error"`, so the corpus stays green. | M |
| 21 | **F-002 / F-003** (agent I's ruling) | **Not structural, though they read that way in a defect log.** F-002 is one validator arm that forgot what its sibling already does — **all five backends emit correct code today**. F-003 is `shared.ts:26 opts.allowSelfId`, a flag set at 1 of 3 sites whose stated justification does not apply at the other two. | Both are the same shape as F-004: *a validator stricter than the emitters.* | S each |

### 3.4 The buyer's first thirty minutes — ops and auth

Agent H booted the emitted Keycloak realm and drove the token endpoint directly. **Ordered by when the
buyer hits it**, which is not the same as severity:

| Minute | # | Finding | Fix | Effort |
|---|---|---|---|---|
| 2 | 22 | **F-020** `minio/minio:latest` no longer exists on Docker Hub → `docker compose pull` fails **and interrupts the other three pulls** (`postgres`, `valkey`, `mailpit` all print `Interrupted`). Worse than filed: on a cold machine the buyer gets *no* image at all. `system/index.ts:1045,1056,1067`. | Pin `quay.io/minio/minio`. Add the runtime image-existence leg from §5 — that is the reusable part. **Ship alone and immediately**: it is a one-file change that unblocks every other verification anyone runs against a generated stack. | S |
| 6 | 23 | **F-024a** `SCOPES = "openid offline_access"` (`hono/v4/auth-emit.ts:663-669`) but the emitted realm's demo user cannot mint offline tokens → `{"error":"not_allowed"}` → `401 token_exchange_failed`. Reproduced **without a browser**, in ~10s with `curl`. | Either drop `offline_access` or grant the role in the emitted realm. | S |
| 7 | 24 | **F-024b** post-login lands on `/` — which is the **API** origin (`3000:3000`), not the SPA (`3001:3000`) → `404 no route for GET /`. `OIDC_POST_LOGIN_REDIRECT` is read by `handshake.ts:10` and **set nowhere in compose**. | Set it in `system/index.ts`. **Ships with #23 as one PR** — sequential symptoms of one hole: no gate has ever driven `/auth/login` → `/auth/callback`. | S |
| 12 | 25 | **F-022** the emitted realm mints **none** of the declared claims — `protocolMappers` absent entirely — while `auth/oidc.ts:75-80` reads exactly `role`, `permissions`, `tenantId`, `technicianId`. Proven by decoding a real token: all four `<<ABSENT>>`. Every gated route 500s or denies; **multi-tenancy, the headline B2B feature, cannot be demonstrated at all.** `lower-auth.ts:44-45`, `system/index.ts:857-945`. | Emit protocol mappers from the declared `user {}` block. **The deliverable is the shared `resolveClaimPaths` helper, not the mappers** — two halves reading two different sources for one question is the defect; the empty array is the symptom. | M |
| — | 26 | **F-038** no lockfile, all deps caret-ranged (`_docker/node-stage.ts:10-24,57`). Invisible at minute 30, decisive at the security review. Determinism control re-verified: two fresh generations diff to **0 lines**, so the non-determinism is entirely in the install. | Has a real design fork (vendor a lockfile vs. pin exact versions vs. commit one on first generate). Should **not** be rushed behind the four above. | L |
| — | 27 | **F-023** the OCC precondition is never sent: `grep -rn 'If-Match' web/src` → **0**, and `parseIfMatch(undefined, v)` returns `current` — so the server's optimistic-concurrency check passes vacuously. `docs/language.md:584` still says `token` is "sent as an optimistic-concurrency precondition". `_frontend/api-module.ts:464,467`. | Send the header from the generated client. **Highest severity per occurrence in this cluster (silent lost-update), lowest first-impression cost.** | M |
| — | 28 | **F-042** `ddd trace` is blind to production: `api/Dockerfile` ends `CMD ["node","dist/index.js"]` with no `--enable-source-maps`, so every frame is a bundle frame. `hono/v4/emit.ts:1911`. | **One line**, and agent H *proved it sufficient*: built the real bundle, ran it with the flag, and a live frame resolved to `Field.WorkOrder.schedule (main.ddd:219:21)` — the resolver already suffix-matches `/app/domain/…`. **No `ddd trace` change needed.** Checked and clear: .NET carries `.pdb` into the runtime image; java/python/elixir do not bundle. | S |

**Through-line for all of #22, #23 and #25:** every OIDC gate in the repo uses the **password grant with
no `scope`**, against a fixture (`test/e2e/fixtures/auth-oidc-e2e.ddd`) whose `user {}` declares only
claims Keycloak already mints by default — and no CI job has ever pulled the object-store image. Three
defects, one blind spot.

### 3.5 One ruling that gates four backends — `function` visibility (F-015 / F-026)

This is the only finding whose fix must be decided before any backend moves, so it is called out
separately. The same repro breaks **four targets in four different ways**:

| Target | Emitted | Call site | Failure |
|---|---|---|---|
| node | `private hasSkill(...)` | `workflows.ts:56` | `TS2341` — compile |
| dotnet | `private bool HasSkill(...)` | `GiveHandler.cs:37` | `CS0122` — compile |
| java | `private boolean hasSkill(...)` | `CWorkflows.java:36` | javac — compile |
| python | `def _has_skill` | `t.has_skill(...)` | **name mismatch → `AttributeError` at request time** |
| elixir | `def has_skill(%Tech{}, s)` — **public** | `t.has_skill(skill)` | struct-field access, not `Api.C.has_skill(t, skill)` → **runtime raise** |

**The decisive fact:** `FunctionIR` (`ir/types/loom-ir.ts:418-423`) has `name`/`params`/`returnType`/`body`
and **no visibility axis at all** — no grammar modifier feeds one — while `OperationIR` (`:456`) does.
And `docs/language.md:430` already scopes the construct: *"Pure helper (expression form); **callable from
any expression in the same aggregate**."* The workflow calls it from **outside** the aggregate, which the
documented contract already forbids — yet phases ④ and ⑦ accept it and four backends emit a broken call.

**Recommendation: (A) refuse it** with a new shared validator leaf (`aggregate-function-visibility.ts`),
riding `walkExprDeep`/`walkStmtExprsDeep`/`walkWorkflowStmtExprsDeep` per CLAUDE.md's no-hand-rolled-walks
rule — otherwise the check misses the receiver hidden in a `match` arm, which is the exact #2720/#2705
class. Model the message on the existing symmetric gate `loom.workflow-private-operation`
(`workflow-checks.ts:1093-1104`). The check does **not** belong in `workflow-checks.ts`: a `domainService`
reproduces it with no workflow at all.

Under (A), **no emitter changes on any backend** — `dotnet/emit/entity.ts:426` and its four siblings stay
byte-identical and become unreachable. Under (B) (make `function` a public pure query), five emitters move
at once, and python's silent `AttributeError` and elixir's struct-field raise are two failures **no compile
gate will ever surface** — so (B) additionally requires a runtime leg, not just `tsc`/`javac`/`dotnet build`.
That asymmetry is the argument for (A).

### 3.6 Documentation (agent J) — cheap, and one of them is a parse error

| # | Finding | Edit |
|---|---|---|
| 29 | **F-043** `README.md:18/54/202` point at `lemmit.github.io/Loc/` → **404**. The live site is `loom-harness.github.io/Loc/`. **11 more hits repo-wide**, plus a 60-hit second tier of stale-org URLs that reaches into **every scaffolded user project's LICENSE file**. | Rewrite; then the host denylist in §5 so the next org move names every file. |
| 30 | **F-045** `README.md:370` claims `generate system` emits a `LICENSE` at the output root. It does not (`Wrote 286 file(s)`, no LICENSE). `ddd new` does, and `docs/license-faq.md:42-47` is correct. | One README line. |
| 31 | **F-021** `docs/auth.md:976-981` documents `x-loom-dev-claims` as raw JSON; the emitters parse **base64** inside `try/catch`, so a raw-JSON header **silently** yields the built-in admin identity. `docs/language-reference/17-auth.md:250-253` already has the correct form. | One doc block. The silent-fallback behaviour is worth a separate look. |
| 32 | **F-005 doc half** `docs/tenancy.md:135-137` claims `POST /organizations` works for its §Surface example — **and that example does not even parse** (`crossTenant aggregate Plan`; the doc's own line 100 says the modifier goes after the name). | Fix the fence and the claim; the code gate in #20 makes the drift impossible to reintroduce silently. |
| 33 | **F-031** the Feliz `design:` message suggests barewords when the grammar takes **quoted** strings — and carries **no `loom.*` code at all**, so it is outside `diagnostic-catalog.test.ts` *and* `diagnostic-docs-anchors.test.ts`. `validators/deployable.ts:441-449`. | Quote the suggestions; give the message a code and a catalog entry. |
| 34 | **F-006 doc half** `docs/language.md:435` over-generalises the event-sourced rule. `docs/language-reference/06-...:360` is already correct. | One line. (Code half is #2861's.) |
| 35–37 | Agent J's own mechanical sweep found four more in ten minutes: `observability.md:153` doubly-dead link, `channels.md:19` broken link, an undocumented `asyncapi.yaml`, and a `ddd new --help` omission. | **These are a sample, not the set** — see §5. |

### 3.8 F-046 — a macro-injected `currentUser` evades the gate that refuses the hand-written one

**Found while verifying wave 0, not during the evaluation.** An aggregate carrying `auditable` on a
deployable with **no `user { }` block and no `auth:`** validates `0 error(s), 0 warning(s)` and then
fails to build on **all five backends** (elixir `CompileError`, node `TS2304`, dotnet `CS0103`, java
`cannot find symbol: UserId` *plus* `@CreatedDate` on a principal field, python a request-time
`NameError`). Full evidence table: `FINDINGS.md` → F-046.

**Root cause, one level above every emitter.** Without a `user { }` block, `currentUser` lowers to
`refKind: "unknown"` rather than `"current-user"`:

```
no user{}:  {"kind":"ref","name":"currentUser","refKind":"unknown"}
with user{}:{"kind":"ref","name":"currentUser","refKind":"current-user","type":{"kind":"entity","name":"__User__"}}
```

That single word does two things. `exprUsesCurrentUser()` returns false, so `validateStampSupport`
(`ir/validate/checks/principal-guard-checks.ts:76`) never raises **`loom.stamp-principal-without-auth`**
— the diagnostic **three backends cite in comments as their upstream guarantee**
(`dotnet/emit/auditable-interceptor.tpl.ts:32,73,175`, `java/emit/entity.ts:366`,
`dotnet/index.ts:1620`). And each backend's principal-stamp renderer tests for exactly the two
`current-user` shapes, misses both, and falls through to a plain expression render — emitting the
bare identifier.

**It disabled at least TWO gates.** The fix turned `menu-link-gate.test.ts` red, naming a second
diagnostic — **`loom.current-user-needs-auth-ui`**, blind for the same one word. Worse, the case it
broke was named *"emits NO gating when the app has no auth (byte-identical)"*: a page gate reading
`currentUser` without auth was **silently dropped** by the Phoenix sidebar emitter, so an authorization
rule the author wrote never ran — and a green test pinned that as correct. Both halves now fixed, with
the refusal asserted. A one-word lowering hole was switching off auth gates in more than one place.

**Why no gate caught it — the sharpest instance of §5 in this whole document.** The gate is not
missing, and it is not weak. `test/generator/dotnet/dotnet-stamping.test.ts` carries a case named
*"gates a currentUser stamp on a dotnet deployable WITHOUT auth fail-fast"*, and **it passes**. It
builds its model from a hand-written context-level `stamp onCreate { createdBy := currentUser }`, in a
system that still declares `user { }`, with only `auth: required` removed from the deployable. The
**macro-injected** spelling — `with auditable`, in a system with no `user { }` at all — takes a
different lowering path and has never been handed to it. A hand-written `currentUser` read *is*
refused today; the same read injected by a prelude capability is not.

**Fixed — upstream, single-site, no new diagnostic.** `resolveNameRef` now resolves `currentUser` to
`refKind: "current-user"` as its **last** step, when nothing else binds the name — so a real local or
field named `currentUser` still shadows it in a system without auth, and only the case that
previously dangled moves. The existing gate then refuses the model on all five backends, with its
existing message, and **no emitter changed**.

The corpus sweep the plan asked for was run first and is what made this safe: across all **461**
tracked `.ddd`, exactly **two** read `currentUser` with no visible `user { }` — `examples/sales-ui.ddd`
(already pinned UNPARSEABLE) and `web/src/examples/erp/hr.ddd`, whose block lives in the project entry
that imports it. The fall-through was protecting nothing.

Mutation proof: reverting the resolution fails all five refusal cases plus the root-cause pin, while
the five auth-carrying controls and the shadowing case stay green — so the mutation is shown to hit
the no-auth path, not lowering in general.

**Correction to this section as first written:** it claimed java carried two extra emitter defects
(`UserId` referenced but never emitted; `@CreatedDate` on a principal field) that would survive the
ruling. Regenerating the same model *with* auth shows java emits `@CreatedBy`/`@LastModifiedBy` and
`String createdBy` correctly — both oddities were produced only by the un-refused tree and are
unreachable once it is refused. Second java mis-call of this evaluation (see F-035); both came from
reading emitted source without generating the passing control.

### 3.9 F-047 — 122 AST-layer diagnostics carry no code, so all three diagnostic gates skip them

**Found after the F-031 correction, not during the evaluation.** F-031's message-text half is now
**fixed on `main`** — the Feliz `design:` diagnostic says the theme must be a QUOTED string and shows
`design: "light"`. The other half stands and is much larger than one message.

Measured with the TypeScript AST over exactly the files `diagnostic-catalog.test.ts` scans:
**122 of 320** `accept("<severity>", …)` sites attach no `code:` at all — `deployable.ts` 24,
`statements.ts` 22, `ui.ts` 21, `types.ts` 15, `match.ts` 12, … **All 122 are in the AST layer;
`src/ir/validate/checks/` is 100% coded.** One layer was never migrated while its sibling was.

The gates miss them by construction, not by oversight: catalog invariant 1 is *"a site that
**attaches a code** must render from the catalog"*, and a codeless site satisfies it vacuously — as
do the docs-anchor gate (keyed by code) and the firing census (a fixture per code). Three gates for
diagnostic quality; 38% of the surface outside all three. That is why F-031 could ship advice that
did not parse with `diagnostic-catalog.test.ts` green.

**Landed now: the ratchet** — `test/system/diagnostic-code-coverage.test.ts`, one file, no source
change, no CI leg. It pins today's count per layer and fails if it *rises*; when a PR adds a code it
must lower the baseline in the same PR (a stale baseline fails too, the repo's own waiver
convention). It also pins `src/ir/validate/checks/` at **zero**, which is both the proof the target
is achievable and the thing the AST layer migrates toward.

**Not landed: the migration.** 122 sites × (code + catalog entry + docs anchor + firing fixture) is
mission-sized and should be minted as one, drained per-file. `deployable.ts`, `statements.ts` and
`ui.ts` are 67 of the 122 between them.

### 3.7 What is genuinely structural (agent I's ruling)

Agent I was asked to plan fixes for the seven "structural limits" in the report. Its ruling materially
narrows that framing, and the report has been corrected accordingly:

**Only three are real limits.**
1. **There is no transactional consistency across a bounded context, and there never will be.** Inherent — document it, do not fix it.
2. **The read path has two spellings, not at parity.** A sequenced transition, not a bug.
3. **A Loom `enum` is a write-time constraint, not a stored one.** Inherent to the storage model.

**The other four are ordinary defects wearing structural clothing:** F-002, F-003, F-044 (design written
down, expensive half already built, seam already in use for source maps), and **F-009** — which is *worse*
than filed, not structural: the read-only cross-context form validates `0 error(s), 0 warning(s)` and emits
a dangling receiver on **all five** backends (`lower-workflow.ts:96-103` builds `reposByName` from the
enclosing context only), while `docs/domain-services.md:130` points the reader at workflows for exactly
this job.

> Agent I's summary, which is also the thesis of §5: *"a validator stricter than the emitters, or a
> pipeline stage left one option short — and in each case the diagnostic told the author it was their
> fault."*

---

## 4. Sequencing

Ordered by **what unblocks the most other work**, not by severity. Each row is independently landable;
nothing here is a big-bang refactor.

| Wave | Contents | Why here | Cost |
|---|---|---|---|
| **0 — today** | #22 (minio pin), #28 (`--enable-source-maps`), #12 (mantine `{`), #3 (`global::`), #4 (.NET `.find`→`.filter`), #7A (elixir `__dt`), #29/#30/#31/#34 (doc one-liners) | Nine one-file changes. #22 **unblocks every other person's ability to boot a generated stack**, so it ships alone and first. | S each |
| **1 — the gate widenings** | **§5.1** multi-word names in the fuzz generator · **§5.2** field-shape × target matrix · **§5.3** module-symbol sweep · **§5.6** doc-fence validator | **Before** the rest of the fixes, not after. Each is a one-file edit to an *existing* gate, and each would have caught findings in wave 0 that shipped anyway. Landing these first means waves 2–3 are verified by the gates rather than by hand. | S–M each |
| **2 — compile-breakers** | #1, #2, #5, #6, #11, #13, #14, #16 | The remaining "valid model → uncompilable output" set. Ordered within the wave by blast radius: #13 (four frontends) before #14 (one). | S–M each |
| **3 — the auth stack** | #23+#24 as **one PR**, then #25 | Sequential by construction: you cannot see #24's 404 until #23's 401 is fixed. #25's deliverable is the shared `resolveClaimPaths` helper. | S, S, M |
| **4 — new validator gates** | #17 (`loom.containment-cycle`), #20 (`loom.aggregate-not-constructible`), #15 (ui topology), #19+#21 (validator-vs-emitter), **§3.5 ruling** then #9 | New `loom.*` codes carry the most bookkeeping (catalog entry, docs anchor, firing fixture, census row), so they batch. **§3.5 must be ruled before #9 moves**, and the ruling is a maintainer decision, not an agent's. | M each |
| **5 — the expensive ones** | #18 (page-lambda typing), #26 (lockfiles), #27 (If-Match) | Each has a genuine design fork or a one-way door. #18's corpus sweep across 280+ `.ddd` is the real work and must precede the severity choice. | M–L each |

**Parallelism.** Waves 0 and 1 are mutually independent and can run concurrently. Wave 2 is
per-backend and parallel within itself. The one true serialization is **§3.5 → #9**.

---

## 5. The durable fix — change what the gates measure

**Ten agents, ten subsystems, one answer.** Every agent was asked independently *"why did no gate catch
this?"*, and not one of them answered "the gate does not exist" or "the oracle is too weak". They all
answered the same thing:

> **The gates fail on REACH, not on POWER.** The checker that would catch the defect is already written,
> already correct, and already running on every PR — it has simply never been handed an input that
> reaches the code under test.

The evidence, measured rather than asserted:

- **F-025** fires only when the deployable is *named* `api`. 67 corpus fixtures name theirs `d`. `ddd new` scaffolds `api`. **Every real user hits the one shape the corpus does not have.**
- **F-033's** Angular gate literally contains the string `string[]` — in a `store { state { … } }` block, a position that structurally **cannot reach** `controlInit`. The gate names the thing and never touches it.
- **F-035's** broken .NET output **compiles green**. No compile gate can ever see it.
- **F-026's** python half passes `compileall`, `import app.main` and `ruff check`. Only `mypy --strict` sees it — and the shipped Dockerfile runs `uv sync --no-dev`.
- **F-012** needs a name where `lowerFirst(plural(n)) !== snake(plural(n))`. The fuzz generator's name pool (`test/_helpers/ddd-model-generator.ts:51`) is **eight single-word names**. Unreachable by construction.
- **Zero corpus fixtures** (measured, not estimated): use `!=` in a projection `where` · use `Chart` on a JSX frontend · put two contexts in one python deployable with a cross-context `X id` · contain **both** a `workflow` and a `function` · put `currentUser` in a find filter · contain `requires true` · cross `for` with `if let`.
- **Every OIDC gate** uses the password grant with no `scope`, against a fixture declaring only claims Keycloak already mints.
- **The wire-golden differential** — five backends, seven legs per PR, waiver registry currently **empty** — carries exactly **three** distinct validation messages across its whole corpus, all authored, and **no regex rule at all**. The arm that echoes a pattern to the client has no coverage in any tier.

This is `experience_gathered.md` §59/§63's recurring failure shape — *a check that never reaches the thing
it names* — reproduced at the **fixture** level rather than the assertion level. And it is why patching the
~80 defects from five audits will not converge: the sixth build will find another forty, in the same way,
for the same reason.

So the durable work is **seven fixture-and-reach changes**, not eighty patches. Every one of them is an
edit to a gate that already exists. None adds a CI leg except where noted.

### 5.1 Widen the fuzz generator's input space — **CORRECTED, and the correction matters**

> **Two things in the original version of this section were wrong, and both were found by doing it.**
>
> **(a) The deep leg was red because the GENERATOR was wrong, not the validator.** This section
> repeated agent G's reading that seeds 3/4/9 were "most likely a validator over-refusal". Reading the
> rule's own rationale settles it the other way — `workflow-own-state.ts:104` states that the saga row
> *"is loaded-or-allocated BEFORE the first statement runs and the key must therefore be certain by
> then"*, so `item := built.id`, where `built` is minted inside the create body, genuinely addresses no
> instance. The gate is right. The generator was emitting a shape Loom does not support, and the
> harness's `invalid` tier said so correctly. A second, independent generator defect sat underneath:
> it emitted a field `amount` beside a value object `Amount`, which .NET refuses by design
> (`loom.dotnet-name-collision`). Both are now fixed, and **the deep leg is green at 700 seeds × 5
> backends for the first time** (258 s, 0.35 s/seed — the header's estimate was right).
> Acting on this section as written would have widened a correctness gate to accommodate a broken test
> helper.
>
> **(b) Widening the generator cannot catch the compile-error family at all.** The claim that
> multi-word names are the *"highest yield per line in this whole report"* is false for most of what
> this evaluation found, and the reason is the **oracle**, not the inputs. The deep leg's four tiers
> are `invalid` / `verify` / `crash` / `sentinel` — it runs phases ①–⑧ and inspects the emitted TEXT.
> **It never compiles the output.** Mutation-proved: with F-025b's `global::` fix reverted and the
> generator emitting both an `api`-named deployable and messaged invariants (so
> `Localization/LoomMessages.cs` is emitted with the defect in it), 80 seeds × 5 backends stayed
> **green**.
>
> So the sharper statement of §5 is: **a gate's reach is bounded by its oracle as well as its inputs.**
> Widening the fuzzer helps the **crash / invalid / sentinel** family — F-012 and F-040 are crashes and
> are the right targets. The **compile-error** family (F-013, F-014, F-016, F-017, F-025, F-033, F-035
> — the majority of this register's S1s) can only be caught where a real toolchain runs, which is the
> corpus × backend build legs, fed by `test/fixtures/corpus/*.ddd` and **not** by the fuzzer. §5.7's
> fixture edits, not this section, are what close those.

**What landed here** (all green, and labelled for what they actually buy):

| Change | Buys |
|---|---|
| the two generator defects above, fixed | the tier stops reporting vacuous `invalid` seeds — every other assertion on those seeds was meaningless |
| `NAMES` grows `WorkOrder` / `LineItem` / `PurchaseOrder` | the only way any seed can separate `lowerFirst(plural(n))` from `snake(plural(n))`; necessary for F-012's family, **not sufficient** (see below) |
| the deployable name is drawn from `{api, d}` | `api` is what `ddd new` scaffolds and what no fixture used; it is the name that creates the `Api.Api` child namespace behind F-025 |
| invariants carry a `message` on ~half of seeds | the validation-message catalog is emitted at all — it never was |
| `assertNoTypeNameCollisions()` at import | the `amount`/`Amount` collision cannot be reintroduced by a future pool edit |

**Still open, and honestly out of reach today:** F-012 additionally needs a **second backend
deployable** and a `test e2e` block, neither of which the generator emits. That is the `M` item below
and it is what would actually make F-012's class reachable — the multi-word names alone cannot.



`test/system/pipeline-fuzz.test.ts` already asserts the exact invariant — its describe block reads
*"a crash on a valid model is always a bug"* — runs **on every PR**, and costs **13 seconds**. Its deep
sibling has a four-tier oracle, a shrinker that prints a corpus-ready `.ddd`, and a `LOOM_FUZZ_SEEDS`
replay hatch. **The oracle would have judged F-012, F-040 and F-011 correctly. It never saw them**, because
the model generator cannot express the shapes:

| Generator limit | `file:line` | Finding it hides |
|---|---|---|
| 8 names, **all single-word** | `ddd-model-generator.ts:51` | F-012 (and its unknown siblings — multi-word names cross `lowerFirst(plural)` vs `snake(plural)`, `pascal` vs `snake`, and `camelId` boundaries in **every** emitter) |
| every containment is a fixed leaf | `:138-144, :302-303` | F-040 |
| exactly one backend deployable; no `test e2e` block ever | `:157, :414` | F-012's actual precondition |

Adding `WorkOrder`, `LineItem`, `PurchaseOrder` to line 51 is **one line**. Part-in-part and cyclic
containment is **S**. A second deployable plus `test e2e` blocks is **M**.

**Two preconditions, both real:**
1. **The deep leg is red right now, and most likely for the wrong reason.** Seeds 3/4/9 (2.5%) fail with `loom.workflow-create-correlation-unsupplied` on a model that **does** supply the key — `item := built.id`, the canonical "create, then correlate on the new id" starter. The gate accepts only `item := <param>`. So this reads as a **validator over-refusal**, not a generator defect — and the harness confidently blames the generator, which is the misattribution that trains people to ignore the gate. Resolve this *before* widening.
2. **The generator is an unmaintained fourth writer of `.ddd`** (after humans, `ddd patch`, the visual builder). Every new phase-④/⑦ gate can make it emit invalid models, driving the `invalid` tier up and making every other assertion on that seed vacuous. #2896 alone mints four new refusals. Widening without owning that feedback loop buys a check that goes red for reasons unrelated to the code under test.

Then wire the deep leg **nightly**, not per-PR: measured at **0.37 s/seed** on this box, 3500 seeds × 5
backends ≈ **22 min** (the header's 12 min estimate is stale). The shallow leg stays the per-PR rung.

**One ladder rung is missing and should be added before the widening lands:** `checkAllBackends` returns
the **first** failure across five platforms, so a model that one backend refuses and four accept is
reported as whatever tier the first failing backend produced. Widening will make that class common. The
ladder needs a fifth rung — `divergence`.

### 5.2 Field-shape × target coverage matrix — *the one that catches the frontend class*

A per-*target* corpus floor would **not** have caught F-032 or F-033 — Angular already had a dedicated
`generated-angular-build.test.ts` with four cases including a full scaffold, and the defect shipped anyway.
A per-**shape**-per-target floor catches both.

Derive it rather than hand-maintain it, using the ratchet pattern the repo already uses twice
(`walker-stdlib-completeness.test.ts`, `heex-parity.test.ts`):

1. Enumerate the field shapes a scaffolded form must render, from the IR type vocabulary — ~14: `string`, `int`, `decimal`, `money`, `bool`, `datetime`, `enum`, `File`, `X id`, `X id?`, `T?`, `T[]` (scalar), `VO`, `VO[]`.
2. For each of the four `generated-*-build.test.ts` gates plus feliz/flutter, assert the scaffold case's aggregate covers **every** shape.
3. Missing shape → failure naming the shape and the gate, with a **ratcheting** waiver list (a fix deletes its waiver in the same PR).

**Cost: one test file, ~12 fields added to four existing scaffold fixtures. No new `.ddd` files, no new CI
legs, no new runner slots** — it makes the existing per-pack build matrices actually reach what they claim.
Under it, **F-033 fails on day one** (`T[]`-scalar uncovered in the Angular gate) and **F-032 would have
failed the same way** (`X id?` uncovered in the vue gate — exactly the hole #2885 closed by hand).
By-product: it immediately surfaces the stale honesty in #14.

**LANDED, and it found more than F-033.** `test/system/frontend-field-shape-coverage.test.ts` reads
the same corpora the four frontend build gates build — the shared `*-build-cases.ts` manifests where
they exist, the inline `Case` sources where they don't — strips `store`/`state` blocks (the position
that made Angular *look* covered), and measures which of fourteen field shapes each gate can actually
fail on. Fast tier, no toolchain, no network: its job is to decide whether the expensive gates are
pointed at the right models.

Measured on landing:

| frontend | shapes its build corpus cannot fail on |
|---|---|
| react | — (all fourteen; the widest corpus, and the only frontend this evaluation found no form defect on) |
| vue | `decimal`, `datetime`, **`scalar-array`**, `file` |
| svelte | **`id-ref-optional`**, **`scalar-array`** |
| angular | `id-ref`, **`id-ref-optional`**, **`scalar-array`**, `file` |

Read together those rows say something sharper than the plan predicted:

* **`scalar-array` is missing from all three.** That is F-033's shape exactly (`skills: string[]` →
  `FormControl(null)` → `ng build` failure), and it explains how one defect shipped past four
  per-framework build gates at once.
* **`id-ref-optional` is missing from svelte *and* angular.** That is F-032's shape — and #2885 closed
  it by adding the shape to the **vue** gate. The fix was right and the corpus edit was right; what
  neither did was ask whether the sibling gates were blind to the same class. They are.

The entries are recorded as named debt, not policy, and the gate ratchets both ways —
mutation-proved: a **stale** waiver fails (*"MISSING lists string, but the corpus now covers it"*),
and a **new** gap fails (removing `items: LineItem[]` from the angular fixture →
*"MISSING SHAPES -> vo-array"*). Closing an entry means adding the field to that gate's scaffolded
aggregate, which makes the gate BUILD the shape — so for `scalar-array` on angular the entry is
deleted by the PR that fixes F-033, per the repo's convention that a fix deletes its waiver. Landing
the gate first is deliberate: it turns an invisible gap into a tracked number.

### 5.3 Module-symbol-resolution sweep — *prototyped, 0 false positives*

**F-027 is the eleventh instance of one sentence: "a python emitter referenced a name it did not import."**
`experience_gathered.md` §104 got the method right; what it under-specified is the **axis**. The question to
sweep is *"does every name in this module resolve?"* — not *"is this particular alias imported?"*

Agent D prototyped it: it runs in the **fast tier**, needs no python toolchain, found **all three** live
instances across two generated trees, and produced **zero false positives on six trees**. #2881's own
follow-up note names the right home: *"one neutral `idTargetsOf(type)` in `src/ir/util/`"*.

Note for the register: #2881's body attributes the missing gate to **M-T9.59**. That is a misattribution —
M-T9.59 is the `*-unsupported` suffix-register hole. **There is no unresolved-symbol-gate mission anywhere
in `docs/new-plan/`.** This is that missing mission.

### 5.4 A TSX/markup parse gate on generated frontend output

F-017 emitted seven TypeScript **parse** errors and every gate stayed green. Agent E prototyped the check
(`parse-tsx.mjs`): run each emitted `.tsx` through `ts.createSourceFile` and assert `parseDiagnostics` is
empty. It correctly split mantine-broken from chakra/mui/shadcn-OK across all eight React packs. Pure,
fast-tier, no `npm install`, no build. **This is a syntax floor under every pack × every primitive** — the
level at which a `.hbs` typo becomes unshippable rather than undetected.

### 5.5 A runtime image-existence leg

F-020 shipped because **no CI job has ever pulled the object-store image**. `docker manifest inspect` on
every image the composer can emit, from a pin table that is the single source of truth (so the emitter and
the gate cannot disagree), catches this class — including the next registry that disappears. Seconds, no
boot. Agent H's second recommendation, equally cheap: **one OIDC gate that drives the real code flow**
(`/auth/login` → `/auth/callback`) rather than the password grant — that single leg covers #23, #24 and #25,
which are three symptoms of one untested path.

### 5.6 Execute the fenced `ddd` blocks in the docs

`test/system/archived-docs-fence.test.ts` already walks every live doc and resolves relative `.md` links.
It checks too narrow a slice — **one line** (`:129`) restricts it to `old/` and `audits/`, which is why
`docs/channels.md:19` slipped through. Agent J simulated the widening: **1,473 links, 2 failures** — one
real, one placeholder to waive. Three changes, no network, no new file:

1. Delete `:129` (the `seen > 40` reach-assertion generalises to `seen > 1000`).
2. Add `README.md` to `liveDocs()` — **the repo's most-read file is currently outside the only doc gate there is.**
3. Add a stale-host denylist (`lemmit.github.io`, `github.com/lemmit/`) widened to `src/`, `web/src/`, `docs/index.html`, `docs/build.mjs`. Ten lines — this is all of F-043 including the 60-hit tier, and it ratchets.

**The higher-yield half: validate the fences.** Collect every ` ```ddd ` fence in `README.md`, `docs/*.md`
and `docs/language-reference/*.md` and run each through `validate()` from `src/api/` — already browser-safe
on `EmptyFileSystem`, so it runs in the fast tier with no CLI spawn. Deliberate fragments carry a
`<!-- loom-doc-fence: fragment -->` marker, and the marker list ratchets.

- **Catches F-005 outright** — `docs/tenancy.md`'s §Surface is a parse error *today*.
- **Catches the entire class #2861 §3 fixed by hand** — five retired spellings across README/`workflow.md`/`traceability.md` — and stops it re-accreting.
- **Mutation proof is free**: revert the `crossTenant` word order and the gate goes red naming that fence.

Executing fenced **`bash`** blocks is not worth it (most need a booted stack; the yield is one finding a
fence validator cannot see anyway). Cover the CLI examples the cheap way instead: assert every
`ddd <subcommand> --flag` appearing in a docs fence is a flag the corresponding Commander command declares
— a pure string check against `src/cli/main.ts`. Point it at **diagnostic messages** too and it would have
caught `loom.persistence-mode-unsupported`'s invented `dataSource X { … }` suggestion.

### 5.7 Fixtures that cost two lines and close a whole tier

Three of the biggest blind spots close with fixture edits, not new machinery:

| Gate | Edit | Closes |
|---|---|---|
| `test/fixtures/corpus/validation-messages.ddd` | add a `matches(...)` rule with **no** `message`, and one `expect(...).toThrow(422)` that violates a message-less bound | **F-034b** — converts an invisible four-backend divergence into a five-way diff on the next PR, at **zero** new CI boot cost. The differential is wired into seven legs and has never once been handed a message-less denial. |
| any corpus fixture | add `requires true`; add a find filter reading `currentUser.<claim>`; cross `for` with `if let` | **F-030B, F-029, F-028** — three backends, three gates that already run, three shapes none has ever seen |
| the `ts-build` corpus set | one fixture carrying a VO holding an `X id`, a workflow whose state field is an enum, and a `managed` field with a declared default | #2864's D2/D3/D4 — *"each **one fixture** away from being impossible"* |

### 5.8 A census ratchet with a known blind spot

`test/system/ir-walk-census.test.ts` is the right idea and it **did not see F-028**: its documented shape #2
requires an `if (x.kind === "a") … else if …` **chain**, and `reposUsed` uses four *sequential, independent*
`if` statements with no `else`. It also enforces kind-**exhaustiveness**, not traversal **depth** — which is
why F-004's shallow-but-exhaustive dispatch is sanctioned, and why `api-checks.ts` hand-rolled its own deep
walk (`forEachStmtDeep`) while its neighbour in the same directory stayed shallow. **Two checks, one
directory, one union, two different depths.**

Widening shape #2 to count non-chained `if (<recv>.kind === …)` statements within a function body is the
durable fix, but it is honestly an **L**: a first pass over `src/generator` + `src/platform` surfaces ~76
such statements across ~12 files, each needing triage into migrate / `never`-check / waive. **Mint it as its
own mission** rather than bundling it into #5.

---

## 6. What this plan does not cover

Stated plainly, because the report's coverage section applies here too:

- **It plans; it does not implement.** Nothing in the Loom tree was modified and no PR was opened, per the evaluation contract. Every root cause carries a `file:line` verified on `9a8f2fe0`, and every plan carries a mutation proof to run — but **no mutation proof has been executed**, because executing one means editing the tree.
- **Effort estimates are S/M/L judgements from reading the code, not measurements.** The ones I would distrust most are #18 (M–L, whose real cost is a corpus sweep nobody has run) and #26 (L, which has an unresolved design fork).
- **Three findings were re-verified by static reading only**, and are labelled as such in their cluster reports. The F-035 correction in `FINDINGS.md` exists precisely because I previously filed a static inference as a verified result; that error was caught by two agents independently, and it is the reason every row above names the command that produced its evidence.
- **The claim check is a snapshot.** `main` moved 93 commits during the evaluation and ~30 PRs are open. Two findings were already fixed or claimed in that window and one more (#2885) landed *during* the fleet run. Re-run the claim check before starting any row.
