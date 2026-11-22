// The shrink-only allowlist of tool-named names in generated output (#5942).
//
// Generated projects carry no tool name (docs/decisions/D-NO-TOOL-NAME.md).
// Every name below still reaches the generated corpus today; each row says
// which group it belongs to and which step of the rename lane removes it.
// `test/system/tool-name-census.test.ts` fails on a name the corpus emits that
// is not listed here (a NEW tool-named identifier) and on a row no generated
// tree reaches any more (a removed name whose row must go in the same change).
// `tool-name-census-fast.test.ts` pins the row count (TOOL_NAME_ALLOWLIST_CEILING):
// a row added or removed moves that ceiling in the same diff.
//
// `step` is the step of the rename lane that renames the name: 3 wire names
// (headers, routes, env, compose/Helm/k8s), 4 backend types and helpers, 5 frontend
// components and design packs, 6 prose.  `"pending-design"` marks the tool
// markers and the `.loom/` bundle, which the no-read-back redesign (#5993)
// removes from the generated tree (D-NO-TOOL-NAME, "Tool markers and .loom/");
// `"standing"` marks a name derived from a name the fixture itself declares.
// The runtime tables (`src/util/runtime-tables.ts`) and the environment
// variables (`src/util/runtime-wire-names.ts`) are renamed, so there is no
// `table` or `env` group: a tool-named table or variable can no longer be listed.
// A `pattern` row covers a family whose middle is the user's (a context, a
// channel, a deployable); `shows` is how the family reads.

export type ToolNameGroup =
  | "wire"
  | "config"
  | "type"
  | "helper"
  | "file"
  | "comment"
  | "pending"
  | "user";

export type ToolNameStep = 3 | 4 | 5 | 6 | "pending-design" | "standing";

export type ToolNameEntry = (
  | { readonly name: string }
  | { readonly pattern: string; readonly shows: string }
) & {
  readonly group: ToolNameGroup;
  readonly step: ToolNameStep;
  readonly note?: string;
};

