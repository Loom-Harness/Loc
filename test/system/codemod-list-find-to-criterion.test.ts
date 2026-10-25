// The list-find removal codemod (`scripts/codemod-list-find-to-criterion.mjs`,
// D-LIST-FIND-REMOVED): each list `find` becomes a criterion beside its
// repository, each call site reads through `run`, and the migrated model
// validates clean of `loom.repository-find-deprecated`.

import { describe, expect, it } from "vitest";
import { migrateSource, migrateSources } from "../../scripts/codemod-list-find-to-criterion.mjs";
import { parseString } from "../_helpers/parse.js";

const SRC = `context Sales {
  enum Status { Draft, Placed }
  aggregate Order { customerId: string  status: Status  region: string }
  repository Orders for Order {
    find byId2(id: Order id): Order? where this.id == id
    // Orders a customer placed.
    find byCustomer(customerId: string): Order[]
    find inRegion(r: string): Order paged
      where this.region == r && this.status == Placed
  }
  domainService Reports {
    operation count(r: string): int { return Orders.inRegion(r).count }
  }
}
`;

describe("codemod-list-find-to-criterion", () => {
  it("rewrites each list find to a criterion and its call sites to run", () => {
    const { text, changed } = migrateSource(SRC);
    expect(changed).toBeGreaterThan(0);
    // The single-row find stays; the list finds are gone from the repository.
    expect(text).toContain("find byId2(id: Order id): Order? where this.id == id");
    expect(text).not.toContain("find byCustomer");
    expect(text).not.toContain("find inRegion");
    // The filterless find spells out the parameter-name convention; the
    // comment above it moves with it.
    expect(text).toContain(
      "  // Orders a customer placed.\n  criterion OrdersByCustomer(customerId: string) of Order = this.customerId == customerId",
    );
    expect(text).toContain(
      "criterion OrdersInRegion(r: string) of Order = this.region == r && this.status == Placed",
    );
    expect(text).toContain("return Orders.run(OrdersInRegion(r)).count");
  });

  it("is idempotent", () => {
    const once = migrateSource(SRC).text;
    const twice = migrateSource(once);
    expect(twice.changed).toBe(0);
    expect(twice.text).toBe(once);
  });

  it("leaves `find all` alone and reports what it cannot migrate", () => {
    const src = `context C {
  aggregate T { n: string }
  repository Ts for T {
    find all(): T[]
    find named(): T[] where this.n == "a"
    find everything(): T[]
  }
}
`;
    const { text, report } = migrateSource(src);
    expect(text).toContain("find all(): T[]");
    expect(text).toContain('criterion TsNamed of T = this.n == "a"');
    // A filterless find with no field-named parameter read every row: there is
    // no criterion to write, so it stays and is reported.
    expect(text).toContain("find everything(): T[]");
    expect(report.some((r) => r.includes("Ts.everything") && r.includes("every row"))).toBe(true);
  });

  it("resolves a call site in another .ddd file of the same run", () => {
    const { results } = migrateSources([
      {
        file: "a.ddd",
        text: `context C {
  aggregate T { n: string }
  repository Ts for T { find named(n: string): T[] }
}
`,
      },
      {
        file: "b.ddd",
        text: `context D {
  domainService S { operation k(n: string): int { return Ts.named(n).count } }
}
`,
      },
    ]);
    expect(results[1]!.text).toContain("Ts.run(TsNamed(n)).count");
  });

  it("migrates ```ddd fences in markdown and leaves prose alone", () => {
    const md =
      "Prose mentions find x(): T[] here.\n\n```ddd\ncontext C {\n  aggregate T { n: string }\n  repository Ts for T { find named(n: string): T[] }\n}\n```\n";
    const { text } = migrateSource(md, "doc.md");
    expect(text).toContain("Prose mentions find x(): T[] here.");
    expect(text).toContain("criterion TsNamed(n: string) of T = this.n == n");
  });

  it("turns a parameterless, filterless list find into `find all`, reads included", () => {
    const src = `context C {
  aggregate T { n: string }
  repository Ts for T { find recent(): T paged }
  domainService S { operation k(): int { return Ts.recent().count } }
}
`;
    const { text } = migrateSource(src);
    expect(text).toContain("repository Ts for T { find all(): T paged }");
    expect(text).toContain("return Ts.all().count");
  });

  it("keeps a route a test e2e reads: a routed handler on the same path", async () => {
    const src = `system S {
  subdomain Sales {
    context Shop {
      aggregate Order with crudish { code: string  region: string }
      repository Orders for Order {
        find inRegion(region: string): Order[] where this.region == region
      }
    }
  }
  user { id: string  role: string }
  api A from Sales
  storage pg { type: postgres }
  resource s { for: Shop, kind: state, use: pg }
  deployable d { platform: node  contexts: [Shop]  dataSources: [s]  serves: A  port: 3000 }
  test e2e "reads" against d {
    let rows = api.orders.inRegion({ region: "EU" })
    expect(rows.length).toBe(0)
  }
}
`;
    const { text } = migrateSource(src);
    expect(text).toContain(
      "criterion OrdersInRegion(region: string) of Order = this.region == region",
    );
    expect(text).toContain(
      [
        "queryHandler ListOrdersInRegion(region: string): Order[] {",
        "        let r = Orders.run(OrdersInRegion(region))",
        "        return r",
        "      }",
      ].join("\n"),
    );
    expect(text).toContain('route GET "/orders/in_region/{region}" -> Shop.ListOrdersInRegion');
    expect(text).toContain('let rows = api.shop.listOrdersInRegion("EU")');
    const { diagnostics } = await parseString(text);
    expect(diagnostics.filter((d) => d.severity === 1)).toEqual([]);
  });

  it("produces a model with no loom.repository-find-deprecated", async () => {
    const { text } = migrateSource(SRC);
    const { diagnostics } = await parseString(text);
    expect(diagnostics.map((d) => d.code)).not.toContain("loom.repository-find-deprecated");
    const before = await parseString(SRC);
    expect(before.diagnostics.map((d) => d.code)).toContain("loom.repository-find-deprecated");
  });
});
