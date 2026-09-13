# Agent B — .NET emitter (F-035, F-025, F-026)
Base: fresh main `9a8f2fe0`.

## Verification
| Finding | Status | Claimed? | Evidence |
|---|---|---|---|
| F-035 two `onCreate` stamps, one dropped | **LIVE** | UNCLAIMED | interceptor stamps `TenantId`/`DataKey` only; `Migrations/…_S_Initial.cs:39` declares `"created_by" TEXT NOT NULL`. **Project builds green** — no compile gate can see it |
| F-025 channel transport unqualified namespace | **LIVE** | UNCLAIMED | `ChannelTransport.cs(239,26)`+`(244,13)` `CS0234 … 'Infrastructure' does not exist in the namespace 'Api.Api'` |
| **F-025b — NEW, found by the sweep** | **LIVE** | UNCLAIMED | `LoomMessages.cs(31,22) CS0234` **+ 4 cascading**. Fires on **any messaged `check`/`invariant`** on dotnet |
| F-026 (.NET half) private `function` | **LIVE** | UNCLAIMED | `GiveHandler.cs(37,21) CS0122: 'Tech.HasSkill(string)' is inaccessible` |

Claim check: #2901/#2872 are value-object work; #2852 touches `dotnet/emit/{common,dapper,repository}.ts`
+ `find-emit.ts` — none of these sites. #2907 (draft) *fences* `src/generator/dotnet/**` for packet 2b
but its rows are `unsupported-register` gaps — disjoint. Cite the fence when landing.