export const TOOL_NAME_ALLOWLIST: readonly ToolNameEntry[] = [
  // ── wire ────────────────────────────────────────────────────────
  {
    name: "loom_locale",
    group: "helper",
    step: 4,
    note: "LiveView assign `:loom_locale` (the cookie is `<namespace>_locale`)",
  },
  { name: "loom-page", group: "wire", step: 3, note: "LiveView phx-click event names" },
  { name: "loom-sort", group: "wire", step: 3, note: "LiveView phx-click event names" },
  {
    name: "loomDemoTenant",
    group: "wire",
    step: 3,
    note: "browser storage / cookie key, seed dataset name",
  },
  {
    name: "loom.session",
    group: "wire",
    step: 3,
    note: "browser storage / cookie key, seed dataset name",
  },

  // ── config ──────────────────────────────────────────────────────
  { name: "com.loom", group: "config", step: 3 },

  // ── type ────────────────────────────────────────────────────────
  { name: "LoomIssueParams", group: "type", step: 4 },
  { name: "LoomRefLabel", group: "type", step: 5 },
  { name: "Loom.Datetime", group: "type", step: 4 },
  { name: "Loom.ValueObject", group: "type", step: 4 },
  { name: "LoomEventEnvelope", group: "type", step: 4 },
  { name: "useLoomForm", group: "type", step: 5 },
  { name: "LoomFieldError", group: "type", step: 4 },
  { name: "LoomIssue", group: "type", step: 4 },
  { name: "LoomForm", group: "type", step: 5 },
  { name: "LoomOutbox", group: "type", step: 4 },
  { name: "LoomOutboxRow", group: "type", step: 4 },
  { name: "LoomErrorHandler", group: "type", step: 4 },
  { name: "LoomOutboxMessage", group: "type", step: 4 },
  { name: "LoomOutboxRepository", group: "type", step: 4 },
  { name: "LoomTable", group: "type", step: 5 },
  { name: "LoomNavDrawer", group: "type", step: 5 },
  { name: "LoomPage", group: "type", step: 5 },
  { name: "LoomAura", group: "type", step: 5 },
  { name: "LoomEventOutbox", group: "type", step: 4 },
  { name: "LoomChart", group: "type", step: 5 },
  { name: "LoomQuery", group: "type", step: 5 },
  { name: "LoomMoney", group: "type", step: 5 },
  { name: "_LoomLocaleClient", group: "type", step: 5 },

  // ── helper ──────────────────────────────────────────────────────
  {
    name: "loomCode",
    group: "helper",
    step: 5,
    note: "React field-error property `zod-resolver.ts` copies the issue's catalog code onto; a react-hook-form error node of an object field is keyed by the user's field names, so it cannot become a plain word",
  },
  {
    name: "loomValues",
    group: "helper",
    step: 5,
    note: "React field-error property `zod-resolver.ts` copies the issue's catalog values onto; a react-hook-form error node of an object field is keyed by the user's field names, so it cannot become a plain word",
  },
  { name: "__loom_int32_range", group: "helper", step: 4 },
  { name: "loom_code", group: "helper", step: 4 },
  { name: "loom_params", group: "helper", step: 4 },
  { name: "__loom_filters__", group: "helper", step: 4 },
  { name: "loom_path", group: "helper", step: 4 },
  { name: "loom_rule_code", group: "helper", step: 4 },
  { name: "loom_current_user", group: "helper", step: 4 },
  { name: "loom_principal", group: "helper", step: 4 },
  { name: "loom_post_commit", group: "helper", step: 4 },
  { name: "__loom_int32_param", group: "helper", step: 4 },
  { name: "__loom_decimal_ok", group: "helper", step: 4 },
  { name: "__loom_filter__", group: "helper", step: 4 },
  { name: "__loom_dig", group: "helper", step: 4 },
  { name: "loom_filter", group: "helper", step: 4 },
  {
    pattern: "^loom_(event|lineage|prov_inputs|channels|kafka_sub)_\\d+$",
    shows: "loom_<kind>_<n>",
    group: "helper",
    step: 4,
    note: "Elixir generated locals / process names",
  },
  { name: "__loom_decimal_ingress", group: "helper", step: 4 },
  { name: "__loom_uuid", group: "helper", step: 4 },
  { name: "__loom_param_error", group: "helper", step: 4 },
  { name: "__loom_money_range", group: "helper", step: 4 },
  { name: "loom_invariant", group: "helper", step: 4 },
  { name: "__loom_decimal_param", group: "helper", step: 4 },
  { name: "__loom_label_rows", group: "helper", step: 4 },
  { name: "loom_error_code", group: "helper", step: 5 },
  { name: "loom_l", group: "helper", step: 4 },
  { name: "loom_r", group: "helper", step: 4 },
  { name: "loom_body_value_object", group: "helper", step: 4 },
  { name: "__loom_ref_labels", group: "helper", step: 4 },
  { name: "__loom_vo_param", group: "helper", step: 4 },
  { name: "__loom_id_param", group: "helper", step: 4 },
  { name: "loom_e", group: "helper", step: 4 },
  { name: "loom_domain_floor", group: "helper", step: 4 },
  { name: "loom_date", group: "helper", step: 4 },
  { name: "__loom_vo_param_errors", group: "helper", step: 4 },
  { name: "loom_pointer", group: "helper", step: 4 },
  { name: "loom_c", group: "helper", step: 4 },
  { name: "__loom_money_in_range", group: "helper", step: 4 },
  { name: "loom_event_id", group: "helper", step: 4 },
  { name: "loom_icu", group: "helper", step: 5 },
  { name: "loomL", group: "helper", step: 4 },
  { name: "loomR", group: "helper", step: 4 },
  { name: "__loom_list", group: "helper", step: 4 },
  { name: "__loom_validate_invariants", group: "helper", step: 4 },
  { name: "loom_payload_refusal", group: "helper", step: 4 },
  { name: "loom_state", group: "helper", step: 4 },
  { name: "loom_prov_traces", group: "helper", step: 4 },
  { name: "__loomPageTitle", group: "helper", step: 5 },
  { name: "__loom_vo_rules", group: "helper", step: 4 },
  { name: "loom_s", group: "helper", step: 4 },
  { name: "__loom_tagged", group: "helper", step: 4 },
  { name: "loom_body_vo_codes", group: "helper", step: 4 },
  { name: "loom_dir", group: "helper", step: 5 },
  { name: "loomHttp", group: "helper", step: 5 },
  { name: "loom_caller_credential", group: "helper", step: 4 },
  { name: "loom_dt", group: "helper", step: 4 },
  { name: "loom_d", group: "helper", step: 4 },
  { name: "loom_other", group: "helper", step: 4 },
  { name: "loom_skeleton_", group: "helper", step: 5 },
  { name: "loom_rich", group: "helper", step: 5 },
  { name: "__loom_date_param", group: "helper", step: 4 },
  { name: "loom_m", group: "helper", step: 4 },
  { name: "loomV", group: "helper", step: 4 },
  { name: "loom_arm_result", group: "helper", step: 4 },
  { name: "__loomRow", group: "helper", step: 5 },
  { name: "loom_found", group: "helper", step: 4 },
  { name: "seed_loom_demo_tenant", group: "helper", step: 4 },
  { name: "loom_el", group: "helper", step: 4 },
  { name: "__loom_payload_money", group: "helper", step: 4 },
  { name: "seedLoomDemoTenant", group: "helper", step: 4 },
  { name: "loomRefLabelProvider", group: "helper", step: 5 },
  { name: "loomFmt$", group: "helper", step: 5 },

  // ── file ────────────────────────────────────────────────────────
  { name: "path:com/loom", group: "file", step: 3, note: "Java base package directory" },
  { name: "path:loom_datetime", group: "file", step: 4 },
  { name: "path:loom_value_object", group: "file", step: 4 },
  { name: "path:LoomRefLabel", group: "file", step: 5 },
  { name: "path:loom_outbox", group: "file", step: 4 },
  { name: "path:LoomOutboxMessage", group: "file", step: 4 },
  { name: "path:LoomOutboxRepository", group: "file", step: 4 },
  { name: "path:LoomEventEnvelope", group: "file", step: 4 },
  { name: "path:loom_table", group: "file", step: 5 },
  { name: "path:LoomEventOutbox", group: "file", step: 4 },
  { name: "path:loom_chart", group: "file", step: 5 },

  // ── comment ─────────────────────────────────────────────────────
  { name: "Loom", group: "comment", step: 6, note: "prose" },
  { name: "loom", group: "comment", step: 6, note: "prose" },
  { name: "loom-", group: "comment", step: 6, note: "prose" },
  { name: "Loom-generated", group: "comment", step: 6, note: "prose" },
  { name: "Loom-derived", group: "comment", step: 6, note: "prose" },

  // ── pending ─────────────────────────────────────────────────────
  {
    name: "x-loom",
    group: "pending",
    step: "pending-design",
    note: "AsyncAPI extension key in contracts/asyncapi.yaml — #5993",
  },
  {
    name: "loom-std",
    group: "pending",
    step: "pending-design",
    note: "stdlib pseudo-source URI in debug/sourcemap.json — #5993",
  },
  {
    name: "loomignore",
    group: "user",
    step: "standing",
    note: "the user's pin file — an input the compiler reads, outside the rule (D-NO-TOOL-NAME)",
  },
  {
    name: "loom:sourcemap-begin",
    group: "pending",
    step: "pending-design",
    note: "tool marker / .loom/ reference — removed by #5993 (no read-back)",
  },
  {
    name: "loom:sourcemap-end",
    group: "pending",
    step: "pending-design",
    note: "tool marker / .loom/ reference — removed by #5993 (no read-back)",
  },
  {
    name: "loom:unrendered",
    group: "pending",
    step: "pending-design",
    note: "tool marker / .loom/ reference — removed by #5993 (no read-back)",
  },
  {
    name: "loom.<diagnostic-code>",
    group: "pending",
    step: "pending-design",
    note: "tool marker / .loom/ reference — removed by #5993 (no read-back)",
  },

  // ── user ────────────────────────────────────────────────────────
  {
    name: "loom-landing-secrets",
    group: "user",
    step: "standing",
    note: "derived from a name the fixture declares",
  },
  {
    pattern: "^loom-landing-(db|web-app|web-app-e2e)$",
    shows: "loom-landing-<package | db>",
    group: "user",
    step: "standing",
    note: "the package and container names of a system the fixture names `LoomLanding`",
  },
  {
    name: "loom_landing_locale",
    group: "user",
    step: "standing",
    note: "the locale cookie of a system the fixture names `LoomLanding`",
  },
  {
    name: "nav-ext-loom-docs",
    group: "user",
    step: "standing",
    note: "derived from a name the fixture declares",
  },
];
