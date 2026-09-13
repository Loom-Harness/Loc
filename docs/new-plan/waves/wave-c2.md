# Wave C2 — nothing unsupported on any target (coordinator log)

*Plan: [`../completion-waves-2026-09.md`](../completion-waves-2026-09.md) §4 Wave C2. Base: `main` @ `6d6c1a1` (Wave C1, #2891, merged 2026-09-13 11:13Z). Ten packets, one per target tree (2a–2j), run as Opus agents in isolated worktrees on local `claude/c2-<packet>` branches; the coordinator folds them on `claude/loom-review-planning-adz0n4` (the only branch this coordinator pushes). The plan's "one PR per target tree" shape is honoured **sequentially on that one branch**: a fold batch is pushed, flipped, merged, and the branch restarted from `main` before the next batch — never a ten-tree fold in one PR.*

## Status: **claimed — coordinator commit landed, packets launching** (2026-09-13)

## Coordinator commit (first, per the kickoff)

`unsupported-register.ts` gains `kind: "seam"`: the 24 rows whose gate set already names every shipping target (or fires only for a context no backend hosts — the "latent seam" / "dormant" / "fires only when no backend deployable hosts" rows) moved off `gap`, so `MAX_OPEN_GAPS` counts LIVE rows only: **51 → 27** (the plan's 24 live + the 3 config-shaped rows — `context-filter-unsupported`, `persistence-mode-unsupported`, `ui-realtime-unsupported` — which packet 2f dispositions: a misuse error is renamed out of the suffix, per the register header). `LATENT_SEAMS = 24` is pinned exactly beside it, and every seam row's `what` must name its full membership set. `openGaps()` unchanged; `latentSeams()` added; `scripts/completion-denominators.mjs` and `scripts/quality-delta.mjs` count the third kind and their tests assert gap + seam + scope = rows.

## Reconciliation before launch (2026-09-13)

Thirty-one PRs are open, most touching a C2 tree. Each packet's prompt names the ones on its fence; the rule is **skip a row an open PR already covers (cite it in the hand-off), and avoid the files it touches where the fix allows** — at fold the coordinator merges `origin/main` and composes. Two open PRs explicitly claim C2 rows and are folded by reference: **#2903** (2f numeric rows: M-T5.23 + M-T5.24, `avg` over money, the `long` ceiling) and **#2886** (M-T6.67a, the `command`-typed workflow `create` param's wire type — closes 1a's `#payload` refusal). #2852 (`envelope`, option B) and #2860 (M-T1.31 F11 `DestroyForm` gate) stay C1's rows. Owner-gated rows (`D-HANDLE-REMOVAL`; `dapper-no-schema-evolution`'s phase-⑨ ruling if `D-DAPPER-SCHEMA` is not in `docs/decisions.md`) are reported, not built.

| tree fence | open PRs touching it (files) |
|---|---|
| 2a elixir | #2906 + #2870 (heex-primitives, heex-walker-core, liveview-emit), #2852 (document/eventsourced/repository-emit, find-controller), #2900 (auth-emit), #2895 + #2904 (migrations-emit), #2886 (openapi-emit), #2903 (query-projections-emit) |
| 2b dotnet | #2852 (common, dapper, repository, find-emit), #2872 (efcore), #2886 (dto-mapping, workflow-emit), #2900 (auth-emit) |
| 2c node | #2872 (repository-find-hydrate, repository-save-builder), #2881 (value-objects), #2886 (routes-builder, workflow-builder), #2894 (workflow-builder), #2899 (schema), #2903 (routes builders), #2900 (auth-emit) |
| 2d java | #2852 (repository), #2886 (openapi-customizer, wire, workflow), #2901 (service), #2903 (channels, query-projection-reads, numeric-codec), #2900 (auth) |
| 2e python | #2881 + #2901 (repository-builder), #2886 (routes-builder, workflows-builder), #2903 (numeric-codec, query-projections-builder), #2900 (auth-emit) |
| 2f cross (`src/ir/**`, `src/generator/_*/**`) | #2871 (ui-gate*, ui-checks), #2885 (optional-member, id-link, table, registry, row-field-type), #2896 (create-state, workflow-checks, validate), #2903 (codec, lower-projection, projection-checks), #2877 (lower-types, default-deny-checks), #2873 + #2884 (lower-expr/-stmt), #2870 + #2860 (ui-checks, ui-page-structure-checks), #2894, #2895 + #2904 + #2899 (migrations-ir), #2874, #2878, #2897, #2886 |
| 2g walker / react / vue / svelte | #2902 (`field-input-array.hbs` in every JSX pack + form-fields-vm), #2885 (data-grid, id-link, table, registry, target), #2894 (react workflow-builder), #2878 (controls) |
| 2h angular | #2905 (tsconfig.hbs ×3), #2894 (api-module, workflows-module) |
| 2i feliz | #2885 + #2860 (feliz-target) |
| 2j flutter | #2885 (flutter-target) |

## Packets

| packet | model | tree fence | rows | state |
|---|---|---|---|---|
| 2a elixir / Phoenix / HEEx | Opus | `src/generator/elixir/**`, `designs/coreComponents/**`, `designs/daisyui/**` | M-T6.59 `if`; `vanilla-document-unsupported` residual; `table-filter-unsupported`; `heex-component-host-state-unsupported`; M-T6.56 (F60/F61); `static-subpath-405` elixir; F2-W-06; G2646 HEEx layout / pager; M-T6.26; M-T6.2 §13/§14; M-T6.14 DEBT-12; M-T6.3 gate decision | launching |
| 2b .NET / EF / Dapper | Opus | `src/generator/dotnet/**` | `tph-filter-unsupported`; `dapper-unsupported` ×4 + `find-predicate-unsupported` on dapper (build or decide per sub-code); `DAPPER_UNSUPPORTED` tenancy-hierarchy; M-T5.7 `<Concrete>Id`; G2646 dotnet arm; pairwise F12 dotnet; M-T6.14 `HasColumnName` | launching |
| 2c node / Hono / Drizzle / MikroORM | Opus | `src/platform/hono/**`, `src/generator/typescript/**` | `audited-returning-operation-unsupported`; `mikroorm-unsupported` ×3 + `find-predicate-unsupported` on mikroorm; pairwise F11; M-T4.3 item 4; M-T2.10 `embedded` on Drizzle relational; #2649 read-port handle; G2646 node arm | launching |
| 2d java / Spring / JPA | Opus | `src/generator/java/**` | M-T6.36 reserved identifiers; M-T4.2 document-shaped aggregation; G2667-D3; Schemathesis F11 (W11/W12) + F21 (W27/W34); `render-sql-restriction.ts:32`; java arms of F2-XB-4 / F2-CB-C7 | **handed off** — `claude/c2-java`, [note](handoffs/wave-c2-2d-java.md).  Built: M-T6.36 (gate DELETED, `MAX_OPEN_GAPS` 27 → 26; a second silent gap on ENUM VALUES found and closed with it), M-T4.2 (java gate DELETED, both direct-table arms run native), F21/W34 (rule text was wrong — the real cause is Jackson coercing a JSON number/boolean into a String; fixed, rule deleted), `render-sql-restriction.ts:32` (proved unreachable, every link a floor).  Verified-and-cited, not rebuilt: G2667-D3, F11, and the java arms of F2-XB-4 / F2-CB-C7 (C1 1e fixed them rather than handing them off).  W27 (dotnet, F21's other half) handed to 2b with the method |
| 2e python / FastAPI / SQLAlchemy | Opus | `src/generator/python/**` | pairwise F12, F13, F15; Schemathesis F17-class residue; M-T5.14 python arm; G2646 python arm | launching |
| 2f cross-backend contracts | Opus | `src/ir/**`, `src/generator/_*/**`, one file per backend per row | `seed-event-sourced-unsupported`; `sensitive-wire-unsupported` (M-T3.8 2–4 or a `scope` decision); `polymorphic-id-ref-unsupported`; M-T5.14 read-port on four backends; M-T1.11 (c) domain-floor `code`; M-T3.16 goldens; the five `unowned` `scope` rows; the 3 config-shaped `gap` rows renamed out of the suffix; **not** M-T5.23/M-T5.24 (#2903) and **not** M-T5.22 (C5) | batch 2 |
| 2g shared walker (react / vue / svelte) | Opus | `src/generator/_walker/**`, `src/generator/{react,vue,svelte}/**`, JSX packs under `designs/**` | `frontend-collection-op-unsupported` (M-T1.20, 8 ops on all seven emitters); `toast-message-unsupported` (M-T1.10); `scaffold-filter-param-unsupported` (M-T1.15); `page-form-locals-unsupported` (M-T1.1); `modal-controlled-op-form-unsupported` (M-T1.6); `queryview-lambda-int-plus-literal-concat`; `ui-projection-read-unsupported#not-ui-consumable`; M-T1.8 vue error boundary; M-T1.28 Svelte F50; M-T1.3 Angular `Chart` leg verify | batch 2 |
| 2h angular | Opus | `src/generator/angular/**`, `designs/{angularMaterial,primeng,spartanNg}/**` | `component-children-unsupported`; the 4 deferred component shapes; M-T1.14; M-T1.11 `modalTitle`; M-T1.12 aria; the 15 `KNOWN_UNREACHABLE` pins re-verified | batch 2 |
| 2i feliz | Opus | `src/generator/feliz/**` | `feliz-async-effect-unsupported` (F66 classifier promotion); `store-lifetime-target-unsupported#field`; the 10 deferred component shapes; M-T1.16; sourcemap feliz half; `feliz-navbar-ignores-page-requires`; M-T3.9 History | batch 2 |
| 2j flutter | Opus | `src/generator/flutter/**` | `flutter-async-effect-unsupported`; `store-lifetime-target-unsupported#flutter-field`; the 5+ deferred component shapes; M-T1.16; sourcemap flutter half; M-T4.12 (1) authenticated http client; a11y matrix; M-T3.9 History; M-T1.18 M-G seam (verify-first); `KNOWN_FLUTTER_GAPS` register in `allowlist-ratchet` | batch 2 |

Batch 1 = the five backend trees (2a–2e); batch 2 = 2f–2j once batch 1 is folded (2f edits the same backend files the five packets own, so it runs after them).

## Fold notes

- (none yet)
