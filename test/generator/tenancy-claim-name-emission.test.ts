// Cross-backend emission gate for the tenancy claim NAME.
//
// `tenancy by user.<claim>` takes any claim name.  The `tenantOwned` floor and
// stamp anchor on the operating org (`organizationContext.org`), whose home
// value each backend's switch gate reads off the DECLARED claim — so a fixture
// that names its claim `tenantId` cannot tell a backend binding the declaration
// from one reaching for the default.
//
// This pins the emitted result on all five backends: what a compile cannot see
// is a backend whose gate reads the `TENANT_OWNED_TENANT_ID_FIELD` constant off
// the principal instead of the declared claim (on a typed backend that is a
// compile error, on a dynamic one a per-request 500 — neither is in the corpus).
//
// Both halves matter, so both are asserted:
//   - the ROW column stays `tenantId` (the capability owns it), and
//   - the PRINCIPAL side is the operating org, homed on the declaration (`orgId`).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inlineDapperScope } from "../_helpers/dapper-scope.js";
import { inlineDrizzleScope } from "../_helpers/drizzle-scope.js";
import { ectoScope } from "../_helpers/ecto-scope.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const FIXTURE = readFileSync("test/fixtures/corpus/tenancy-claim-name.ddd", "utf8");
const src = (platform: string) => FIXTURE.replace("__PLATFORM__", platform);

/** Concatenated contents of every emitted file whose path matches. */
async function emitted(platform: string, match: RegExp): Promise<string> {
  const files = await generateSystemFiles(src(platform));
  const hits = [...files.entries()].filter(([p]) => match.test(p));
  expect(hits.length, `no emitted file matched ${match} for ${platform}`).toBeGreaterThan(0);
  return hits.map(([, c]) => inlineDrizzleScope(files, inlineDapperScope(c))).join("\n");
}

describe("tenancy claim name — emitted principal reads follow the declaration", () => {
  it("node: the floor and stamp read the operating org, homed on the DECLARED claim", async () => {
    const repo = await emitted("node", /invoice-repository\.ts$/);
    expect(repo).toContain("eq(schema.invoices.tenantId, requireCurrentUser().operatingOrg)");
    expect(repo).not.toContain("requireCurrentUser().tenantId");
    const stamp = await emitted("node", /audit-stamp\.ts$/);
    expect(stamp).toContain("tenantId: currentUser.operatingOrg");
    const gate = await emitted("node", /auth\/middleware\.ts$/);
    expect(gate).toContain('const homeOrg = String(claims.orgId ?? "");');
  });

  it("python: the floor reads the operating org, homed on `org_id`", async () => {
    // The tenant floor is a read-scope hook criterion over the request principal.
    const scope = await emitted("python", /app\/db\/read_scope\.py$/);
    expect(scope).toContain("InvoiceRow.tenant_id == user.operating_org");
    expect(scope).not.toContain("user.tenant_id");
    const gate = await emitted("python", /app\/auth\/middleware\.py$/);
    expect(gate).toContain('home_org = "" if user.org_id is None else str(user.org_id)');
  });

  it("dotnet: the EF query filter reads the operating org, homed on the DECLARED claim", async () => {
    const ctx = await emitted("dotnet", /AppDbContext\.cs$/);
    expect(ctx).toContain("x.TenantId == _currentUser.User.OperatingOrg");
    expect(ctx).not.toContain("_currentUser.User.TenantId");
    const user = await emitted("dotnet", /Auth\/User\.cs$/);
    expect(user).toContain('get => _operatingOrg ?? $"{OrgId}";');
  });

  it("java: the tenant filter reads the operating org, homed on the DECLARED claim", async () => {
    const entity = await emitted("java", /features\/invoices\/Invoice\.java$/);
    expect(entity).toContain("tenant_id = :__cuOperatingOrg");
    expect(entity).toContain("return __cu == null ? null : __cu.operatingOrg();");
    expect(entity).not.toContain("__cu.tenantId()");
    const gate = await emitted("java", /auth\/UserFilter\.java$/);
    expect(gate).toContain(
      'String homeOrg = user.orgId() == null ? "" : String.valueOf(user.orgId());',
    );
  });

  it("elixir: the Ecto filter reads the operating org, homed on the DECLARED claim", async () => {
    // The tenant floor is the Invoice schema's `:tenant_owned` clause, applied
    // by `Repo.prepare_query/3`; the repository's create stamp reads it too.
    const files = await generateSystemFiles(src("elixir"));
    const scope = ectoScope(files, "D.Billing.Invoice");
    expect(scope).toContain("record.tenant_id == ^(current_user && current_user.operating_org)");
    expect(scope).not.toContain("current_user.tenant_id");
    const repo = await emitted("elixir", /invoice_repository\.ex$/);
    expect(repo).toContain("current_user.operating_org");
    expect(repo).not.toContain("current_user.tenant_id");
    const gate = await emitted("elixir", /_web\/auth\.ex$/);
    expect(gate).toContain('defp home_org(user), do: to_string(user[:org_id] || "")');
  });

  it("every backend keeps the ROW column named `tenantId` (the capability owns it)", async () => {
    // The declaration renames the CLAIM, never the column — a backend that
    // followed the claim on both sides would emit a schema that disagrees with
    // the shared MigrationsIR.  Emitted DDL is snake_case on every backend.
    for (const platform of ["node", "python", "java", "dotnet", "elixir"] as const) {
      const files = await generateSystemFiles(src(platform));
      // .NET emits EF migrations as `.cs`; the SQL backends as `.sql`/`.exs`.
      const migration = [...files.entries()].find(
        ([p]) => /\.(sql|exs|cs)$/.test(p) && /migrat/i.test(p),
      );
      expect(migration, `${platform}: no migration emitted`).toBeDefined();
      expect(migration![1], platform).toContain("tenant_id");
      expect(migration![1], platform).not.toContain("org_id");
    }
  });
});

