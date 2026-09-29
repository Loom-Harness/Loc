# Re-verification on fresh `main` + fix-wave plan — 2026-09-29

This file **supersedes README.md §2–§3**. Those sections were assembled from per-register reports. Here, every item was re-proved by an adversarial agent on `main` @ `cbda91658`. Each agent was told to *refute* the claim. For each item it:

- wrote a minimal repro and ran `parse` + `generate system`;
- cited the generated `path:line` and the responsible `src/` `file:line`;
- compiled the generated code where a toolchain was available (`tsc`, `py_compile`, `mypy --strict`, `ruff`);
- read the diff of every open PR that could claim the item.

Machine-readable results, with evidence and fix sketches, are in [`reverified-items.json`](reverified-items.json).

## Result

| verdict | n | notes |
|---|---|---|
| **CONFIRMED, unclaimed** | **62** | 37 code defects/gaps, 25 docs/tracker corrections |
| CONFIRMED, claimed | 15 | see "Already claimed" — several were opened on 09-29 |
| FIXED on main | 2 | #4 ES-create gate (#3048), #35 `--enable-source-maps` (already in the Dockerfile) |
| NOT a bug | 5 | #14c (the pure core is only reached by tests), #41 (honest destructive-refusal; move is a feature), #42a (documented `loom.datasource-duplicate` rule), #46 (documented override-by-name), G8-10d (deep-fuzz leg exists) |

**Corrections to README.md.**

- **#3 (reactor gate):** #3066 claims it, but only for the command-workflow path on Java and .NET. The reactor path is still broken on all five backends.
- **#42b:** owned by live mission M-T3.10.
- **#21:** Java *does* fall back to `OIDC_AUDIENCE`; #3065 fixes node and elixir.
- **#23:** the silent fallback is on all five backends, not just Hono.
- **M-FT.5:** the `then:` toast works on the four JSX frontends; only Feliz and Flutter drop it.
- **#19:** CI *does* `tsc` the fixture and corpus output. The generated Dockerfile doesn't, so a user's model can ship type errors.

## Already claimed — land these, don't duplicate

| PR | covers | state |
|---|---|---|
| #3063 | #31 keyword field names (209 → 58 hard words, named error) | open |
| #3065 | #21 `aud` default (node, elixir), G8-03 auth.md | open |
| #3066 | #16 Java/.NET `put(Map)`; #3 command-workflow half (Java, .NET) | open |
| #3073 | #1 `loom.migration-rename-inferred` | draft, empty diff (opened 09-29) |
| #3071 | #33 Flutter `design:` warning | draft, stub (09-29) |
| #3074 | #34 breakpoints → mission M-T8.26 (diagnosis only) | open |
| #3076 | coverage.md claimshub/freight rows, mission-id collisions, stale statuses, eval-fieldops register, FIX-PLAN §5.3 mission | open (09-29) |
| #2949, #3040 | primitive-receiver member reads; domainService env | open — #9 stacks on them |
| M-T3.10 | #42b `can_*` for `requires` gates | live mission |

## Decisions needed before a fix (with the default I would take)

