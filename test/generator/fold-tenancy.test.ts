// Tenant-scoped folded projections on every backend (`fold-tenancy.ts`).  A
// fold over `tenantOwned` producers' events (`Totals`) reads the event's tenant
// from its metadata — the dispatching frame's event origin — stamps the row
// with `tenant_id`, keys it by `(tenant_id, <key>)`, and every read
// route applies the tenant floor against the request principal.  A fold over
// `crossTenant` producers only (`Bookings`) keeps the unscoped shape.
//
// Also the event-origin accuracy folds depend on: a buffered dispatch runs in
// the frame the event was raised in (dotnet `DomainEventDeferral`, node
// `deferredDispatcher`, python `PostCommitDispatcher`, java's after-commit
// reactor listener), and java's workflow / reactor publish of a tenant-scoped
// stream's events runs in the stream tenant's origin frame.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const FIXTURE = fs.readFileSync(
  path.resolve(__dirname, "../e2e/fixtures/ts-build/fold-tenant-scoped.ddd"),
  "utf8",
);

const on = (platform: string): string => FIXTURE.replace("platform: node", `platform: ${platform}`);

function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([k]) => k.endsWith(suffix));
  if (!hit) throw new Error(`no generated file ending in ${suffix}`);
  return hit[1];
}

/** The block of `text` from the first line containing `start` up to the next
 *  line containing `end` (exclusive). */
function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  if (from < 0) throw new Error(`no '${start}'`);
  const to = text.indexOf(end, from + start.length);
  return text.slice(from, to < 0 ? undefined : to);
}

describe("node (drizzle): tenant-scoped fold", async () => {
  const files = await generateSystemFiles(FIXTURE);
  const schema = file(files, "db/schema.ts");
  const projections = file(files, "http/projections.ts");

  it("the migration keys the fold row by (tenant_id, key)", () => {
    const sql = [...files.entries()]
      .filter(([k]) => k.includes("/db/migrations/") && k.endsWith(".sql"))
      .map(([, v]) => v)
      .join("\n");
    const totals = between(sql, `"totalses"`, ");");
    expect(totals).toContain(`"tenant_id" TEXT NOT NULL`);
    // Absence check: tenancy is flat, the row carries no hierarchy-path column.
    expect(totals).not.toContain("data_key");
    expect(totals).toMatch(/PRIMARY KEY \("tenant_id", "acct"\)/);
    expect(between(sql, `"bookingses"`, ");")).not.toContain("tenant_id");
  });

  it("the drizzle table carries the tenant column under a composite key", () => {
    const totals = between(schema, "export const totalses", "}));");
    expect(totals).toContain(`tenantId: text("tenant_id").notNull(),`);
    expect(totals).toContain("primaryKey({ columns: [table.tenantId, table.acct] })");
    expect(between(schema, "export const bookingses", "});")).not.toContain("tenantId");
  });

  it("the fold reads the event's tenant from its origin, keys and stamps the row with it", () => {
    const fold = between(projections, "export async function foldPaidIntoTotals", "\n}\n");
    expect(fold).toContain("const __origin = currentEventOrigin();");
    expect(fold).toContain("if (__tenant == null) return;");
    expect(fold).toContain("await loadTotals(db, __key, __tenant)");
    expect(fold).toContain("?? { acct: __key, tenantId: __tenant, paid: 0, deposited: 0 }");
    expect(projections).toContain(
      "onConflictDoUpdate({ target: [schema.totalses.tenantId, schema.totalses.acct], set: state })",
    );
    expect(
      between(projections, "export async function foldBookedIntoBookings", "\n}\n"),
    ).not.toContain("currentEventOrigin");
  });

  it("every read of the scoped fold applies the tenant floor; the exempt one does not", () => {
    const floor = "eq(schema.totalses.tenantId, String(requireCurrentUser().tenantId))";
    expect(projections).toContain(`db.select().from(schema.totalses).where(${floor});`);
    expect(projections).toContain(
      `db.select().from(schema.totalses).where(and(eq(schema.totalses.acct, key), ${floor})).limit(1);`,
    );
    expect(projections).toContain("const rows = await db.select().from(schema.bookingses);");
  });

  it("a deferred dispatch runs back in the event's raising async context", () => {
    const events = file(files, "domain/events.ts");
    expect(events).toContain("buffered.push({ event, frame: AsyncLocalStorage.snapshot() });");
    expect(events).toContain("await frame(() => inner.dispatch(event));");
  });
});

/** The fixture without its event-sourced `Ledger` (MikroORM hosts no
 *  tenant-scoped event stream — `loom.target-unsupported`). */
