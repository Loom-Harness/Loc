// `loom.paged-param-reserved` — a paged read's own parameter may not reuse a
// paging query key (`PAGED_QUERY_PARAMS`: page / pageSize / sort / dir).
//
// Before the gate, `find byRank(page: int): Thing paged` generated on every
// backend with the key twice: `byRank(page: number, page: number, pageSize…)`
// (TS2300), `byRank(int page, int page, …)` (javac "already defined"),
// `def by_rank(self, page: int, page: int, …)` (Python "duplicate argument"),
// a C# query record with two `Page` properties, and an Elixir repo head binding
// `page` twice.  The refusal is the honest answer: the query key IS the name.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { PAGED_QUERY_PARAMS } from "../../src/ir/stdlib/generics.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.paged-param-reserved";

function findModel(param: string, ret = "Thing paged"): string {
  return `
system S {
  subdomain Core {
    context Shop {
      aggregate Thing with crudish { name: string  rank: int }
      repository Things for Thing {
        find byRank(${param}: int): ${ret} where this.rank == ${param}
      }
    }
  }
  storage pg { type: postgres }
  resource s { for: Shop, kind: state, use: pg }
  deployable d { platform: node  contexts: [Shop]  dataSources: [s]  port: 3000 }
}`;
}

function handlerModel(handlerParam: string, criterionParam: string): string {
  return `
system S {
  subdomain Core {
    context Shop {
      aggregate Thing with crudish { name: string  rank: int }
      repository Things for Thing { }
      criterion Ranked(${criterionParam}: int) of Thing = rank == ${criterionParam}
      queryHandler ListRanked(${handlerParam}: int): Thing paged {
        let r = Things.run(Ranked(${handlerParam}))
        return r
      }
    }
  }
  api A from Core { route GET "/ranked" -> Shop.ListRanked }
  storage pg { type: postgres }
  resource s { for: Shop, kind: state, use: pg }
  deployable d { platform: node  contexts: [Shop]  dataSources: [s]  serves: A  port: 3000 }
}`;
}

async function reserved(src: string) {
  const { model } = await parseString(src, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter((d) => d.code === CODE);
}

describe("loom.paged-param-reserved", () => {
  it("the reserved set is the four paging query keys", () => {
    expect([...PAGED_QUERY_PARAMS]).toEqual(["page", "pageSize", "sort", "dir"]);
  });

  it.each([...PAGED_QUERY_PARAMS])("refuses a paged find parameter named '%s'", async (name) => {
    const diags = await reserved(findModel(name));
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("error");
    expect(diags[0]!.message).toContain(`parameter '${name}'`);
    expect(diags[0]!.message).toContain(`paging query parameter '${name}'`);
    expect(diags[0]!.message).toContain("Rename the parameter");
  });

  // Python / Elixir spell the control `page_size`; .NET Pascal-cases the query
  // record's properties — both collide just the same.
  it.each([
    ["page_size", "pageSize"],
    ["Dir", "dir"],
    ["Page", "page"],
  ])("refuses '%s' as the snake-equal twin of '%s'", async (name, key) => {
    const diags = await reserved(findModel(name));
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain(`paging query parameter '${key}'`);
  });

  it("does not fire on a NON-paged find with a parameter named 'page'", async () => {
    expect(await reserved(findModel("page", "Thing?"))).toEqual([]);
    expect(await reserved(findModel("page", "Thing[]"))).toEqual([]);
  });

  it.each([
    "pageNo",
    "sortKey",
    "direction",
    "rank",
    "pages",
  ])("does not fire on a paged find parameter named '%s'", async (name) => {
    expect(await reserved(findModel(name))).toEqual([]);
  });

  it("refuses a paged queryHandler parameter that is a paging key", async () => {
    const diags = await reserved(handlerModel("sort", "min"));
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("queryHandler 'ListRanked'");
    expect(diags[0]!.message).toContain("parameter 'sort'");
  });

  it("refuses a criterion parameter a paged queryHandler threads into its synthesized find", async () => {
    const diags = await reserved(handlerModel("min", "page"));
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("criterion 'Ranked' parameter 'page'");
    expect(diags[0]!.message).toContain("findAllByRanked");
  });

  it("stays silent on a paged queryHandler + criterion with free names", async () => {
    expect(await reserved(handlerModel("min", "floor"))).toEqual([]);
  });
});
