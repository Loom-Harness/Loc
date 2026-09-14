# Testability-audit fleet plan

**Snapshot 2026-09-14, re-verified against `main @ 9e03c0ff`** (233 commits after the
audit was written). Findings:
[`2026-09-13-testability-audit.md`](2026-09-13-testability-audit.md). This file is the
ORDER, the FILE OWNERSHIP that keeps a parallel fleet from colliding, and the four
decisions that gate part of it.

`docs/new-plan/` remains the only authoritative status table. This is a plan snapshot;
if the two disagree later, the track file wins.

## Re-verification — what 233 commits changed

Every finding was re-run on fresh `main` before planning. **Two moved, ten stand.**

| F | Status on `9e03c0ff` | Change |
|---|---|---|
| F1 `.count` on a repo-read binding | **stands** — and the diagnosis is now exact (below) | — |
| F2 id/datetime literals in emitted tests | **stands** — TS2345 + two mypy errors | — |
| F3 e2e suite has no isolation | **stands** — zero reset hooks in the emitted project | — |
| F4 e2e payload unchecked | **stands, narrowed** | a new `loom.e2e-unrouted-verb` gate landed; it checks the VERB (and now double-reports with `loom.e2e-unknown-method`). The PAYLOAD is still unchecked |
| F5 no workflow accessor | **stands** | — |
| F6 no principal in `test e2e` | **stands** — grammar unchanged | — |
| F7 UI negative path | **stands** — status arg still dropped | — |
| F8 `verifies` join | **half fixed** — see below | `ddd verify` now **exits 1** and prints a diagnostic instead of reporting a silent pass (F-017 / #2922 wave 5) |
| F9 `auditable` + any frontend | **stands** | — |
| F10 uuid 422 vs 404 | **stands** | — |
| F11 matcher catalogue | **stands** (10 entries, not 9 — the audit undercounted by one) | — |
| F12 no generated README | **stands** | — |

**F1's root cause, pinned.** Three sibling operations over the same binding, one
`ddd generate system`:

```ddd
operation a(t: string): bool { let f = Owners.byTier(t)  return f.count > 0 }
operation b(t: string): bool { let f = Owners.byTier(t)  return f.length > 0 }
operation c(t: string): bool { let f = Owners.byTier(t)  return f.totallyInvented > 0 }
```

```ts
return f.count > 0;            // a — TS2339, the collection op never fired
return [...f].length > 0;      // b — the STRING `.length` lowering, spread-to-array
return f.totallyInvented > 0;  // c — fails open, verbatim
```

`b` is the tell: the let-binding of a repository read inside a `domainService` body is
typed **`string`** — `memberType`'s default fallback — not `Owner[]`. So *every* member
read off such a binding is wrong, not just `.count`. The fix is to type the binding, not
to gate the member.

**F8's remaining half, pinned.** The join works; the name it is given never matches.

| results row | verdict | exit |
|---|---|---|
| `{name: "creates a widget", suite: "VerifyProbe e2e"}` | 1/1 VERIFIED | 0 |
| `{name: "creates a widget against api", suite: "VerifyProbe e2e"}` — *what every runner reports* | 0/1, gate failed | 1 |

`src/system/e2e-render.ts:150` appends ` against <slug>` deliberately (multi-backend
replay disambiguation — worth keeping). `src/verify/verification.ts` matches the declared
name exactly. And the new diagnostic misdiagnoses it: it says *"likely a `suite` mismatch
… got 'VerifyProbe e2e'"* while naming the suite that is in fact correct. The repo's own
per-PR leg still shows it — `node run.mjs storefront-system` → **6 passed, 0 failed,
`requirements: 1/4 verified, 2 unverified`**, exit 0.

## The field — dedupe against four live fleets

26 PRs are open; ten were claimed this morning. Checked in both directions:

| PR | Overlap | Ruling |
|---|---|---|
| #2949 `loom.unknown-primitive-member` | adjacent — an invented member on a **primitive** receiver, emitted verbatim | **Not F1.** Different receiver kind (primitive vs array binding) and different fix (gate the member vs type the binding). F1's `c` case would be its natural extension; the P6 brief says so |
| #2938 CR1 batch 1 | its finding #1 is the Hono **read-port derivation** for domain services (TS2304) | Same file neighbourhood as F1, different defect. P6 must read it before starting |
| #2933 wave C2 batch 2 | touches `src/ir/lower/lower-expr.ts` | **Fences F1.** P6 stacks on it or waits |
| #2922 / #2911 / #2862 / #2865 end-to-end audits | same methodology | No finding of mine appears in their registers |

## Wave 1 — five agents, disjoint files, no decision needed

| # | Packet | Fixes | Owns | Proof it must carry |
|---|---|---|---|---|
| **P1** | **the `verifies` join** | F8 | `src/verify/verification.ts`, the `ddd verify` CLI reporter, `test/behavioral/run.mjs`'s rollup call | Normalize the ` against <slug>` suffix on the RESULT side (keep the emitter's suffix). Fix the diagnostic to name the real mismatch. **Proof: `node run.mjs storefront-system` goes `1/4` → `3/4` or better with TC-002 VERIFIED, and a mutation (revert the normalization) puts it back.** Also cover the `.ui.spec.ts` title shape |
| **P2** | **typed literals in emitted unit tests** | F2 | the five test emitters (`{typescript,dotnet,java,python}/emit/tests.ts`, `elixir/vanilla/tests-emit.ts`) + a shared arg-coercion helper | Wrap an `<Agg> id` argument in the backend's brand/ctor and an ISO-8601 literal in its datetime type, **per backend**. Wire a generated-test typecheck into a gate that runs per-PR, since none does today. **Proof: `tsc --noEmit` AND `mypy` clean on a project whose `test` passes both literal kinds — today that is 1 TS error + 2 mypy errors.** `web/src/examples/sales-system.ddd:106` ships this shape, so the gate must reach `web/src/examples/**` |
| **P3** | **e2e payload validation** | F4 | `src/ir/validate/checks/e2e-route-checks.ts`, `src/diagnostics/messages.ts` | Validate create/operation bodies against `createInput` / the operation's params, and response-field reads against `wireShape`: unknown key, wrong scalar type, missing required field, unknown response field. **Corpus sweep BEFORE the change, #2949-style — the gate must turn no valid model red.** Also collapse the new double-report (`e2e-unknown-method` + `e2e-unrouted-verb` both fire on one mistake) |
| **P4** | **two papercuts** | F9, F10 | `src/ir/validate/checks/react-id-reference-checks.ts` (F9); the id path-param schema on hono + python (F10) | F9: `auditable`'s `createdBy: User id` is the PRINCIPAL type, not an aggregate — a UI-mounting deployable must not demand an aggregate named `User`. **Proof: the 12-line repro parses clean and the React project builds.** F10: settle D-2 then make the id param agree across backends. **Proof: the same placeholder UUID answers the same status on node and python** |
| **P5** | **UI e2e negative path** | F7 | `src/system/ui-e2e-render.ts` + the matching validator check | Today `toThrow(422)` in a `ui` body silently drops the status and emits an assertion that cannot fire — it hangs to the 30 s Playwright timeout and fails. Settle D-3; at minimum **never silently drop the argument**. **Proof: either the negative test passes in a real browser run, or the model is rejected at parse time with a diagnostic naming the reason** |

