// A `tenantOwned` event-sourced aggregate on java (`stream-tenancy.ts`): the
// stream carries its tenant as stored-event metadata.  A new stream is stamped
// from the principal, the fold adopts the stream's tenant, every by-id load /
// list / find is scoped by the fact's tenancy restrictions (in-app over the
// folded aggregate), and the events publish in the stream tenant's event origin.
// A `crossTenant` stream keeps the unscoped shape.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const FIXTURE = fs
  .readFileSync(path.resolve(__dirname, "../../e2e/fixtures/ts-build/es-tenant-owned.ddd"), "utf8")
  .replace("platform: node", "platform: java");

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
  deployable d { platform: java contexts: [C] dataSources: [st, st2] serves: A port: 4000 auth: required }
}`;

describe("java: a tenantOwned event-sourced stream carries and scopes its tenant", async () => {
  const files = await generateSystemFiles(FIXTURE);
  const ledgerRepo = file(files, "LedgerRepositoryImpl.java");
  const bookRepo = file(files, "BookRepositoryImpl.java");

  it("the by-id load reads the tenant metadata, adopts it, and answers empty out of scope", () => {
    expect(ledgerRepo).toContain("select type, data, tenant_id, data_key from");
    expect(ledgerRepo).toContain(
      `inst._adoptStreamTenant((String) rows.get(0).get("tenant_id"), (String) rows.get(0).get("data_key"));`,
    );
    expect(ledgerRepo).toContain(
      "return Optional.of(inst).filter(x -> currentUser != null && (Objects.equals(x.tenantId(), currentUser.tenantId())));",
    );
    // `getById` (the command / append load) rides `findById`.
    expect(ledgerRepo).toMatch(/public Ledger getById[\s\S]*?var found = findById\(id\);/);
  });

  it("the list load is scoped; the unscoped fold is private", () => {
    expect(ledgerRepo).toContain("return loadAll().stream().filter(x -> currentUser != null &&");
    expect(ledgerRepo).toContain("private List<Ledger> loadAll()");
    expect(ledgerRepo).toContain("inst._adoptStreamTenant(");
    // A declared find narrows the unscoped fold by the same restriction.
    expect(ledgerRepo).toMatch(
      /findAllByByOwner[\s\S]*?loadAll\(\)\.stream\(\)\.filter\(x -> Objects\.equals\(x\.owner\(\), o_\)\)\.filter\(x -> currentUser != null/,
    );
  });

  it("`allow deep` widens a stream's scope to the subtree over data_key", () => {
    expect(bookRepo).toContain("startsWith");
    expect(bookRepo).toContain("dataKey()");
  });

  it("an `ignoring tenantOwned` read loads unscoped, and only that read", () => {
    const m = bookRepo.match(/IgnoringTenantOwned[\s\S]*?\n {4}}\n/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("loadAll().stream()");
    expect(m![0]).not.toContain("currentUser");
  });

  it("a new stream is stamped from the principal; every row carries the stream's tenant", () => {
    expect(ledgerRepo).toMatch(/if \(version == 0\) \{\s*aggregate\._stampOnCreate\(\);/);
    expect(ledgerRepo).toContain(
      "(stream_type, stream_id, version, type, data, tenant_id, data_key) values",
    );
    expect(ledgerRepo).toContain("aggregate.tenantId(), aggregate.dataKey());");
  });

  it("the domain class adopts the metadata and stamps from the principal", () => {
    const domain = file(files, "features/ledgers/Ledger.java");
    expect(domain).toContain("public void _adoptStreamTenant(String tenantId, String dataKey) {");
    expect(domain).toContain("public void _stampOnCreate() {");
  });

  it("the events publish in the stream tenant's event origin (channel envelope tenantid)", () => {
    const svc = file(files, "features/ledgers/LedgerService.java");
    expect(svc).toContain(
      "java.util.Objects.equals(__origin == null ? null : __origin.tenant(), aggregate.tenantId())",
    );
    expect(svc).toContain("CurrentUserAccessor.runAsEventOrigin(");
    expect(svc).toContain("new EventOrigin(aggregate.tenantId(), aggregate.dataKey(),");
  });
});

describe("java: a crossTenant event-sourced stream stays unscoped", async () => {
  const files = await generateSystemFiles(CROSS_TENANT);
  it("no metadata columns, no scope, no stamp", () => {
    const repo = file(files, "LedgerRepositoryImpl.java");
    expect(repo).not.toContain("_adoptStreamTenant");
    expect(repo).not.toContain("tenant_id");
    expect(repo).not.toContain("loadAll");
    expect(file(files, "features/ledgers/LedgerService.java")).not.toContain("runAsEventOrigin");
  });
});
