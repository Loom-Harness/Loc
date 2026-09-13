All verification complete. Here is the report.

---

# 1. Verification table

| Finding | Status | Claimed? | Evidence (fresh `main` @ `9a8f2fe0`) |
|---|---|---|---|
| **F-035** two `onCreate` stamps, one silently dropped | **LIVE** | **UNCLAIMED** | `AuditableInterceptor.cs` stamps `TenantId`/`DataKey` only; `CreatedAt`/`CreatedBy` absent while `Migrations/…_S_Initial.cs:39` declares `"created_by" TEXT NOT NULL`. Control (`auditable` alone) correct. **Project builds green** — no compile gate can see it. |
| **F-025** .NET channel transport unqualified namespace | **LIVE** | **UNCLAIMED** | `dotnet build -warnaserror` → `ChannelTransport.cs(239,26)` + `(244,13)`: `error CS0234: … 'Infrastructure' does not exist in the namespace 'Api.Api'` |
| **F-025b** *(NEW — found by the sweep)* `Localization/LoomMessages.cs` same hazard | **LIVE** | **UNCLAIMED** | `LoomMessages.cs(31,22): error CS0234 … in the namespace 'Api.Api'` **+ 4 cascading errors**. Any messaged `check`/`invariant` on dotnet. |
| **F-026** (.NET half) workflow calls a `private` method | **LIVE** | **UNCLAIMED** | `GiveHandler.cs(37,21): error CS0122: 'Tech.HasSkill(string)' is inaccessible due to its protection level` |

Claim check: I read #2901, #2872, #2852, #2903 and listed all 30 open PRs. #2872/#2901 are value-object work; #2852 touches `dotnet/emit/{common,dapper,repository}.ts` + `find-emit.ts` — none of my four sites. #2907 (draft) fences `src/generator/dotnet/**` for packet 2b, but its enumerated rows are `unsupported-register` gaps (`tph-filter-unsupported`, `dapper-unsupported`, …) — disjoint from all four. **Coordination note:** whoever lands these should cite #2907's fence, since 2b claims the tree.

---

# 2. THE RULING on F-035 — root cause is the **.NET emitter**, not any shared derivation

**The IR is correct.** Dumped from the repro through `lowerProject` → `enrichLoomModel`:

```
AGG Thing caps=["auditable","tenantOwned","versioned"]
stamps=[{"e":"create","f":["tenantId","dataKey"]},
        {"e":"create","f":["createdAt","createdBy"]},
        {"e":"update","f":["updatedAt","updatedBy"]}]
```

Both `create` rules are present and distinct, exactly as `loom-ir.ts:647` specifies: *"Composes additively — N stamping declarations yield N rule sets concatenated per event."*

**The defect is one line.** `src/generator/dotnet/emit/auditable-interceptor.tpl.ts:157-158`:

```ts
const onCreate = rules.find((r) => r.event === "create")?.assignments ?? [];
const onUpdate = rules.find((r) => r.event === "update")?.assignments ?? [];
```

`.find()` returns the **first** matching rule and discards the rest. Every other consumer in the tree reads the array additively:

| consumer | pattern | correct? |
|---|---|---|
| `typescript/emit/audit-stamp.ts:58` | `.filter(s => s.event === event).flatMap(s => s.assignments)` | yes |
| `python/routes-builder.ts:813`, `python/emit/aggregate.ts:635` | `.filter(…).flatMap(…)` | yes |
| `elixir/vanilla/stamp-emit.ts:159` | `.filter(r => events.includes(r.event)).flatMap(…)` | yes |
| `java/emit/entity.ts:381` | `for (const rule of entity.contextStamps ?? [])` | yes |
| **`dotnet/emit/auditable-interceptor.tpl.ts:157`** | **`.find(…)`** | **NO** |
| `dotnet/emit/dapper.ts:1041` | `.filter(…).flatMap(…)` | yes |

The decisive evidence: **the .NET backend's own Dapper adapter (`dapper.ts:1041`) reads the same IR correctly.** Two emitters, one IR, one right and one wrong — a shared derivation cannot produce that.

