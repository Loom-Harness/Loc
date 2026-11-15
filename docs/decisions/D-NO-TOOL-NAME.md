# D-NO-TOOL-NAME — generated output carries no tool name

**Status:** PINNED (rule and reserved table namespace). The old→new mapping below is a proposal awaiting the owner's signature; rows marked **?** are open.

**Problem.** A generated project is code a team owns. The compiler's name in its tables, types, headers, environment variables, helpers, file names and comments marks it as tool output, leaks into wire contracts between deployables and into persisted data, and collides with nothing the user can see coming.

**Rule.** No backend or frontend emits the tool's name (`loom`, any case) into generated source, SQL, configuration, compose / Helm / Kubernetes files, HTTP headers, routes, environment-variable names, broker topology, log and trace keys, browser storage keys, file or directory names, or comments.

- **Runtime-owned tables** take a reserved `_` prefix: `_outbox`, `_inbox`, `_timer`, `_timer_runs`, `_migrations`, `_seed`. Table names starting with `_` belong to the runtime; a user declaration whose derived table, or a `tablePrefix:`, starts with `_` is refused as `loom.persisted-table-reserved`. There is no dedicated schema.
- **Generated types and UI components** take role names with no prefix (`Money`, `EventEnvelope`, `OutboxMessage`, `DataTable`, `AppForm`). The names are reserved through the symbol plan (`src/generator/_symbols/plan.ts`), which disambiguates or refuses a user type of the same name in one place per target.
- **Headers, routes, environment variables and helpers** take neutral names, idiomatic per target language, checked for collisions with user-declared names (through the symbol plan), with well-known names that mean something else, and with each target's reserved words.
- **Out of scope:** the `.loom/` artifact bundle, `loom.*` diagnostic codes in the compiler's own reports, `LOOM_*` variables that gate this repository's test tiers, and compiler-internal types. A name the user's own model spells (a system called `LoomLanding`) is the user's.

**Enforcement.** `test/system/tool-name-census.test.ts` generates the whole corpus plus the `ddd new` starter on every backend × design pack and holds every tool-named name against the shrink-only allowlist `test/system/tool-name-census.allowlist.ts`: a name no row covers fails, and a row nothing reaches fails as stale. `tool-name-census-fast.test.ts` runs a fixed sample in `npm test`. `test/_helpers/tool-name-scan.ts` defines what a name is.

**Dependencies.**
- Runtime tables have no rename path in `MigrationsIR`; renaming them through the chain (`ALTER TABLE … RENAME`, not drop/create) needs one first.
- Backend types and helpers move through the symbol plan's per-area lanes; until a lane covers an emitter, that emitter's names stay listed.
- The consumer inbox replaces `__loom_fold_inbox` with one inbox table; its name follows the outbox (`_inbox` in the mapping) and the allowlist follows `main`.
- Cross-deployable names (headers, environment variables, CloudEvents attributes, broker topology) change on every backend in one change so a mixed stack keeps interoperating. Durable broker names (consumer groups, durable queues) and keys inside persisted payloads need a read-both window; renaming them in place loses committed offsets or orphans stored rows.

## Mapping (proposal)

Steps refer to the rename lane: 2 tables, 3 wire names and deployment config, 4 backend types and helpers, 5 frontend components and design packs, 6 prose.

### Tables and indexes — step 2

| old | proposed | sure? |
|---|---|---|
| `__loom_outbox` | `_outbox` | yes |
| `__loom_outbox_pending_idx` | `_outbox_pending_idx` | yes |
| `__loom_fold_inbox` / `__loom_inbox` | `_inbox` | yes |
| `__loom_timer` | `_timer` | yes |
| `loom_timer_runs` | `_timer_runs` | yes |
| `__loom_migrations` | `_migrations` | yes |
| `__loom_seed` | `_seed` | yes |
| `CreateLoomOutbox`, `CreateLoomFoldInbox` (Ecto migration modules) | `CreateOutboxTable`, `CreateInboxTable` | ? a user aggregate `Outbox` gets `CreateOutboxes`; the `Table` suffix keeps them apart |
| `LoomMigration` (.NET migration-ledger entity) | `SchemaMigration` | yes |
| `<ts>_create___loom_outbox.exs` (file) | `<ts>_create__outbox.exs` | yes |

