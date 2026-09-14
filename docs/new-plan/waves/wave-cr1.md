# Wave CR1 — the verification layer (coordinator log)

*Source: [`../../audits/code-review-2026-09-13.md`](../../audits/code-review-2026-09-13.md) — an independent
review of `main` @ `619708fd` whose verdict was that the **code** is sound and the **verification and
suppression layers** are where things slipped. Base: `main` @ `76ef74ad` (#2896 merged 2026-09-14 08:2xZ).
Packets run as Opus agents in isolated worktrees on local `claude/cr1-<packet>` branches and are folded
onto `claude/loom-code-review-audit-790gec` (the only branch this coordinator pushes), one at a time.
Hand-off notes land under `handoffs/wave-cr1-<packet>.md`.*

## Status: **batch 1 COMPLETE — all four packets folded, full suite green** (2026-09-14)

`npx tsc -b` clean · `npm run lint` **exit 0** (the new ratchet, on a clean tree) · full `npm test`
**2,067 files / 24,314 tests passed**, 89 files and 1,142 tests skipped, 7 expected-fail, exit 0,
on the folded tree merged with `origin/main` @ `c677f242`.

**Every P0 and P1 row the audit opened is closed except the two L-drains and CR1-g/h**, which are
batch 2 and blocked on #2933's `src/ir/**` + `src/generator/_*/**` fence (2f and 2j still running).

### What the wave actually found — beyond the rows it was given

Three of the four packets found something the audit had not, and one corrected the audit itself.
That is the argument for running the drains rather than filing them:

1. **A live, compile-breaking codegen defect in Hono** (CR1-d) — reached by draining a waiver, which
   is precisely what the waiver was suppressing.
2. **The audit's own elixir row was wrong** (CR1-b), and wrong in the direction that understated the
   finding: the OIDC audience divergence was two backends, not one.
3. **A second bug inside the gate being fixed** (CR1-a) — `_[a-z]+` silently dropped `_i18n`.
4. **A spent carve-out orphaned by #2729** (the lint sweep) — the same merged PR whose stale fences
   CR1-d drained. One PR left two kinds of residue and it took two packets to see either.

## Why a wave, and why this shape

The audit's three failure shapes are all *meta*: a check that exists, is green, and does not reach
what it names. That makes the packets unusually independent — each one owns a different gate — but it
also means the two **L-effort drains** (73 census waivers; the per-target string tier) touch the whole
generator and the whole test tree, and would collide head-on with [#2933](https://github.com/Loom-Harness/Loc/pull/2933)
(Wave C2 batch 2), whose packet **2f** holds `src/ir/**` + `src/generator/_*/**` and whose **2i**/**2j**
are still running. Those two drains are therefore **batch 2**, after #2933 folds and this branch is
restarted from `main`. Batch 1 is the four packets that are fence-clean today.

That is not a deferral of the hard part for its own sake: the 23 expired-fence waivers CR1-d drains are
the *precondition* for the 42+31 drain (they are entries in the same register), and CR1-a's path-filter
fix is the gate that would have caught a batch-2 regression in the first place. Batch 1 is the order
that makes batch 2 verifiable.

## Fence reconciliation before launch (2026-09-14)

24 PRs open. #2933 is the one that matters — its 2f fence (`src/ir/**`, `src/generator/_*/**`) and its
running 2i/2j trees are the constraint that shapes this wave. Measured, not assumed:

**The 23 expired-fence waiver sites split 14 free / 9 fenced.**

| where | count | state |
|---|---|---|
| `src/platform/hono/v4/**` (workflow-builder ×4, workflow-eventsourced-builder, projection-builder) | 6 | free — C2 2c merged |
| `src/generator/_walker/walker-core.ts` (`walk`, `emitStmt`) | 2 | free — C2 2g **folded** |
| `src/generator/elixir/heex-walker-core.ts` (`renderExpr`, `renderStmt`) | 2 | free — C2 2a merged |
| `src/generator/zod-refine.ts` (`renderRefineExpr`, `refineRenderable`) | 2 | free — outside 2f's `_*` fence; #2736 merged |
| `src/generator/typescript/emit/mikroorm-filter.ts#filterValue` | 1 | free — C2 2c merged |
| `src/generator/dotnet/…`, misc | 1 | free |
| **`src/ir/validate/checks/**`** (ui-action-body ×4, ui-page-structure ×2, datasource ×3) | **9** | **fenced — 2f running, and #2871 touches `ui-*-checks`** |

| packet | fence | open PRs on it |
|---|---|---|
| **CR1-a** gate reachability | `.github/workflows/**`, `test/system/workflow-path-coverage.test.ts`, new `test/system/skip-gate-reachability.test.ts`, `test/e2e/{embed-react-elixir,auth-gate-ui-e2e}.test.ts` | none |
| **CR1-b** OIDC audience | `src/platform/hono/v4/auth-emit.ts`, `src/language/validators/auth.ts`, `src/diagnostics/messages.ts`, the four `*-oidc-e2e` workflows + their tests | #2900 (auth-emit) **merged**; `validators/` is nominally 2f's tree — `auth.ts` is not on 2f's named row list, cite and proceed |
| **CR1-c** advisories + lint ratchet | `package.json`, `package-lock.json`, `biome.json` | many touch `package.json`; lockfile-only conflicts compose |
| **CR1-d** waiver expiry + 14 free sites | `test/system/ir-walk-census.test.ts` + the 14 free sites above | none on the 14 |

## Packets — batch 1

| packet | audit rows | what it must land |
|---|---|---|
| **CR1-a** | **P0-3**, **P1-1** | (a) `workflow-path-coverage.test.ts` requires every shared `src/generator/_*/` dir in a gate's own transitive import closure — the exemption's rationale ("genuinely per-target") is inverted for the `_*` dirs by construction; fix the 6 enumerated workflows so `_stmt`/`_workflow`/`_payload`/`_type`/`_numeric`/`_i18n`/`_trace` can fire a backend compile gate, Elixir included. (b) A new gate: every `process.env.LOOM_*` read used as a skip condition must be set by some npm script or workflow — zero-tolerance, the tree is at two (`LOOM_EMBED_E2E_PHOENIX`, `LOOM_AUTH_GATE_E2E`, 677 L unreachable). Wire or delete both. **Both gates mutation-proved.** |
| **CR1-b** | **P0-4** | Hono emits no `OIDC_AUDIENCE` env fallback while the other four do, so the same `.ddd` is enforceable on four backends and not on node. Close the divergence, add `loom.auth-oidc-no-audience` (declared `oidc`, no `audience:`) to the catalogue, and add an audience row to the four `*-oidc-e2e` legs that already boot a real IdP. Diagnostic text goes in `src/diagnostics/messages.ts`, never inline. |
| **CR1-c** | **P1-3**, **P1-5** | `npm audit`: 2 high (`ip-address`, 3 SSRF advisories) + 3 moderate (`qs`), fix available — via the **`dependency-upgrade` skill**, both surfaces. Then `biome ci` exits 0 on **24** warnings: auto-fix, then make warnings fail (`--error-on-warnings` or promote the rules), so the `Stop` hook and `test.yml` enforce it. Folded **last** in the batch so it sweeps what the other three wrote. |
| **CR1-d** | **P0-1** | 23 of 111 `ir-walk-census` waivers are expired process fences — 12 `INFLIGHT_*` naming #2729/#2736/#2742 (all merged) and 11 deferring to the 2.6 hotspot split (landed). The ratchet detects a stale *site*, never an expired *reason*. Add the missing input — a `blockedBy`/`reviewedOn` field the ratchet evaluates — then drain the **14 free** sites. The 9 in `src/ir/validate/checks/**` are fenced to batch 2 and must be **listed in the hand-off**, not silently skipped. |

## Batch 2 — after #2933 folds, branch restarted from `main`

| packet | audit rows | note |
|---|---|---|
| **CR1-e** | **P0-2a** | The 42 `CLOSED_PREDICATE` waivers, whose own reason says *"classified by default-arm shape, not individually re-verified per kind"* — plus the 9 `src/ir/validate/checks/**` sites CR1-d fenced. Script the case-set diff against `walk.ts`'s kind enumeration first; the drain is then mostly mechanical. |
| **CR1-f** | **P0-2b** | The 31 `THROWING_DISPATCHER` waivers. A `throw` in a *generator* default arm means codegen dies on valid `.ddd` — the repo's own definition of a **silent gap**, not a waiver. Each one: prove the vocabulary complete, or replace the throw with a `loom.*` diagnostic so the gap is honest. Hands off to `parity-auditor` where a row turns out to be real parity debt. |
| **CR1-g** | **P1-4** | `knip` in the lint job, then the **52** never-referenced exports (incl. `generateJava`, superseded by `generateJavaForContexts`) and a decision on the **417** exported-but-module-local. Same class as #2897, found by hand — the point is the gate, not the sweep. |
| **CR1-i** | **new — found by CR1-a** | Two follow-ons one level down from P0-3, both measured, neither an oversight. (a) The coverage gate **unions `paths:` across triggers**, and workflows rely on that deliberately: measured per-trigger, ~14 carry the five generation-path globs on `push:` **only**, so a `src/util/naming.ts` change fires none of them *on a PR*. Same bug shape as P0-3, one level down — but it is a tiering decision (per-PR cost vs. post-merge latency), so it needs a ruling before a gate. (b) **`behavioral-e2e-*.yml` are not recognised as generation gates at all** — they drive generation through a `.mjs` case driver, so the entry-point derivation scores them non-generation and every assertion skips them silently. That one is a plain bug in the derivation. |
| **CR1-h** | **P1-2** | `test/` grew +30,765/−1,421 over 60 PRs (4.6% delete rate vs `src/`'s 55%) and 19,523 of 41,130 assertions are `toContain`. `gate-ledger.test.ts` already computes the strongest-gate matrix and already states the drain rule; nothing exercises it and nothing measures the tier's size. Add the count ratchet (seeded at today's number, may only fall), then drain under the ledger's existing authority. |

## Owner-gated — reported, not built

P2-1 (31.8% comment density carrying PR/packet archaeology in the hot path), P2-2 (`docs/` at 43% of
`src/`; is `docs/old/` a record or a graveyard?), P2-3 (~12 `*_SUPPORTED` parity sets now 5-of-5 and
unreachable — keep or delete?), P2-4 (`packages/` publish-shaped but never exercised out-of-tree).
Each is a judgement call with no correct default; they are decisions for the owner, not agent work.

## Gates every packet states in its hand-off

`npx tsc -b` · `npm run lint` · the suites its fence touches · **and the rule this wave exists to
defend**: a gate that claims to close a bug class is shown to FAIL when the fix is reverted, with the
failing assertion quoted. Revert the mutation with a file copy, never `git checkout -- <path>`
(`experience_gathered.md` §84). A green first run proves nothing — which is the whole finding.

## Folds

### CR1-a — folded (P0-3, P1-1)

`worktree-agent-a4a6b95e9f77f716f`, `c0333aeb..ba354f35` (4 commits). 20 workflows fixed.

**Took approach (a), refined — and the refinement is the point.** Approach (b) only swaps a
hand-maintained positive list for a hand-maintained negative one, which is the thing that rotted. The
gate now *derives* the requirement: a workflow whose `paths:` claims a whole platform tree
(`src/generator/<plat>/**`) must watch every `src/generator/_*` dir in **that tree's import closure,
cut at the boundary of any platform dir it does not claim**. The cut is what makes it
false-positive-free — `java/index.ts` really does import the React/Angular generators (the embedded
`ClientApp/`), so a naive closure would demand `java-build` watch the body walker it neither claims
nor compiles. The escape hatch is *precision*: narrow the platform claim to subdirs, as
`elixir-vanilla-obs-e2e.yml` already does, and the rule stops applying.

**A second bug in the same file, found on the way:** the seam matcher was `_[a-z]+`, so **`_i18n`**
— the one collector deciding validation-catalog membership for all five backends — was silently
dropped from every check. Now `_[a-z0-9]+`.

Coordinator re-verified the headline rather than taking the report: seam coverage per backend gate
went **1 → 14–16** (`java-build` 1→15, `corpus-elixir-build` 1→16), and `_payload/union-wire.ts` now
fires **four** elixir gates where it previously fired none. Independently mutation-proved by deleting
`- 'src/generator/_stmt/**'` from `corpus-elixir-build.yml`:

> `corpus-elixir-build.yml claims a whole platform generator tree but does not watch
> src/generator/_stmt/**. … expected [ '_stmt' ] to deeply equal []`

— naming exactly the one seam removed, then green again on restore (`cp`, not `git checkout`).

**Both orphaned suites were WIRED, not deleted** — the packet established neither is redundant.
`embed-react-elixir` is the only proof the Phoenix embed *serves* (the mix gate only compiles it;
`phoenix-ui-e2e` boots LiveView) → `npm run test:embed-phoenix` + an `embed-react-runtime` job in
`phoenix-ui-e2e.yml`. `auth-gate-ui-e2e` is the only runtime proof that `requires`-gated menus, pages
and buttons hide client-side → `npm run test:auth-gate-ui` + a job in `auth-oidc-compose-e2e.yml`.
Both ride existing push/dispatch/label triggers, never an unlabeled PR.

Worth recording because it is the wave's own discipline working: `draft-gate.test.ts` rejected the
packet's first placement of the embed job, and it moved the job to a label-opt-in workflow rather
than concatenating the literal `if:` the gate greps for. Gaming the gate was available and declined.

**Two carry-forwards**: no `run-*` label was minted for the two new jobs (the label table lives under
the gitignored `.claude/skills/`, outside any packet fence), and **neither new job has ever run** —
hex.pm egress and the Playwright download are unavailable in the sandbox, so their first triggered
run needs watching. Two further findings became batch-2 row **CR1-i**.

### CR1-b — folded (P0-4)

`worktree-agent-a969add743a0d89c7`, `76ef74ad..513e5424` (5 commits).

**This packet corrected the row it was draining, and the correction is the interesting part.** The
audit's table listed elixir as already env-overridable with a documented `OIDC_AUDIENCE=""` opt-out.
Measured, it was not: every audience construct in `renderOidcVerifier` — `audience/0`,
`aud_present?/1`, the `add_claim("aud", …)` validator — sits behind `auth.oidc.audience ? … : ""`, so
an undeclared audience emitted **no audience check at all**, exactly like node. The audit read the
`envOrDeclared("OIDC_AUDIENCE", …)` call and inferred an env path without checking that the call only
appears in the *declared* branch. **The divergence was two backends, not one.** The audit's table is
struck through and corrected in place rather than rewritten, because the error mode — classifying by
the shape of a call site instead of by what executes — is the same one the audit attributes to the
waiver register in P0-2.

Both backends now read `OIDC_AUDIENCE` at boot alongside `ISSUER` (in a generated Node service
`process.env` at module load already *is* the deploy env; elixir reads per-verify only because a
module attribute would freeze compile-time env into the release). Empty still means skip, preserving
the documented opt-out. `hono/v5` shares the emitter, so `platform: node` inherits it.

`loom.auth-oidc-no-audience` raised in `validators/auth.ts`, text in `messages.ts`, anchored in
`code-docs.ts`, with a firing fixture in the census.

**The e2e row is a runtime proof, not a string assertion**: it boots a second instance of the same
artifact with `OIDC_AUDIENCE` set to an audience the token cannot carry and asserts the same real
token is rejected — `/health` asserted first, so a 401 cannot be "never came up". Green against
Keycloak 26 + PG 18, red on the reverted emitter. The probe was also added to all four legs' `paths:`
blocks, since otherwise a change to the assertion would fire none of the legs it is the assertion for
— P0-3's own bug shape, caught by the packet that had just read about it.

**Residual divergence, recorded not fixed:** `OIDC_AUDIENCE=""` is an opt-out on node and elixir
only. dotnet, java and python read the empty string as a *declared* audience of `""` and reject every
token. Fail-closed, so not a hole — a deployment footgun, one line per backend, each named with its
line number in the hand-off.

### CR1-d — folded (P0-1)

`worktree-agent-a07b4a9bb6cfc0217`, `8e5823ba..6e4c8398` (5 commits). Waivers **111 → 98**.

**The mechanism.** A waiver is now a typed claim: `{ standing }` has no shelf life,
`{ deferred, reviewUntil, blockedBy? }` is parked work that expires. Three failure modes on top of
the two that existed — a past `reviewUntil`, a date parked beyond a 180-day cap (closing the
`"2099-01-01"` escape), and a `blockedBy` naming a PR absent from the test's own `LIVE_FENCES` map.

`blockedBy` resolves against that register rather than real merge state **on purpose**, and the
reasoning is worth keeping: `test.yml` checks out at `fetch-depth: 1`, so
`git log --grep "Merge pull request #2736"` finds nothing on a runner even for a PR merged months
ago — and "nothing found" would read as "not merged". It would fail **open** exactly where the gate
has to hold. The fence register is data, identical on runner and laptop.

**The drain found a live codegen defect.** Hono's `serviceReadPorts` rode two hand-rolled child
enumerations, both holed: no statement arm for `domain-service-call`/`assign`/`repo-delete`/
`repo-run`, no expression arm for `match`/`list`/`convert`/`duration`/`i18nFormat`/`authz-filter` or
lambda blocks. On a `.ddd` that parses and validates clean, a reading service call in a `match` arm
derived no read port and the emitted handler passed an identifier it never bound — TS2304, the
generated project did not compile. Python already rode the sanctioned walker; java/dotnet/elixir
inject read-ports rather than pass them, so only Hono was exposed.

**Coordinator sent the packet back for a regression test, and should have.** The fix first landed
with none, and the packet's own byte-identical result was the evidence why that mattered: 42,859
files with 0 diffs means **no corpus fixture exercises the shape**, so the census would have guarded
the mechanism and not the behaviour — a future refactor riding `walk.ts` correctly and still dropping
the port would pass. `test/generator/typescript/workflow-read-port-derivation.test.ts` now pins it:
four slots, four services, four repositories so each port is independently observable, with
`IfLetBranch` kept as a **control** because it worked pre-fix. The assertions distinguish a *binding*
from a *use* — broken output is precisely the output that mentions the identifier without
constructing it — and the fifth is name-independent: every bare-identifier argument to a
reading-service call must have a `const <id> =` in the same handler, which is the TS2304 condition
itself. Coordinator re-verified by copying the pre-fix emitter in: **4 failed, 1 passed** (the
control), restore byte-identical.

Corpus fixture **recommended against**, with reasoning: the defect is Hono-specific, so a fixture
would fan five aggregates across four backends it proves nothing for, into the docker-booting compile
legs — and assertion 5 already encodes the TS2304 condition at ~1s.

Corrects the brief: the split is **13 free / 10 fenced**, not 14/9 —
`backend-syntax-checks.ts#eachStmtExpr` is `src/ir/**`, packet 2f's tree. **None was re-waived:** 4
migrated onto `walk.ts`, 9 given an explicit `never`-check.

Worth noting for future packets: the first draft of the regression test copied the neighbouring
suites' `generateHono(model)` import and tripped `legacy-generate-path-ratchet.test.ts` on all three
assertions. The packet followed the ratchet rather than widening its pin. "Copy the neighbouring
suite's imports" is the obvious move and it is the one that gate rejects.

The **63 entries** whose own text said "follow-up drain" are now `deferred` with
`reviewUntil: 2026-12-31` — deliberately, since leaving them `standing` would have built a mechanism
with no subjects. One date, one batch, one future packet; CR1-e and CR1-f drain most of them.

### CR1-c — folded last, as designed (P1-3, P1-5)

`worktree-agent-acb4378b61255bd8d`, `76ef74ad..64bd1860` (3 commits). Coordinator re-verified rather
than taking the report: `npm audit` → **0 vulnerabilities**; `npm run lint` → **exit 1** on the
warning tree (the ratchet bites); the 68-line `predicates.ts` deletion is genuinely dead — the only
surviving `walkExpr` references are two comments that already describe it as deleted, and the one in
`workflow-execution-emit.ts` names the *validate-layer* function, not this one.

Two corrections to the brief, both the packet's own finding:

- **The advisory count had moved: 11, not 6** — all in-range and Surface A, cleared to 0 in one pass.
  `ip-address`/`qs` trace solely to `packages/ddd-mcp` → `@modelcontextprotocol/sdk` → express, and
  pin nowhere under `stacks/`, `designs/`, `packages/*/pins.ts`, `src/platform/hono/v*/pins.ts`,
  `api/`, `vite/`, `docker/` — so the `dependency-upgrade` skill's Surface B (the generated
  projects' stack templates) is genuinely not in play, and no compose-boot gate is implicated. The
  `hono` advisory is a decoy: that is the MCP SDK's transitive copy, not the emitted pin string.
- **`npm audit fix` is unusable on this tree** and was so on pristine `main` — it crashes arborist
  (`Cannot read properties of null (reading 'edgesOut')`) because `vite@8` →
  `@vitejs/devtools-vitest` → peer `vitest@*` resolves to **vitest 5**, the out-of-scope major.
  Cleared instead with a lockfile-only `npm update` plus one scoped override pinning that nested
  peer to `^4.1.11`. A top-level `vitest` override is refused (`EOVERRIDE`) and `$vitest` does not
  resolve nested — both recorded in the hand-off.

**Ratchet mechanism**: `--error-on-warnings` on the `lint` script rather than promoting rules to
`error`, because the promote route must *enumerate* and an incomplete list silently re-opens the hole
for the next rule — the exact failure P1-5 describes. `biome.json`'s `files.includes` is an
allowlist, so 24 was the whole surface, not a partial view. Both enforcement points (`test.yml`, the
`Stop` hook) already call `npm run lint`, so neither needed editing. Mutation-proved three ways, the
third load-bearing: old `biome ci .` on a seeded unused import → `Found 1 warning`, **exit 0** (the
bug); new script, same tree → **exit 1**.

**Carry-forward for the coordinator — 2 items:**

1. `npm run lint` is **RED on this branch by design**: 8 warnings remain, all inside #2933's fence
   (`src/ir/**` ×7, `src/generator/flutter/**` ×1 — verified by the coordinator, list below). None
   touch CR1-a/b/d, which carry no Biome warnings. Sweep at fold, or after #2933 merges if it is
   still open — the conflict would be trivial (unused imports) but the fence is the fence.
   `src/generator/flutter/index.ts:40` · `src/ir/types/loom-ir.ts:4137` ·
   `src/ir/util/workflow-own-state.ts:123` · `src/ir/validate/checks/backend-syntax-checks.ts:123` ·
   `orm-adapter-checks.ts:20` · `projection-backend-checks.ts:11` · `ui-checks.ts:361` ·
   `ui-collection-display-checks.ts:28`. One (`MAP_UNRENDERED_FRAMEWORK`) needs a by-hand
   dead-or-dropped call after the sweep — Biome only renames it.
2. The `@vitejs/devtools-vitest` override is **temporary scaffolding**; whoever lands the vitest 5
   bump deletes it in the same PR.

### The lint sweep — carry-forward 1, resolved at the fold

All 8 were swept rather than left, because a lint ratchet that ships with the tree red is not
shipped, and waiting on #2933 would have blocked the wave indefinitely on four unused imports. Seven
are Biome-fixable one-liners that compose trivially with any concurrent edit; #2933's coordinator
composes at their fold.

**The eighth was not mechanical, and is a find in its own right.**
`MAP_UNRENDERED_FRAMEWORK = "feliz"` in `ui-checks.ts` is a carve-out whose own doc comment says
*"Delete this carve-out when the walker grows a lambda seam and `feliz-target.ts` renders `map`."*
#2729 did exactly that — rendered `map` on all seven emitters, removed **every use**, and left a
comment reading *"There used to be a per-ui Feliz carve-out here"* — but left the declaration behind.
Deleting it completes that removal.

Which PR that was is the point: **#2729 is one of the same merged PRs whose stale `INFLIGHT_` fences
CR1-d drained.** One spent PR left two different kinds of residue, and it took two different packets
of this wave to see either — the waiver register could not notice its reason had expired, and the
lint gate could not fail on the constant it orphaned. Neither gap was visible to the other.

Gates stated: `tsc -b` clean; `test/system` + `test/platform` 2,613 passed (incl.
`local-run-mapping`, `pr-gate`, `merge-queue-readiness`); `test/macro` + four generator dirs +
`test/language` 5,375 passed; suite reports `RUN v4.1.11`, so the vitest bump is live.