// ─── The realtime room key (A2) ─────────────────────────────────────────────
//
// The four SSE backends key their per-tenant rooms off the PRINCIPAL, and all
// four spelled `tenantId` literally — the row column, not the claim.  Under
// this fixture's `tenancy by user.orgId` that member does not exist on the
// emitted `User` shape: .NET/Java fail to compile, python raises per publish,
// and node reads `undefined` through its cast, so every connection joins no
// room and every tenant-scoped event degrades to a cross-tenant broadcast.
// The claim now rides the shared plan (`realtimeRoomPlan`), cased per backend.

describe("realtime room key — the SSE backends read the DECLARED claim", () => {
  it("node: the ambient + connect-time room keys read `orgId`", async () => {
    const rt = await emitted("node", /http\/realtime\.ts$/);
    expect(rt).toContain("const user = requestContext()?.currentUser as { orgId?: unknown }");
    expect(rt).toContain('typeof principal?.orgId === "string" ? principal.orgId : undefined');
    expect(rt).not.toContain("tenantId");
  });

  it("dotnet: the hub and the SSE endpoint read `OrgId`", async () => {
    const hub = await emitted("dotnet", /Infrastructure\/Realtime\/RealtimeHub\.cs$/);
    expect(hub).toContain("user.OrgId.ToString()");
    expect(hub).not.toContain("TenantId");
    // Program.cs derives the connecting principal's room independently.
    const program = await emitted("dotnet", /Program\.cs$/);
    expect(program).toContain("__rtUser.OrgId.ToString()");
    expect(program).not.toContain("__rtUser.TenantId");
  });

  it("java: the room-key accessor reads `orgId()`", async () => {
    const rt = await emitted("java", /RealtimeController\.java$/);
    expect(rt).toContain("user.orgId() == null ? null : String.valueOf(user.orgId())");
    expect(rt).not.toContain("tenantId");
  });

  it("python: the room-key helper reads `org_id`", async () => {
    const rt = await emitted("python", /app\/realtime\.py$/);
    expect(rt).toContain(
      "return None if user is None or user.org_id is None else str(user.org_id)",
    );
    expect(rt).not.toContain("tenant_id");
  });

  // The A4 half, asserted on the emitted artefact rather than the plan: the
  // fixture's `InvoiceReminderSent` carries no `<Agg> id`, so the id-reference
  // classifier put it in the GLOBAL set and streamed one tenant's invoice
  // number to every connected tenant.
  it("an id-less event out of the tenant-owned context is tenant-scoped, not global", async () => {
    const rt = await emitted("node", /http\/realtime\.ts$/);
    expect(rt).toContain(
      'const TENANT_SCOPED_EVENT_TYPES: ReadonlySet<string> = new Set(["InvoiceIssued", "InvoiceReminderSent"]);',
    );
    // With no id reference the ticket degrades to the `type` alone.
    expect(rt).toContain("InvoiceReminderSent: [],");
  });
});
