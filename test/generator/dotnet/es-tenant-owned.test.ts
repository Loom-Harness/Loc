// A `tenantOwned` event-sourced aggregate on dotnet, EF and Dapper adapters
// (`stream-tenancy.ts`): the stream carries its tenant as stored-event metadata.
// The event log gains the tenant columns, a new stream is stamped from the
// principal, the fold adopts the stream's tenant, every by-id load / list / find
// is scoped by the fact's tenancy restrictions (in-app over the folded aggregate),
// and the events dispatch in the stream tenant's event origin.  A `crossTenant`
// stream keeps the unscoped shape.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const BASE = fs.readFileSync(
  path.resolve(__dirname, "../../e2e/fixtures/ts-build/es-tenant-owned.ddd"),
  "utf8",
);
const EF = BASE.replace("platform: node", "platform: dotnet");
const DAPPER = BASE.replace("platform: node", "platform: dotnet { persistence: dapper }");

function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([k]) => k.endsWith(suffix));
  if (!hit) throw new Error(`no generated file ending in ${suffix}`);
  return hit[1];
}

const CROSS_TENANT = (platform: string) => `system X {
  user { id: guid  tenantId: string }
  tenancy by user.tenantId of Org
  subdomain S {
    context C {
      event Opened { ledger: Ledger id }
      aggregate Ledger persistedAs: eventLog crossTenant {
        opened: bool
        create open() { emit Opened { ledger: id } }
        apply(e: Opened) { opened := true }
      }
      aggregate Org with crudish { name: string }
      repository Ledgers for Ledger { }
      repository Orgs for Org { }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: eventLog, use: pg }
  resource st2 { for: C, kind: state, use: pg }
  deployable d { platform: ${platform} contexts: [C] dataSources: [st, st2] serves: A port: 4000 auth: required }
}`;

const SCOPE = "(x.TenantId == RequestContext.Current!.CurrentUser!.TenantId)";
const FRAME_EQ = "__ambientOrigin?.Tenant == aggregate.TenantId";
const FRAME_ENTER =
  "EnterEventOrigin(new global::Api.Auth.EventOrigin(aggregate.TenantId, aggregate.DataKey, __ambientOrigin?.CausedBy))";

