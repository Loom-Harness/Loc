// The stream-tenancy fact (`src/ir/enrich/stream-tenancy.ts`): where a
// `tenantOwned` event-sourced aggregate keeps its tenant (stored-event
// metadata), which assignments stamp a new stream, which read-scope
// restrictions every stream load applies, and which events carry the tenant
// in their metadata.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  eventLogCarriesTenant,
  eventTenantMetadataFor,
  isTenancyStampAssignment,
  STREAM_TENANT_METADATA,
  streamTenancyFor,
} from "../../src/ir/enrich/stream-tenancy.js";
import { buildLoomModel, enrichedContexts } from "../_helpers/ir.js";

const FIXTURE = fs.readFileSync(
  path.resolve(__dirname, "../e2e/fixtures/ts-build/es-tenant-owned.ddd"),
  "utf8",
);

async function mainCtx(src = FIXTURE) {
  const loom = await buildLoomModel(src);
  return enrichedContexts(loom).find((c) => c.name === "Main")!;
}

describe("stream-tenancy fact", () => {
  it("a tenantOwned stream carries tenant_id metadata, stamped on create", async () => {
    const ctx = await mainCtx();
    const ledger = ctx.aggregates.find((a) => a.name === "Ledger")!;
    const fact = streamTenancyFor(ledger, ctx.aggregates)!;
    expect(fact.metadata.map((m) => m.column)).toEqual(["tenant_id"]);
    expect(fact.metadata).toBe(STREAM_TENANT_METADATA);
    expect(fact.stamp.map((a) => a.field)).toEqual(["tenantId"]);
    expect(fact.stamp.every((a) => isTenancyStampAssignment(ledger, a))).toBe(true);
  });

  it("stream loads apply the read scope's tenancy restriction — the flat tenant floor", async () => {
    const ctx = await mainCtx();
    const ledger = ctx.aggregates.find((a) => a.name === "Ledger")!;
    const book = ctx.aggregates.find((a) => a.name === "Book")!;
    expect(streamTenancyFor(ledger, ctx.aggregates)!.restrictions.map((r) => r.tenancy)).toEqual([
      "tenant",
    ]);
    expect(streamTenancyFor(book, ctx.aggregates)!.restrictions.map((r) => r.tenancy)).toEqual([
      "tenant",
    ]);
  });

  it("`ignoring tenantOwned` drops the stream restriction", async () => {
    const ctx = await mainCtx();
    const ledger = ctx.aggregates.find((a) => a.name === "Ledger")!;
    const fact = streamTenancyFor(ledger, ctx.aggregates, {
      ignoring: { bypassCaps: ["tenantOwned"] },
    })!;
    expect(fact.restrictions).toEqual([]);
  });

  it("the context log carries the tenant; the folded events carry it in metadata", async () => {
    const ctx = await mainCtx();
    expect(eventLogCarriesTenant(ctx)).toBe(true);
    for (const e of ["Opened", "Deposited", "Shelved"]) {
      expect(eventTenantMetadataFor(ctx, { name: e }), e).toBe(STREAM_TENANT_METADATA);
    }
    // The payload stays pure domain data.
    expect(ctx.events.find((e) => e.name === "Opened")!.fields.map((f) => f.name)).toEqual([
      "ledger",
      "owner",
    ]);
  });

  it("a crossTenant stream, and a state-sourced tenantOwned aggregate, carry none", async () => {
    const ctx = await mainCtx(
      FIXTURE.replace(
        "aggregate Ledger persistedAs: eventLog with tenantOwned",
        "aggregate Ledger persistedAs: eventLog crossTenant",
      )
        .replace(
          "aggregate Book persistedAs: eventLog with tenantOwned",
          "aggregate Book persistedAs: eventLog crossTenant",
        )
        .replace("ignoring tenantOwned", ""),
    );
    const ledger = ctx.aggregates.find((a) => a.name === "Ledger")!;
    expect(streamTenancyFor(ledger, ctx.aggregates)).toBeUndefined();
    expect(eventLogCarriesTenant(ctx)).toBe(false);
    expect(eventTenantMetadataFor(ctx, { name: "Opened" })).toBeUndefined();
  });
});
