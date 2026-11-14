// React API-client coverage for the paged list read (payload-transport-layer.md,
// P3b emission — React slice).  The paged `all` (the auto-findAll) emits a
// `<Agg>Paged` response schema, adds 1-based `page`/`pageSize` to its query
// schema, and the generated React Query hook
// parses the paged envelope — so a hono-served react frontend consumes the same
// wire shape the backend emits.

import { describe, expect, it } from "vitest";
import { buildApiModule } from "../../../src/generator/_frontend/api-module.js";
import { contractOperations } from "../../../src/ir/contract/frontend-contract.js";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { forApiRead, wireFieldsFor } from "../../../src/ir/enrich/wire-projection.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { pagedReturn, pagedSortDefault } from "../../../src/ir/stdlib/generics.js";
import { enrichedContexts } from "../../_helpers/ir.js";
import { parseString } from "../../_helpers/parse.js";

const SRC = `
  context Inventory {
    aggregate Warehouse { code: string  region: string }
    repository Warehouses for Warehouse
  }
`;

async function apiModule(): Promise<string> {
  const { model } = await parseString(SRC, { validate: false });
  const enriched = enrichLoomModel(lowerModel(model));
  const ctx = enrichedContexts(enriched).find((c) => c.name === "Inventory")!;
  const agg = ctx.aggregates.find((a) => a.name === "Warehouse")!;
  const repo = ctx.repositories.find((r) => r.aggregateName === "Warehouse");
  // A system-less model has no Frontend Contract, so the client finds are
  // the repository's auto-\`all\` (no synthesized find is routed).
  const finds = (repo?.finds ?? [])
    .filter((f) => f.name === "all")
    .map((f) => ({
      name: f.name,
      params: f.params,
      returnType: f.returnType,
      ...(pagedReturn(f.returnType) ? { sortDefault: pagedSortDefault(f) } : {}),
    }));
  return buildApiModule(agg, ctx, {
    operations: contractOperations(ctx),
    records: ctx.payloads,
    finds,
    history: false,
    // No declared response records either: the derived read wire stands in.
    responses: [agg, ...agg.parts].map((ent) => ({
      name: `${ent.name}Response`,
      entity: ent.name,
      fields: forApiRead(wireFieldsFor(ent)).map((w) => ({
        name: w.name,
        type: w.type,
        optional: w.optional,
      })),
    })),
  });
}

describe("react api-builder — the paged list read (P3b)", () => {
  it("emits a <Agg>Paged response schema reusing the carrier's response", async () => {
    const api = await apiModule();
    expect(api).toContain(
      "export const WarehousePaged = z.object({ items: z.array(WarehouseResponse), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), totalPages: z.number().int() });",
    );
    expect(api).toContain("export type WarehousePaged = z.infer<typeof WarehousePaged>;");
  });

  it("adds 1-based page/pageSize to the paged read's query schema", async () => {
    const api = await apiModule();
    expect(api).toContain("export const AllQuery = z.object({");
    expect(api).toContain("page: z.coerce.number().int().min(1).max(1000000).default(1),");
    expect(api).toContain("pageSize: z.coerce.number().int().min(1).max(500).default(20),");
  });

  it("exposes the caller-facing z.input alias for a paged query (page/pageSize optional)", async () => {
    const api = await apiModule();
    // z.output (z.infer) makes the defaulted page/pageSize required; the
    // input alias is what a caller actually supplies — they may omit them.
    expect(api).toContain("export type AllQueryInput = z.input<typeof AllQuery>;");
  });

  it("the hook accepts the input shape and parses the paged envelope", async () => {
    const api = await apiModule();
    // The list read takes no domain parameters, so the query argument is
    // DEFAULTED — a page reading it with nothing to put in the bag type-checks.
    // `{}` satisfies `AllQueryInput` because the input alias makes every paged
    // control optional (that is the assertion just above).
    expect(api).toContain("export function useAllWarehouses(query: AllQueryInput = {}) {");
    expect(api).toContain("return WarehousePaged.parse(r);");
  });
});