Sized at five, not twelve: the runner pool is shared with four other audit fleets and a
merge queue, and P2/P3/P4 each wake per-backend compile gates.

## Wave 2 — after wave 1 frees slots

| # | Packet | Fixes | Gate |
|---|---|---|---|
| **P6** | **the repo-read binding types as `string`** | F1 | **Fenced on #2933** (`lower-expr.ts`). Stack on its branch. Read #2938's read-port finding and #2949 first — three packets in one neighbourhood. Proof: all three sibling operations above emit correctly, and a `never`-safe test pins the binding's TYPE, not the rendered string |
| **P7** | **emitted-suite isolation** | F3 | **Decision D-1.** |
| **P8** | **a README in the generated tree** | F12 | None — `src/system/index.ts` writes the root. Say what the four projects are, that `e2e/` and `web_app/e2e/` need their own install, and (pending D-1) what state they assume |

## Wave 3 — language features, design sign-off first

| # | Packet | Fixes | Why it is not wave 1 |
|---|---|---|---|
| **P9** | a workflow accessor for `test e2e` | F5 | New surface syntax. The backend already mounts `POST /workflows/<name>`; the DSL cannot reach it. `language-feature-developer` |
| **P10** | a principal clause for `test e2e` | F6 | The one that unlocks testing `requires` / `policy` / `mask unless` / tenancy denial from a user's own model. Today that coverage exists only as `AUTHZ_LADDERS`, harness-side, shipped to nobody |
| **P11** | matcher catalogue | F11 | `toContain` / absence / an emitted-event assertion, and a way to pin WHICH rule rejected — the audit's mutation probe stayed green because a precondition and an invariant are indistinguishable through `toThrow()` |

## Decisions — owner-gated

- **D-1 (F3, gates P7) — how does an emitted e2e suite get isolation?** (a) emit a
  `beforeEach` that truncates every table through a generated helper; (b) run each test in
  a transaction and roll back — cheapest, but the suite talks HTTP to a separate process,
  so it cannot; (c) leave state shared and DOCUMENT a fresh-database contract, plus a
  `db:reset` script. **Recommendation: (a) for a single-backend system, (c) as the
  documented fallback** — (b) is structurally unavailable to an out-of-process suite.
