# Wave CR1 packet CR1-d — the IR-walk waiver register learns to expire

**Row:** P0-1 in `docs/audits/code-review-2026-09-13.md` (that audit lands with the wave PR; left unlinked here so this note resolves on its own branch too).
**Branch:** `worktree-agent-a07b4a9bb6cfc0217` · base `76ef74ad`.
**Waivers:** 111 → **98**. **Emission byte-identical** over 42,859 files. **One real defect found and fixed** (§4).

---

## 1. The finding, restated

`test/system/ir-walk-census.test.ts` ratcheted a waiver on two axes — the site still
**exists**, and is still **non-exhaustive**. Neither can see a waiver whose **reason** has
expired. 23 of the 111 entries were fenced on process events that had already happened:

| reason | count | what it was waiting for | landed |
|---|---|---|---|
| `INFLIGHT_2742` | 6 | "PR #2742 owns the hono v4 workflow builders this wave" | `9133a3d6` |
| `INFLIGHT_2729` | 4 | "PR #2729 owns this file's walker engine this wave" | `dcb956f8` |
| `INFLIGHT_2736` | 2 | "PR #2736 owns zod-refine.ts this wave" | `90c7e2f2` |
| `HOTSPOT_SPLIT_REASON` | 11 | "left for the 2.6 hotspot-split to relocate first" | `abc1c412` (#2778) |

All four merges verified in this checkout's history. Both existing assertions stayed true
for every one of the 23, so they never failed and never got revisited: **a waiver with a
time-boxed reason had no expiry, so the deferral became permanent.**

---

## 2. The mechanism

A waiver is no longer a bare string. It declares **which kind of claim it is making**:

```ts
type Waiver =
  | { standing: string }                                          // no shelf life
  | { deferred: string; reviewUntil: string; blockedBy?: string }; // parked work, dated
```

and three new failure modes join the two that were there:

| | rule | fails when |
|---|---|---|
| **E1** | `reviewUntil` in the past | the deferral outlived its own stated horizon |
| **E2** | `reviewUntil` > `MAX_DEFERRAL_DAYS` (180) out | immediately **and forever** — closes the `reviewUntil: "2099-01-01"` escape, since a date that far out never becomes valid |
| **E3** | `blockedBy: "#NNNN"` absent from `LIVE_FENCES` | the fence lifted (or was never registered) |

plus the mirror of E3: a `LIVE_FENCES` row **no waiver cites** fails too — a fence nobody
is standing behind can only mislead the next agent into thinking a tree is claimed.

Lifting a fence is now a **one-line deletion** from `LIVE_FENCES`, and it **cascades**: every
waiver that leaned on it fails the same day. That is the piece that was missing — the old
twelve `INFLIGHT_*` waivers each restated their fence inline, so there was no single place
to lift.

### Why this is evaluable offline and deterministically

The brief's first suggestion was to resolve `blockedBy` against real merge state. **It is
not available to a test here, and the way it fails is the worst one:**

- A test cannot call GitHub.
- It cannot read git history either. `test.yml` uses bare `actions/checkout@v6`, whose
  default is `fetch-depth: 1` (`grep -rn "fetch-depth" .github/workflows/` returns exactly
  one hit, in `quality-delta.yml`). So `git log --grep "Merge pull request #2736"` finds
  **nothing** on a runner even for a PR that merged months ago — and "nothing found" reads
  as "not merged yet", i.e. the waiver stays valid. **It would fail OPEN in precisely the
  place it has to hold**, which is the failure mode this whole entry exists to remove.

So the blocking fact is **data the test owns**, not history it queries. `LIVE_FENCES` is
identical on a runner and on a laptop, needs no network, no git, no doc parsing, and no
shallow-clone caveat. `reviewUntil` reads the clock and nothing else. Both are pure
functions of this one file (plus, for E1/E2, the date), which is the strongest offline
determinism available here.

E1 is the backstop for the fence nobody remembers to lift.

### Mutation proof (five ways)

Each mutation was reverted with a **file copy** from a saved pristine snapshot, never
`git checkout -- <path>` (`experience_gathered.md` §84); the final revert was verified with
`diff … && echo IDENTICAL`.

| # | mutation | result | quoted assertion |
|---|---|---|---|
| **E1** | one waiver given `reviewUntil: "2026-03-01"` | **FAILS** | `src/system/e2e-render.ts#visit — DEFERRAL EXPIRED on 2026-03-01. Its reason was an IOU, not a rationale: "MUTATION PROOF E1 — an expired deferral". Drain the site now (migrate it onto src/ir/util/walk.ts, or give it a never-checked default), or — if the deferral is still genuinely the right call — re-date it with a reason that says why it is still parked. Do not simply push the date.: expected [ Array(1) ] to deeply equal []` |
| **E2** | same waiver given `reviewUntil: "2099-01-01"` | **FAILS** | `src/system/e2e-render.ts#visit — reviewUntil 2099-01-01 is 26408 days out, past the 180-day cap. A date this far ahead never becomes valid, so it cannot be used to silence the expiry rule. Pick a horizon someone will honour.: expected [ Array(1) ] to deeply equal []` |
| **E3** | same waiver given `blockedBy: "#2736"`, `LIVE_FENCES` empty | **FAILS** | `src/system/e2e-render.ts#visit — waived as blocked by #2736, which is not in LIVE_FENCES. Either the fence lifted (then this waiver's reason is spent: drain the site) or the fence was never registered (then add it to LIVE_FENCES with what it owns).: expected [ Array(1) ] to deeply equal []` |
| **E4** | `LIVE_FENCES = { "#2736": … }` **and** a waiver citing it | **passes** (8/8) — the rule admits a live fence; it is not just always-red |
| **E5** | `LIVE_FENCES = { "#2736": … }` with no waiver citing it | **FAILS** | `LIVE_FENCES rows no waiver cites: #2736: expected [ '#2736' ] to deeply equal []` |

The two pre-existing assertions are untouched — this is a **third** axis, not a
replacement. The heavily-commented register keeps its shape and its per-entry reasoning
(the `feliz/realtime.ts#reads` note, the deleted-`#collectWorkflowStmtParamRefs` story).

---

## 3. The drains — 13 sites, not 14

The brief's split was **14 free / 9 fenced**. Enumerated from the file, it is **13 free / 10
fenced**: the "remaining one" is `src/ir/validate/checks/backend-syntax-checks.ts#eachStmtExpr`,
and it falls on the **fenced** side — it lives under `src/ir/**`, which is packet 2f's tree
fence on the live #2933 (verified against the PR body: *2f — `src/ir/**`,
`src/language/validators/**`, `src/generator/_*/**`*). `_walker/walker-core.ts` is free per
the coordinator's call (2g folded).