**For the Java agent: Java does NOT have this bug.** Two independent reasons:
1. `java/emit/entity.ts:381` iterates *all* rules with a `for…of` — no first-match drop.
2. Java doesn't stamp audit columns in `@PrePersist` at all. It splits them: claim-valued stamps go to `@PrePersist`, and `createdAt`/`createdBy` ride Spring Data annotations. Generated `Thing.java` on the identical repro carries `@EntityListeners(AuditingEntityListener.class)`, `@CreatedDate Instant createdAt`, `@CreatedBy String createdBy` — and `config/JpaAuditingConfig.java` wires `@EnableJpaAuditing(auditorAwareRef = "auditorProvider")` with a real `AuditorAware<String>` bean. The `@PrePersist` containing only `tenantId`/`dataKey` is **correct by design**, not a dropped stamp. If Java shows a runtime `created_by` NOT NULL violation, the cause is in the auditing wiring, not the stamp merge — a different investigation.

**Trigger surface.** Exactly two prelude capabilities contribute `onCreate` (`prelude.ts`): `auditable` (`createdAt`/`createdBy`) and `tenantOwned` (`tenantId`/`dataKey`). Any aggregate carrying both — the standard multi-tenant audited aggregate — loses `auditable`'s pair, and the migration's `NOT NULL` turns every create into a 500. Hand-written `stamp onCreate` blocks compose the same way. The `onUpdate` line is latently broken too (only `auditable` contributes today).

**Why no gate catches it.** `test/e2e/fixtures/dotnet-build/auditable.ddd:14` is `aggregate Order with auditable` — the *control* case that works. `test/e2e/fixtures/dotnet-build/dapper-tenancy.ddd:25` is `aggregate Invoice with tenantOwned, auditable, crudish` — the exact broken shape, but it declares `platform: dotnet { persistence: dapper }` (line 50), routing to the `.filter()` path. **No fixture puts two `onCreate` rules through the EF interceptor.** And since the broken output compiles green, no compile tier could ever have caught it.

---

# 3. Fix plans

### F-035 — `.find()` → `.filter().flatMap()` — **effort S**

**Root cause:** `src/generator/dotnet/emit/auditable-interceptor.tpl.ts:157-158`.

**Change:**
```ts
const onCreate = rules.filter((r) => r.event === "create").flatMap((r) => r.assignments);
const onUpdate = rules.filter((r) => r.event === "update").flatMap((r) => r.assignments);
```

**Validated in a sandbox copy** (`/tmp/agentB/sandbox`, `/tmp/loom-main` untouched). After the change the arm emits all four create stamps:
```csharp
case Thing e:
    if (entry.State == EntityState.Added)
    {
        ctx.Entry(e).Property(x => x.TenantId).CurrentValue  = RequestContext.Current!.CurrentUser!.TenantId;
        ctx.Entry(e).Property(x => x.DataKey).CurrentValue   = RequestContext.Current!.CurrentUser!.OrgPath;
        ctx.Entry(e).Property(x => x.CreatedAt).CurrentValue = DateTime.UtcNow;
        ctx.Entry(e).Property(x => x.CreatedBy).CurrentValue = RequestContext.Current!.CurrentUser!.Id;
    }
```
and `dotnet build -warnaserror` on `sdk:10.0` → **Build succeeded, 0 Warning(s), 0 Error(s)**.

**Blast radius — measured, not argued.** Byte-identical wherever ≤1 rule per event. I regenerated `examples/{acme,showcase,event-sourcing}.ddd` patched vs unpatched and diffed every file with the `#line` absolute source path normalized: **0 content diffs in all three**. The `auditable`-alone control repro is byte-identical too. Other four backends: **untouched** — this is one file in `src/generator/dotnet/`.

**Test:** `test/generator/dotnet/dotnet-stamping.test.ts` (existing suite, already owns this emitter). Add a case: an aggregate `with tenantOwned, auditable` under a `tenancy by` system, asserting the single `case Thing e:` arm's `Added` block contains **all four** `Property(x => x.{TenantId,DataKey,CreatedAt,CreatedBy})` writes. Must be a unit assertion — the broken output compiles, so no compile tier can host it.

**Mutation proof:** copy the emitter aside with `cp` (never `git checkout --`, per §84), restore `.find(…)?.assignments ?? []`, re-run. Expected failure: the assertion on `CreatedBy` — *not* merely "a test failed". Also confirm the `auditable`-alone case in the same suite stays **green** under the mutation, which proves the new test reaches the two-rule path specifically rather than the one that already worked.

