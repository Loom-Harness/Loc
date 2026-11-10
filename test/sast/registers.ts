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
  "loom-ef-bypass-lifts-every-filter @ audit-history/dotnet/d/Infrastructure/Repositories/OrderRepository.cs :: if (bypass.All) __q = __q.IgnoreQueryFilters();":
    "the runtime `bypass.All` path of a criterion read (`Repo.run` / `Repo.find … ignoring *`) on `Order`, which carries no `policy { deny }`, so `ignoring *` may lift every filter — the .NET repository emitter names the bypassable filters only when a deny carve-out must survive",
  "loom-ef-bypass-lifts-every-filter @ field-mask/dotnet/d/Infrastructure/Repositories/EmployeeRepository.cs :: if (bypass.All) __q = __q.IgnoreQueryFilters();":
    "the runtime `bypass.All` path of a criterion read (`Repo.run` / `Repo.find … ignoring *`) on `Employee`, which carries no `policy { deny }`, so `ignoring *` may lift every filter — the .NET repository emitter names the bypassable filters only when a deny carve-out must survive",
  "loom-ef-bypass-lifts-every-filter @ find-bypass/dotnet/d/Infrastructure/Repositories/OrderRepository.cs :: var result = await _db.Orders.IgnoreQueryFilters().Where(new ByCodeCriterion(c).ToExpression()).FirstOrDefaultAsync(cancellationToken);":
    "find-bypass's `Orders.find(ByCode(c)) ignoring *` on `Order`, which carries no `policy { deny }`, so `ignoring *` may lift every filter — the .NET repository emitter names the bypassable filters only when a deny carve-out must survive",
  "loom-ef-bypass-lifts-every-filter @ find-bypass/dotnet/d/Infrastructure/Repositories/OrderRepository.cs :: if (bypass.All) __q = __q.IgnoreQueryFilters();":
    "the runtime `bypass.All` path of a criterion read (`Repo.run` / `Repo.find … ignoring *`) on `Order`, which carries no `policy { deny }`, so `ignoring *` may lift every filter — the .NET repository emitter names the bypassable filters only when a deny carve-out must survive",
  "loom-ef-bypass-lifts-every-filter @ inheritance-read-restrictions/dotnet/d/Infrastructure/Repositories/DriverRepository.cs :: if (bypass.All) __q = __q.IgnoreQueryFilters();":
    "the runtime `bypass.All` path of a criterion read (`Repo.run` / `Repo.find … ignoring *`) on `Driver`, which carries no `policy { deny }`, so `ignoring *` may lift every filter — the .NET repository emitter names the bypassable filters only when a deny carve-out must survive",
  "loom-ef-bypass-lifts-every-filter @ principal-read-filter/dotnet/d/Infrastructure/Repositories/WorkOrderRepository.cs :: if (bypass.All) __q = __q.IgnoreQueryFilters();":
    "the runtime `bypass.All` path of a criterion read (`Repo.run` / `Repo.find … ignoring *`) on `WorkOrder`, which carries no `policy { deny }`, so `ignoring *` may lift every filter — the .NET repository emitter names the bypassable filters only when a deny carve-out must survive",
  "loom-ef-bypass-lifts-every-filter @ sast~leak-shapes/dotnet/d/Infrastructure/Repositories/OrderRepository.cs :: var result = await _db.Orders.IgnoreQueryFilters().Where(new OrdersByCodeCriterion(c).ToExpression()).FirstOrDefaultAsync(cancellationToken);":
    "the fixture's deliberate no-deny half: `Orders.find(OrdersByCode(c)) ignoring *` on `Order`, which carries no `policy { deny }`, so `ignoring *` may lift every filter — the .NET repository emitter names the bypassable filters only when a deny carve-out must survive (its deny half, `Secret`, carries the F2-ADP-1 seed)",
  "loom-ef-bypass-lifts-every-filter @ tenancy-claim-name/dotnet/d/Infrastructure/Repositories/InvoiceRepository.cs :: if (bypass.All) __q = __q.IgnoreQueryFilters();":
    "the runtime `bypass.All` path of a criterion read (`Repo.run` / `Repo.find … ignoring *`) on `Invoice`, which carries no `policy { deny }`, so `ignoring *` may lift every filter — the .NET repository emitter names the bypassable filters only when a deny carve-out must survive",
  "loom-ef-bypass-lifts-every-filter @ tenancy-hierarchy/dotnet/d/Infrastructure/Repositories/AccountRepository.cs :: if (bypass.All) __q = __q.IgnoreQueryFilters();":
    "the runtime `bypass.All` path of the `Accounts.all(AnyAccount, …)` criterion read on `Account`, whose filters are the `tenantOwned` floor and no `policy { deny }`, so `ignoring *` may lift every filter — the .NET repository emitter names the bypassable filters only when a deny carve-out must survive",
  "loom-ef-bypass-lifts-every-filter @ tenancy-hierarchy/dotnet/d/Infrastructure/Repositories/NoteRepository.cs :: if (bypass.All) __q = __q.IgnoreQueryFilters();":
    "the runtime `bypass.All` path of the `Notes.all(AnyNote, …)` criterion read on `Note`, whose only policy is `deny write` (a mutation gate, not a read carve-out), so `ignoring *` may lift every filter — the .NET repository emitter names the bypassable filters only when a read deny must survive",
  "loom-ef-bypass-lifts-every-filter @ tenancy-owned/dotnet/d/Infrastructure/Repositories/InvoiceRepository.cs :: if (bypass.All) __q = __q.IgnoreQueryFilters();":
    "the runtime `bypass.All` path of a criterion read (`Repo.run` / `Repo.find … ignoring *`) on `Invoice`, which carries no `policy { deny }`, so `ignoring *` may lift every filter — the .NET repository emitter names the bypassable filters only when a deny carve-out must survive",
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
    from: "const [row] = await db.select({ total: count() }).from(schema.orders).where(orderScope());",
    to: "const [row] = await db.select({ total: count() }).from(schema.orders);",
    defect: "audit A1: the aggregation read the source table with only its own `where`",
  },
  {
    id: "A1/python",
    rule: "loom-aggregation-without-tenant-floor-py",
    fixture: LEAK_SHAPES_ID,
    backend: "python",
    file: /query_projections_routes\.py$/,
    from: "select(func.count()).select_from(OrderRow))",
    to: 'select(func.count()).select_from(OrderRow).execution_options(loom_ignoring=frozenset({"tenantOwned"})))',
    defect: "audit A1 (python arm): the aggregation read leaves the read-scope hook's tenant floor",
  },
  {
    id: "A1/java",
    rule: "loom-aggregation-without-tenant-floor-java",
    fixture: LEAK_SHAPES_ID,
    backend: "java",
    file: /StoreQueryProjections\.java$/,
    from: 'entityManager.createQuery("select count(e) from Order e")',
    to: 'entityManager.createNativeQuery("select count(*) from orders")',
    defect: "audit A1 (java arm): native SQL, which the entity's tenant `@Filter` never sees",
  },
  {
    id: "A1/elixir",
    rule: "loom-aggregation-without-tenant-floor-ex",
    fixture: LEAK_SHAPES_ID,
    backend: "vanilla",
    file: /query_projections\/order_volume\.ex$/,
    from: "|> Repo.one(current_user: current_user)",
    to: "|> Repo.one(current_user: current_user, skip_filters: [:tenant_owned])",
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
