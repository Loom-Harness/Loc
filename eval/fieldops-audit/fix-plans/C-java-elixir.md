## 1. Verification table

| Finding | Verdict | Claimed? | Evidence (real output) |
|---|---|---|---|
| **F-028** java — repo used only in `if let` inside `for` never injected | **LIVE** | **UNCLAIMED** (no open PR touches `src/generator/java/emit/workflow.ts`) | `gradle testClasses` on `/tmp/agentC/out-f028/api`: `error: cannot find symbol / symbol: variable partsRepository / location: class CWorkflows` ×2 (lines 30, 33) → `BUILD FAILED in 1m 55s` |
| **F-035 java half** — two `onCreate` capabilities, one dropped | **CHANGED — not a defect on java** (misdiagnosis) | n/a | Java routes `createdAt`/`createdBy` through Spring Data JPA auditing, not `_stampOnCreate`. `gradle testClasses` → `EXIT=0` |
| **F-029** elixir — `currentUser` in a find filter → unbound Ecto var | **LIVE** | **UNCLAIMED** (file overlap with #2852, #2861 — see §4) | `mix compile`: `** (Ecto.Query.CompileError) unbound variable \`current_user\` in query. If you are attempting to interpolate a value, use ^var` at `lib/api/c/thing_repository.ex:80: Api.C.ThingRepository.mine/0` |
| **F-030** elixir — `mix compile --warnings-as-errors` fails | **LIVE, both halves** | **UNCLAIMED** | 6 × `warning: the underscored variable "__dt"/"__s"/"__d"/"__other" is used after being set` at `lib/api/c.ex:54-59` + `warning: the following conditional expression will always evaluate to false: not true … typing violation found at: 106 │ if not (true) do` → `Compilation failed due to warnings while using the --warnings-as-errors option`, `EXIT=1` |

Repro commands (fresh main `9a8f2fe0`, `cd /tmp/loom-main`):
- F-028: `node bin/cli.js generate system /tmp/repro/java-missing-repo-injection.ddd -o /tmp/agentC/out-f028` then the gradle recipe.
- F-029: `node bin/cli.js generate system /tmp/repro/elixir-currentuser-find.ddd -o /tmp/agentC/out-f029` then the hexpm recipe.
- F-030: `/tmp/agentC/f030.ddd` (crudish + `at: datetime` + `operation reschedule(when_: datetime)` + `find named(...) requires true`), same recipe with `mix compile --force --warnings-as-errors`.
- F-035 java: `sed 's/platform: dotnet/platform: java/' /tmp/repro/dotnet-two-oncreate-stamps.ddd` → `/tmp/agentC/java-two-oncreate-stamps.ddd`.

## 2. Claim check (step 2)

| PR | Covers my cluster? | Note |
|---|---|---|
| **#2907** (draft, Wave C2 batch 1) | **No claim, but fences overlap** | Packet 2d fences `src/generator/java/**`, 2a fences `src/generator/elixir/**`. Its rows are named *register* rows (`MAX_OPEN_GAPS`, `*-unsupported` codes); none of them is repo-injection, currentUser-in-find, or `--warnings-as-errors` hygiene. Coordinate on files, not on claim. |
| **#2852** (envelope carrier) | No — but **touches `src/generator/elixir/vanilla/repository-emit.ts` and `find-controller.ts`** | Both are F-029 fix sites. Real conflict risk. |
| **#2901** (nested VO, java mapper) | No | Touches only `src/generator/java/emit/service.ts`. |
| **#2870** / **#2906** (Phoenix LiveView / filter bar) | No | HEEx side only (`heex-*`, `liveview-emit.ts`); no vanilla repo/controller/context files. |
| **#2864 / #2865 / #2862** | No | Three-dot diffs touch no java/elixir generator file. |
| **#2861** | No | Touches `src/generator/elixir/vanilla/find-controller.ts` (query-projection route half) — minor conflict risk with F-029/F-030. |

Verified by `git diff --name-only origin/main...origin/<branch>` on every open PR head.

## 3. Fix plans (LIVE + UNCLAIMED)

### F-028 — java workflow repository injection · effort **S**

**Root cause.** `src/generator/java/emit/workflow.ts:169-183`, `reposUsed()`:

```ts
const visit = (s: WorkflowStmtIR): void => {
  if (s.kind === "factory-let") aggs.add(s.aggName);
  if (s.kind === "repo-let") aggs.add(s.aggName);
  if (s.kind === "repo-run") aggs.add(s.aggName);
  if (s.kind === "repo-delete") aggs.add(s.aggName);
  if (s.kind === "for-each") {
    for (const save of s.savesPerIteration) aggs.add(save.aggName);
    for (const b of s.body) visit(b);
  }
};
```

Two independent holes: `if-let` is not in the kind set at all (its `aggName` is the repo the emitter calls at `workflow.ts:398`), and the recursion descends only into `for-each.body` — never `if-let.thenBody`/`elseBody`. The constructor is built from this set at `:843-931`, so the body references a field that was never declared.

**Concrete change.** Mirror the sibling that is already correct — `src/generator/java/emit/explicit-handlers-emit.ts:78-97` rides `walkWorkflowStmtsDeep` and *does* include `if-let`:

```ts
export function reposUsed(wf: WorkflowIR, ctx: EnrichedBoundedContextIR): string[] {
  const aggs = new Set<string>();
  for (const s of wf.statements) {
    walkWorkflowStmtsDeep(s, (st) => {
      if (st.kind === "factory-let" || st.kind === "repo-let" || st.kind === "repo-run" ||
          st.kind === "repo-delete" || st.kind === "if-let") {
        aggs.add(st.aggName);
      } else if (st.kind === "for-each") {
        for (const save of st.savesPerIteration) aggs.add(save.aggName);
      }
    });
  }
  for (const save of wf.savesAtExit) aggs.add(save.aggName);
  return [...aggs].filter((a) => ctx.aggregates.some((x) => x.name === a)).sort();
}
```
Also add `savesInThen`/`savesInElse` aggNames on the `if-let` arm — they are the other `repoField(...)` sites (`:390-395`). (In practice they resolve to nested `factory-let`s the walker already visits, but the emitter reads those arrays directly, so derive from the same source it reads.)

`walkWorkflowStmtChildren` (`src/ir/util/walk.ts:205-250`) already descends `if-let.thenBody`/`elseBody` and is `never`-checked, so a 15th `WorkflowStmtIR` kind breaks the build rather than silently dropping a repo.

**Required companion edit.** The migrated form is an `if/else-if` chain naming ≥3 kinds, so `test/system/ir-walk-census.test.ts` *will* see it. Add, beside the identical sibling at line 401:
```ts
"src/generator/java/emit/workflow.ts#reposUsed": DELEGATES_TO_SANCTIONED_WALKER,
```

**Test to add.** `test/generator/java/java-workflow-repo-injection.test.ts` — generate the `/tmp/repro/java-missing-repo-injection.ddd` model, assert the emitted `CWorkflows.java` constructor parameter list and field list contain `PartRepository partsRepository` *and* that every `repoField(...)` identifier appearing in the method body also appears as a `private final` field (a string-free structural assertion, so it survives naming churn). Cover both nestings: `for → if let` and `if let → for`.

**Mutation proof.** `cp src/generator/java/emit/workflow.ts /tmp/agentC/workflow.ts.bak`, revert `reposUsed` to the sequential-`if` form, run the new test → must fail on the *missing-field* assertion (read which assertion failed, not just that one did), then `cp /tmp/agentC/workflow.ts.bak src/generator/java/emit/workflow.ts`. **Never `git checkout -- <path>`** (CLAUDE.md §84). Second-order proof: the gradle compile above goes `BUILD FAILED` → `EXIT=0`.

**Blast radius.** Java only; `reposUsed` has one call site (`:620`). Output for any workflow without an `if-let`/nested repo use is byte-identical (the added kinds contribute nothing). node/.NET/python already emit this model correctly. `test/system/ir-walk-census.test.ts` must be updated in the same PR or it goes red.

**Corpus blind spot to close at the same time.** No corpus fixture crosses `for` with `if let` — verified: `for f in test/fixtures/corpus/*.ddd; do grep -qE '^\s*for .* in ' $f && grep -q 'if let' $f && echo $f; done` returns nothing. Adding that crossing to a corpus fixture is what makes `java-build.yml` catch the class, not just this instance.

### F-029 — elixir `currentUser` in a find filter · effort **M**

**Root cause — two independent halves.**

1. **Arity/threading.** `src/generator/elixir/vanilla/repository-emit.ts:180`:
   `const principal = aggregateUsesPrincipalContextFilter(agg);`
   `principal` is derived *only* from the aggregate's capability (tenancy) context filter. It never asks whether *this find's own* filter reads the principal. The same aggregate-level predicate keys the other two call sites: `src/generator/elixir/vanilla/context-emit.ts:386` (facade `defdelegate` arity, args built at `:487-491`) and `src/generator/elixir/vanilla/find-controller.ts:191` (controller call arg, at `:225`).
2. **Pinning.** `src/generator/elixir/vanilla/repository-emit.ts:609-610` renders the declared filter raw:
   ```ts
   if (f.filter) { whereExpr = renderExpr(f.filter, renderCtx); }
   ```
   and `src/generator/elixir/render-expr.ts:500-501` returns bare `"current_user"` for the `current-user` ref regardless of `ctx.filterArgs`. The capability path never hits this because it goes through `renderPrincipalFilter`/`pinPrincipal` (`src/generator/elixir/vanilla/capability-filter.ts:48-64`) — which is exactly why the compiler-generated tenant conjunct pins correctly on the same line while the author-written one does not.

**Which backend elixir should copy: node / python / .NET** (all three thread the principal as an explicit trailing repository parameter; java is the odd one out and should *not* be copied).

| Backend | Emitted signature | Body |
|---|---|---|
| node | `async mine(currentUser: User): Promise<Thing[]>` | `eq(schema.things.ownerTag, currentUser.ownerTag)` |
| python | `async def mine(self, current_user: User) -> list[Thing]:` | `ThingRow.owner_tag == current_user.owner_tag` |
| .NET | `Task<List<Thing>> Mine(User currentUser, CancellationToken …)` | `x.OwnerTag == currentUser.OwnerTag` |
| java | `List<Thing> mine();` | `@Query("select e from Thing e where e.ownerTag = :#{@currentUserAccessor.user()?.ownerTag()}")` — a SpEL bean deref, no parameter |

Elixir already *has* the node/python/.NET parameter shape for the tenancy path (`current_user \\ nil` threaded from `conn.assigns`), so this is widening an existing seam, not inventing one.

The decision predicate already exists and is shared: **`findUsesCurrentUser(find)`**, `src/ir/types/loom-ir.ts:4158`. node uses it at `src/platform/hono/v4/routes-builder.ts:2167`, python at `src/generator/python/repository-builder.ts:487`, .NET at `src/generator/dotnet/emit/dapper.ts:1486`. **`src/generator/elixir/` never imports it** (`grep -rn findUsesCurrentUser src/generator/elixir/` → empty).

**Concrete change.**
- `repository-emit.ts`: keep aggregate-level `principal` for the CRUD reads; at the per-find call (`:217`) pass `principal || findUsesCurrentUser(f)`. `headFor()` (`:565-571`) already derives the underscore-vs-name from whether the rendered body mentions `current_user`, so the un-underscored name follows automatically once the body pins.
- `repository-emit.ts:609-610`: route the declared filter through the principal renderer — `exprUsesCurrentUser(f.filter) ? pinPrincipal(renderExpr(f.filter, renderCtx)) : renderExpr(...)`. `pinPrincipal` is currently module-private at `capability-filter.ts:48`; export it (or export `renderPrincipalFilter`, which also handles the `guid-from-string` self-scope case). Output becomes `record.owner_tag == ^(current_user && current_user.owner_tag)` — nil-safe and fail-closed, matching the tenancy conjunct on the same line.
- `context-emit.ts:386` + `:490` and `find-controller.ts:191` + `:225`: widen the same way, per-find, so the facade arity and the controller's `current_user` argument match the repository head. `find-controller.ts` already imports `exprUsesCurrentUser` (`:17`) and computes `gateUsesUser` per find — extend `cuLine`/`argReads` with the filter case.
- `@spec` arg lists (`:628-630`, `:588`) must gain `map() | nil` on the same condition.

**Test to add.** `test/generator/elixir/vanilla-find-currentuser.test.ts` — assert (a) `def mine(current_user \\ nil)` (not `_current_user`, not arity 0), (b) the `where:` contains `^(current_user && current_user.owner_tag)` and no bare `current_user.`, (c) the facade `defdelegate mine_thing(current_user \\ nil)` and (d) the controller binds `current_user = Map.get(conn.assigns, :current_user)` and passes it. Plus a **corpus fixture** `test/fixtures/corpus/find-principal-filter.ddd` (or a clause on an existing one) wired into the elixir + node + python + java + dotnet legs — `grep -rln "where.*currentUser\." test/fixtures/corpus/*.ddd` is currently empty; the only corpus `currentUser` read is a *gate* (`read-gates.ddd:58: find all(): Order[] requires currentUser.role == "agent"`), which is a different code path. That fixture is what makes `corpus-elixir-build.yml` catch this class.

**Mutation proof.** Copy `repository-emit.ts` aside, revert the `principal || findUsesCurrentUser(f)` widening only → the new test must fail on the *arity* assertion; restore, then revert the `pinPrincipal` routing only → must fail on the *pin* assertion. Two separate mutations, because the two halves are independent and a single-mutation proof would leave one untested. End-to-end proof: the hexpm `mix compile` above goes from `Ecto.Query.CompileError` to a clean `Generated api app`.

**Blast radius.** Elixir only; every aggregate with no `currentUser` in any declared find filter is byte-identical (the new disjunct is false). **Conflict risk: #2852 edits `repository-emit.ts` and `find-controller.ts`; #2861 edits `find-controller.ts`.** Land after #2852 or rebase onto it.

### F-030 — generated Phoenix fails `--warnings-as-errors` · effort **S**, two independent halves

Both halves are LIVE and the gate (`corpus-elixir-build.yml`, a per-PR check running `mix compile --warnings-as-errors`) is real — it simply has no fixture that reaches either site.

**Half A — emitter hygiene (6 of the 7 warnings).** `src/generator/elixir/vanilla/context-emit.ts:243`, `coerceOpParam`'s `datetime` arm emits `__dt` / `__s` / `__d` / `__other` — leading-underscore names that are then *read*. Elixir warns on exactly that. These are genuine live bindings; the underscores are simply wrong.
*Change:* rename to `dt` / `s` / `d` / `other` (or `coerce_dt` etc. if shadowing is a concern — they live inside a `case` clause, so plain names are safe).
*Test:* `test/generator/elixir/vanilla-op-param-coercion.test.ts` — assert the emitted `datetime` coercion contains no `/\b__[a-z]/` identifier. Better: a **generic** assertion over the whole emitted elixir tree that no `_`-prefixed binding is read, which catches the next instance too.
*Mutation:* restore the underscores → test fails; `mix compile --warnings-as-errors` goes `EXIT=1` → `EXIT=0`.
*Blast radius:* elixir only, one function, one `TypeIR` arm.

**Half B — the `requires true` gate (the 7th).** `find-controller.ts` emits `if not (true) do` for `find … requires true`. Elixir 1.18's type system reports it as a *typing violation*, not a style warning. This is **not** the `requires` lowering — javac/csc/tsc/python all accept their equivalent dead branch (`if (!(true)) throw new ForbiddenException(...)` on java), and four corresponding golden tests pin that spelling (`test/generator/{elixir,java,dotnet,typescript}/*-find-gate.test.ts`).
*Recommended change (elixir-local, S):* in `find-controller.ts`'s `wrap()`, when `f.requires` is the boolean literal `true`, skip the guard entirely — byte-identical to an ungated find, and semantically exact (`requires true` is the documented "intentionally public" escape, which never 403s). Update `test/generator/elixir/phoenix-find-gate.test.ts` in the same PR.
*Rejected alternative (name it in the PR body):* constant-folding a literal-`true` `requires` in phase ⑤ would fix all five backends at once, but it rewrites four backends' golden output for zero defect on those four — wrong trade for this change. Worth minting as a separate mission if the register wants one spelling.
*Test:* extend `phoenix-find-gate.test.ts` with a `requires true` find asserting no `if not (` wrapper is emitted; add `requires true` to a corpus fixture so the compile gate covers it (`grep -rln "requires true" test/fixtures/corpus/*.ddd` → currently empty).
*Mutation:* re-emit the wrapper → the corpus elixir leg fails with the quoted typing violation.
*Blast radius:* elixir only; a `requires <non-literal>` find keeps today's output exactly.

## 4. Independent rulings

### F-035 root-cause layer — I **disagree** with the "shared capability-stamp merge" hypothesis

The shared layer is **provably fine**, and the java half is **not a defect**.

- **The IR carries both capabilities' rules.** `auditable` (`src/macros/prelude.ts:66-71`) contributes `createdAt := now()`, `createdBy := currentUser` (a *bare* ref) on create plus `updatedAt`/`updatedBy` on update; `tenantOwned` contributes `tenantId := currentUser.tenantId`, `dataKey := currentUser.orgPath` (*claim* refs). Both land in `agg.contextStamps`.
- **Java honors both, by design, on two mechanisms.** `claimStampsFor` (`src/generator/java/emit/entity.ts:214-227`) is a `.filter(...).flatMap(...)` over *all* rules — it cannot drop a second capability. Its doc comment states the split explicitly: *"A BARE `currentUser` value is excluded — it rides the @CreatedBy/@LastModifiedBy annotation path instead."* The generated `Thing.java` carries `@EntityListeners(AuditingEntityListener.class)`, `@CreatedDate @Column(name="created_at", updatable=false) Instant createdAt`, `@CreatedBy … String createdBy`, and `JpaAuditingConfig` wires `@EnableJpaAuditing(auditorAwareRef="auditorProvider")` over a `ThreadLocal`-backed `CurrentUserAccessor` (no request-scoped-proxy hazard). `_stampOnCreate` is *supposed* to carry only the two claim-valued tenancy stamps. `gradle testClasses` → `EXIT=0`.
- **.NET's bug is per-backend and I can name the line.** `src/generator/dotnet/emit/auditable-interceptor.tpl.ts:157-158`:
  ```ts
  const onCreate = rules.find((r) => r.event === "create")?.assignments ?? [];
  const onUpdate = rules.find((r) => r.event === "update")?.assignments ?? [];
  ```
  `.find` takes the **first** matching rule and discards the rest. With two capabilities each contributing a `create` rule, the second is silently dropped — which is exactly the observed output: the `EntityState.Added` block stamps `TenantId` + `DataKey` (tenantOwned, first) and nothing else, while `UpdatedAt`/`UpdatedBy` survive because only `auditable` contributes an `update` rule. Fix: `.filter(r => r.event === "create").flatMap(r => r.assignments)` on both lines.

Every other backend already uses the collecting form — python `src/generator/python/routes-builder.ts:813` (`.filter(...).flatMap(...)`), elixir `src/generator/elixir/vanilla/stamp-emit.ts:43,159` (`.flatMap(...)`). **Ruling: per-backend, in .NET's `renderArm`. No shared file needs to change.** The .NET agent should not wait on a shared-layer fix.

*Residual risk, distinct from F-035, worth a separate note:* `auditorProvider` returns `Optional.ofNullable(accessor.user()).map(u -> u.id())` and `_stampOnCreate` returns early on a null principal — so a **non-request save** (seed / system path) leaves `created_by` and `tenant_id` null against `NOT NULL` columns. Unverified (needs a booted stack, not a compile). Affects java and .NET alike, and is the *real* version of the "500 on create" symptom F-035 described.

### Is F-028 a hand-rolled-walk instance? **Yes — unambiguously.**

`reposUsed` re-derives its own child enumeration over `WorkflowStmtIR` instead of riding `src/ir/util/walk.ts`. The fix is "migrate onto `walk.ts`", not "add one more case" — and the correct migration already exists 400 lines away in the same backend (`explicit-handlers-emit.ts:78-97`, already waived in the census as `DELEGATES_TO_SANCTIONED_WALKER`). The comment immediately *above* the defective function documents the identical defect being fixed once already (M-T6.50, `workflowUsesCurrentUser`) — the author migrated the neighbour and left this one.

**Secondary finding — the census has a detector blind spot.** `npx vitest run test/system/ir-walk-census.test.ts` → `5 passed` on fresh main, i.e. the census does not see this site. Its documented shape #2 requires an `if (x.kind === "a") … else if (x.kind === "b") …` **chain**; `reposUsed` uses four *sequential, independent* `if` statements with no `else`, so it falls through both detectors. Widening shape #2 to count non-chained `if (<recv>.kind === …)` statements within one function body is the durable fix, but it is a separate **L** mission — a first pass over `src/generator` + `src/platform` surfaces ~76 such statements across ~12 files (`src/generator/dotnet/workflow-emit.ts` 29, `src/generator/typescript/repository-find-predicate.ts` 22, `src/platform/hono/v4/workflow-builder.ts` 14, …), each needing triage into migrate / `never`-check / waive. Recommend minting it rather than bundling it into F-028.