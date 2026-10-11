# Wave C3F — the C3 defect drain (coordinator log)

Wave C3 ([`wave-c3.md`](wave-c3.md), closed 2026-10-06) was test-only by design: every runtime defect its packets found was handed off with a repro, not fixed. C3F fixes them. One Opus agent per packet, each in an isolated worktree on a local `claude/c3f-<packet>` branch, fenced by tree so no two packets edit the same emitter files. The coordinator folds packets onto the wave branch and lands them in batches through the merge queue.

## Status: **launched 2026-10-06** — eight packets building; landing order and PR batches below.

## Rules every packet follows

1. **Verify before fixing, on fresh `main`.** `main` moved ~60 commits during C3's last day, and several open PRs touch the same rows (cited per packet). An item already fixed on `main` is recorded with the commit. An item an open PR covers is cited and skipped; if the PR only partly covers it, the packet builds on that PR's approach.
2. **Each fix ships with a test that fails without it.** Mutation-prove by file-copy revert, read the failing assertion, and boot the behavioural leg where the defect is runtime. Where a fixture was held or waived for the defect, the fix drains it: restore the block, node-mint the golden, delete the register/waiver row.
3. **No new `loom.*` refusal as a "fix"** unless the defect is genuinely unsupported surface. A refusal is an honest gap, not a fix; say so in the hand-off.
4. A hand-off note goes to `handoffs/wave-c3f-<packet>.md`: item → outcome (fixed / already fixed / covered by #NNNN / deferred with mission id), mutation proofs, and gates run.

## Owner defaults taken (the owner said "continue with recommended", 2026-10-06)

- **M-T6.87 — the message-less rule's default sentence.** Default: **node's sentence is canonical**. Every backend emits the sentence node derives from the rule, as #3153 already does for python's single-field case, and an RS-rule pins it. Minted as `D-MESSAGELESS-DEFAULT` (`proposed`, the usual 48 h default) by packet F4.
- **`CLAUDE.md` § "CI surface"** refreshed in this PR to #3178's truth: 24 queue gates, and no runtime leg post-merge only except the waived `playground-e2e`.
- **The `run-migration-e2e` label** is unbound since #3178 and is deleted.

## Packets

| # | packet | tree fence | items (source hand-off) | cite / check first |
|---|---|---|---|---|
| **F1** | elixir runtime values | `src/generator/elixir/**` changeset / validator / decimal / projection emitters (NOT router / openapi / controller, which are F8's) | 3d **D14** (whitespace-only string gives "can't be blank" before the invariant), **D16** (a messaged check tripped by "" → 500), **D17** (a messaged VO invariant omits `errors[].code` — 3g's D4b may have fixed it), **D19** (a joined `decimal` in a query-time projection serialised as the string "2.5"), **D24** (a malformed money inside a VO on create is accepted), **D25** (a malformed top-level money on crudish create/update answers Ecto's "is invalid") | #3108 (L1-E: workflow 422 `errors[]`), #3101 (elixir VO follow-ups) |
| **F2** | .NET / Dapper compile + storage | `src/generator/dotnet/**` except the numeric-ingress and string-intrinsic sites (F4's) | 3d **D5** (Dapper does not enforce `unique(...)`), **D8** (`aggregate Event` → CS0104 against `EventId`), **D12** (a find param named `x` → CS0019) | #3107 (L1-C: `ignoring` — C3 3c's defect 1, excluded here), #3155 / #3185 / #3102 (reserved identifiers — D8 / D12 may be covered) |
| **F3** | node / MikroORM | `src/platform/hono/**`, `src/generator/typescript/**` | 3d **D6** (MikroORM `unique`), **D7** (drizzle has no uniqueIndex; `synthDDL` drops `unique` — no golden is mintable), **D15** (MikroORM: a value-side intrinsic in a find → 500), **D18** (MikroORM: a `transactional` workflow → 500), **D20** (node saga money compound 500; `hono-workflow-own-state-assign.test.ts` pins the broken spelling), **D21** (MikroORM saga money serialised without scale) | #3110 (L1-N node decimal), #3127 (node wire numeric gate), #3139 (Fleet A node correctness) |
| **F4** | cross-backend wire value contracts | each backend's numeric-ingress, string-intrinsic and validation-message sites only | 3d **D10** (`substring` counts UTF-16 units on node/java/.NET, code points on python), **D11** (.NET `ToUpperInvariant` keeps ß), **D13** (python message-less invariant 422: "Value error," prefix and empty pointer), **D22** (.NET/Dapper accept money "12,50" as 1250), **D23** (int32 range refusal has no contract: node/python 422, java/.NET 400), **M-T6.87** (per the default above), **M-T6.88** (java points a nested payload field's 422 at the leaf) | #3153 (python message-less single-field), #3094 (`string(datetime)` canonical) |
| **F5** | audit & principal cluster | each backend's audit-history / stamp / mask emitters | 3d **D1** (audit `actor` JSON diverges four ways under auth), **D2** (elixir aggregate-wide `audited` writes no row for the crudish update), **D3** (java audited + `stamp` datetime → create 500, NPE), **D4** (`mask unless` without auth validates clean, then CS1061 / missing package / boot exit 1 on .NET / java / python), **D9** (python auditable `updatedBy` is "" on a fresh row), 3c **#2** (audit-history 403 `detail` spelled three ways — the census ratchet waiver goes) | #3103 / #3131 (system principal), #3160 (absent claim null) |
| **F6** | frontend i18n + primitive census | `src/generator/_walker/**`, per-frontend walker targets, pack chrome | 3f **D-I18N-1..8, 10** (scaffold sidebar labels catalogued but rendered raw; DestroyForm / 404 / error-view / bool / pager chrome raw on named targets; Feliz carries Mantine pack keys; Feliz Modal title; HEEx explicit-menu heading), **D-CENSUS-1** (row-scoped `Action { o.<op> }` unrendered on every target), **D-CENSUS-2** (`Avatar` without `src:` drops `alt`), **D-CENSUS-3** (HEEx component call drops children) — each fix deletes its `DEAD_KEY_WAIVERS` / census `GAPS` row | #3182 (frontend action vocabulary), #3105 (L1-F frontends), #3117 (HEEx) |
| **F7** | frontend server-error mapping + Flutter | per-frontend form runtimes (`lib/form*`, `forms.dart`, Feliz HTTP helper), `src/generator/flutter/**` | 3f **D-ACL-1..5** (a 422 reaches the field only on React: Vue and Svelte misread the `errors` array; Angular / Feliz / Flutter have no mapper), 3b **D-3b-1** (money loses its scale on the Vue/React/Svelte read path), **D-3b-2** (Flutter `Action` posts a param-less op with no body → 415; deletes the `KNOWN_DEFECTS` row), **D-3b-3** + 3f **D-I18N-9** (Flutter / Feliz emit no navigation from an explicit `menu { }`) | #3090 (Feliz/Flutter `then:` + If-Match), #3182 |
| **F8** | elixir Schemathesis triage | `src/generator/elixir/**` router / openapi / controller emitters | 3e: the 2026-10-05 nightly elixir cell — 32 failures, 30 errors over 29 operations: non-uuid `{id}` → `Ecto.Query.CastError`; `/by_email` shadowed by `/{id}`; undeclared success content types; `POST /customers` and `POST /orders` → 405; 14 schema errors. Root-cause rules, then the cell binds (drop `discovery: true`) | #3108, #3101 |

`.NET` document finds ignoring `ignoring` (C3 3c defect 1) is **#3107**'s, cited not duplicated.

## Landing

Batches through the merge queue, in this order:
1. **F2 + F3** — backend-local, smallest blast radius.
2. **F1 + F8** — elixir.
3. **F4 + F5** — cross-backend; they touch every backend, so they land after the backend-local batches and re-derive against them.
4. **F6 + F7** — frontends.

A packet that finishes early folds into the next open batch. Golden re-mints and register rows are re-derived from their counters at each fold.

## Fold notes

- **Launched** (2026-10-06): this log, plus the `CLAUDE.md` CI-surface refresh, rides the C3 close-out PR #3189 as the fleet's claim. Eight agents launched on `main` @ `d3f226765`.
