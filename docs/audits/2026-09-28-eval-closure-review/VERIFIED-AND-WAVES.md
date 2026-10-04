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

## Rulings (owner, 2026-09-29)

| # | question | ruling |
|---|---|---|
| D1 (#3) | A reactor has no request principal. What does a gated op reached from a reactor do? | **Reactors run as a `system` principal, tenant-scoped, and gates are evaluated against it.** <br>• **The principal:** `{isSystem: true, tenant: the triggering event's tenant, causedBy: the originating user id}`. `causedBy` is for audit and logs only. <br>• **Gates:** evaluated normally. A gate that can pass for system must say so, e.g. `requires currentUser.isSystem or …`. <br>• **Warning:** a reactor that reaches a gate system can never satisfy gets a compile-time warning. <br>• **Tenancy:** filters and stamps use the event's tenant, so the channel envelope must carry it. <br>• **Timers:** they have no tenant, so a tenant-owned read from a timer needs an explicit `crossTenant`. <br>• **Language surface:** add `currentUser.isSystem`. |
| D2 (#6) | Target-language reserved member names | **Escape per backend.** Python gets one ident funnel that keeps the wire and DB names (pydantic alias, `mapped_column` name), mirroring Java M-T6.36. .NET renames its private helper. |
| D3 (#13) | Kafka consumer start offset | **`earliest` for a new group on work queues** (`retention: work` / `delivery: queue`). `retention: log` keeps `latest`. |
| D4 (#20) | 403 detail echoes the gate predicate | **Echo in dev only:** the predicate stays in the body under dev-stub auth; otherwise the body is a constant `Forbidden` and the predicate goes to the server log. |
| D5 (#22) | `denyByDefault` leaves the auto-`findAll` list route open | **Warning** `loom.default-deny-list-ungated`, same tier as the by-id warning. |
| D6 (#23) | Malformed dev-claims header | **400** on all five dev stubs. |
| D7 (#17) | Param/let named like a `resource` | **Params and lets shadow** resource handles (lexical scoping). |
| D8 (#38) | ICU `plural`/`select` in backend domain code | **Warning now** (`loom.interp-format-dropped-in-domain`); rendering becomes a mission. |
| D9 (#39) | Cross-context policy | **Clear diagnostic now** (`loom.policy-out-of-scope`); sharing becomes a mission. |
| D10 (#15d) | Python message for a message-less rule | **Match node's synthesized message** (wire parity; the regex never leaves the server). |
| D11 (#37, #47) | `npx ddd` naming; README claims | **Print the invocation that actually ran**, and qualify both README claims with a link to the unsupported register. |
| D12 | Lockfiles, stale-pin detector, event/equality matchers, aggregate move, multi-resource, union wire shape | **Mission only.** |

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


### Wave A outcome (2026-09-29)

All 9 PRs are open and ready. Each has a mutation-proved test, and its local gates and backend compile tier were run.

| agent | PR | fixed |
|---|---|---|
| A1 | #3079 | #2: `find all() where` filter on python and elixir (plain and paged paths) |
| A2 | #3080 | #10: TPH projection source and discriminator on node (drizzle, mikroorm), python and elixir; #14b: elixir `sum` over a jsonb VO leaf |
| A3 | #3082 | #14a: elixir workflow-state VO, optional, `id[]` and enum field types, plus the state migration and allocation (also the D8 sibling from #3058) |
| A4 | #3083 | #11: foreign-event VO/enum closure; #12: optional-field decoding on .NET and python; F-046 |
| A5 | #3084 | #7: honest refusal for a paged `queryHandler` over a retrieval run |
| A6 | #3085 | #5: node null-aware find predicate; #19: `npm run typecheck` in the generated node Dockerfile |
| A7 | #3086 | #15b: ruff F841; #15c: mypy comparison-overlap |
| A8 | #3088 | #18: `loom.ui-scaffold-unserved`; G8-02: docs and comment |
| A9 | #3090 | #27: If-Match on Feliz and Flutter; M-FT.5: `then:` on Feliz and Flutter |

**New follow-ups found by Wave A**, added to Wave B:

| id | defect | from |
|---|---|---|
| B-A6a | **elixir** `where: record.col == ^(current_user && current_user.claim)` raises an Ecto `ArgumentError` at runtime when the claim is null | A6 |
| B-A6b | **java** JPQL `e.col = :#{currentUser?.claim}` binds `= NULL` for a null claim and returns no rows, unlike node | A6 |
| B-A3a | **python** has the #14a shape: `BillingRow(total="")` over flattened `total_amount`/`total_currency` columns | A3 |
| B-A3b | **elixir** stores a Decimal inside a VO written from domain code as a string in jsonb; delta `addColumn` of a VO field still flattens | A3 |
| B-A1 | **python** document, embedded and event-sourced repository `all()` ignores a declared `all` filter | A1 |
| B-A4 | **node** omits an optional event field left out of `emit` (it is absent rather than null); channels-e2e and corpus fixtures need an optional-field row | A4 |
| B-A9 | **flutter** Riverpod `match await` on a versioned update sends no If-Match; **feliz** scaffolded param-less OperationForm plus a custom Action on the same op collide | A9 |
| B-A2 | **elixir** grouping key over a VO leaf (`group by b.amount.currency`) renders `record.<leaf>` | A2 |
| M | Accept a retrieval-run in a paged `queryHandler` (the fix beyond A5's refusal) | mission |

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

### Wave B outcome (2026-09-29)

All 9 PRs are open and ready. Each has a mutation-proved test and its local gates were run.

| agent | PR | fixed | left open |
|---|---|---|---|
| B1 | #3092 | #32: argument types in `test` bodies; #8: parse error instead of a `lowerApply` crash | #9 is claimed by #3078 |
| B2 | #3093 | #44: deep effect pass; #17: params and lets shadow resources (D7) | — |
| B3 | #3095 | #36 `verify` status check; #29 `loom.api-unserved`; #30 rename-hint placement; #40a named hand-edited files | #40b goes to a mission |
| B4 | #3096 | #28: IR diagnostics carry file:line:col | 136 sites on system/ui/api/store nodes with no IR origin yet; playground worker mapping; statement-level workflow spans |
| B5 | #3098 | #15a; B-A3a: python workflow-state VO; B-A1: python doc/embedded/ES `all()` filter | python projection read-model VO flattening (python twin of #3089) |
| B6 | #3097 | #24: compose `restart:` plus DB-connect retry on all 5 backends | Java/Elixir not booted locally |
| B7 | #3099 | Docs and tracker sweep; ported registers; new missions M-T1.41, M-T2.19, M-T3.22/23, M-T5.44–46, M-T7.11, M-T9.77–79 and slices | M-T8.26 id collision (#3074 vs #3076) |
| B8 | #3100 | B-A6a, B-A6b: null-aware predicates on elixir, java and dapper; dapper jsonb VO-leaf predicates | An enum VO leaf in a dapper predicate is honestly refused |
| B9 | #3101 | B-A3b: elixir VO delta migrations as one `:map` column; Decimal read-back | B-A2 is not a bug (`loom.projection-groupby-key-not-columnar` refuses it everywhere); backfill/addIndex on a VO leaf |

### Wave C — after the decisions (7 agents)

| agent | items | decision | waits on |
|---|---|---|---|
| C1 | #3 reactors run as a tenant-scoped `system` principal: `currentUser.isSystem`, tenant carried in the event envelope, a warning for unsatisfiable gates, `crossTenant` for timers (all five backends; a language-feature-developer slice) | D1 | #3066 |
| C2 | #6 target reserved words (Python funnel, .NET helper) | D2 | — |
| C3 | #20 403 detail (echo in dev only); #22 list-route warning; #23 dev-claims 400; #26 demo tenant seed + permissions attr; #39 `loom.policy-out-of-scope` | D4–D6, D9 | #3065 (`auth-emit.ts`) |
| C4 | #13 Kafka offset, all five backends + channels-e2e-kafka proof | D3 | — |
| C5 | #15d Python message-less rule message | D10 | — |
| C6 | #38 ICU-drop warning; #37 `ddd new` invocation; #47 README claims | D8, D11 | — |
| C7 | M-FT.24 OpenAPI splits op-union error arms out of the 200 schema (shared `_payload/union-wire.ts` helper) | union-wire card for the rest | — |

### Wave C outcome (2026-10-04)

A weekly usage limit stopped Wave C on 9-29, and a session limit stopped it again on 10-04. Both times it was resumed from the open branches; no work was restarted from scratch. Every Wave C PR is open and ready. None is merged; the owner queues them.

The agent labels changed between runs. The table below is keyed by item, not by the plan's row letters.

| item | PR | fixed | left open |
|---|---|---|---|
| #3 (D1), principal + emitters | #3103 | Reactors and timers run as a tenant-scoped `system` principal on all five backends. `currentUser.isSystem` exists in the language. An unsatisfiable gate gets a compile warning. A timer needs `crossTenant` for tenant-owned reads. CI fixes: the Node id-claim placeholder no longer references an unimported `Ids`; Python `user User(` under hierarchy tenancy | The warning does not cover gates on lifecycle `create` operations a reactor calls |
| #3 (D1), envelope (stacked on #3103) | #3131 | The outbox row (`__loomOrigin`) and the channel envelope (`tenantid` / `loomorgpath` / `loomcausedby`) carry the event's origin. The relay and consumers run each event as that origin's system principal. CI fix: `tenant` is bound only when it is read (Python ruff F841, Elixir `--warnings-as-errors`) | Retarget to main after #3103 merges. #3083 edits the same channel emitters, so whichever merges second resolves a signature conflict. The channels-e2e broker leg was not run locally |
| #6 (D2) | #3102 | Target reserved words are escaped per backend: one Python ident funnel that keeps wire and DB names, and a renamed .NET helper. Sweep fix: Python soft keywords (`match`, `case`) are no longer escaped | — |
| #20 (D4), #23 (D6), #26 | #3104 | The 403 body echoes the gate predicate only under dev-stub auth. A malformed dev-claims header gets a 400 on all five stubs. The demo tenant gets a stable uuid plus a registry row seeded on first boot. CI fix: Phoenix `seeds.ex` emits `insert!/3` only when a domain-path row uses it | The Keycloak demo-user `permissions` attribute was deliberately not done and needs its own ruling |
| #22 (D5), #39 (D9) | #3143 | `loom.default-deny-list-ungated` warning; `loom.policy-out-of-scope` error | Cross-file policies in a multi-file model still give the old `unknown` error. Sharing policies across contexts stays a mission |
| #13 (D3) | #3149 | Kafka work queues start a new group at `earliest` on all five backends; `retention: log` keeps `latest`. A late-join e2e case was added. CI fix: the late-join test counted the other scenario's rows in the shared CI database | The python kafka leg's port-bind failure (55678 is in the runner's ephemeral port range) is unconfirmed until the re-run |
| #15d (D10) | #3153 | Python returns node's synthesized message for a rule with no message (the regex no longer leaks), including the bound wording. Rebaselined the wire golden | The same rule's message text still differs on .NET (EF and Dapper), Java and Elixir: new mission M-T6.86, four narrow waivers |
| #38 (D8), #37 + #47 (D11) | #3154 | `loom.interp-format-dropped-in-domain` warning. `ddd new` and the generated README print the invocation that actually ran. The README's "no drift" and "identical contracts" claims are qualified, with links | Rendering ICU branches on the backends stays a mission |
| M-FT.24 (OpenAPI half) | #3156 | An operation returning an error union publishes `<Union>Success` as its 200 schema and each error arm as `anyOf [ProblemDetails, <Tag>Problem]` at the arm's status. One shared helper (`opUnionResponses`) feeds all five OpenAPI emitters. The runtime wire is unchanged | Schemathesis fixture follow-up (F34). The union wire redesign stays mission M-FT.24 |

**Sweep of Wave A/B (2026-10-04):** all 18 PRs plus #3102 merge cleanly into main and have no open review threads. Required checks are green on every head except #3102, which has been fixed and is re-running. #3079, #3086, #3095 and #3097 show `blocked` although both required checks are green; the cause is unconfirmed (possibly the ruleset's extra-approval setting). Most Wave A/B heads date from 9-29, so the merge queue is where a semantic conflict with current main would show up.

**Known on main, not caused by these PRs:** two Elixir build failures (a tenantRegistry consumer in another deployable; a multi-context reactor consuming another context's event). Also, `dotnet-obs-e2e` truncates captured stdout at 8 KiB, which makes it flaky.

**Mission-only** (filed by B7, not built): #41 aggregate move, #42a multi-resource per kind, #25 lockfile policy, #40b stale-pin detector, #43 matchers (event, equality, not-navigated), M-FT.24 union wire, the OIDC code-flow gate, widening ir-walk-census to independent `if` chains, the clinica wave-0 generated-compiles gate.

**Scale:** 23 implementer agents across three waves, plus landing the nine already-claimed PRs above.
