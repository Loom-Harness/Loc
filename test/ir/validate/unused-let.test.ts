import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { allContexts } from "../../../src/ir/types/loom-ir.js";
import type { LoomDiagnostic } from "../../../src/ir/validate/checks/diagnostic.js";
import {
  type UnusedLetExclusions,
  validateUnusedLets,
} from "../../../src/ir/validate/checks/unused-let-checks.js";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { loadExampleModel } from "../../_helpers/examples.js";
import { parseString } from "../../_helpers/parse.js";

// `loom.unused-let` (owner ruling on #3517): an unread `let` in a workflow /
// handler / domain-service body warns, except a `get` / `getBy` read (it
// raises not-found on a miss — an existence check) and a binding the body
// saves.  An unread `find` / `findBy` / `all` read does nothing, so it warns.

const model = (body: string) => `
system S {
  subdomain Sd { context C {
    aggregate Customer with crudish { email: string  unique (email) }
    aggregate Order with crudish { customerId: Customer id  code: string
      operation place() { code := "placed" }
    }
    repository Customers for Customer { }
    repository Orders for Order { }
    criterion ByCode(c: string) of Order = this.code == c
    ${body}
  } }
}`;

async function unusedLets(body: string): Promise<string[]> {
  const { model: m } = await parseString(model(body));
  return validateLoomModel(enrichLoomModel(lowerModel(m)))
    .filter((d) => d.code === "loom.unused-let")
    .map((d) => d.message);
}

describe("loom.unused-let", () => {
  it("warns on an unread `find` (by id)", async () => {
    const w = await unusedLets(`commandHandler H(c: Customer id) { let x = Customers.find(c) }`);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("'let x' in commandHandler H is never read");
  });

  it("warns on an unread `findBy`", async () => {
    const w = await unusedLets(
      `commandHandler H(e: string) { let x = Customers.findBy(email: e) }`,
    );
    expect(w).toHaveLength(1);
  });

  it("warns on an unread `find(<Criterion>)` and an unread `all`", async () => {
    const w = await unusedLets(
      `commandHandler H(c: string) { let x = Orders.find(ByCode(c))  let ys = Orders.all(ByCode(c), page: { limit: 5 }) }`,
    );
    expect(w).toHaveLength(2);
  });

  it("warns on an unread expression binding", async () => {
    const w = await unusedLets(`commandHandler H(c: string) { let n = c.length }`);
    expect(w).toHaveLength(1);
  });

  it("does not warn on an unread `get` / `getBy` (an existence check)", async () => {
    expect(
      await unusedLets(
        `commandHandler H(c: Customer id, e: string) { let x = Customers.get(c)  let y = Customers.getBy(email: e) }`,
      ),
    ).toEqual([]);
  });

  it("does not warn on a created binding the body saves at exit", async () => {
    expect(
      await unusedLets(
        `workflow w { create(c: Customer id) { let o = Order.create(customerId: c, code: "x") } }`,
      ),
    ).toEqual([]);
  });

  it("does not warn on a binding an operation call mutates, or one read in a nested branch", async () => {
    expect(
      await unusedLets(
        `commandHandler H(c: string, d: string) {
          let o = Orders.find(ByCode(c))
          if let p = Orders.find(ByCode(d)) { p.place() }
          if let q = o { q.place() }
        }`,
      ),
    ).toEqual([]);
  });

  it("warns in a domain-service operation body", async () => {
    const w = await unusedLets(
      `domainService Pricing { operation total(c: string): int { let n = c.length  return 1 } }`,
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("domainService Pricing.total");
  });
});

// Each exclusion is load-bearing on a shipped model: examples/sales.ddd's
// `placeOrder` reads `let customer = Customers.get(customerId)` only to check
// the customer exists, and creates `let order = Order.create(…)` only to save
// it.  Turning either exclusion off makes that example warn.
describe("loom.unused-let — each ruled exclusion keeps a shipped example clean", () => {
  async function run(ex: UnusedLetExclusions): Promise<string[]> {
    const loom = enrichLoomModel(lowerModel(await loadExampleModel("examples/sales.ddd")));
    const diags: LoomDiagnostic[] = [];
    for (const ctx of allContexts(loom)) validateUnusedLets(ctx, diags, ex);
    return diags.map((d) => d.message);
  }

  it("the ruled gate is silent on examples/sales.ddd", async () => {
    expect(await run({ existenceReads: true, saves: true })).toEqual([]);
  });

  it("without the existence-read exclusion, the `get` binding warns", async () => {
    const w = await run({ existenceReads: false, saves: true });
    expect(w).toEqual([expect.stringContaining("'let customer' in workflow placeOrder create")]);
  });

  it("without the save exclusion, the created binding warns", async () => {
    const w = await run({ existenceReads: true, saves: false });
    expect(w).toEqual([expect.stringContaining("'let order' in workflow placeOrder create")]);
  });
});