describe("dotnet (EF): a tenantOwned event-sourced stream carries and scopes its tenant", async () => {
  const files = await generateSystemFiles(EF);
  const ledger = file(files, "Infrastructure/Repositories/LedgerRepository.cs");
  const book = file(files, "Infrastructure/Repositories/BookRepository.cs");

  it("the event record + configuration map the tenant metadata columns", () => {
    const rec = file(files, "Persistence/Events/MainEventRecord.cs");
    expect(rec).toContain("public string? TenantId { get; set; }");
    expect(rec).toContain("public string? DataKey { get; set; }");
    const cfg = file(files, "Persistence/Configurations/MainEventRecordConfiguration.cs");
    expect(cfg).toContain('builder.Property(x => x.TenantId).HasColumnName("tenant_id");');
    expect(cfg).toContain('builder.Property(x => x.DataKey).HasColumnName("data_key");');
  });

  it("the by-id load adopts the stream's tenant and answers null out of scope (404)", () => {
    expect(ledger).toContain("__inst._AdoptStreamTenant(__rows[0].TenantId, __rows[0].DataKey);");
    expect(ledger).toContain("return _TenantVisible(__inst) ? __inst : null;");
    expect(ledger).toContain(`private static bool _TenantVisible(Ledger x) => ${SCOPE};`);
  });

  it("lists / finds narrow the unscoped fold by the restriction; the fold adopts each tenant", () => {
    expect(ledger).toMatch(/__all\.Where\(.*\)\.Where\(x => \(x\.TenantId == /);
    expect(ledger).toContain(
      "__inst._AdoptStreamTenant(__first[__kv.Key].TenantId, __first[__kv.Key].DataKey);",
    );
  });

  it("`allow deep` widens a stream's scope to the subtree over DataKey", () => {
    expect(book).toContain("x.DataKey.StartsWith(");
  });

  it("an `ignoring tenantOwned` read loads unscoped, and only that read", () => {
    const m = book.match(/FindFirstTitledIgnoringTenantOwned[\s\S]*?\n {4}}\n/);
    expect(m).not.toBeNull();
    expect(m![0]).not.toContain("RequestContext.Current");
  });

  it("a new stream is stamped from the principal; every row carries the stream's tenant", () => {
    expect(ledger).toContain("if (__version == 0) aggregate._StampOnCreate();");
    expect(ledger).toContain("TenantId = aggregate.TenantId,");
    expect(ledger).toContain("DataKey = aggregate.DataKey,");
    const domain = file(files, "Domain/Ledgers/Ledger.cs");
    expect(domain).toContain("internal void _AdoptStreamTenant(string? tenantId, string? dataKey)");
    expect(domain).toContain("internal void _StampOnCreate()");
  });

  it("the events dispatch in the stream tenant's origin (channel envelope tenantid)", () => {
    expect(ledger).toContain(FRAME_EQ);
    expect(ledger).toContain(FRAME_ENTER);
  });
});

describe("dotnet (Dapper): a tenantOwned event-sourced stream carries and scopes its tenant", async () => {
  const files = await generateSystemFiles(DAPPER);
  const ledger = file(files, "Infrastructure/Repositories/LedgerRepository.cs");
  const book = file(files, "Infrastructure/Repositories/BookRepository.cs");

  it("loads read the metadata columns, adopt them, and scope in-app", () => {
    expect(ledger).toContain(
      "SELECT stream_id, type, data, tenant_id, data_key FROM main_events WHERE stream_type = @st AND stream_id = @sid",
    );
    expect(ledger).toContain("__inst._AdoptStreamTenant(__rows[0].tenant_id, __rows[0].data_key);");
    expect(ledger).toContain("return _TenantVisible(__inst) ? __inst : null;");
    expect(ledger).toContain(`private static bool _TenantVisible(Ledger x) => ${SCOPE};`);
    expect(ledger).toContain(
      "__inst._AdoptStreamTenant(__g.First().tenant_id, __g.First().data_key);",
    );
    expect(ledger).toMatch(/__all\.Where\(.*\)\.Where\(x => \(x\.TenantId == /);
  });

  it("a new stream is stamped; every row carries the stream's tenant", () => {
    expect(ledger).toContain("if (__version == 0) aggregate._StampOnCreate();");
    expect(ledger).toContain(
      "(stream_type, stream_id, version, type, data, occurred_at, tenant_id, data_key) VALUES",
    );
    expect(ledger).toContain("tenant_id = aggregate.TenantId, data_key = aggregate.DataKey");
  });

  it("an `ignoring tenantOwned` read loads unscoped; deep widens over DataKey", () => {
    const m = book.match(/FindFirstTitledIgnoringTenantOwned[\s\S]*?\n {4}}\n/);
    expect(m).not.toBeNull();
    expect(m![0]).not.toContain("RequestContext.Current");
    expect(book).toContain("x.DataKey.StartsWith(");
  });

  it("the events dispatch in the stream tenant's origin", () => {
    expect(ledger).toContain(FRAME_EQ);
    expect(ledger).toContain(FRAME_ENTER);
  });
});

describe.each([
  "dotnet",
  "dotnet { persistence: dapper }",
])("%s: a crossTenant event-sourced stream stays unscoped", (platform) => {
  it("no metadata columns, no scope, no stamp", async () => {
    const files = await generateSystemFiles(CROSS_TENANT(platform));
    const repo = file(files, "Infrastructure/Repositories/LedgerRepository.cs");
    expect(repo).not.toContain("_AdoptStreamTenant");
    expect(repo).not.toContain("_TenantVisible");
    expect(repo).not.toContain("_StampOnCreate");
    expect(repo).not.toContain("EnterEventOrigin");
    expect(
      [...files.keys()].some(
        (k) => k.endsWith("EventRecord.cs") && files.get(k)!.includes("TenantId"),
      ),
    ).toBe(false);
  });
});