### Wire names — step 3

| old | where | proposed | sure? |
|---|---|---|---|
| `x-loom-test-reset` (header), `x_loom_test_reset` (FastAPI param) | test-reset route | `x-test-reset-token`, `x_test_reset_token` | yes |
| `/__loom/test-reset` | every backend | `/__test/reset` | yes |
| `x-loom-dev-claims` | dev-stub auth, every backend + frontends | `x-dev-claims` | yes |
| `x-loom-attempts` | rabbitmq retry header | `x-delivery-attempts` | ? RabbitMQ owns `x-delivery-count` (quorum queues, different counter) and other `x-` AMQP headers; `delivery-attempts` avoids the `x-` namespace |
| `x-loom-cache` | by-id cache response header | `x-cache` | ? CDNs and Varnish set `X-Cache` themselves and overwrite it; RFC 9211 `Cache-Status` is the standard alternative |
| `loomchannel` (CloudEvents ext.) | channel envelope, every backend | `channel` | yes |
| `loomkey` (CloudEvents ext.) | kafka partition key | `partitionkey` | yes — the CloudEvents Partitioning extension's own attribute |
| `loomcausedby` (CloudEvents ext.) | originating user id | `causedby` | ? |
| `/loom/<context>` (CloudEvents `source`) | channel envelope | `/<system>/<context>` | ? |
| `/loom` (rabbitmq vhost) | compose, Helm, k8s, broker-init | `/<system>` | ? |
| `loom.<Context>.<Channel>[.<deployable>]` | broker exchange / topic / durable group | `<system>.<Context>.<Channel>[.<deployable>]` | ? durable group rename loses offsets — needs a read-both window |
| `loom.dlx`, `loom.dlq.<queue>`, `loom.retry.<queue>` | rabbitmq topology | `<system>.dlx`, `<system>.dlq.<queue>`, `<system>.retry.<queue>` | ? |
| `loom-kafka-<group>` | kafka client id | `<group>` | yes |
| `loom.correlation_id`, `loom.scope_id`, `loom.actor_id` | log/trace attributes, every backend | `app.correlation_id`, `app.scope_id`, `app.actor_id` | ? OpenTelemetry asks for a namespace on custom attributes; bare `correlation_id` is the other choice |
| `"loom"` (tracer / logger / .NET formatter name) | every backend | the deployable's service name (`OTEL_SERVICE_NAME`); formatter `"json"` | yes |
| `:loom` (telemetry event prefix) | elixir | `:<app>` (the OTP app atom) | yes |
| `__loomOrigin` (key inside persisted outbox payloads) | dotnet, java | `__origin` | ? stored rows carry the old key; readers accept both for one release |
| `__loomEventId` | node workflows | `__eventId` | yes |
| `loom_outbox_event_id` (ContextVar) | python | `outbox_event_id` | yes |
| `loom.locale` (localStorage), `loom_locale` (cookie) | every frontend, backends that read it | `locale` | ? renaming resets saved locale choices once |
| `loom.store.<Store>` (localStorage) | react, vue, svelte | `store.<Store>` | ? same reset |
| `Symbol("loom.session")` | svelte | `Symbol("auth.session")` | yes |
| `loomDemoTenant` (seed dataset name) | tenancy registry demo | `demoTenant` | yes |
| `loom-page`, `loom-sort` (LiveView `phx-click` events) | elixir | `__page`, `__sort` | ? must not collide with a user `action` name; `__` keeps them out of that namespace |

### Environment variables — step 3

| old | proposed | sure? |
|---|---|---|
| `LOOM_TEST_RESET` | `TEST_RESET` | yes |
| `LOOM_TEST_RESET_TOKEN` | `TEST_RESET_TOKEN` | yes |
| `LOOM_SECURE_TRANSPORT` | `SECURE_TRANSPORT` | ? `HTTPS_ONLY` reads better |
| `LOOM_OPENAPI_UI` | `OPENAPI_UI` | yes |
| `LOOM_DEV_AUTH` | `DEV_AUTH` | yes |
| `LOOM_SEED` | `SEED_DATA` | yes |
| `LOOM_PG_URL` (generated Java integration tests) | `TEST_DATABASE_URL` | yes — not `DATABASE_URL`, which the generated apps already read as their runtime database |
| `LOOM_CHANNEL_<NAME>_URL` | `CHANNEL_<NAME>_URL` | yes — beside the existing `CHANNEL_MAX_ATTEMPTS`; the `_URL` suffix keeps a channel named `MaxAttempts` apart |
| `LOOM_OUTBOX_RETENTION_DAYS` | `OUTBOX_RETENTION_DAYS` | yes |

