// The natural-key codemod (`scripts/codemod-find-to-findby.mjs`,
// D-REPO-KEY-LOOKUP): a single-row find over a declared `unique (…)` tuple is
// deleted and its call sites read through `findBy` / `getBy`; everything it
// cannot map is reported, and the migrated model validates.

import { describe, expect, it } from "vitest";
import { migrateSource } from "../../scripts/codemod-find-to-findby.mjs";
import { parseString } from "../_helpers/parse.js";

const SRC = `system S { subdomain M { context C {
  aggregate Product with crudish, softDeletable {
    sku: string  name: string  region: string  price: int
    unique (sku)
    unique (region, name)
    operation reprice(to: int) { price := to }
  }
  repository Products for Product {
    // Looks a product up by its SKU.
    find bySku(s: string): Product? where this.sku == s
    find mustSku(s: string): Product envelope where s == this.sku
    find listing(n: string, r: string): Product where name == n && this.region == r
    find maybeListing(region: string, name: string): Product option ignoring softDeletable
  }
  domainService Q {
    operation taken(s: string): bool { return Products.bySku(s) != null }
  }
  workflow w {
    create(s: string, n: string, r: string) {
      let a = Products.mustSku(s)
      a.reprice(1)
      let b = Products.listing(n, r)
      b.reprice(2)
      if let c = Products.maybeListing(r, n) { c.reprice(3) }
      if let d = Products.bySku(s) { d.reprice(4) }
    }
  }
}}}
`;

async function errorCodes(src: string): Promise<string[]> {
  const { diagnostics } = await parseString(src, { validate: true });
  return diagnostics.filter((d) => d.severity === 1).map((d) => String(d.code ?? d.message));
}

describe("codemod-find-to-findby", () => {
  it("deletes each key-lookup find and rewrites its call sites", async () => {
    const { text, changed, report } = migrateSource(SRC);
    expect(report).toEqual([]);
    expect(changed).toBeGreaterThan(0);
    expect(text).toContain("repository Products for Product { }");
    expect(text).not.toContain("Looks a product up");
    // `T?` → findBy, `T envelope` → getBy, `T` → getBy, `T option` → findBy.
    expect(text).toContain("return Products.findBy(sku: s) != null");
    expect(text).toContain("let a = Products.getBy(sku: s)");
    // Arguments map to columns by the find's parameter → field binding.
    expect(text).toContain("let b = Products.getBy(name: n, region: r)");
    // A clause-less find binds its params by name; `ignoring` moves to the call.
    expect(text).toContain(
      "if let c = Products.findBy(region: r, name: n) ignoring softDeletable { c.reprice(3) }",
    );
    expect(text).toContain("if let d = Products.findBy(sku: s) { d.reprice(4) }");
    expect(await errorCodes(text)).toEqual([]);
  });

  it("is idempotent", () => {
    const once = migrateSource(SRC).text;
    const twice = migrateSource(once);
    expect(twice.changed).toBe(0);
    expect(twice.text).toBe(once);
  });

  it("reports what it cannot map, and leaves it in place", () => {
    const src = `system S { subdomain M { context C {
  error OrderNotFound { code: string }
  aggregate Order with crudish { code: string  total: int  owner: string }
  repository Orders for Order {
    find locate(c: string): Order or OrderNotFound where this.code == c
    find byOwner(o: string): Order? where this.owner == o
    find big(t: int): Order? where this.total > t
    find byId2(id: Order id): Order?
    find latest(): Order?
  }
}}}
`;
    const { text, changed, report } = migrateSource(src, "m.ddd");
    expect(changed).toBe(0);
    expect(text).toBe(src);
    const byFind = (name: string) => report.filter((r) => r.includes(`Orders.${name} —`));
    expect(byFind("locate")[0]).toContain("returns a declared error: dropped (2026-10-25 ruling");
    expect(byFind("byOwner")[0]).toContain(
      "its key (owner) is not a declared unique key of 'Order'; declare 'unique (owner)'",
    );
    expect(byFind("big")[0]).toContain("is not an equality conjunction over fields");
    expect(byFind("byId2")[0]).toContain("a by-id find: read it with findById(id)");
    expect(byFind("latest")[0]).toContain("parameters bind no key");
  });

  it("with --add-unique, declares the key and migrates", async () => {
    const src = `system S { subdomain M { context C {
  aggregate Order with crudish {
    owner: string
    total: int
    operation bump() { total := total + 1 }
  }
  repository Orders for Order {
    find byOwner(o: string): Order where this.owner == o
  }
  workflow w { create(o: string) { let x = Orders.byOwner(o)
    x.bump() } }
}}}
`;
    const { text, report } = migrateSource(src, "m.ddd", { addUnique: true });
    expect(report).toEqual([]);
    expect(text).toContain("    operation bump() { total := total + 1 }\n    unique (owner)\n  }");
    expect(text).toContain("let x = Orders.getBy(owner: o)");
    expect(await errorCodes(text)).toEqual([]);
  });

  it("keeps a find whose route a client reads", () => {
    const src = `system S {
  subdomain M { context C {
    aggregate Order with crudish { code: string  unique (code) }
    repository Orders for Order { find byCode(c: string): Order? where this.code == c }
  } }
  api A from M
  deployable api { platform: node, contexts: [C], serves: A, port: 3000 }
  test e2e "reads" against api {
    let o = api.orders.byCode({ c: "x" })
  }
}
`;
    const { changed, report } = migrateSource(src, "m.ddd");
    expect(changed).toBe(0);
    expect(report.join("\n")).toContain("reads its route, which goes with the declaration");
  });
});
