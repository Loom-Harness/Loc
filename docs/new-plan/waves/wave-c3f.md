# Wave C3F — the C3 defect drain (coordinator log)

Wave C3 ([`wave-c3.md`](wave-c3.md), closed 2026-10-06) was test-only by design: every runtime defect its packets found was handed off with a repro, not fixed. C3F fixes them. One Opus agent per packet, each in an isolated worktree on a local `claude/c3f-<packet>` branch, fenced by tree so no two packets edit the same emitter files. The coordinator folds packets onto the wave branch and lands them in batches through the merge queue.

## Status: **re-run in flight (2026-10-11)** — the first run's work was lost with its container (nothing had been pushed). Packets are re-run with ≤ 4 agents active, and each fold is pushed at once to the wave's draft PR as a checkpoint.

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
- **First run lost** (2026-10-06 → 2026-10-11). All eight packets ran. F2, F1 and F8 handed back and were folded locally; F3–F7 stopped mid-task on the session's weekly usage limit. The idle container was then reclaimed, and with it every unpushed packet branch and the local fold. Lesson for a coordinator: an unpushed fold is not a checkpoint. Push each fold to the wave PR as soon as it is gated, as a draft until the full suite has run. The re-run (2026-10-11) restarts the packets from the hand-back recipes.
- **F2 folded** (2026-10-11; `claude/c3f-f2` @ `e9cbe64da`). **D8** fixed: an id named like an implicit-using type (`EventId`) gets a `global using EventId = <ns>.Domain.Ids.EventId;` alias, and CA1716 joins the csproj `NoWarn`. EF and Dapper build with 0 warnings / 0 errors in the .NET SDK container. **D5** is covered by open draft #3204 (verified at runtime: duplicate → 409, persists across restart). **D12** is covered by open #3185. Hand-off: `handoffs/wave-c3f-f2.md`.
- **F3 folded** (2026-10-11; `claude/c3f-f3` @ `1c2c010f9`):
  - **D6:** MikroORM root `EntitySchema`s declare `uniques:`.
  - **D7:** the drizzle schema emits `uniqueIndex(...)` (partial when soft-deletable), and `synthDDL` keeps UNIQUE. New `corpus/unique-conflict` fixture with a node-minted golden.
  - **D18:** a MikroORM `transactional` workflow emits `em.transactional`.
  - **D20 + D21:** saga load/save convert money and decimal between DB text and `Decimal` on both node adapters, writing the fixed-scale string. `hono-workflow-own-state-assign.test.ts` now pins the conversion.
  - **D15:** already fixed on `main`; `corpus/intrinsics` now asserts it at runtime.
  - **One 409 detail:** every node 23505 handler and elixir answer the shared `UNIQUE_CONFLICT_DETAIL` (the sentence .NET, java and python already served), so one golden covers every leg.
  - **D5 ported:** draft #3204 (`claude/dapper-unique-index`, Dapper `DbSchema.cs` unique indexes — verified at runtime by F2) is merged in as-is. Otherwise the dapper leg would be red on `corpus/unique-conflict`. The merge no-ops once #3204 lands.
  - Hand-off: `handoffs/wave-c3f-f3.md`.