| # | question | recommended default |
|---|---|---|
| D1 (#3) | A reactor has no request principal. What does a gated op called from a reactor do? | **Refuse** at phase ⑦ with `loom.reactor-gated-op`: "call an ungated internal op, or gate the emitter" |
| D2 (#6) | Target-language reserved member names (`def`, `class`, `assertInvariants`) | **Escape** in Python through one ident funnel (wire alias kept, mirroring Java M-T6.36); **rename** the .NET private helper. Refusal only for names no backend can alias |
| D3 (#13) | Kafka consumer start offset | `earliest` for a new group when `retention: work`; keep `latest` for `log` |
| D4 (#20) | 403 detail echoes the gate predicate | Constant `"Forbidden"` plus a policy-decision id; predicate goes to the server log only |
| D5 (#22) | `denyByDefault` leaves the auto-`findAll` list route open | **Warning** `loom.default-deny-list-ungated`, same tier as the by-id warning |
| D6 (#23) | Malformed dev-claims header | **400** on all five dev stubs |
| D7 (#17) | Param/let named like a `resource` | Params and lets **shadow** resource handles (lexical scoping) |
| D8 (#38) | ICU `plural`/`select` in backend domain code | **Warning** now (`loom.interp-format-dropped-in-domain`); rendering stays a mission |
| D9 (#39) | Cross-context policy | Named diagnostic `loom.policy-out-of-scope` now; sharing stays a mission |
| D10 (#15d) | Python message for a message-less rule | Use the same synthesized message node emits (wire parity) |
| D11 (#37, #47) | `npx ddd` naming; README "No drift / Identical contracts" | Print the invocation that actually ran; qualify both README claims with a link to the unsupported register |
| D12 (#25, #40b, #43b, #41, #42a, M-FT.24 union wire) | Lockfiles; stale-pin detector; event/equality matchers; aggregate move; multi-resource; union wire shape | **Mission only**, no build in these waves |

## Waves

Each agent is one Opus implementer on one fresh-`main` branch. Its steps:

1. Claim the work with a draft PR first (CLAUDE.md).
2. Fix the item: a validator refusal or an emitter fix.
3. Pin it with a test, and mutation-prove the gate (revert the fix, watch the test fail).
4. Run the matching per-backend compile tier locally.
5. Push, then drive the PR to green.

Agents inside a wave touch **disjoint files**. Cross-wave order follows file conflicts with open PRs.

### Wave A — silent wrong output, no decision needed (9 agents, parallel)

| agent | items | files (primary) | targets | size |
|---|---|---|---|---|
| A1 | #2 declared `find all() where` loses its filter | python `repository-builder.ts`, elixir `repository-emit.ts` | py, ex | M |
| A2 | #10 TPH projection source + discriminator; #14b elixir `sum` over a `:map` VO | node/python/elixir `query-projections*`, `ir/util/inheritance.ts` | node, py, ex | M |
| A3 | #14a elixir workflow-state VO/optional field types | elixir `dispatch-emit.ts`, `migrations-emit.ts` | ex | M |
| A4 | #11 foreign-event VO/enum closure; #12 optional-field decode; F-046 double cast | channels emitters ×4, backend `index.ts` pools | node, py, .NET, java | M |
| A5 | #7 paged `queryHandler` over a retrieval → honest refusal (or accept) | `enrich/enrichments.ts`, `projection-backend-checks.ts` | all 5 | S |
| A6 | #5 node find on a nullable claim; #19 `tsc` in the generated Dockerfile | `typescript/repository-find-predicate.ts`, `hono/v4/emit.ts` | node | S |
| A7 | #15b ruff F841; #15c mypy comparison-overlap | python `workflows-builder.ts`, `emit/tests.ts` | py | S |
| A8 | #18 scaffold selects a subdomain its `targets:` backend doesn't serve → phase-⑦ `loom.ui-scaffold-unserved`; fix G8-02 doc/comment | `ui-backend-binding-checks.ts`, `page-metamodel.md`, `walker-core.ts` comment | all 6 frontends | M |
| A9 | #27 Feliz/Flutter `If-Match`; M-FT.5 `then:` toast on Feliz/Flutter | `feliz/wire.ts`, `feliz-target.ts`, `flutter/forms-emit.ts`, `flutter-target.ts` | feliz, flutter | M |

### Wave B — validators, CLI, docs (7 agents; start after Wave A merges or as independent PRs)

| agent | items | waits on |
|---|---|---|
| B1 | #9 invented member on an array receiver (`loom.unknown-member#collection`) | stack on #2949 + #3040 |
| B2 | #32 argument types in `test` bodies; #8 CLI crash on a parse error (`lowerApply`) | — |
| B3 | #44 `transactional-no-effect` via `walkWorkflowStmtsDeep`; #17 resource shadowing (D7) | #3065 (`workflow-checks.ts`, `structural-checks.ts`) |
| B4 | #36 `ddd verify` rejects unknown statuses; #29 `loom.api-unserved`; #30 rename-hint placement; #40a name the locally-modified files | #3073 (`migrations-builder.ts`) for #30 |
| B5 | #28 IR diagnostics carry `file:line` (origin span), incremental over the check leaves | — |
| B6 | #15a Python loop-var collision (two `contains`); #24 compose `restart:` + boot-migration retry | A1 (same Python file) |
| B7 | Docs/tracker sweep: the 18 unclaimed G8 items (language.md:1150, .NET verifier comment, eval-fieldops F-005, coverage eshop/testability rows, M-T6.56, register headers, broken links, `.ddd.txt` repros), port the six unmerged registers under `docs/audits/`, `coverage.md` rows for them + eval-clinica, headings for M-FT.5/M-FT.24, missions for G8-10b/c/e/f/g, the #45 slice in M-T5.31 | rebase on #3076 |

### Wave C — after the decisions (7 agents)

| agent | items | decision | waits on |
|---|---|---|---|
| C1 | #3 reactor gated-op refusal | D1 | #3066 |
| C2 | #6 target reserved words (Python funnel, .NET helper) | D2 | — |
| C3 | #20 403 detail; #22 list-route warning; #23 dev-claims 400; #26 demo tenant seed + permissions attr; #39 `loom.policy-out-of-scope` | D4–D6, D9 | #3065 (`auth-emit.ts`) |
| C4 | #13 Kafka offset, all five backends + channels-e2e-kafka proof | D3 | — |
| C5 | #15d Python message-less rule message | D10 | — |
| C6 | #38 ICU-drop warning; #37 `ddd new` invocation; #47 README claims | D8, D11 | — |
| C7 | M-FT.24 OpenAPI splits op-union error arms out of the 200 schema (shared `_payload/union-wire.ts` helper) | union-wire card for the rest | — |

**Mission-only** (filed by B7, not built): #41 aggregate move, #42a multi-resource per kind, #25 lockfile policy, #40b stale-pin detector, #43 matchers (event, equality, not-navigated), M-FT.24 union wire, the OIDC code-flow gate, widening ir-walk-census to independent `if` chains, the clinica wave-0 generated-compiles gate.

**Scale:** 23 implementer agents across three waves, plus landing the nine already-claimed PRs above.
