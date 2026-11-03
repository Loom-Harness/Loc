// Generator coverage for `criterion`: a criterion composed of other criteria
// (`ActiveCustomer && InRegion(r)`) flows through the existing where→Drizzle
// path, producing the same query the equivalent inline predicate does — no
// per-backend query-engine change is needed.

import { describe, expect, it } from "vitest";
import { generateBackendFiles } from "../../_helpers/generate.js";

const SRC = `
  context Sales {
    aggregate Customer { active: bool  region: string }
    repository Customers for Customer { }
    criterion CustomersInRegionViaCriterion(r: string) of Customer = ActiveCustomer && InRegion(r)
    criterion CustomersInRegionInline(r: string) of Customer = active == true && region == r
    criterion ActiveCustomer of Customer = active == true
    criterion InRegion(rgn: string) of Customer = region == rgn
    queryHandler ListViaCriterion(r: string): Customer[] {
      let x = Customers.all(CustomersInRegionViaCriterion(r))
      return x
    }
    queryHandler ListInline(r: string): Customer[] {
      let x = Customers.all(CustomersInRegionInline(r))
      return x
    }
  }
`;

describe("typescript generator — criterion", () => {
  it("lowers a criterion-composed read to the same Drizzle where as the inline one", async () => {
    const files = await generateBackendFiles(SRC, "node");
    const repo = files.get("db/repositories/customer-repository.ts")!;
    const expected = "and(eq(schema.customers.active, true), eq(schema.customers.region, r))";
    // Both the composed and the inline criterion reify to the same predicate…
    expect(repo).toContain(
      `const customersInRegionViaCriterionCriterion = (r: string) => ${expected};`,
    );
    expect(repo).toContain(`const customersInRegionInlineCriterion = (r: string) => ${expected};`);
    // …and each read narrows by its own.
    expect(repo).toMatch(
      /async runFindAllByCustomersInRegionViaCriterion\(r: string[\s\S]*?\.where\(customersInRegionViaCriterionCriterion\(r\)\)/,
    );
    expect(repo).toMatch(
      /async runFindAllByCustomersInRegionInline\(r: string[\s\S]*?\.where\(customersInRegionInlineCriterion\(r\)\)/,
    );
    // No unresolved-name fallout reached the emitter.
    expect(repo).not.toMatch(/TODO: translate where-clause/);
  });
});