**Worth adding (optional, M):** promote `test/e2e/fixtures/dotnet-build/` with an EF twin of `dapper-tenancy.ddd` (`tenantOwned, auditable` on the default EF persistence), so the compile tier at least carries the shape. It won't catch this defect but closes the fixture gap that hid it.

---

### F-025 + F-025b — the `global::` qualifier, as a **sweep** — **effort S**

**Root cause (one class, two sites):**
- `src/generator/dotnet/emit/channels.ts:949` and `:954` — `${ns}.Infrastructure.Events.${innerDispatcherType}` inside `namespace ${ns}.Infrastructure.Channels;`
- `src/generator/dotnet/emit/messages.ts:74` — `${ns}.Domain.Common.RequestContext.Current?.Locale` inside `namespace ${ns}.Localization;`

**The mechanism, precisely.** C# resolves the *leading* identifier of a qualified name by walking the enclosing namespaces outward. From `Api.Infrastructure.Channels`, the name `Api` is looked for in `Api.Infrastructure.Channels` (miss), then `Api.Infrastructure` (miss), then `Api` — where **`Api.Api` exists**, emitted by `api/Api/*.cs` (`DomainExceptionFilter`, `ValidationProblem`, …). Lookup stops there, and `Api.Api.Infrastructure` does not exist → CS0234.

**The trigger is `deployable api`.** I proved it: renaming the deployable to `backend` makes the root namespace `Backend`, there is no `Backend.Backend`, and the identical source **builds succeeded, 0 errors**. This is also exactly why every gate is blind — **67 of the corpus fixtures name their deployable `d`** (`test/fixtures/corpus/validation-messages.ddd:84` is `deployable d`), while `src/cli/new-templates.ts:213` scaffolds **`deployable api`** and `examples/*.ddd` uses it 12 times. The default shape a user gets from `ddd new` is the poisoned one; the corpus never generates it.

**Change:** prefix both sites with `global::`. This is already the established convention in this backend — `src/generator/dotnet/emit/api.ts` uses `global::${ns}.…` at 11 sites (`:461`, `:890`, `:910`, `:945`, `:1013`, …), i.e. someone already hit this hazard and fixed it that way. (An alternative for `channels.ts` is to drop the qualifier entirely, since `using ${ns}.Infrastructure.Events;` is already emitted — but `global::` matches precedent and is uniform with `messages.ts`, which has no such using.)

**Validated:** both patched, regenerated, swept clean, and compiled — `fixed-f025` and `fixed-f025b` both **Build succeeded, 0 Warning(s), 0 Error(s)**.

**The sweep is complete, and I'll state its bound.** I wrote a checker (`/tmp/agentB/sweep.py`) that parses each generated `.cs` file's file-scoped namespace and flags any `Api.<Pascal>.<Pascal>…` reference in the namespace *body* not prefixed with `global::`. Statically, `grep -rn '\${ns}\.' src/generator/dotnet/ | grep -v global:: | grep -v 'using \|namespace '` leaves only three classes of hit:
- `emit/program.ts` — **safe**: `Program.cs` is top-level statements, emits no `namespace` declaration (`grep -n 'namespace ' emit/program.ts` → no output), so its refs resolve in global scope. This is why its ~20 unqualified refs work.
- `usings.add(…)` / `ns:` / file-path strings across ~20 files — **safe**: `using` directives sit *before* the file-scoped namespace, so they too resolve globally.
- **`channels.ts:949/954` and `messages.ts:74`** — the only two genuine in-body sites. Both are the bug.

Empirically the checker returns 0 hits on `examples/{acme,showcase,event-sourcing}` and on the F-035 repro, and exactly the 2+1 known hits on the two probes.

**Tests (two, one per site):**
- `test/generator/dotnet/` — new `dotnet-namespace-qualification.test.ts`: generate a system with **`deployable api`** (the trigger is load-bearing — a fixture named `d` asserts nothing) carrying (a) a channel and (b) a messaged `check`, and assert every `Api.`-qualified reference inside a namespace body is `global::`-prefixed. Encode the checker as a small reusable helper so it ratchets over *all* emitted files, not just the two known ones — that turns a two-site fix into a closed class.
- Add an `api`-named cell to `test/e2e/fixtures/dotnet-build/` for the channel and messaged-rule shapes, so `LOOM_DOTNET_BUILD` compiles the real thing.

