# Wave CR1 — the verification layer (coordinator log)

*Source: [`../../audits/code-review-2026-09-13.md`](../../audits/code-review-2026-09-13.md) — an independent
review of `main` @ `619708fd` whose verdict was that the **code** is sound and the **verification and
suppression layers** are where things slipped. Base: `main` @ `76ef74ad` (#2896 merged 2026-09-14 08:2xZ).
Packets run as Opus agents in isolated worktrees on local `claude/cr1-<packet>` branches and are folded
onto `claude/loom-code-review-audit-790gec` (the only branch this coordinator pushes), one at a time.
Hand-off notes land under `handoffs/wave-cr1-<packet>.md`.*

## Status: **batch 1 claimed, four packets launching** (2026-09-14)

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

*(appended as packets land)*
