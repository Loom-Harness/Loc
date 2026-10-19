// Paged queryHandler over `Repo.run(<Criterion>)` — the durable read-path
// vehicle (read-path-architecture.md, "The ergonomic default").
//
// A `queryHandler H(...): <Agg> paged { let r = Repo.run(<Criterion>(args)); return r }`
// exposes a criterion-filtered, paged read through the read-only port. Enrich
// synthesizes a paged `FindIR` (flagged `synthesized`, so the aggregate router
// does NOT auto-expose it) onto the aggregate's repository, reusing #1904's
// paged-find repo-method emission; the Hono explicit-handler emitter binds the
// page/pageSize/sort/dir route params and returns the `Paged<T>` envelope.
// Every backend emits it, so no backend gates it.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const SYS = (platform = "node"): string => `
system S {
  subdomain Sales {
    context Orders {
      aggregate Order { code: string  region: string }
      repository Orders for Order { }
      criterion InRegion(rgn: string) of Order = region == rgn
      queryHandler ListInRegion(rgn: string): Order paged {
        let r = Orders.run(InRegion(rgn))
        return r
      }
    }
  }
  api A from Sales { route GET "/orders/projections/in_region" -> Orders.ListInRegion }
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: ${platform}  contexts: [Orders]  dataSources: [s]  serves: A  port: 3000 }
}`;

async function enriched(platform = "node") {
  const { model } = await parseString(SYS(platform), { validate: false });
  return enrichLoomModel(lowerModel(model));
}

describe("paged queryHandler — enrich synthesis", () => {
  it("synthesizes a paged, non-exposed FindIR for the criterion on the aggregate's repo", async () => {
    const ctx = allContexts(await enriched())[0]!;
    const repo = ctx.repositories.find((r) => r.aggregateName === "Order")!;
    const find = repo.finds.find((f) => f.name === "findAllByInRegion");
    expect(find, "synthesized paged find").toBeDefined();
    expect(find?.synthesized).toBe(true);
    // Paged return carrier + criterion filter + reified criterion ref.
    expect(find?.returnType).toEqual({
      kind: "genericInstance",
      ctor: "paged",
      arg: { kind: "entity", name: "Order" },
    });
    expect(find?.criterionRef?.name).toBe("InRegion");
    expect(find?.params.map((p) => p.name)).toEqual(["rgn"]);
  });
});

describe("paged queryHandler — validation", () => {
  async function errorCodes(platform: string): Promise<string[]> {
    const { model } = await parseString(SYS(platform), { validate: false });
    return validateLoomModel(enrichLoomModel(lowerModel(model)))
      .filter((d) => d.severity === "error")
      .map((d) => d.code ?? "");
  }

  // Every backend platform emits the paged-run queryHandler (node/Hono,
  // Python/FastAPI, Java/Spring, .NET/Mediator, Elixir/Phoenix), so none is
  // gated.
  it("every backend platform accepts a paged queryHandler", async () => {
    for (const platform of ["node", "python", "java", "dotnet", "elixir"]) {
      expect(await errorCodes(platform)).toEqual([]);
    }
  });
});

describe("paged queryHandler — Hono emission", () => {
  it("emits ONE paged route calling the paged repo method + returning the envelope", async () => {
    const files = await generateSystemFiles(SYS("node"));
    const routeFiles = [...files.entries()].filter(([p]) => p.endsWith("-routes.ts"));
    const joined = routeFiles.map(([, c]) => c).join("\n");
    // The queryHandler's own route is the only `in_region` route (the
    // synthesized find is NOT auto-exposed → no `/orders/in_region`).
    expect(joined).toContain('path: "/orders/projections/in_region"');
    expect(joined).not.toContain('path: "/orders/in_region"');
    // Calls the paged repo method with page/pageSize/sort/dir and wraps the
    // envelope, wire-projecting items.
    expect(joined).toMatch(/findAllByInRegion\([^)]*page[^)]*pageSize[^)]*sort[^)]*dir/);
    expect(joined).toMatch(/items:\s*result\.items\.map\(/);
  });
});

// A paged body over a named RETRIEVAL (`Repo.run(<Retrieval>(args))`) pages the
// retrieval's `where`, ordered by its `sort:` — the declared order is the
// route's default (`sort` defaults to `""`, which every paged find reads as
// "the declared order, then `id`").
const SYS_RETRIEVAL = (platform: string, aggHeader = "", extra = ""): string => `
system S {
  subdomain Sales {
    context Orders {
      aggregate Order${aggHeader} { code: string  region: string }
      repository Orders for Order { }
      criterion InRegion(rgn: string) of Order = region == rgn
      retrieval RegionByCode(rgn: string) of Order { where: InRegion(rgn)  sort: [code desc] }
      queryHandler ListViaRetrieval(rgn: string): Order paged {
        ${extra}
        let r = Orders.run(RegionByCode(rgn))
        return r
      }
    }
  }
  api A from Sales { route GET "/orders/via-retrieval" -> Orders.ListViaRetrieval }
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: ${platform}  contexts: [Orders]  dataSources: [s]  serves: A  port: 3000 }
}`;

async function shapeDiags(src: string) {
  const { model } = await parseString(src, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
    (d) => d.code === "loom.paged-query-handler-shape",
  );
}

describe("paged queryHandler over a retrieval", () => {
  it("is accepted on every backend", async () => {
    for (const platform of ["node", "python", "java", "dotnet", "elixir"]) {
      expect(await shapeDiags(SYS_RETRIEVAL(platform)), platform).toEqual([]);
    }
  });

  it("synthesizes a paged find carrying the retrieval's filter and declared order", async () => {
    const { model } = await parseString(SYS_RETRIEVAL("node"), { validate: false });
    const ctx = allContexts(enrichLoomModel(lowerModel(model)))[0]!;
    const find = ctx.repositories[0]!.finds.find((f) => f.name === "pageRegionByCode");
    expect(find?.synthesized).toBe(true);
    expect(find?.criterionRef?.name).toBe("InRegion");
    expect(
      find?.defaultSort?.map((t) => [t.path.map((s) => s.name).join("."), t.direction]),
    ).toEqual([["code", "desc"]]);
  });

  it("node: the route's sort defaults to the declared order and the repo applies it", async () => {
    const files = await generateSystemFiles(SYS_RETRIEVAL("node"));
    const all = [...files.values()].join("\n");
    expect(all).toContain('sort: z.string().default("")');
    expect(all).toMatch(/orders\.pageRegionByCode\([^)]*page[^)]*pageSize[^)]*sort[^)]*dir/);
  });
});

describe("paged queryHandler — body shape refusal (loom.paged-query-handler-shape)", () => {
  it("refuses a body that does anything besides its gates and the run", async () => {
    const diags = await shapeDiags(SYS_RETRIEVAL("node", "", 'let tag = "x"'));
    expect(diags.map((d) => d.severity)).toEqual(["error"]);
    expect(diags[0]!.source).toBe("Orders/ListViaRetrieval");
    expect(diags[0]!.message).toContain("its `requires` gates and that run, nothing else");
  });

  it("accepts a body that opens with a `requires` gate", async () => {
    expect(await shapeDiags(SYS_RETRIEVAL("node", "", 'requires rgn != ""'))).toEqual([]);
  });

  it("refuses a sorted retrieval over an aggregate that pages in memory", async () => {
    const diags = await shapeDiags(SYS_RETRIEVAL("node", " shape: document"));
    expect(diags.map((d) => d.severity)).toEqual(["error"]);
    expect(diags[0]!.message).toContain("pages retrieval 'RegionByCode'");
    expect(diags[0]!.message).toContain("not a single-table relational aggregate");
  });

  it("accepts the supported criterion-run shape", async () => {
    expect(await shapeDiags(SYS("node"))).toEqual([]);
  });

  it("the refused model never reaches an emitter crash: generate reports the diagnostic", async () => {
    await expect(generateSystemFiles(SYS_RETRIEVAL("python", "", 'let tag = "x"'))).rejects.toThrow(
      /loom\.paged-query-handler-shape|paged envelope/,
    );
  });
});