### Deployment configuration — step 3

| old | proposed | sure? |
|---|---|---|
| `com.loom.<app>` (Java base package, Gradle `group`, `com/loom/` directories) | `app.<app>` | ? Java wants a reverse domain the model does not declare |
| Helm helpers `loom.name`, `loom.fullname`, `loom.labels` | `<chart>.name`, `<chart>.fullname`, `<chart>.labels` (Helm's own convention) | yes |
| `app.kubernetes.io/managed-by: loom` (k8s label) | `managed-by: Helm` in the chart; dropped from raw manifests, which keep `part-of: <system>` | ? selectors on existing clusters match the old label |
| `<deployable>-loom-channel-<name>-url` (Helm/k8s secret key) | `<deployable>-channel-<name>-url` | yes |
| `loom-dev-<kind>[-<deployable>]` (dev broker/cache credentials) | `dev-<kind>[-<deployable>]` | yes |
| `loom-claim-<claim>`, `loom-declared-audience` (Keycloak mappers) | `claim-<claim>`, `declared-audience` | yes |
| `loom-definitions.json`, `10-loom.conf` (rabbitmq) | `definitions.json`, `10-definitions.conf` | yes |
| `loom-db` (README container name) | `<system>-db` | yes |
| `/tmp/loom-certs`, keystore alias `loom-<cert>` (Java Dockerfile) | `/tmp/extra-certs`, `extra-<cert>` | yes |
| `loom-e2e`, `loom-<framework>-app`, `loom-<framework>-app-e2e` (package names) | `<system>-e2e`, `<deployable>`, `<deployable>-e2e` | yes |
| `__LOOM_API_BASE__`, `__LOOM_BASENAME__` (window globals set by an embedding host) | `__APP_API_BASE__`, `__APP_BASENAME__` | ? the playground sets them; it changes in the same step |
| `__loom_sandbox__` (playground mount path, in comments) | follows the playground | ? |
| `"loom_dev"` (Phoenix signing salt) | `"<app>_dev"` | yes |
| `"LOOM"` (Dapper boot advisory-lock key) | `"MIGRATIONS"` | yes |

### Backend types — step 4 (through the symbol plan)

| old | target(s) | proposed | sure? |
|---|---|---|---|
| `LoomEventEnvelope` | node, dotnet, java | `EventEnvelope` | yes |
| `LoomOutbox`, `LoomOutboxRow`, `LoomOutboxMessage`, `LoomOutboxRepository`, `LoomEventOutbox` | elixir, dotnet, python, java | `Outbox`, `OutboxRow`, `OutboxMessage`, `OutboxRepository`, `EventOutbox` | yes — a user aggregate `Outbox` is the symbol plan's collision case |
| `LoomIssue`, `LoomFieldError`, `LoomIssueParams` | every backend, react | `Issue`, `FieldError`, `IssueParams` | ? `Issue` is a common user aggregate name; `ProblemIssue` avoids most collisions |
| `LoomErrorHandler` | dotnet, elixir, java, python, angular | `ErrorHandler` | ? Angular's own `ErrorHandler` class; `AppErrorHandler` there |
| `LoomJsonFormatter`, `LoomJsonFormatMapperConfig` | dotnet, java | `JsonLineFormatter`, `JsonFormatMapperConfig` | yes |
| `LoomWaitForDbAsync` | dotnet | `WaitForDatabaseAsync` | yes |
| `LoomConsumed` | node | `Consumed` | ? |
| `LoomChannel`, `LoomKey` (envelope record members) | dotnet | `Channel`, `PartitionKey` | yes |
| `Loom.Datetime`, `Loom.ValueObject` (Elixir modules, `loom_datetime.ex`, `loom_value_object.ex`) | elixir | `<App>.Datetime`, `<App>.ValueObject` | yes — app-namespaced like every other module |

### Frontend components and design packs — step 5

| old | target(s) | proposed | sure? |
|---|---|---|---|
| `LoomRefLabel` (+ `LoomRefLabel.svelte/.vue`) | every frontend | `RefLabel` | yes |
| `LoomForm`, `useLoomForm` | svelte, vue | `AppForm`, `useAppForm` | yes |
| `LoomTable`, `LoomChart` (HEEx components, `loom_table.ex`, `loom_chart.ex`) | elixir | `DataTable`, `Chart` | yes |
| `LoomPage`, `LoomNavDrawer`, `LoomQuery`, `LoomMoney`, `_LoomLocaleClient` | flutter | `AppPage`, `AppNavDrawer`, `QueryView`, `Money`, `_LocaleClient` | yes |
| `LoomAura` (PrimeNG preset) | angular | `AppPreset` | yes |
| CSS classes `loom-<x>` and tokens `--loom-<x>` (128 names, below) | design packs | `app-<x>`, `--app-<x>` | ? an un-prefixed class (`btn`, `card`) collides with the pack's own library; `app-` is Angular's selector convention and free in CSS |
| `data-loom-title` | react, angular | `data-page-title` | yes |

The CSS names: `loom-breadcrumbs`, `data-loom-title`, `loom-anchor`, `loom-skeleton`, `loom-skip-link`, `loom-stack`, `loom-input`, `loom-label`, `loom-btn`, `loom-nav-section`, `--loom-primary`, `loom-table-scroll`, `loom-ref-label`, `loom-locale-switcher`, `loom-field`, `loom-btn-primary`, `loom-alert`, `loom-table`, `loom-key-value-row`, `loom-kv-label`, `loom-kv-value`, `loom-alert-message`, `loom-alert-red`, `loom-skeleton-group`, `loom-error`, `loom-switch`, `--loom-radius`, `loom-icon`, `loom-btn-outline`, `loom-toolbar`, `loom-button`, `--loom-font-family`, `loom-active`, `loom-table-striped`, `loom-table-highlight`, `loom-modal-title`, `loom-paper`, `loom-empty`, `loom-table-sticky`, `loom-group`, `loom-alert-yellow`, `loom-btn-ghost`, `loom-code-block`, `--loom-font-family-mono`, `loom-icon-sm`, `loom-icon-lg`, `loom-skeleton-pulse`, `loom-divider-labelled`, `loom-brand`, `loom-shell`, `loom-nav-link`, `loom-button-primary`, `loom-modal`, `loom-toggle`, `loom-card`, `loom-card-content`, `loom-content`, `loom-main`, `loom-button-ghost`, `loom-badge`, `loom-code-block-title`, `loom-sidenav`, `--loom-neutral`, `--loom-error`, `--loom-accent`, `loom-container`, `loom-stat`, `loom-stat-label`, `loom-stat-value`, `loom-alert-title`, `loom-alert-green`, `loom-alert-blue`, `loom-inline-code`, `loom-avatar`, `loom-avatar-empty`, `loom-image`, `loom-icon-xs`, `loom-icon-xl`, `loom-grid`, `loom-divider-rule`, `loom-divider-label`, `loom-modal-backdrop`, `loom-modal-box`, `loom-sidebar`, `loom-nav`, `loom-button-secondary`, `loom-button-warn`, `loom-tab-trigger`, `loom-spin`, `loom-toast-host`, `loom-spinner`, `loom-icon-md`, `loom-provenance`, `loom-provenance-tree`, `loom-rabbitmq-reconnect`, `loom-field-label`, `loom-field-input`, `loom-loader-xs`, `loom-loader-sm`, `loom-loader-md`, `loom-loader-lg`, `loom-loader-xl`, `--loom-brand`, `loom-card-title`, `loom-divider`, `loom-tabs`, `loom-tabs-list`, `loom-spinner-xs`, `loom-spinner-sm`, `loom-spinner-lg`, `loom-spinner-xl`, `loom-toast-root`, `loom-toast`, `loom-channels`, `loom-select`, `loom-file-upload`, `loom-chart`, `loom-timeline`, `loom-timeline-entry`, `loom-timeline-action`, `loom-timeline-actor`, `loom-timeline-changes`, `loom-fieldset`, `loom-layout`, `loom-layout-header`, `loom-layout-body`, `loom-layout-main`, `loom-layout-footer`.

### Helpers and locals — step 4 (backend) / 5 (frontend)

A helper drops the tool name. A name that becomes a common word takes the target's reserved spelling: a leading `__` for Elixir functions and module-attribute keys, a symbol-plan fresh name for locals.

| old | target(s) | proposed | sure? |
|---|---|---|---|
| `__loom_int32_range` | elixir | `__int32_range` | yes |
| `loom_code` | elixir | `msg_code` | yes |
| `loom_params` | elixir | `__params` (function) — conn-assign key | ? |
| `__loom_filters__` | elixir | `__filters__` | yes |
| `loomTestResetToken` | dotnet | `testResetToken` | yes |
| `loomCatalog` | java | `eventCatalog` (logger name) | ? |
| `loomParams` | python | `__params` | ? |
| `loomPort` | dotnet | `listenPort` | yes |
| `loom_path` | elixir | `__path` | ? |
| `loom_rule_code` | elixir | `rule_code` | yes |
| `loom_current_user` | elixir, python | `current_user` | ? collides with Phoenix/phx_gen_auth `current_user` assign |
| `loom_principal` | elixir | `principal` (Repo option key) | yes |
| `loom_post_commit` | elixir, python | `post_commit` | yes |
| `loomEnv` | dotnet | `appEnv` | yes |
| `loomSecureTransport` | dotnet | `secureTransport` | yes |
| `loom_fields` | python | `log_fields` | yes |
| `__loom_int32_param` | elixir | `__int32_param` | yes |
| `__loom_decimal_ok` | elixir | `__decimal_ok` | yes |
| `__loom_filter__` | elixir | `__filter__` | yes |
| `__loom_dig` | elixir | `__dig` | yes |
| `loom_filter` | elixir | `__filter` | ? |
| `loom_<kind>_<n>` | elixir | fresh local from the symbol plan (Elixir: trailing `_`, e.g. `l_`; a leading `_` would warn as a used ignored variable) | ? |
| `loomStrictNumbers` | java | `strictNumbers` | yes |
| `loom_request_session` | python | `request_session` | yes |
| `loom_request_context` | python | `request_context` | yes |
| `__loom_decimal_ingress` | elixir | `__decimal_ingress` | yes |
| `__loom_uuid` | elixir | `__uuid` | yes |
| `__loom_param_error` | elixir | `__param_error` | yes |
| `loomOutbox` | node | `outbox` | yes |
| `__loom_money_range` | elixir | `__money_range` | yes |
| `loom_invariant` | elixir | `invariant` (opts key) | yes |
| `__loom_decimal_param` | elixir | `__decimal_param` | yes |
| `loom_ignoring` | python | `ignoring` (execution option) | yes |
| `__loom_label_rows` | elixir | `__label_rows` | yes |
| `loom_error_code` | elixir | `error_code` | yes |
| `loom_l` | elixir | fresh local from the symbol plan (Elixir: trailing `_`, e.g. `l_`; a leading `_` would warn as a used ignored variable) | ? |
| `loom_r` | elixir | fresh local from the symbol plan (Elixir: trailing `_`, e.g. `l_`; a leading `_` would warn as a used ignored variable) | ? |
| `loom_body_value_object` | elixir | `body_value_object` | yes |
| `__loom_ref_labels` | elixir | `__ref_labels` | yes |
| `__loom_vo_param` | elixir | `__vo_param` | yes |
| `__loom_id_param` | elixir | `__id_param` | yes |
| `loom_e` | elixir | fresh local from the symbol plan (Elixir: trailing `_`, e.g. `l_`; a leading `_` would warn as a used ignored variable) | ? |
| `loom_domain_floor` | elixir | `domain_floor` | yes |
| `loom_date` | elixir | `__date` | ? |
| `__loom_vo_param_errors` | elixir | `__vo_param_errors` | yes |
| `loom_pointer` | elixir | `pointer` (opts key) | yes |
| `loom_c` | elixir | fresh local from the symbol plan (Elixir: trailing `_`, e.g. `l_`; a leading `_` would warn as a used ignored variable) | ? |
| `__loom_money_in_range` | elixir | `__money_in_range` | yes |
| `loomKey` | dotnet, java | `partitionKey` | yes |
| `loom_event_id` | elixir | `event_id` (process key) | yes |
| `loom_icu` | elixir | `icu` | yes |
| `loomL` | java | `l$` (lambda param, fresh via symbol plan) | ? |
| `loomR` | java | `r$` | ? |
| `loomJsonFormatMapper` | java | `jsonFormatMapper` | yes |
| `__loom_list` | elixir | `__list` | yes |
| `loomChannel` | java | `channel` | yes |
| `__loom_validate_invariants` | elixir | `__validate_invariants` | yes |
| `loom_payload_refusal` | elixir | `payload_refusal` | yes |
| `loom_state` | elixir | `__state` | ? |
| `loom_prov_traces` | elixir, python | `prov_traces` | yes |
| `__loomPageTitle` | vue | `__pageTitle` | yes |
| `__loom_vo_rules` | elixir | `__vo_rules` | yes |
| `loom_s` | elixir | fresh local from the symbol plan (Elixir: trailing `_`, e.g. `l_`; a leading `_` would warn as a used ignored variable) | ? |
| `__loom_tagged` | elixir | `__tagged` | yes |
| `loom_body_vo_codes` | elixir | `body_vo_codes` | yes |
| `loom_dir` | elixir | `dir` (assign) | ? user page state may be named `dir` |
| `loomHttp` | flutter | `httpClient` | yes |
| `loom_caller_credential` | python, elixir | `caller_credential` | yes |
| `loom_dt` | elixir | fresh local from the symbol plan (Elixir: trailing `_`, e.g. `l_`; a leading `_` would warn as a used ignored variable) | ? |
| `loom_d` | elixir | fresh local from the symbol plan (Elixir: trailing `_`, e.g. `l_`; a leading `_` would warn as a used ignored variable) | ? |
| `loom_other` | elixir | fresh local from the symbol plan (Elixir: trailing `_`, e.g. `l_`; a leading `_` would warn as a used ignored variable) | ? |
| `loom_skeleton_` | elixir | `__skeleton_` | yes |
| `loom_rich` | elixir | `rich` | ? |
| `__loom_date_param` | elixir | `__date_param` | yes |
| `loom_m` | elixir | fresh local from the symbol plan (Elixir: trailing `_`, e.g. `l_`; a leading `_` would warn as a used ignored variable) | ? |
| `loomV` | java | `v$` | ? |
| `loom_arm_result` | elixir | fresh local from the symbol plan (Elixir: trailing `_`, e.g. `l_`; a leading `_` would warn as a used ignored variable) | ? |
| `__loomRow` | static | `__row` | yes |
| `loom_found` | elixir | fresh local from the symbol plan (Elixir: trailing `_`, e.g. `l_`; a leading `_` would warn as a used ignored variable) | ? |
| `seed_loom_demo_tenant` | elixir | `seed_demo_tenant` | yes |
| `loom_el` | elixir | fresh local from the symbol plan (Elixir: trailing `_`, e.g. `l_`; a leading `_` would warn as a used ignored variable) | ? |
| `__loom_payload_money` | elixir | `__payload_money` | yes |
| `seedLoomDemoTenant` | node | `seedDemoTenant` | yes |
| `loomRefLabelProvider` | flutter | `refLabelProvider` | yes |
| `loomFmt$` | flutter | `fmt$` | yes |


### Prose — step 6

`Loom`, `loom`, `Loom-generated`, `Loom-derived` in comments, READMEs, Helm `NOTES.txt` and chart descriptions: rewritten to describe the generated project without naming the tool ("generated", "the generator").

### Awaiting a ruling — compiler vocabulary surfaced in output

| name | where | question |
|---|---|---|
| `.loomignore` | generated README and file headers | the user's ignore file the compiler reads — out of scope like `.loom/`? |
| `loom:scaffold-once` | marker in scaffold-once files | read by the compiler on regenerate — out of scope? |
| `loom:sourcemap-begin` / `-end` | markers under `--sourcemap` | read by `ddd trace` — out of scope? |
| `loom:no-transaction` | first line of emitted SQL migrations | read by the GENERATED migrate runner — in scope; proposed `-- migrate:no-transaction` |
| `loom:unrendered [loom.<code>]` | TSX comment on a walker give-up | the only `loom.*` diagnostic code in output — keep the code, or point at the docs anchor instead? |
| `loomsnap` | provenance comments naming `.loom/…loomsnap.json` | follows `.loom/` — out of scope? |