## THE RULING on F-035 — the **.NET emitter**, not a shared derivation
**The IR is correct.** Dumped through `lowerProject` → `enrichLoomModel`:
```
AGG Thing caps=["auditable","tenantOwned","versioned"]
stamps=[{"e":"create","f":["tenantId","dataKey"]},
        {"e":"create","f":["createdAt","createdBy"]},
        {"e":"update","f":["updatedAt","updatedBy"]}]
```
Both create rules present, exactly as `loom-ir.ts:647` specifies ("Composes additively — N stamping
declarations yield N rule sets concatenated per event").

**The defect is one line** — `src/generator/dotnet/emit/auditable-interceptor.tpl.ts:157-158` uses
`.find()`, which returns the **first** rule and discards the rest. Every other consumer reads additively:
| consumer | pattern | ok |
|---|---|---|
| `typescript/emit/audit-stamp.ts:58` | `.filter().flatMap()` | ✅ |
| `python/routes-builder.ts:813`, `python/emit/aggregate.ts:635` | `.filter().flatMap()` | ✅ |
| `elixir/vanilla/stamp-emit.ts:159` | `.filter().flatMap()` | ✅ |
| `java/emit/entity.ts:381` | `for…of` over all rules | ✅ |
| **`dotnet/emit/auditable-interceptor.tpl.ts:157`** | **`.find()`** | ❌ |
| `dotnet/emit/dapper.ts:1041` | `.filter().flatMap()` | ✅ |
**Decisive:** the .NET backend's *own* Dapper adapter reads the same IR correctly. Two emitters, one IR,
one right and one wrong — a shared derivation cannot produce that.

### ⚠ This CORRECTS my F-035 as filed: **Java does not have this bug.**
Two independent reasons: (1) `java/emit/entity.ts:381` iterates *all* rules; (2) Java doesn't stamp audit
columns in `@PrePersist` at all — it splits them, claim-valued stamps to `@PrePersist` and
`createdAt`/`createdBy` to Spring Data. The generated `Thing.java` carries
`@EntityListeners(AuditingEntityListener.class)`, `@CreatedDate Instant createdAt`, `@CreatedBy String createdBy`,
and `config/JpaAuditingConfig.java` wires `@EnableJpaAuditing(auditorAwareRef="auditorProvider")` with a
real `AuditorAware<String>` bean. **The `@PrePersist` holding only `tenantId`/`dataKey` is correct by
design.** I inferred the Java half statically from the `@PrePersist` body and never booted Java — that
inference was wrong.

**Trigger surface:** exactly two prelude capabilities contribute `onCreate` — `auditable` and
`tenantOwned`. Any aggregate with both (the standard multi-tenant audited aggregate) loses `auditable`'s
pair. `onUpdate` is latently broken too (only `auditable` contributes today).
**Why no gate catches it:** `dotnet-build/auditable.ddd:14` is `with auditable` — the *control*.
`dotnet-build/dapper-tenancy.ddd:25` is the exact broken shape but declares
`platform: dotnet { persistence: dapper }`, routing to the `.filter()` path. **No fixture puts two
`onCreate` rules through the EF interceptor** — and the broken output compiles, so no compile tier could.

**Change:** `.find(…)?.assignments ?? []` → `.filter(…).flatMap(r => r.assignments)`, both lines.
**Validated in a sandbox copy:** all four create stamps emit, `dotnet build -warnaserror` on `sdk:10.0`
→ **Build succeeded, 0 Warning(s), 0 Error(s)**.
**Blast radius — measured:** regenerated `examples/{acme,showcase,event-sourcing}.ddd` patched vs
unpatched, `#line` path normalised → **0 content diffs**. `auditable`-alone control byte-identical.
**Test:** case in the existing `test/generator/dotnet/dotnet-stamping.test.ts` — must be a *unit*
assertion, since the broken output compiles. **Mutation proof:** revert by `cp`; the `CreatedBy`
assertion must fail *and* the `auditable`-alone case must stay green (proves the new test reaches the
two-rule path, not the one that already worked).
**Effort: S.**

## F-025 + F-025b — `global::`, as a sweep
Sites: `dotnet/emit/channels.ts:949,954` (`${ns}.Infrastructure.Events.…` inside
`namespace ${ns}.Infrastructure.Channels;`) and `dotnet/emit/messages.ts:74`
(`${ns}.Domain.Common.RequestContext…` inside `namespace ${ns}.Localization;`).

**Mechanism:** C# resolves the leading identifier outward. From `Api.Infrastructure.Channels`, `Api` is
sought in `…Channels` (miss), `Api.Infrastructure` (miss), then `Api` — where **`Api.Api` exists**
(emitted by `api/Api/*.cs`). Lookup stops; `Api.Api.Infrastructure` doesn't exist → CS0234.

**The trigger is the deployable being named `api`** — proven: renaming to `backend` gives root namespace
`Backend`, no `Backend.Backend`, identical source **builds succeeded, 0 errors**. And that is exactly
why every gate is blind: **67 corpus fixtures name their deployable `d`**, while
`src/cli/new-templates.ts:213` scaffolds **`deployable api`** and `examples/*.ddd` uses it 12 times.
**The default shape `ddd new` hands a user is the poisoned one, and the corpus never generates it.**

**Change:** `global::` prefix at both sites — already the established convention here
(`dotnet/emit/api.ts` uses `global::${ns}.…` at 11 sites, i.e. someone hit this before and fixed it that way).
**Validated:** both patched → swept clean → **Build succeeded, 0 Warning(s), 0 Error(s)**.
**Sweep is complete and bounded:** a checker parses each `.cs` file-scoped namespace and flags
un-`global::`-prefixed `Api.<Pascal>.…` refs in the namespace *body*. Static grep leaves three classes:
`emit/program.ts` (**safe** — top-level statements, emits no `namespace`), `using`/`ns:`/path strings
(**safe** — resolve before the file-scoped namespace), and the 2+1 genuine sites. Empirically 0 hits on
`examples/{acme,showcase,event-sourcing}` and the F-035 repro.
**Test:** `test/generator/dotnet/dotnet-namespace-qualification.test.ts`, generating with **`deployable api`**
(the trigger is load-bearing — a fixture named `d` asserts nothing) carrying a channel and a messaged
`check`; encode the checker as a reusable ratchet over *all* emitted files. Plus an `api`-named cell in
`test/e2e/fixtures/dotnet-build/`.
**Effort: S.** Checker at `/tmp/agentB/sweep.py`, worth porting into the test.

## F-026 — defer; `FunctionIR` has no visibility axis at all
`dotnet/emit/entity.ts:426` hard-codes `private`. Compare `:516`, where *operations* have
`op.visibility === "public" ? "public" : "private"` — `OperationIR` carries visibility
(`loom-ir.ts:456`, lowered at `lower-members.ts:298`). **`FunctionIR` (`loom-ir.ts:418-423`) has no
visibility field and no grammar modifier feeds one.**

Four targets, four distinct failure modes (same repro):
| target | emitted | call site | failure |
|---|---|---|---|
| dotnet | `private bool HasSkill` | `t.HasSkill(...)` | CS0122 (confirmed by build) |
| java | `private boolean hasSkill` | `t.hasSkill(skill)` | private across packages (source-evidenced; gradle died on proxy plugin resolution, not the code) |
| python | `def _has_skill` | `t.has_skill(skill)` | **name mismatch**; `grep "def has_skill"` → nothing → **AttributeError at request time** |
| elixir | `def has_skill(%Tech{}=record, s)` on the context module | `t.has_skill(skill)` | struct-field access → runtime raise; correct form `Api.C.has_skill(t, skill)` |

**Recommends deferring to a shared validator gate** — `docs/language.md:430` already scopes `function` to
*"any expression in the same aggregate"*, so the workflow's cross-aggregate call is already outside the
documented contract. Under that ruling **.NET needs no emitter change**; a speculative widening would be
output churn across every dotnet fixture for a call the language doesn't sanction.
**Independently agrees with Agent A's recommendation (A).** Adds: python's `AttributeError` and elixir's
struct raise are invisible to every compile gate — **this needs a runtime leg, not `tsc`/`javac`/`dotnet build`.**