**No site was re-waived.** Every one is either migrated onto `walk.ts` or made exhaustive.

| # | site | outcome |
|---|---|---|
| 1 | `platform/hono/v4/workflow-builder.ts#walk` | **migrated** → `walkWorkflowStmtsDeep` + shared `collectRepoRefs` leaf (itself `never`-checked) |
| 2 | `platform/hono/v4/workflow-builder.ts#walk$2` | **migrated** → same, one leaf now serves both collectors |
| 3 | `platform/hono/v4/workflow-builder.ts#exprChildren` | **migrated** → deleted; caller rides `walkExprDeep` — **carried a defect, §4** |
| 4 | `platform/hono/v4/workflow-builder.ts#workflowStmtExprs` | **migrated** → deleted; caller rides `walkWorkflowStmtExprsDeep` — **carried a defect, §4** |
| 5 | `platform/hono/v4/workflow-eventsourced-builder.ts#renderApplierStmt` | **never-checked** (the 9 refused `StmtIR` kinds enumerated) |
| 6 | `platform/hono/v4/projection-builder.ts#renderFoldStatement` | **never-checked** (the 8 impure kinds enumerated) |
| 7 | `generator/_walker/walker-core.ts#walk` | **never-checked** (the 14 markup-unrenderable kinds enumerated; each still degrades through the catalogued `loom.page-expr-unrenderable` give-up sentinel, unchanged) |
| 8 | `generator/_walker/walker-core.ts#emitStmt` | **never-checked** (the 5 backend-body statement forms enumerated) |
| 9 | `generator/elixir/heex-walker-core.ts#renderExpr` | **never-checked** (was already exhaustive — see below) |
| 10 | `generator/elixir/heex-walker-core.ts#renderStmt` | **never-checked** (idem) |
| 11 | `generator/zod-refine.ts#refineRenderable` | **never-checked** (idem) |
| 12 | `generator/zod-refine.ts#renderRefineExpr` | **never-checked** (idem) |
| 13 | `generator/typescript/emit/mikroorm-filter.ts#filterValue` | **never-checked** (the 18 non-FilterQuery `ExprIR` kinds enumerated) |

### A census detector gap, worth knowing