function withoutLedger(src: string): string {
  return src
    .replace(/ {6}aggregate Ledger persistedAs[\s\S]*?\n {6}}\n/, "")
    .replace(/ {6}workflow topUp \{[\s\S]*?\n {6}}\n/, "")
    .replace("        on(e: Deposited) { deposited := e.amount }\n", "")
    .replace("      repository Ledgers for Ledger { }\n", "")
    .replace("      event Opened { ledger: Ledger id, owner: string }\n", "")
    .replace("      event Deposited { ledger: Ledger id, acct: Acct id, amount: int }\n", "")
    .replace("  resource mainLog { for: Main, kind: eventLog, use: pg }\n", "")
    .replace(
      "dataSources: [mainState, mainLog, registryState]",
      "dataSources: [mainState, registryState]",
    );
}

describe("node (mikroorm): tenant-scoped fold", async () => {
  const files = await generateSystemFiles(
    withoutLedger(FIXTURE).replace("platform: node", "platform: node { persistence: mikroorm }"),
  );
  const projections = file(files, "http/projections.ts");

  it("keys, stamps and scopes the fold row", () => {
    expect(projections).toContain("db.findOne(TotalsRow, { acct: key, tenantId: tenant })");
    expect(projections).toContain(
      "db.fork().find(TotalsRow, { tenantId: String(requireCurrentUser().tenantId) })",
    );
    expect(projections).toContain(
      "db.fork().findOne(TotalsRow, { acct: key, tenantId: String(requireCurrentUser().tenantId) })",
    );
  });
});

describe("dotnet (EF Core): tenant-scoped fold", async () => {
  const files = await generateSystemFiles(on("dotnet"));
  const handler = file(files, "Application/Workflows/TotalsOnPaidHandler.cs");
  const config = file(files, "Configurations/TotalsRowConfiguration.cs");
  const controller = file(files, "Api/MainProjectionsController.cs");

  it("the row is keyed by (TenantId, Acct) and maps the tenant columns", () => {
    expect(config).toContain("builder.HasKey(x => new { x.TenantId, x.Acct });");
    expect(config).toContain(`builder.Property(x => x.TenantId).HasColumnName("tenant_id");`);
    expect(file(files, "Configurations/BookingsRowConfiguration.cs")).toContain(
      "builder.HasKey(x => x.Plan);",
    );
  });

  it("the fold reads the event origin, keys and stamps the row", () => {
    expect(handler).toContain("var __origin = global::Api.Auth.User.CurrentEventOrigin();");
    expect(handler).toContain("FindAsync(x => x.TenantId == __tenant && x.Acct == __key");
    expect(handler).toContain(
      "state = new TotalsRow { Acct = __key, TenantId = __tenant, Paid = 0, Deposited = 0 };",
    );
  });

  it("every read applies the floor against the principal", () => {
    const list = between(controller, "ListTotals()", "[HttpGet");
    expect(list).toContain(".Where(r => r.TenantId == __scope0)");
    expect(between(controller, "GetTotals(", "[HttpGet")).toContain(
      "r.Acct == __key && r.TenantId == __scope0",
    );
    expect(between(controller, "ListBookings()", "[HttpGet")).not.toContain("__scope0");
  });

  it("a deferred dispatch re-enters the frame the event was raised in", () => {
    const common = [...files.entries()].find(([, v]) =>
      v.includes("class DomainEventDeferral"),
    )![1];
    expect(common).toContain("scope._buffered.Add((dispatcher, ev, RequestContext.Current));");
    expect(common).toContain("RequestContext.Enter(frame)");
  });
});

describe("dotnet (Dapper): tenant-scoped fold", async () => {
  const files = await generateSystemFiles(
    FIXTURE.replace("platform: node", "platform: dotnet { persistence: dapper }"),
  );
  const ports = file(files, "Infrastructure/Persistence/DapperPersistencePorts.cs");
  const controller = file(files, "Api/MainProjectionsController.cs");

  it("upserts on (tenant_id, acct) and scopes both reads", () => {
    expect(ports).toContain("ON CONFLICT (tenant_id, acct) DO UPDATE SET");
    expect(controller).toContain("FROM totalses WHERE tenant_id = @scope0");
    expect(controller).toContain("WHERE acct = @key AND tenant_id = @scope0");
    expect(ports).toContain("ON CONFLICT (plan) DO UPDATE SET");
  });
});

