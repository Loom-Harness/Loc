// ---------------------------------------------------------------------------
// The SAST ruleset's registers (M-T3.14).
//
//   TRIAGE — forbidden-rule hits on the CLEAN tree that are not defects, each
//            with the reason.  A ratchet both ways: an untriaged hit fails the
//            nightly, and so does a triage row no hit matches.
//   SEEDS  — one re-seeded historical defect per rule, applied to a COPY of the
//            emitted tree on every run.  A forbidden rule must NAME its seed; a
//            required rule must go SILENT on its seed.  This is the ruleset's
//            standing mutation proof — a rule that stops matching its own defect
//            fails the gate the night it drifts, not the day someone checks.
// ---------------------------------------------------------------------------

import type { Backend } from "../fixtures/corpus/backends.js";
import { LEAK_SHAPES_ID } from "./harness.js";

/** Rule ids in `loom-auth-tenancy.yml`, by family (pinned against the YAML by
 *  the fast test). */
export const FORBIDDEN_RULES = [
  "loom-ef-bypass-lifts-every-filter",
  "loom-aggregation-without-tenant-floor-ts",
  "loom-aggregation-without-tenant-floor-py",
  "loom-aggregation-without-tenant-floor-java",
  "loom-aggregation-without-tenant-floor-ex",
  "loom-hardcoded-client-secret",
  "loom-token-logged",
] as const;

export const REQUIRED_RULES = ["loom-oidc-state-verified", "loom-pkce-verifier-exchanged"] as const;

/** Corpus features whose every targeted backend must fire each REQUIRED rule. */
export const OIDC_FEATURES = ["auth-oidc"] as const;

/** `<rule> @ <tree>/<file> :: <line>` → why the hit is not a defect. */
export const TRIAGE: Readonly<Record<string, string>> = {
  "loom-ef-bypass-lifts-every-filter @ find-bypass/dotnet/d/Infrastructure/Repositories/OrderRepository.cs :: var result = await _db.Orders.IgnoreQueryFilters().Where(x => x.Code == c).FirstOrDefaultAsync(cancellationToken);":
    "find-bypass's `unfiltered … ignoring *` on `Order`, which carries no `policy { deny }` — lifting every filter is the authored intent",
  "loom-ef-bypass-lifts-every-filter @ principal-read-filter/dotnet/d/Infrastructure/Repositories/WorkOrderRepository.cs :: if (bypass.All) __q = __q.IgnoreQueryFilters();":
    "the runtime `bypass` path of a principal-filtered read on `WorkOrder`, which carries no `policy { deny }`",
  "loom-ef-bypass-lifts-every-filter @ sast~leak-shapes/dotnet/d/Infrastructure/Repositories/OrderRepository.cs :: var result = await _db.Orders.IgnoreQueryFilters().Where(x => x.Code == c).ToListAsync(cancellationToken);":
    "`Order` carries no NON-bypassable filter (no `policy { deny }`), so `ignoring *` may lift every filter — find-emit.ts `ignoreFiltersClause` emits the parameterless form only then",
};

export interface Seed {
  readonly id: string;
  readonly rule: string;
  readonly fixture: string;
  readonly backend: Backend;
  /** Emitted file (path suffix) the edit applies to. */
  readonly file: RegExp;
  readonly from: string;
  readonly to: string;
  /** The historical defect the seed re-creates. */
  readonly defect: string;
}

export const SEEDS: readonly Seed[] = [
  {
    id: "F2-ADP-1/ef",
    rule: "loom-ef-bypass-lifts-every-filter",
    fixture: LEAK_SHAPES_ID,
    backend: "dotnet",
    file: /Repositories\/SecretRepository\.cs$/,
    from: 'IgnoreQueryFilters(["TenantIdFilter"])',
    to: "IgnoreQueryFilters()",
    defect: "#2668 wave 1: `ignoring *` on a deny aggregate emitted the parameterless overload",
  },
  {
    id: "A1/node",
    rule: "loom-aggregation-without-tenant-floor-ts",
    fixture: LEAK_SHAPES_ID,
    backend: "node",
    file: /http\/query-projections\.ts$/,
    from: "const [row] = await db.select({ total: count() }).from(schema.orders).where(eq(schema.orders.tenantId, requireCurrentUser().tenantId));",
    to: "const [row] = await db.select({ total: count() }).from(schema.orders);",
    defect: "audit A1: the aggregation read the source table with only its own `where`",
  },
  {
    id: "A1/python",
    rule: "loom-aggregation-without-tenant-floor-py",
    fixture: LEAK_SHAPES_ID,
    backend: "python",
    file: /query_projections_routes\.py$/,
    from: "select(func.count()).select_from(OrderRow).where((OrderRow.tenant_id == require_current_user().tenant_id))",
    to: "select(func.count()).select_from(OrderRow)",
    defect: "audit A1 (python arm)",
  },
  {
    id: "A1/java",
    rule: "loom-aggregation-without-tenant-floor-java",
    fixture: LEAK_SHAPES_ID,
    backend: "java",
    file: /StoreQueryProjections\.java$/,
    from: '"select count(e) from Order e where (e.tenantId = :__cuTenantId)"',
    to: '"select count(e) from Order e"',
    defect: "audit A1 (java arm)",
  },
  {
    id: "A1/elixir",
    rule: "loom-aggregation-without-tenant-floor-ex",
    fixture: LEAK_SHAPES_ID,
    backend: "vanilla",
    file: /query_projections\/order_volume\.ex$/,
    from: "where: record.tenant_id == ^(current_user && current_user.tenant_id), ",
    to: "",
    defect: "audit A1 (elixir arm)",
  },
  {
    id: "secret/node",
    rule: "loom-hardcoded-client-secret",
    fixture: "auth-oidc",
    backend: "node",
    file: /auth\/handshake\.ts$/,
    from: "client_id: CLIENT_ID,",
    to: 'client_id: CLIENT_ID,\n      client_secret: "s3cr3t-not-from-env",',
    defect: "a confidential-client secret inlined into the emitted token exchange",
  },
  {
    id: "token-log/python",
    rule: "loom-token-logged",
    fixture: "auth-oidc",
    backend: "python",
    file: /app\/auth\/oidc\.py$/,
    from: '"code_verifier": verifier,',
    to: '"code_verifier": verifier,\n            "_": log.info("exchanged %s", tokens.get("access_token")),',
    defect: "the token-exchange response logged",
  },
  {
    id: "state/node",
    rule: "loom-oidc-state-verified",
    fixture: "auth-oidc",
    backend: "node",
    file: /auth\/handshake\.ts$/,
    from: '|| state !== getCookie(c, "oidc_state") ',
    to: "",
    defect: "the callback no longer binds `state` to the login's cookie (login CSRF)",
  },
  {
    id: "pkce/dotnet",
    rule: "loom-pkce-verifier-exchanged",
    fixture: "auth-oidc",
    backend: "dotnet",
    file: /Auth\/AuthHandshake\.cs$/,
    from: '["code_verifier"] = verifier,',
    to: "",
    defect: "the token exchange stops sending the PKCE verifier",
  },
];
