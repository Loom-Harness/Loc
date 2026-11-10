// A `tenantOwned` event-sourced aggregate on python (`stream-tenancy.ts`): the
// stream carries its tenant as stored-event metadata.  The event-log row model
// gains `tenant_id`, a new stream is stamped from the principal,
// every stream load and list is scoped by the repository's `_stream_scope`, an
// append carries the loaded stream's tenant forward, and the dispatch runs in
// the stream tenant's event-origin frame.  A `crossTenant` stream stays unscoped.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const FIXTURE = fs
  .readFileSync(path.resolve(__dirname, "../../e2e/fixtures/ts-build/es-tenant-owned.ddd"), "utf8")
  .replace("platform: node", "platform: python");

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
  deployable d { platform: python contexts: [C] dataSources: [st, st2] serves: A port: 4000 auth: required }
}`;

describe("python: a tenantOwned event-sourced stream carries and scopes its tenant", async () => {
  const files = await generateSystemFiles(FIXTURE);
  const ledgerRepo = file(files, "app/db/repositories/ledger_repository.py");
  const bookRepo = file(files, "app/db/repositories/book_repository.py");

  it("the event-log row model maps the tenant metadata column", () => {
    const schema = file(files, "app/db/schema.py");
    expect(schema).toContain("tenant_id: Mapped[str | None] = mapped_column(Text)");
    // Absence check: tenancy is flat, the row model carries no hierarchy-path column.
    expect(schema).not.toContain("data_key");
  });

  it("the stream scope renders the tenancy restriction over the metadata column", () => {
    expect(ledgerRepo).toContain("def _stream_scope(");
    expect(ledgerRepo).toContain(
      "out.append(false() if user is None else (MainEventRow.tenant_id == user.operating_org))",
    );
    expect(bookRepo).toContain(
      "out.append(false() if user is None else (MainEventRow.tenant_id == user.operating_org))",
    );
  });

  it("the by-id load is scoped, and adopts the stream's tenant", () => {
    expect(ledgerRepo).toContain(
      'MainEventRow.stream_type == "Ledger", MainEventRow.stream_id == id, *_stream_scope())',
    );
    expect(ledgerRepo).toContain("inst._adopt_stream_tenant(rows[0].tenant_id)");
    // get_by_id — the command (append) load — rides find_by_id.
    expect(ledgerRepo).toMatch(/async def get_by_id[\s\S]*?await self\.find_by_id\(id\)/);
  });

  it("the list load is scoped, and adopts each stream's tenant", () => {
    expect(ledgerRepo).toContain(
      '.where(MainEventRow.stream_type == "Ledger", *_stream_scope(ignoring))',
    );
    expect(ledgerRepo).toContain("inst._adopt_stream_tenant(first_row[sid].tenant_id)");
  });

  it("an `ignoring tenantOwned` read loads unscoped, and only that read", () => {
    expect(bookRepo).toContain('self._load_all(frozenset({"tenantOwned"}))');
    expect(bookRepo.match(/_load_all\(frozenset/g)?.length).toBe(1);
    expect(ledgerRepo).not.toContain("_load_all(frozenset");
  });

  it("a new stream is stamped from the principal; every row carries the stream's tenant", () => {
    expect(ledgerRepo).toContain("if version == 0:");
    expect(ledgerRepo).toContain("aggregate._stamp_on_create(require_current_user())");
    expect(ledgerRepo).toContain("tenant_id=aggregate.tenant_id,");
  });

  it("the events dispatch in the stream tenant's origin (channel envelope tenantid)", () => {
    expect(ledgerRepo).toContain("with self._origin_frame(aggregate):");
    expect(ledgerRepo).toContain('origin.get("tenant") == aggregate.tenant_id');
    expect(ledgerRepo).toContain('"tenant": aggregate.tenant_id,');
    // Absence check: the event origin is `{tenant, causedBy}` only.
    expect(ledgerRepo).not.toContain('"orgPath"');
  });

  it("the domain class adopts the metadata onto its tenantOwned fields", () => {
    expect(file(files, "app/domain/ledger.py")).toContain(
      "def _adopt_stream_tenant(self, tenant_id: str | None) -> None:",
    );
  });
});

describe("python: a crossTenant event-sourced stream stays unscoped", async () => {
  const files = await generateSystemFiles(CROSS_TENANT);
  it("no metadata columns, no stream scope, no stamp", () => {
    const repo = file(files, "app/db/repositories/ledger_repository.py");
    expect(repo).not.toContain("_stream_scope");
    expect(repo).not.toContain("_adopt_stream_tenant");
    expect(repo).not.toContain("_origin_frame");
    expect(file(files, "app/db/schema.py")).not.toContain("tenant_id");
  });
});