- **F1 folded** (2026-10-11; `claude/c3f-f1` @ `39597e68d`):
  - **D14 + D16:** string columns are cast with `empty_values: []` and a nil-only `__require_present/2`, so a blank or whitespace string reaches the invariant / messaged `check` — node's `Name is required` + `msg.izdgzf`.
  - **D19:** projection decimals go through one shared `__decimal_num/1` (`numeric-codec.ts`).
  - **D24 + D25:** `changeset-ingress.ts` `__loom_decimal_ingress/3` answers node's `Invalid decimal: "…"` at the leaf pointer, top-level and VO leaves alike.
  - **D17:** already fixed on `main` (C3 3g's D4b); its probe is restored.
  - **Found and fixed:** a blank VO string leaf was accepted with a 201.
  - The full elixir behavioural leg passes, 80 cases against the goldens, 0 divergences. Three goldens were re-minted from node.
  - **Behaviour change:** a LiveView form posting `""` for a required text field now saves `""` (node's wire contract); `phoenix-ui-e2e` confirms in CI.
  - The `intrinsics` `"   "` probe stays held for F4: the only divergence left is M-T6.87's default sentence.
  - Hand-off: `handoffs/wave-c3f-f1.md`.
- **F8 folded** (2026-10-11; `claude/c3f-f8` @ `a6b6df695`). **The elixir Schemathesis cell is binding.** Measured locally on `storefront-elixir`: 26 findings + 26 error keys, 23 of 29 operations erroring → 5 waived findings, 0 errors, 29/29 operations tested. The other four legs were re-run with the pin and are clean. Root causes:
  - an unpinned `jsonschema-rs` 0.56.0 broke the fuzzer's generator on all five legs from 2026-09-10 → pinned to `0.49.1`, and an untestable operation is now a finding (`<op>::error:<type>`);
  - VO properties registered no OpenAPI component → the schema module, plus a corpus-wide dangling-`$ref` check;
  - the harness fuzzed the LiveView pages (relative `servers`) → `specServerBase`;
  - a body-parse failure corrupted the next keep-alive request → `connection: close`;
  - find params reached the query unchecked → `__check_find_params/2` answers 422 at the param.
  - F34 (elixir persists a VO's raw wire map) is minted **M-T6.89** and waived W37/W38. Hand-off: `handoffs/wave-c3f-f8.md`.
- **F4 folded** (2026-10-11; `claude/c3f-f4` @ `4e5d52650`). **Cross-backend wire value contracts.** Three new RS rules and one ruling:
  - **RS-39:** a decimal comma (.NET/Dapper, D22) and an int past int32 (D23) are refused at the field, with one message on every backend.
  - **RS-40 / `D-MESSAGELESS-DEFAULT`:** every message-less wire rule answers node's sentence. This covers .NET, java and elixir (M-T6.86) and python's model-level invariant (D13). M-T6.86 is closed, and so is M-T6.87's rule half.
  - **RS-41:** `substring` counts code points on every backend (D10), and .NET's `toUpper` maps `ß` to `SS` (D11).
  - **M-T6.88:** java's payload mappers carry the path they sit at. Elixir answers at the leaf pointer too, so `/c/amount` is the same on every leg.
  - `WIRE_WAIVERS` is empty again.
  - The fold kept F3's and F1's additions to `corpus/intrinsics` and `corpus/wire-ingress` alongside F4's. Both goldens were re-minted from node.
  - F4's four new missions collided with F8's M-T6.89, so they are renumbered **M-T6.93–96**: the missing-required sentence, Feliz/Flutter UTF-16 units, the NUL contract, and elixir's changeset Ecto text. Hand-off: `handoffs/wave-c3f-f4.md`.
- **F5 folded** (2026-10-11; `claude/c3f-f5` @ `3a7e2c707`). **Audit and principal cluster.** All six items are fixed:
  - **D1:** every backend records the audit `actor` as the principal's declared `user {…}` shape, by declared name (the `/auth/me` body), or null without auth. This is minted as RS-39 and renumbered **RS-42** at the fold.
  - **D2:** elixir's audited crudish update writes its row in one transaction.
  - **D3:** java's create audit snapshots the saved entity, so a `stamp` datetime no longer 500s.
  - **D4:** `mask unless` without auth is refused at validation (`loom.field-mask-principal-without-auth`).
  - **D9:** python stamps `updatedBy` on a fresh row.
  - **3c #2:** every backend's audit-history 403 says `Forbidden: find history`, and its waiver is deleted.
  - The witnesses are `corpus/field-mask`, `audit-history` and `stamps-principal`, with goldens minted from node. They match on node, python, .NET EF, java and elixir. Dapper and MikroORM are left to CI. Hand-off: `handoffs/wave-c3f-f5.md`.
- **F6 folded** (2026-10-11; `claude/c3f-f6` @ `f0b9a706f`). **Frontend i18n and the primitive census.** Twelve of thirteen items are fixed; D-I18N-9 is F7's.
  - **Sidebars:** they take the scaffold pages' `menu` keys on every static-bundle frontend and on HEEx (D-I18N-1, read through `src/ir/util/page-menu.ts`).
  - **Raw strings now catalogued:**
    - DestroyForm (D-I18N-2); Feliz now confirms before deleting;
    - the vue/angular 404 page (D-I18N-3);
    - the feliz/flutter error view (D-I18N-4);
    - Angular's Yes/No, by rendering `lib/format.ts` after the chrome catalog is set (D-I18N-5);
    - the HEEx pager, through a `sharedChrome` pack helper; it now reads "Prev" (D-I18N-6);
    - the feliz Modal title (D-I18N-8);
    - the HEEx menu heading (D-I18N-10).
  - **Catalog:** feliz and flutter no longer carry mantine keys (D-I18N-7).
  - **Census:**
    - a row-scoped `Action` binds its own row's id on all 15 cells (D-CENSUS-1);
    - an Avatar with no `src:` keeps its `alt` as `role="img"` + `aria-label` (D-CENSUS-2);
    - HEEx component children render into the `Slot` (D-CENSUS-3).
  - The census `GAPS` map is empty, and seven `DEAD_KEY_WAIVERS` rows are deleted. The remaining rows are Feliz/Flutter's derived menu and Flutter's delete label, both in F7's fence.
  - Building the Feliz output found two defects, both fixed: a `For` over an unpaged `.all` lost its `then:`, and an Action's API function collided with an OperationForm on the same op.
  - **M-T1.42** is minted: the auto-paged Table makes an Action column sortable. Hand-off: `handoffs/wave-c3f-f6.md`.
- **F7 folded** (2026-10-11; `claude/c3f-f7` @ `1ec223255`). **Frontend server-error mapping and Flutter.** All eight items are fixed:
  - **Server-error mapping:** a server 422's `errors[]` lands under the named field, with the rest form-level, on vue (D-ACL-1), svelte (D-ACL-2), angular (D-ACL-3, new `lib/server-errors.ts`), feliz (D-ACL-4, `Result<_, ServerErrors>`) and flutter (D-ACL-5, a `ServerErrors` class; `DestroyForm` shows the problem's `detail`). ACL `WAIVERS` went from 5 to 0.
  - **D-3b-1:** a parsed money keeps the wire string's scale on React/Vue/Svelte (one `_frontend/money-schema.ts`).
  - **D-3b-2:** Flutter's one-click Action sends `{}` as JSON, so there's no more 415, and `KNOWN_DEFECTS` is empty.
  - **D-3b-3 + D-I18N-9:** Feliz and Flutter render the explicit menu through `deriveSidebarFromUi`, with labels translated and each link gated by its page's `requires`.
  - The fold kept F6's row id in Flutter's Action URL alongside F7's JSON body, and dropped both packets' deleted waivers.
  - The `page-emitter-equivalence` baseline fixture is re-captured; its diff is F4's .NET int32 converter, money grammar and message-less sentences.
  - Runtime: `run-ui-auth` flutter 10/10 (was 7 + a known defect), feliz 10/10, `run-ui` sales-system-vue 12/12. Hand-off: `handoffs/wave-c3f-f7.md`.
