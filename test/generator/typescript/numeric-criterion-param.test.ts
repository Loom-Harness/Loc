// A money / decimal value bound against a numeric column in a node (drizzle)
// predicate.  Drizzle types a `numeric()` column — every money and decimal
// field — as `string`, while the runtime value is a `Decimal` (money) or a
// `number` (decimal), so binding a criterion PARAM bare
//
//     const bigOrderCriterion = (min: Decimal) => gte(schema.orders.total, min);
//
// failed the generated project's `tsc` (TS2769 "No overload matches this
// call").  The value binds as its string form, as a money literal already did.
// The same predicate renderer serves criteria, retrieval `where`s and the TPH
// subtype reads, so the subtype fixture pins the shared seam's other caller.

import { beforeAll, describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system Market {
  subdomain Commerce { context Store {
    aggregate Order with crudish { ref: string  total: money  amt: decimal  cap: decimal? }
    repository Orders for Order { }
    criterion BigOrder(min: money) of Order = this.total >= min
    criterion BigAmt(min: decimal) of Order = this.amt >= min
    criterion CapAbove(min: decimal?) of Order = this.cap > min
    criterion AmtOverLiteral of Order = this.amt > 2.5
    queryHandler ListBig(min: money): Order paged { let r = Orders.all(BigOrder(min))  return r }
    queryHandler ListBigAmt(min: decimal): Order[] { let r = Orders.all(BigAmt(min))  return r }
    queryHandler ListCap(min: decimal?): Order[] { let r = Orders.all(CapAbove(min))  return r }
    queryHandler ListLit(): Order[] { let r = Orders.all(AmtOverLiteral)  return r }

    abstract aggregate Account { owner: string }
    aggregate Savings extends Account { balance: money  rate: decimal }
    repository SavingsAccounts for Savings { }
    criterion RichSavings(floor: money, minRate: decimal) of Savings = this.balance >= floor && this.rate >= minRate
    queryHandler ListRich(floor: money, minRate: decimal): Savings paged { let r = SavingsAccounts.all(RichSavings(floor, minRate))  return r }
  }}
  api StoreApi from Commerce {
    route GET "/big" -> Store.ListBig
    route GET "/big-amt" -> Store.ListBigAmt
    route GET "/cap" -> Store.ListCap
    route GET "/lit" -> Store.ListLit
    route GET "/rich" -> Store.ListRich
  }
  storage primary { type: postgres }
  resource storeState { for: Store, kind: state, use: primary }
  deployable api { platform: node, contexts: [Store], dataSources: [storeState], serves: StoreApi, port: 3000 }
}
`;

let files: Map<string, string>;
beforeAll(async () => {
  files = await generateSystemFiles(SRC);
}, 120_000);

function repo(name: string): string {
  const content = files.get(`api/db/repositories/${name}-repository.ts`);
  if (content === undefined) {
    const repos = [...files.keys()].filter((k) => k.includes("/repositories/"));
    throw new Error(`no ${name} repository; got:\n${repos.join("\n")}`);
  }
  return content;
}

describe("node: a money / decimal value binds against a numeric column as a string", () => {
  it("binds a money and a decimal criterion param through String()", () => {
    const order = repo("order");
    expect(order).toContain("(min: Decimal) => gte(schema.orders.total, String(min))");
    expect(order).toContain("(min: number) => gte(schema.orders.amt, String(min))");
  });

  it("keeps the null branch of an optional decimal param and binds the value as a string", () => {
    expect(repo("order")).toContain(": gt(schema.orders.cap, String(min)))");
  });

  it("quotes a decimal literal", () => {
    expect(repo("order")).toContain('gt(schema.orders.amt, "2.5")');
  });

  it("binds a TPH subtype's money / decimal params the same way", () => {
    const all = [...files.entries()]
      .filter(([k]) => k.startsWith("api/db/repositories/"))
      .map(([, v]) => v)
      .join("\n");
    expect(all).toMatch(/gte\(schema\.\w+\.balance, String\(floor\)\)/);
    expect(all).toMatch(/gte\(schema\.\w+\.rate, String\(minRate\)\)/);
    expect(all).not.toMatch(/gte\(schema\.\w+\.balance, floor\)/);
  });
});
