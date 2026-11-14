// Regression: the React api-builder must emit the zod schema for an enum
// reached only THROUGH a value object's field.
//
// An aggregate field of value-object type emits a `<VO>Schema =
// z.object({...})`; each VO field renders as that field type's schema
// reference (`country: CountrySchema`).  The schema collector previously
// walked only the aggregate's own fields, so an enum referenced solely by
// a nested VO (e.g. `Address.country: Country`) was never collected — the
// emitted `AddressSchema` then referenced an undeclared `CountrySchema`,
// which the playground bundler rejects with "Can't find variable:
// CountrySchema".  Mirrors the Acme ERP `Address`/`Country` shape from
// shared/geo.ddd.

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
  enum Country { US, GB, DE }

  valueobject Address {
    line1: string
    city: string
    country: Country
  }

  context Sales {
    aggregate Customer {
      name: string
      shipTo: Address
    }
    repository Customers for Customer {}
  }
`;

async function apiModule(): Promise<string> {
  const { model } = await parseString(SRC, { validate: false });
  const enriched = enrichLoomModel(lowerModel(model));
  const ctx = enrichedContexts(enriched).find((c) => c.name === "Sales")!;
  const agg = ctx.aggregates.find((a) => a.name === "Customer")!;
  const repo = ctx.repositories.find((r) => r.aggregateName === "Customer");
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

describe("react api-builder — transitive enum/VO schema collection", () => {
  it("emits the enum schema reached only through a value object's field", async () => {
    const api = await apiModule();
    // The VO schema references CountrySchema …
    expect(api).toContain("country: CountrySchema");
    // … so CountrySchema itself must be declared, before the VO that uses it.
    expect(api).toContain(`export const CountrySchema = z.enum(["US", "GB", "DE"]);`);
    expect(api.indexOf("export const CountrySchema")).toBeLessThan(
      api.indexOf("export const AddressSchema"),
    );
  });
});