Sites **9–12 were already compile-time exhaustive**, by an idiom the census cannot see:
*no `default` clause at all* plus a *non-nullable declared return type*, so an unhandled
kind is **TS2366 "Function lacks ending return statement"**. Proved by mutation — renaming
one `case` label in `heex-walker-core.ts#renderExpr` produced exactly that error at the
function header. The explicit `never` keeps the same guarantee while pointing the error at
the *missing arm* (TS2322, naming the kind) instead of the function header.

I did **not** teach the detector this idiom. It would need "switch has no default **and**
the enclosing function's declared return type excludes `undefined`", which is sound for a
value-returning function but **not** for a `void` one — and a detector that is right most of
the time is how a census stops being trustworthy. Making the four sites explicit is the
cheaper, legible fix. Flagging it here in case a future packet finds more of them: **a
waived site with no `default:` arm is worth re-reading before assuming it is unsafe.**

---

## 4. BEHAVIOUR CHANGE FOUND — a live defect in the Hono read-port derivation

`serviceReadPorts` (sites 3 + 4) finds the `reading`-tier domain-service calls a workflow
body makes, so the emitted handler can construct and pass each repository **read-port** the
service needs. It rode two hand-rolled child enumerations, and **both had holes**:

- **statement level** (`workflowStmtExprs`) — no arm for `domain-service-call`, `assign`,
  `repo-delete`, `repo-run`, or a `repo-run`'s page `offset`/`limit`. A **statement-level**
  service call contributed nothing at all.
- **expression level** (`exprChildren`) — no arm for `match`, `list`, `convert`, `duration`,
  `i18nFormat`, `authz-filter`, a `call`'s `style:` entries, or a **block-bodied lambda's
  statements**.

This is the #2720/#2705/M-T6.50 class verbatim — the one CLAUDE.md names as *"a
domain-service call inside an `if-let` branch never gets its import"*. It is **not
theoretical**.

**Repro** (`test/fixtures/corpus/domain-services.ddd` + a second aggregate the workflow does
not otherwise touch; parses, validates and generates **clean**, 0 errors):

```ddd
domainService Registration {
  operation notBlocked(holder: string): bool {
    return Blocklists.byHolder(holder) == null      // reads Blocklists, nothing else does
  }
}
workflow RegisterAccount transactional {
  create(holder: string, balance: Money) {
    precondition match {                            // <- the service call is in a MATCH ARM
      holder == "" => false
      else => Registration.notBlocked(holder)
    }
    let acct = Account.create({ holder: holder, balance: balance })
  }
}
```

**Before** (`d/http/workflows.ts`) — `blocklists` appears **exactly once in the whole file**,
as a *use*. No declaration, no `BlocklistRepository` import: the generated Hono project does
not compile (TS2304 + a missing module).

```ts
const accounts = new AccountRepository(tx, events);
if (!((holder === "" ? false : (await Registration.notBlocked(blocklists, holder))))) throw …
```

**After** — both halves are emitted:

```diff
  import { AccountRepository } from "../db/repositories/account-repository";
+ import { BlocklistRepository } from "../db/repositories/blocklist-repository";
@@
  const accounts = new AccountRepository(tx, events);
+ const blocklists = new BlocklistRepository(tx, events);
```

**Cross-backend check** (same repro, all five): **python** already rode the sanctioned walker
(`explicit-handlers-emit.ts#walk`, waived `DELEGATES_TO_SANCTIONED_WALKER`) and emits
`blocklists = BlocklistRepository(session, …)` correctly. **java / dotnet / elixir** wire
read-ports by constructor/context injection rather than a per-call port argument
(`registration.notBlocked(holder)` — no port in the signature), so they were never exposed.
**The defect was Hono-only, and is now closed.**

Why the corpus never caught it: the one existing workflow→reading-service fixture calls the
service from a bare `precondition` (a kind the old enumeration *did* cover), and its service
reads the same repository the workflow already constructs for its save-at-exit — so even a
dropped port resolved to an already-present binding. It needed **both** a slot the
enumeration missed **and** a repository nothing else in the workflow touches.

> **Suggested follow-up (not this packet):** the four `SHALLOW_CHILD_BUILDER` waivers
> (`feliz/wire.ts#exprChildren`, `flutter/{forms,inputs,reads}-emit.ts#exprChildren`) are the
> *same shape* as the one that was carrying this defect. Treat them as suspects, not as safe.
> Their waiver reason now says so.

---

