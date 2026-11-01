// Hono reified criteria — repository read path.  A `Repo.find(C)` /
// `Repo.findAll(C)` read narrows by the same module-level predicate function
// (`<name>Criterion`) a `retrieval` does, instead of inlining the predicate.
// A criterion composed of other criteria reifies to ONE function whose body
// inlines the composition (it does not call the parts' functions), so
// behaviour — and cross-backend wire parity — is unchanged; only the code
// organisation differs.  A criterion shared by a read and a retrieval emits
// one function.

import { describe, expect, it } from "vitest";
import { generateHono } from "../../_helpers/generate.js";
import { parseValid } from "../../_helpers/parse.js";

const SRC = `
  context Sales {
    aggregate Customer { active: bool  region: string  name: string }
    repository Customers for Customer { }
    criterion CustomersActiveInRegion(r: string) of Customer = ActiveCustomer && InRegion(r)
    criterion ActiveCustomer of Customer = active == true
    criterion InRegion(rgn: string) of Customer = region == rgn
    retrieval ByRegion(rgn: string) of Customer { where: InRegion(rgn) sort: [name asc] }
    queryHandler GetActive(): Customer {
      if let x = Customers.find(ActiveCustomer()) { return x } else { notFound "not_found" }
    }
    queryHandler GetInRegion(r: string): Customer {
      if let x = Customers.find(InRegion(r)) { return x } else { notFound "not_found" }
    }
    queryHandler ListActiveInRegion(r: string): Customer[] {
      let x = Customers.findAll(CustomersActiveInRegion(r))
      return x
    }
  }
`;

describe("typescript generator — reified criteria (repository reads)", () => {
  it("a single-criterion read calls the reified predicate fn", async () => {
    const model = await parseValid(SRC);
    const repo = generateHono(model).get("db/repositories/customer-repository.ts")!;

    // Parameterless + parameterised criterion reads reify.
    expect(repo).toMatch(
      /async runFindAllByActiveCustomer\([\s\S]*?\.where\(activeCustomerCriterion\(\)\)/,
    );
    expect(repo).toMatch(
      /async runFindAllByInRegion\(rgn: string[\s\S]*?\.where\(inRegionCriterion\(rgn\)\)/,
    );

    // A composed criterion reifies to one fn that inlines its parts.
    expect(repo).toContain(
      "const customersActiveInRegionCriterion = (r: string) => and(eq(schema.customers.active, true), eq(schema.customers.region, r));",
    );
    expect(repo).toMatch(
      /async runFindAllByCustomersActiveInRegion\(r: string[\s\S]*?\.where\(customersActiveInRegionCriterion\(r\)\)/,
    );
  });

  it("a criterion shared by a read and a retrieval emits exactly one fn", async () => {
    const model = await parseValid(SRC);
    const repo = generateHono(model).get("db/repositories/customer-repository.ts")!;
    // `InRegion` is read by `GetInRegion` and retrieval `ByRegion` — one fn.
    const decls = repo.match(/const inRegionCriterion = /g) ?? [];
    expect(decls.length).toBe(1);
    expect(repo).toMatch(/async runByRegion\(rgn: string[\s\S]*?\.where\(inRegionCriterion\(rgn\)\)/);
  });
});
