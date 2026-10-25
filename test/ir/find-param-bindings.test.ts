// A clause-less find filters on the fields its parameters name.  The pairing
// is resolved once in enrichment and stored on `FindIR.paramBindings`; a
// parameter that names no field is refused (`loom.find-param-unbound`) instead
// of being dropped from the query — unrefused, `find bySku(s: string)` emitted
// an unfiltered `LIMIT 1` on every backend and answered each lookup with an
// arbitrary row.

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { buildLoomModelUnchecked, enrichedContexts } from "../_helpers/ir.js";

const model = (finds: string): string => `
  context Catalog {
    aggregate Site { title: string }
    aggregate Product { sku: string  site: Site id  name: string }
    repository Products for Product {
      ${finds}
    }
  }
`;

async function build(findDecls: string) {
  const loom = await buildLoomModelUnchecked(
    model(findDecls),
    "the unbound-param cases are refused by phase ⑦",
  );
  const ctx = enrichedContexts(loom).find((c) => c.name === "Catalog")!;
  const finds = ctx.repositories.find((r) => r.name === "Products")!.finds;
  const unbound = validateLoomModel(loom).filter((d) => d.code === "loom.find-param-unbound");
  return { finds, unbound };
}

describe("find parameter → field binding", () => {
  it("binds by field name and by the `<field>Id` spelling", async () => {
    const { finds, unbound } = await build(
      "find bySkuAtSite(sku: string, siteId: Site id): Product?",
    );
    expect(finds.find((f) => f.name === "bySkuAtSite")!.paramBindings).toEqual([
      { param: "sku", field: "sku" },
      { param: "siteId", field: "site" },
    ]);
    expect(unbound).toEqual([]);
  });

  it("leaves a find with a `where` unbound — the clause replaces the convention", async () => {
    const { finds, unbound } = await build("find named(q: string): Product[] where this.name == q");
    expect(finds.find((f) => f.name === "named")!.paramBindings).toBeUndefined();
    expect(unbound).toEqual([]);
  });

  it("refuses a clause-less find parameter that names no field", async () => {
    const { finds, unbound } = await build("find bySku(s: string): Product?");
    expect(finds.find((f) => f.name === "bySku")!.paramBindings).toEqual([]);
    expect(unbound.map((d) => [d.severity, d.source])).toEqual([
      ["error", "Catalog/Products.bySku"],
    ]);
    expect(unbound[0]!.message).toContain("'s' names no field");
  });

  it("binds a parameter naming a field the concrete inherits from its base", async () => {
    const loom = await buildLoomModelUnchecked(
      `
      context Fleet {
        abstract aggregate Vehicle { plate: string }
        aggregate Truck extends Vehicle { payload: int }
        repository Trucks for Truck { find byPlate(plate: string): Truck? }
      }
    `,
      "a loose context has no TPH host, which phase ⑦ refuses",
    );
    const ctx = enrichedContexts(loom).find((c) => c.name === "Fleet")!;
    const find = ctx.repositories[0]!.finds.find((f) => f.name === "byPlate")!;
    expect(find.paramBindings).toEqual([{ param: "plate", field: "plate" }]);
    expect(validateLoomModel(loom).filter((d) => d.code === "loom.find-param-unbound")).toEqual([]);
  });
});
