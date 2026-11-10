// A `tenantOwned` event-sourced aggregate on elixir (`stream-tenancy.ts`): the
// stream carries its tenant as stored-event metadata.  The aggregate's event-log
// schema maps `tenant_id` and hosts the tenancy scope that
// `Repo.prepare_query/3` applies to every read of the stream, a new stream is
// stamped from the principal, an append carries the loaded stream's tenant
// forward, and the dispatch runs in the stream tenant's event-origin frame.
// A `crossTenant` stream stays unscoped.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const FIXTURE = fs.readFileSync(
  path.resolve(__dirname, "../../e2e/fixtures/elixir-vanilla-build/vanilla-es-tenant-owned.ddd"),
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
  deployable d { platform: elixir contexts: [C] dataSources: [st, st2] serves: A port: 4000 auth: required }
}`;

describe("elixir: a tenantOwned event-sourced stream carries and scopes its tenant", async () => {
  const files = await generateSystemFiles(FIXTURE);
  const repo = file(files, "lib/api/main/ledger_repository.ex");
  const bookRepo = file(files, "lib/api/main/book_repository.ex");
  const ledgerLog = file(files, "lib/api/main/ledger_event_log.ex");
  const bookLog = file(files, "lib/api/main/book_event_log.ex");

  it("the event-log schema maps the metadata column and hosts the tenancy scope", () => {
    expect(ledgerLog).toContain("field :tenant_id, :string");
    // Absence check: tenancy is flat, the log carries no hierarchy-path column.
    expect(ledgerLog).not.toContain("data_key");
    expect(ledgerLog).toContain("def __loom_filters__, do: [{:tenant_owned, true}]");
    expect(ledgerLog).toContain("record.tenant_id == ^(current_user && current_user.tenant_id)");
    expect(bookLog).toContain("record.tenant_id == ^(current_user && current_user.tenant_id)");
  });

  it("the by-id load and the list adopt the stream's tenant (the read scope is the schema's)", () => {
    expect(repo).toContain("|> adopt_stream_tenant(hd(rows))");
    expect(repo.match(/adopt_stream_tenant\(hd\(rows\)\)/g)?.length).toBe(2);
    expect(repo).toContain("%{agg | tenant_id: tenant_id}");
  });

  it("an `ignoring tenantOwned` read loads unscoped, and only that read", () => {
    expect(bookRepo).toContain("list(current_user: current_user, skip_filters: [:tenant_owned])");
    expect(bookRepo.match(/skip_filters/g)?.length).toBe(1);
    expect(repo).not.toContain("skip_filters");
  });

  it("a new stream is stamped from the principal; an append carries the stream's tenant", () => {
    expect(repo).toContain("defp stream_tenant(0, _stream) do");
    expect(repo).toContain("tenant_id = current_user && current_user.tenant_id");
    expect(repo).toContain("{:error, :forbidden}");
    expect(repo).toContain("defp stream_tenant(_prior, %{tenant_id: tenant_id})");
    expect(repo).toContain("tenant_id: tenant.tenant_id");
    const ctxFile = file(files, "lib/api/main.ex");
    expect(ctxFile).toContain(".append(id, 0, events, nil)");
    expect(ctxFile).toContain(".append(state.id, state.__stream_version__, events, state)");
  });

  it("the events dispatch in the stream tenant's origin (channel envelope tenantid)", () => {
    expect(repo).toContain(
      "in_stream_origin(tenant, fn -> Api.Main.Dispatcher.AfterCommit.dispatch(ev) end)",
    );
    expect(repo).toContain('origin["tenant"] == tenant.tenant_id');
    expect(repo).toContain('"tenant" => tenant.tenant_id,');
    // Absence check: the event origin is `{tenant, causedBy}` only.
    expect(repo).not.toContain('"orgPath"');
    expect(repo).toContain("ApiWeb.Auth.with_event_origin(");
  });
});

describe("elixir: a crossTenant event-sourced stream stays unscoped", async () => {
  const files = await generateSystemFiles(CROSS_TENANT);
  it("no metadata columns, no scope, no stamp", () => {
    const repo = file(files, "ledger_repository.ex");
    expect(repo).not.toContain("stream_tenant");
    expect(repo).not.toContain("adopt_stream_tenant");
    expect(repo).toContain("@spec list() ::");
    const log = file(files, "ledger_event_log.ex");
    expect(log).not.toContain("tenant_id");
    expect(log).not.toContain("__loom_filters__");
  });
});