- **D-2 (F10, gates half of P4) — which UUID semantics is the contract?** Hono's
  `z.uuid()` rejects some hex-shaped ids with 422 before the 404 path; python/java/.NET
  accept them. **Recommendation: loosen Hono to the shared hex shape** — the documented
  contract is "missing row → 404", and the strict reading makes `toThrow(404)` depend on
  which placeholder the author typed.
- **D-3 (F7, gates P5) — real UI negative assertion, or an honest refusal?**
  **Recommendation: refuse now** (`loom.e2e-ui-throw-unsupported`), and file the real
  matcher — "the form shows this field error and stays on the page" — as its own mission.
- **D-4 (F5/F6, gates wave 3) — are these features wanted?** They are the difference
  between a test tier that covers CRUD and one that covers what Loom markets: workflows
  and the authorization layer.

## Standing rules for every packet

1. **Re-verify on fresh `main` before writing code.** Two of twelve findings moved under
   233 commits in one day. A finding is a lead, not a diagnosis.
2. **Claim first**: open the draft PR naming the files you will touch before implementing.
   Check the open drafts for overlap — ten were opened this morning.
3. **Mutation-prove every gate**, reverting by file copy, never `git checkout -- <path>`.
   State the result in the PR body.
4. **Run the matching gate locally.** Never push to see a check's verdict.

## Dispatched — wave 1, 2026-09-14 14:45–14:47 UTC

Five Opus sessions, one per packet, each briefed with its finding, its measured
before-state, its file ownership, the proof it must carry, and the standing rules.
Sessions were told to claim with a draft PR **before** implementing, and not to merge.

| Packet | Session | Fixes |
|---|---|---|
| P1 | `session_01LbMANcN87hT6oJjSu5K1uT` | F8 — the `verifies` join |
| P2 | `session_01QqqfzKiMzyfLB5rptZkR5G` | F2 — typed literals in emitted unit tests + the missing typecheck gate |
| P3 | `session_01WbgqXFQ9L6Y8b8aqXExNvL` | F4 — e2e payload validation |
| P4 | `session_01LDt6GCMqPecdVYj29826yG` | F9 + F10 — `auditable` × frontend, UUID status parity |
| P5 | `session_01HDqPV1fxsx1bEstsGrmXhB` | F7 — the UI negative path (settles D-3) |

Wave 2 (P6 fenced on #2933, P7 gated on D-1, P8) and wave 3 (P9–P11, gated on D-4)
are **not** dispatched. P4 carries D-2 and P5 carries D-3 because each is local to one
packet's own evidence; D-1 and D-4 are owner decisions and block their packets.

## Outcomes — wave 1, and wave 2 dispatched (2026-09-14 16:28 UTC)

Wave 1 produced **six** PRs (P4 split its two papercuts, as its brief allowed):

| Packet | PR | State at 16:26 UTC |
|---|---|---|
| P1 | [#2956](https://github.com/Loom-Harness/Loc/pull/2956) — the `verifies` join | green, queued |
| P2 | [#2957](https://github.com/Loom-Harness/Loc/pull/2957) — typed literals + the missing typecheck gate | 235 checks pass, 4 pending, auto-merge armed |
| P3 | [#2958](https://github.com/Loom-Harness/Loc/pull/2958) — e2e payload validation | running the full suite after a ~20-PR main merge |
| P4 | [#2960](https://github.com/Loom-Harness/Loc/pull/2960) — `auditable` × frontend · [#2962](https://github.com/Loom-Harness/Loc/pull/2962) — UUID status parity | review-ready |
| P5 | [#2959](https://github.com/Loom-Harness/Loc/pull/2959) — refuse `toThrow` in a ui body (settles **D-3**: refuse, don't silently weaken) | in progress |

The audit and this plan are [#2964](https://github.com/Loom-Harness/Loc/pull/2964).

**Wave 2 dispatched**, three sessions:

| Packet | Session | Notes |
|---|---|---|
| P6 — F1 | `session_01Uz1mFCn4RQu6vt88j7fq1P` | #2933 still open at dispatch, so the brief is: stack on it rather than wait |
| P7 — F3 | `session_01BqvZ1WTZasfyV42Lsxz7Ya` | **D-1 settled as the default**: a generated reset seam, with the documented fresh-DB contract as the honest fallback; per-test transactions are structurally unavailable to an out-of-process suite. The binding constraint handed to it: it must be impossible to fire against a non-local target |
| P8 — F12 | `session_01MmL7Sj8F1uAQHRhadbGVmF` | Derived from the model, and every command in it actually run — a README whose recipe was never executed is the same defect class this fleet is draining |

**Wave 3 (P9–P11) stays held on D-4** — a workflow accessor and a principal clause for `test e2e` are new surface syntax, and they are the difference between a test tier that covers CRUD and one that covers what Loom markets.