describe("python: tenant-scoped fold", async () => {
  const files = await generateSystemFiles(on("python"));
  const schema = file(files, "app/db/schema.py");
  const dispatch = file(files, "app/dispatch.py");
  const routes = file(files, "app/http/projections_routes.py");

  it("the row carries tenant_id in its composite key", () => {
    const row = between(schema, "class TotalsRow", "\n\n\n");
    expect(row).toContain("tenant_id: Mapped[str] = mapped_column(Text, primary_key=True)");
    // Absence check: tenancy is flat, the row carries no hierarchy-path column.
    expect(row).not.toContain("data_key");
  });

  it("the fold reads the event origin, keys and stamps the row", () => {
    const fold = between(dispatch, "async def _proj_totals_paid", "await session.flush()");
    expect(fold).toContain(`__tenant = __origin.get("tenant")`);
    expect(fold).toContain("await _load_totals(session, __key, __tenant)");
    expect(fold).toContain(
      "state = TotalsRow(acct=__key, tenant_id=__tenant, paid=0, deposited=0)",
    );
  });

  it("every read applies the floor; the exempt fold does not", () => {
    expect(routes).toContain(
      "select(TotalsRow).where(TotalsRow.tenant_id == str(current_user.tenant_id))",
    );
    expect(routes).toContain(
      "select(TotalsRow).where(TotalsRow.acct == key, TotalsRow.tenant_id == str(current_user.tenant_id))",
    );
    expect(routes).toContain("row = await session.get(BookingsRow, key)");
  });

  it("a post-commit delivery runs in a copy of the raising context", () => {
    const events = file(files, "app/domain/events.py");
    expect(events).toContain("frame = copy_context()");
    expect(events).toContain("await create_task(inner.dispatch(event), context=frame)");
  });
});

describe("java: tenant-scoped fold", async () => {
  const files = await generateSystemFiles(on("java"));
  const row = file(files, "/TotalsRow.java");
  const repo = file(files, "/TotalsRowRepository.java");
  const dispatcher = file(files, "/MainDispatcher.java");
  const controller = file(files, "/MainProjectionsController.java");
  const workflows = file(files, "/MainWorkflows.java");

  it("the row's id is the (tenant_id, acct) Key embeddable", () => {
    expect(row).toContain("@EmbeddedId\n    Key rowKey;");
    expect(row).toContain(`@Column(name = "tenant_id")`);
    expect(repo).toContain("extends JpaRepository<TotalsRow, TotalsRow.Key>");
    expect(repo).toContain(`@Query("select r from TotalsRow r where r.rowKey.tenantId = :tenant")`);
    expect(file(files, "/BookingsRowRepository.java")).toContain(
      "extends JpaRepository<BookingsRow, PlanId>",
    );
  });

  it("the fold reads the event origin, keys and stamps the row", () => {
    const fold = between(dispatcher, "public void onTotalsOnPaid", "\n    }\n");
    expect(fold).toContain("var __origin = com.loom.api.auth.User.currentEventOrigin();");
    expect(fold).toContain(
      "totalsRowRepository.findByTenantAndKey(__tenant, __key).orElseGet(() -> TotalsRow._allocate(__tenant, __key));",
    );
  });

  it("every read applies the floor against the principal", () => {
    const tenant = "String.valueOf(currentUserAccessor.user().tenantId())";
    expect(controller).toContain(`totalsRowRepository.findAllByTenant(${tenant})`);
    expect(controller).toContain(
      `totalsRowRepository.findByTenantAndKey(${tenant}, new AcctId(key))`,
    );
    expect(controller).toContain("bookingsRowRepository.findAll()");
  });

  it("a workflow's publish of a tenant-scoped stream runs in the stream tenant's origin", () => {
    expect(workflows).toContain(
      "com.loom.api.auth.CurrentUserAccessor.runAsEventOrigin(new com.loom.api.auth.EventOrigin(__t, __o == null ? null : __o.causedBy()), __pub);",
    );
  });
});

describe("elixir: tenant-scoped fold", async () => {
  const files = await generateSystemFiles(on("elixir"));
  const row = file(files, "/projections/totals_row.ex");
  const fold = file(files, "/projections/totals/on_paid.ex");
  const controller = file(files, "controllers/projections_controller.ex");

  it("the row schema has the composite (tenant_id, acct) primary key", () => {
    expect(row).toContain("@primary_key false");
    expect(row).toContain("field :tenant_id, :string, primary_key: true");
    expect(row).toContain("field :acct, :binary_id, primary_key: true");
    expect(file(files, "/projections/bookings_row.ex")).toContain(
      "@primary_key {:plan, :binary_id, autogenerate: false}",
    );
  });

  it("the fold reads the event origin, keys and stamps the row", () => {
    expect(fold).toContain("origin = ApiWeb.Auth.current_event_origin() || %{}");
    expect(fold).toContain(
      "Repo.get_by(Api.Main.Projections.TotalsRow, acct: key, tenant_id: tenant)",
    );
    expect(fold).toContain("nil -> %Api.Main.Projections.TotalsRow{acct: key, tenant_id: tenant}");
  });

  it("every read applies the floor; the exempt fold does not", () => {
    expect(controller).toContain("where: r.tenant_id == ^scope0");
    expect(controller).toContain("acct: key, tenant_id: scope0");
    expect(controller).toContain("Api.Repo.all(Api.Main.Projections.BookingsRow)");
  });
});