**Mutation proof:** revert each site by file copy. Expected: the unit test fails naming `ChannelTransport.cs` / `LoomMessages.cs` and the offending reference; the compile cell fails with the literal `CS0234 … in the namespace 'Api.Api'`.

**Blast radius:** zero on the other four backends (`global::` is C#-only syntax, and both files are .NET-exclusive). Within .NET, output changes only in `Infrastructure/Channels/ChannelTransport.cs` and `Localization/LoomMessages.cs`, and only for projects that emit them.

---

### F-026 (.NET half) — **do not fix in the .NET emitter yet; the ruling belongs upstream** — effort S once decided

**Root cause (.NET):** `src/generator/dotnet/emit/entity.ts:426` hard-codes the modifier:
```ts
const head = `    private ${renderCsType(fn.returnType)} ${upperFirst(fn.name)}(${params})`;
```
Compare line 516, where *operations* have a visibility axis: `const visibility = op.visibility === "public" ? "public" : "private";`. `OperationIR` carries `visibility: "public" | "private"` (`loom-ir.ts:456`, lowered from the source `private` modifier at `lower-members.ts:298`). **`FunctionIR` (`loom-ir.ts:418-423`) has `name`, `params`, `returnType`, `body` — no visibility field, and no grammar modifier feeds one.** So a `function` is unconditionally private on every backend that has the concept.

**This is a four-target defect, not a .NET one — with four distinct failure modes.** I generated the same repro on each:

| target | emitted | call site | failure |
|---|---|---|---|
| **dotnet** | `Tech.cs:31 private bool HasSkill(string s)` | `GiveHandler.cs:37 t.HasSkill(command.Skill)` | **CS0122** — confirmed by `dotnet build` |
| **java** | `Tech.java:59 private boolean hasSkill(String s)` | `CWorkflows.java:36 t.hasSkill(skill)` | private access across packages — javac error (source-evidenced; my gradle run died on `org.springframework.boot:4.1.0` plugin resolution through the proxy, not on the code) |
| **python** | `tech.py:39 def _has_skill(self, s)` | `workflows_routes.py:41 t.has_skill(skill)` | **name mismatch** — `_has_skill` is defined, `has_skill` is called, and `grep -rn "def has_skill"` finds nothing. Imports fine, **`AttributeError` at request time** — strictly worse than .NET's |
| **elixir** | `c.ex:32 def has_skill(%Api.C.Tech{} = record, s)` | `give.ex:51 t.has_skill(skill)` | `t` is a struct, not a module — `t.has_skill` is a map-field access → runtime raise. Correct form would be `Api.C.has_skill(t, skill)` |

**Why I recommend deferring rather than widening .NET's modifier.** `docs/language.md:430` defines the contract: *"Pure helper (expression form); **callable from any expression in the same aggregate**."* The workflow calls `t.hasSkill(skill)` from *outside* the aggregate — the documented contract already says that is invalid, yet phase ④/⑦ accepts it and four backends emit a broken call. So the most likely correct resolution is a **validator gate in the shared layer** (a `loom.*` diagnostic on a cross-aggregate `function` call), after which **.NET needs no emitter change at all** — and a speculative `private` → `internal`/`public` widening would be output churn across every dotnet fixture for a call the language doesn't sanction.

If the ruling instead widens the contract, the .NET half is small: give `FunctionIR` a visibility (or derive "called from outside this aggregate" in phase ⑥ per *derive-don't-stamp*), then thread it at `entity.ts:426` exactly as line 516 already does for operations. That is **effort S** for .NET, but it is the tail of a shared change.

**Handing to the node agent** (who owns the shared-layer decision): the cross-cutting fact is that **`FunctionIR` has no visibility axis at all** and `docs/language.md:430` scopes `function` to the owning aggregate — so this is a *validator* question before it is an emitter question, and whichever way it goes it must land on node, dotnet, java, python and elixir together. Python's silent `AttributeError` and elixir's struct-field raise are the two that no compile gate will ever surface, so the gate for this needs a runtime leg, not just `tsc`/`javac`/`dotnet build`.

---

## Artifacts

Everything is under `/tmp/agentB/`; `/tmp/loom-main` and `/home/user/Loc` were not modified (the sandbox at `/tmp/agentB/sandbox` is a `tar`-copy used for fix validation). No commits, no pushes, no PRs. The reusable namespace checker is `/tmp/agentB/sweep.py` — worth porting into the F-025 test as the ratchet.