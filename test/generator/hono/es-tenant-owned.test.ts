// A `tenantOwned` event-sourced aggregate on node (`stream-tenancy.ts`): the
// stream carries its tenant as stored-event metadata.  The event log gains the
// `tenant_id` / `data_key` metadata columns, a new stream is stamped from the
// principal, every stream load and list is scoped by the generated
// `<agg>StreamScope` helper, an append carries the loaded stream's tenant
// forward, and the dispatch runs in the stream tenant's event origin (the
// CloudEvents `tenantid` / `loomorgpath`).  A `crossTenant` stream keeps the
// unscoped shape.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../../_helpers/index.js";
import { buildLoomModel } from "../../_helpers/ir.js";

const FIXTURE = fs.readFileSync(
  path.resolve(__dirname, "../../e2e/fixtures/ts-build/es-tenant-owned.ddd"),
  "utf8",
);

function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([k]) => k.endsWith(suffix));
  if (!hit) throw new Error(`no generated file ending in ${suffix}`);
  return hit[1];
}

const CROSS_TENANT = `system X {
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
  deployable d { platform: node contexts: [C] dataSources: [st, st2] serves: A port: 4000 auth: required }
}`;

describe("node: a tenantOwned event-sourced stream carries and scopes its tenant", async () => {
  const files = await generateSystemFiles(FIXTURE);
  const ledgerRepo = file(files, "db/repositories/ledger-repository.ts");
  const bookRepo = file(files, "db/repositories/book-repository.ts");
  const scopes = file(files, "db/read-scopes.ts");

  it("the event log carries the tenant metadata columns (migration + drizzle schema)", () => {
    const sql = [...files.entries()]
      .filter(([k]) => k.includes("/db/migrations/") && k.endsWith(".sql"))
      .map(([, v]) => v)
      .join("\n");
    const log = sql.slice(sql.indexOf("main_events"));
    expect(log).toMatch(/"tenant_id" TEXT NULL/);
    expect(log).toMatch(/"data_key" TEXT NULL/);
    const schema = file(files, "db/schema.ts");
    expect(schema).toContain(`tenantId: text("tenant_id"),`);
    expect(schema).toContain(`dataKey: text("data_key"),`);
  });

  it("the stream scope helper renders the tenancy restriction over the metadata columns", () => {
    expect(scopes).toContain("export function ledgerStreamScope(");
    expect(scopes).toContain(
      `drops(use, "tenantOwned") ? undefined : eq(schema.mainEvents.tenantId, requireCurrentUser().tenantId)`,
    );
    // `allow deep` widens Book's to the subtree over `data_key`.
    const book = scopes.slice(scopes.indexOf("export function bookStreamScope("));
    expect(book).toContain("schema.mainEvents.dataKey");
    expect(book).toContain("requireCurrentUser().orgPath");
  });

  it("the by-id load is scoped — a foreign tenant's stream is not found (404)", () => {
    expect(ledgerRepo).toContain(
      `.where(and(eq(schema.mainEvents.streamType, "Ledger"), eq(schema.mainEvents.streamId, id as string), ledgerStreamScope()))`,
    );
    // getById — the command (append) load — rides findById.
    expect(ledgerRepo).toMatch(/async getById[\s\S]*?this\.findById\(id\)/);
    expect(ledgerRepo).toContain(
      "inst._adoptStreamTenant({ tenantId: rows[0].tenantId, dataKey: rows[0].dataKey });",
    );
  });

  it("the list load is scoped, and adopts each stream's tenant", () => {
    expect(ledgerRepo).toContain(
      "private async _loadAll(scope: ReturnType<typeof ledgerStreamScope> | null = ledgerStreamScope() ?? null)",
    );
    expect(ledgerRepo).toContain(
      `.where(and(eq(schema.mainEvents.streamType, "Ledger"), scope ?? undefined))`,
    );
    expect(ledgerRepo).toContain("inst._adoptStreamTenant(stream.meta);");
    expect(ledgerRepo).not.toMatch(/this\._loadAll\(null\)/);
  });

  it("an `ignoring tenantOwned` read loads unscoped, and only that read", () => {
    expect(bookRepo).toMatch(/IgnoringTenantOwned[\s\S]*?this\._loadAll\(null\)/);
    expect(bookRepo.match(/this\._loadAll\(null\)/g)?.length).toBe(1);
  });

  it("a new stream is stamped from the principal; an append carries the stream's tenant", () => {
    expect(ledgerRepo).toContain("const meta = aggregate._streamVersion === 0");
    expect(ledgerRepo).toContain(
      "? stampInsertLedger({ tenantId: aggregate.tenantId, dataKey: aggregate.dataKey })",
    );
    expect(ledgerRepo).toContain(": { tenantId: aggregate.tenantId, dataKey: aggregate.dataKey };");
    expect(ledgerRepo).toMatch(/data: eventToData\(event\),\s*\.\.\.meta,/);
    expect(ledgerRepo).toContain(`import { stampInsertLedger } from "../audit-stamp";`);
  });

  it("the events dispatch in the stream tenant's origin (channel envelope tenantid)", () => {
    expect(ledgerRepo).toContain("if ((origin?.tenant ?? null) === aggregate.tenantId)");
    expect(ledgerRepo).toContain(
      "await runAsEventOrigin({ tenant: aggregate.tenantId, orgPath: aggregate.dataKey, causedBy: origin?.causedBy ?? null }, dispatchAll);",
    );
  });

  it("the domain class adopts the metadata onto its tenantOwned fields", () => {
    const domain = file(files, "domain/ledger.ts");
    expect(domain).toContain(
      "_adoptStreamTenant(meta: { tenantId: string | null; dataKey: string | null }): void {",
    );
  });
});

describe("node: a crossTenant event-sourced stream stays unscoped", async () => {
  const files = await generateSystemFiles(CROSS_TENANT);
  it("no metadata columns, no stream scope, no stamp", () => {
    const repo = file(files, "db/repositories/ledger-repository.ts");
    expect(repo).not.toContain("StreamScope");
    expect(repo).not.toContain("_adoptStreamTenant");
    expect(repo).toContain("private async _loadAll(): Promise<Ledger[]>");
    expect(file(files, "db/schema.ts")).not.toContain("tenant_id");
  });
});

describe("node `persistence: mikroorm`: a tenantOwned event-sourced stream is refused, not emitted unscoped", () => {
  it("raises loom.target-unsupported#tenant-owned-event-sourced", async () => {
    const loom = await buildLoomModel(
      FIXTURE.replace("platform: node", "platform: node { persistence: mikroorm }"),
    );
    const refusals = validateLoomModel(loom).filter((d) => d.code === "loom.target-unsupported");
    expect(refusals.map((d) => d.source).sort()).toEqual([
      "Main/aggregate Book",
      "Main/aggregate Ledger",
    ]);
    expect(refusals[0]!.message).toContain("persistence: mikroorm");
  });
});
