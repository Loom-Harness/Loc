// M-T1.36 F4 — the scaffolded SERVER-paged list marked every column
// `sortable:`, but the backend validates `?sort=` against `sortableFields`
// (src/ir/util/sortable-fields.ts): the `version` token, `mask unless` fields,
// optional / reference / provenanced columns are refused (a 400 on node's
// `z.enum`).  The macro now marks exactly the whitelisted columns; this pins
// the frontend's header set EQUAL to the server's accepted set over one
// aggregate that exercises every exclusion.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const DDD = `
system SortShop {
  user { id: string  role: string }
  subdomain Sales { context Orders {
    enum Tier { Gold, Silver }
    aggregate Customer with versioned, crudish {
      name: string
      tier: Tier
      salary: money mask unless currentUser.role == "admin"
      joined: datetime
      ownerRef: Customer id?
      active: bool
      nick: string?
      tierMaybe: Tier?
      score: int provenanced
      derived display: string = name
    }
    repository Customers for Customer { }
  } }
  api SalesApi from Sales
  storage db { type: postgres }
  resource st { for: Orders, kind: state, use: db }
  ui WebApp with scaffold(subdomains: [Sales]) { api Sales: SalesApi }
  deployable api { platform: node, contexts: [Orders], dataSources: [st], serves: SalesApi, port: 8080, auth: required }
  deployable web { platform: react, targets: api, ui: WebApp { Sales: api }, port: 3000 }
}`;

describe("scaffold list sortable columns = server sort whitelist (F4)", () => {
  it("marks exactly the columns the server's `?sort=` enum accepts", async () => {
    const files = await generateSystemFiles(DDD);
    const serverEnum = [...files.values()]
      .map((c) => c.match(/sort: z\.enum\(\[([^\]]*)\]\)/))
      .find((m) => m)?.[1];
    expect(serverEnum).toBeDefined();
    const accepted = serverEnum!
      .split(",")
      .map((s) => JSON.parse(s.trim()) as string)
      .filter((s) => s !== "");
    const list = files.get("web/src/pages/customers/list.tsx")!;
    const headers = [...list.matchAll(/setSortKey\("(\w+)"\)/g)].map((m) => m[1]);
    expect(accepted).toEqual(["id", "name", "tier", "joined", "active"]);
    expect(headers).toEqual(accepted);
    // …while every column still RENDERS.
    for (const col of ["Salary", "Owner Ref", "Version", "Nick", "Score"]) expect(list).toContain(`"${col}"`);
  });
});