### 4a. The regression test (added on coordinator review)

**`test/generator/typescript/workflow-read-port-derivation.test.ts`** — 5 cases, placed per
`docs/testing.md` rule 2 ("a backend now *emits* something different → one generator test per
affected target, string-matching the emitted source"), alongside the existing
`domain-service-reading.test.ts` / `handler-reading-service.test.ts`.

It goes through **`generateSystemFiles(source)`**, not the `generateHono(model)` its two
neighbours use. That was not a preference: `test/system/legacy-generate-path-ratchet.test.ts`
(M-T9.48) pins the legacy single-context call sites and **fails any NEW file that reaches
them** — my first draft tripped all three of its assertions (`no NEW file on the legacy
single-context path`, the exact per-file count, and the pinned total `63 (pinned 58)`). The
ratchet is right and the fix was to follow it, not to widen the pin: the orchestrator path is
what `ddd generate system` actually runs, so the test asserts phases ①/④ as well as ⑤/⑥/⑦.
Cost: the fixture needs a `system`/`subdomain`/`storage`/`resource`/`deployable` wrapper and
the emitted key is `<deployable>/http/workflows.ts` rather than `http/workflows.ts`. Worth
recording because the obvious move — copying the neighbouring suite's imports — is the one
the ratchet rejects.

The census gate guards the **mechanism** (nobody hand-rolls that traversal again); it is blind
to **behaviour** — a future refactor that rides `walk.ts` correctly and still drops the port
would pass the census and re-break codegen. This file pins the emission itself.

**Four slots, four services, four repositories.** Each workflow calls a *different* `reading`
operation that reads a *different* repository, so each slot's port is independently
observable and one regression fails one assertion. `Accounts` — the repo every workflow also
saves into — is deliberately never the probe: it is bound for its own sake, so a service
reading it would pass even with the port dropped. **That near-miss is exactly why the existing
corpus fixture missed this**, and the test comment says so.

| case | slot | probe repo | broken before the fix? |
|---|---|---|---|
| `MatchArm` | expression — inside a `match` arm | `Blocklists` | **yes** |
| `ListLiteral` | expression — inside a `list` literal | `Quotas` | **yes** |
| `StateAssign` | statement — value side of an own-state `:=` | `Regions` | **yes** |
| `IfLetBranch` | nested — inside an `if let` branch body | `Ledgers` | **no — the control** |

`IfLetBranch` already worked pre-fix (the old walk *did* recurse into if-let bodies). It is
kept deliberately: it proves the assertions are not vacuously failing on every workflow, and
it pins the recursion the migration onto `walk.ts` had to preserve.

**How the assertions distinguish a declaration from a use** — the coordinator's requirement,
and the crux, because *the broken output is precisely the one that mentions the identifier
without binding it*, so a grep for `blocklists` passes on both:

1. `handlerBody()` slices the emitted file to **one workflow's** handler, so a handle bound in
   a *sibling* handler cannot satisfy an assertion — a file-wide `toContain` would have been
   satisfied by any other workflow that happens to bind the same name.
2. Within that slice it requires the **construction**: `const <handle> = new <Repo>(tx, events);`.
   This is the line the broken output lacks.
3. Plus an independent second witness: `import { <Repo> } from …`. The broken output was
   missing the import too, so a half-fix that bound the handle without wiring the import is
   still caught.
4. The fifth case is the **name-independent** form, re-derived from the emitted text: for every
   `await Screening.<op>(a, b, …)` call site, every bare-identifier argument must have a
   `const <id> =` binding in the same handler. A future refactor that derives ports correctly
   but renames the handles keeps passing; one that drops a port fails even if it also renames.
   This is the TS2304 condition itself, expressed as an assertion.

#### Mutation proof

`src/platform/hono/v4/workflow-builder.ts` was copied aside, replaced with its pre-fix content
(`git show HEAD:…` written to a scratch file, then `cp` — **never** `git checkout --`,
per `experience_gathered.md` §84), rebuilt, and the new test run. Run twice — once on the
first draft and again after the rewrite onto `generateSystemFiles` — with identical results,
so the orchestrator path does not weaken the proof:

```
Tests  4 failed | 1 passed (5)
```

The three defect cases fail; `IfLetBranch` passes, confirming the control does its job. The
per-case assertion, verbatim:

> `MatchArm: 'blocklists' is PASSED to the reading service but never CONSTRUCTED — the read
> port was not derived from this slot. (A plain grep for 'blocklists' passes on the broken
> output; this assertion is what distinguishes a binding from a use.): expected 'workflow:
> "MatchArm" });\n      httpC…' to contain 'const blocklists = new BlocklistRepos…'`

and the name-independent one:

> `a reading-service call was handed an identifier this handler never binds — the emitted
> project does not compile (TS2304):`
> `MatchArm: 'blocklists' passed to await Screening.notBlocked(blocklists, holder) but never bound`
> `ListLiteral: 'quotas' passed to await Screening.hasQuota(quotas, holder) but never bound`
> `StateAssign: 'regions' passed to await Screening.inRegion(regions, holder) but never bound`
> `: expected [ …(3) ] to deeply equal []`

Restored by file copy, verified byte-identical against the pristine snapshot
(`diff … && echo RESTORED IDENTICAL`) and against `git diff --stat src/` coming back empty,
rebuilt, re-run: **5 passed**.

#### Corpus fixture: recommended against, with the reasoning

The coordinator asked whether this shape deserves a `test/fixtures/corpus/` fixture rather than
only a unit test. **My recommendation is no**, for one reason that is about the shape and not
about effort:

- **The defect is Hono-specific.** A corpus fixture fans out across every backend in its
  manifest row, and java/dotnet/elixir wire read-ports by constructor/context injection — there
  is no per-call port argument for them to drop (verified on the repro in §4; their emission is
  identical before and after). A fixture would exercise four backends for which this shape
  proves nothing, and add five aggregates + five repositories to the docker-booting compile
  legs for one backend's benefit.
- **The thing a fixture would add over the unit test is a real COMPILE**, not a string match —
  and the fifth assertion already encodes the TS2304 condition ("passed but never bound")
  directly. That is the compile failure in miniature, at ~1s instead of a docker boot.

The cheaper lever, **if** you want a genuine compile behind this: fold a `match`-arm service
call into the *existing* `test/fixtures/corpus/domain-services.ddd`, which already runs the TS
compile tier — no new matrix row. I did not do it because it changes that fixture's emission on
all five declared backends, so it churns their baselines and belongs in a packet that owns the
corpus, not one fencing on `walk.ts`. Flagging it rather than deciding it.

---

## 5. Gates

| gate | result |
|---|---|
| `npx tsc -b` | clean (exit 0) |
| `npm run lint` (`biome ci .`) | clean (exit 0; 24 warnings, all pre-existing) |
| `npx vitest run test/system test/ir test/generator test/platform` | green |
| `npx vitest run test/system/ir-walk-census.test.ts` | 8/8 (was 5) |
| `npx vitest run test/generator/typescript/workflow-read-port-derivation.test.ts` | 5/5 — mutation-proved 4-fail/1-pass against the reverted fix (§4a) |
| **emission byte-identical** | **42,859 emitted files, 0 differences, 0 generation errors** |

The emission gate hashes every file of every generated project across the **79-fixture
shared corpus × its declared backends** (node, dotnet, java, python, elixir) **× the
non-default persistence adapters** (node: drizzle, mikroorm; dotnet: dapper), **plus** every
`.ddd` under `examples/` and `web/src/examples/` through `generateSystems`. Captured before
the first edit and after the last; `diff` returned empty. The only intended behaviour change
is §4, which the corpus does not reach — demonstrated instead on the purpose-built repro
above, old build vs new build, diffed file-by-file.

---

## 6. Waiver counts

**111 → 98** (−13, one per drained site; every site left the register, none was re-waived).

| reason | before | after | note |
|---|---|---|---|
| `CLOSED_PREDICATE` | 42 | 42 | reclassified **deferred**, `reviewUntil: 2026-12-31` |
| `THROWING_DISPATCHER` | 32 | 32 | **standing** |
| `HOTSPOT_SPLIT_REASON` → `HOTSPOT_SPLIT_RESIDUE` | 11 | **10** | reclassified **deferred**, `2026-12-31`; −1 = `mikroorm-filter.ts#filterValue`, drained |
| `TRAVERSAL_TIME_BOXED` | 7 | 7 | reclassified **deferred**, `2026-12-31` |
| `INFLIGHT_2742` | 6 | **0** | all drained |
| `INFLIGHT_2729` | 4 | **0** | all drained |
| `INFLIGHT_2736` | 2 | **0** | all drained |
| `SHALLOW_CHILD_BUILDER` | 4 | 4 | reclassified **deferred**, `2026-12-31` |
| `DELEGATES_TO_SANCTIONED_WALKER` | 3 | 3 | **standing** |
| **total** | **111** | **98** | 98 == the non-exhaustive site count (131 sites, 33 exhaustive) |

> ### ⚠ This plants a 63-entry expiry on **2026-12-31** — deliberately, and it is the point.
>
> The 42 `CLOSED_PREDICATE` + 7 `TRAVERSAL_TIME_BOXED` + 4 `SHALLOW_CHILD_BUILDER` + 10
> `HOTSPOT_SPLIT_RESIDUE` entries are classified **deferred** because that is what their own
> text always said they were — *"not completed in this packet's time-box; follow-up drain"*,
> *"classified by default-arm shape, not individually re-verified"*. Leaving them `standing`
> would have built a mechanism with no subjects and re-told the exact lie the finding names.
>
> They all carry **one** date, so they come due as **one batch** for **one** drain packet
> rather than trickling. 2026-12-31 is 108 days out, inside the 180-day cap. Re-dating is a
> legitimate outcome and a one-line edit — but the failure message says, in so many words,
> *"Do not simply push the date."* **A future wave should own this drain before then;**
> `TRAVERSAL_TIME_BOXED` is the highest-risk bucket (it is the #2720 shape itself) and its
> reason now says to drain it first.

---

## 7. For CR1-e — the 10 fenced sites, verbatim

All under `src/ir/validate/checks/`, i.e. inside packet **2f**'s `src/ir/**` fence on the
live **#2933** (Wave C2 batch 2). CR1-d did not touch them. They are waived as
`HOTSPOT_SPLIT_RESIDUE` — **deferred**, `reviewUntil: 2026-12-31` — with the honest reason
restated (the 2.6 split they waited for merged as #2778 on 2026-09-03; the `walk.ts`
migration is the outstanding work).

```
src/ir/validate/checks/ui-action-body-checks.ts#visitStmt
src/ir/validate/checks/ui-action-body-checks.ts#visitExpr
src/ir/validate/checks/ui-action-body-checks.ts#toastMessageProblem
src/ir/validate/checks/ui-action-body-checks.ts#checkBody
src/ir/validate/checks/ui-page-structure-checks.ts#namesReadByBody
src/ir/validate/checks/ui-page-structure-checks.ts#directlyRenderedRefs
src/ir/validate/checks/datasource-checks.ts#docStmtUnsupported
src/ir/validate/checks/datasource-checks.ts#docFunctionUnsupported
src/ir/validate/checks/datasource-checks.ts#docExprUnsupported
src/ir/validate/checks/backend-syntax-checks.ts#eachStmtExpr
```

Note the last row: the brief asked which side of the fence it falls on. **Fenced** —
`src/ir/validate/checks/` is `src/ir/**`. That is why the free set is 13, not 14.

Two of them (`#namesReadByBody`, `#directlyRenderedRefs`) are `if-chain` form; the rest are
`switch`. Six are over `ExprIR`, four over `StmtIR`.

### Notes for whoever drains them

- These are **validator** checks, so a migration that changes behaviour changes the
  **diagnostic set**, not emitted code. The byte-identical gate for that work is the
  `parse`-diagnostic run over the 348 fixtures + the firing census, not the emission hash —
  see `wave-2-hotspot-splits.md` for the exact recipe #2778 used.
- Watch for the §4 shape: a check that hand-enumerates expression children and silently
  misses `match` / `list` / a lambda block is a **false negative** in a gate, which is worse
  than a crash — it means a diagnostic that should fire does not.

---

## 8. Files touched

```
src/platform/hono/v4/workflow-builder.ts                 (sites 1-4; the §4 fix)
src/platform/hono/v4/workflow-eventsourced-builder.ts    (site 5)
src/platform/hono/v4/projection-builder.ts               (site 6)
src/generator/_walker/walker-core.ts                     (sites 7-8)
src/generator/elixir/heex-walker-core.ts                 (sites 9-10)
src/generator/zod-refine.ts                              (sites 11-12)
src/generator/typescript/emit/mikroorm-filter.ts         (site 13)
test/system/ir-walk-census.test.ts                       (the mechanism + the register)
test/generator/typescript/workflow-read-port-derivation.test.ts  (the §4 regression test)
docs/new-plan/waves/handoffs/wave-cr1-d.md               (this note)
```

`8e5823ba` (drains) and `6dfb293b` (register) are **atomic as a pair** — the first deletes the
code whose waivers the second removes, so the branch **tip** is the green state. Fold the
whole branch, not a subset.
