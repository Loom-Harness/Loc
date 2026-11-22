// A `paged` query handler may page every row with the bare `Repo.all()`: it
// pages through the aggregate's own list read (the one `GET /<aggs>` runs),
// so it never loads the table.  Anywhere else the bare read stays refused, and
// on an aggregate whose list read is not paged in SQL it is refused too.

import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";

const SRC = (opts: { agg?: string; ret?: string; handler?: "query" | "command" } = {}) => `
system S {
  subdomain Sales {
    context Ordering {
      aggregate Order ${opts.agg ?? "with crudish"} { code: string }
      repository Orders for Order
      ${opts.handler === "command" ? "commandHandler" : "queryHandler"} ListOrders()${
        opts.handler === "command" ? "" : `: ${opts.ret ?? "Order paged"}`
      } {
        let r = Orders.all()
        ${opts.handler === "command" ? "" : "return r"}
      }
    }
  }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable d { platform: node contexts: [Ordering] dataSources: [st] port: 4000 }
}`;

async function codes(src: string): Promise<string[]> {
  return (await validate(src)).diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => `${d.code}: ${d.message}`);
}

describe("Repo.all() in a paged query handler", () => {
  it("is admitted on a single-table relational aggregate", async () => {
    expect(await codes(SRC())).toEqual([]);
  });

  it("stays refused in a handler that is not paged", async () => {
    const out = await codes(SRC({ handler: "command" }));
    expect(out.some((c) => c.startsWith("loom.workflow-load-array-unsupported"))).toBe(true);
  });

  it("is refused on an aggregate whose list read is not paged in SQL", async () => {
    const out = await codes(SRC({ agg: "persistedAs: eventLog with crudish" }));
    expect(out.some((c) => c.includes("is not a single-table relational aggregate"))).toBe(true);
  });
});
