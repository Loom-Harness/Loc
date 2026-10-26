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

  it("turns a non-unique key or any query into a criterion read with find(C)", async () => {
    const src = `system S { subdomain M { context C {
  error OrderNotFound { code: string }
  aggregate Order with crudish { code: string  total: int  owner: string
    operation bump() { total := total + 1 } }
  criterion Big(t: int) of Order = this.total > t
  repository Orders for Order {
    // An order of an owner.
    find byOwner(o: string): Order? where this.owner == o
    find big(t: int): Order? where Big(t)
    find above(t: int): Order option where this.total > t
    find locate(c: string): Order or OrderNotFound where this.code == c
  }
  domainService Q {
    operation owns(o: string): bool { return Orders.byOwner(o) != null }
  }
  workflow w {
    create(o: string, t: int) {
      if let x = Orders.byOwner(o) { x.bump() }
      if let y = Orders.big(t) { y.bump() }
      if let z = Orders.above(t) { z.bump() }
    }
  }
}}}
`;
    const { text, report } = migrateSource(src, "m.ddd");
    expect(report).toEqual([]);
    expect(text).toContain("repository Orders for Order { }");
    expect(text).toContain(
      "  // An order of an owner.\n  criterion OrdersByOwner(o: string) of Order = this.owner == o",
    );
    // `where Big(t)` is exactly a criterion: reused, not copied.
    expect(text).not.toContain("criterion OrdersBig");
    expect(text).toContain("criterion OrdersAbove(t: int) of Order = this.total > t");
    // `T or <Error>`: a miss is T? — the same target.
    expect(text).toContain("criterion OrdersLocate(c: string) of Order = this.code == c");
    expect(text).toContain("return Orders.find(OrdersByOwner(o)) != null");
    expect(text).toContain("if let x = Orders.find(OrdersByOwner(o)) { x.bump() }");
    expect(text).toContain("if let y = Orders.find(Big(t)) { y.bump() }");
    expect(text).toContain("if let z = Orders.find(OrdersAbove(t)) { z.bump() }");
    expect(await errorCodes(text)).toEqual([]);
  });

  it("rewrites a by-id find to the built-in by-id reads", async () => {
    const src = `system S { subdomain M { context C {
  aggregate Order with crudish { total: int  operation bump() { total := total + 1 } }
  repository Orders for Order {
    find byId2(id: Order id): Order
    find maybe(oid: Order id): Order? where this.id == oid
  }
  domainService Q {
    operation has(oid: Order id): bool { return Orders.maybe(oid) != null }
  }
  workflow w { create(oid: Order id) { let o = Orders.byId2(oid)
    o.bump() } }
}}}
`;
    const { text, report } = migrateSource(src, "m.ddd");
    expect(report).toEqual([]);
    expect(text).toContain("let o = Orders.getById(oid)");
    expect(text).toContain("return Orders.findById(oid) != null");
    expect(await errorCodes(text)).toEqual([]);
  });

  it("keeps a find a call site cannot migrate, and reports why", () => {
    const src = `system S { subdomain M { context C {
  error OrderNotFound { code: string }
  aggregate Order with crudish { code: string  total: int  owner: string
    operation bump() { total := total + 1 } }
  repository Orders for Order {
    find locate(c: string): Order or OrderNotFound where this.code == c
    find latest(): Order?
    find scoped(o: string): Order? where this.owner == o ignoring *
  }
  workflow w {
    create(c: string) {
      let l = Orders.locate(c)
      match l { Order x => { x.bump() } OrderNotFound e => { } }
    }
  }
}}}
`;
    const { text, changed, report } = migrateSource(src, "m.ddd");
    expect(changed).toBe(0);
    expect(text).toBe(src);
    const byFind = (name: string) =>
      report.filter((r) => r.includes(`Orders.${name} —`)).join("\n");
    expect(byFind("locate")).toContain("matches on the error variant");
    expect(byFind("latest")).toContain("it reads an arbitrary row");
    expect(byFind("scoped")).toContain("Repo.find(<Criterion>) carries no 'ignoring'");
  });

  it("rewrites a must-exist criterion read to `if let … else { notFound }`", async () => {
    const src = `system S { subdomain M { context C {
  aggregate Order with crudish { total: int  owner: string
    operation bump() { total := total + 1 } }
  repository Orders for Order {
    find mustOwner(o: string): Order where this.owner == o
  }
  commandHandler Bump(o: string) {
    let m: Order = Orders.mustOwner(o)
    // the rest of the block moves into the then-branch
    m.bump()
  }
  workflow w {
    create(o: string) {
      let m = Orders.mustOwner(o)
    }
  }
}}}
`;
    const { text, report } = migrateSource(src, "m.ddd");
    expect(report).toEqual([]);
    expect(text).toContain("criterion OrdersMustOwner(o: string) of Order = this.owner == o");
    expect(text).toContain(`  commandHandler Bump(o: string) {
    if let m = Orders.find(OrdersMustOwner(o)) {
      // the rest of the block moves into the then-branch
      m.bump()
    } else {
      notFound
    }
  }`);
    expect(text).toContain(`      if let m = Orders.find(OrdersMustOwner(o)) {
      } else {
        notFound
      }`);
    expect(await errorCodes(text)).toEqual([]);
    expect(migrateSource(text, "m.ddd").changed).toBe(0);
  });

  it("reports a must-exist criterion read that cannot become `if let … else { notFound }`", () => {
    const src = `system S { subdomain M { context C {
  aggregate Order with crudish { total: int  owner: string }
  repository Orders for Order {
    find mustOwner(o: string): Order where this.owner == o
  }
  queryHandler Total(o: string): int {
    let m = Orders.mustOwner(o)
    return m.total
  }
  commandHandler Probe(o: string) {
    precondition Orders.mustOwner(o) != null
  }
}}}
`;
    const { changed, report } = migrateSource(src, "m.ddd");
    expect(changed).toBe(0);
    const lines = report.join("\n");
    expect(lines).toContain("is followed by a 'return'");
    expect(lines).toContain("where only a 'let' can become 'if let … else { notFound }'");
  });

  it("rewrites a let-bound T? read, and a findById `if let` source", async () => {
    // A `let` binds a `T?` read, and `findById` is an `if let` source, so
    // neither call site blocks its find any more.
    const src = `system S { subdomain M { context C {
  aggregate Customer with crudish { email: string }
  aggregate Product with crudish { sku: string  unique (sku) }
  aggregate Order with crudish { total: int
    operation bump() { total := total + 1 } }
  repository Customers for Customer { find byEmail(e: string): Customer? where this.email == e }
  repository Products for Product { find bySku(s: string): Product? where this.sku == s }
  repository Orders for Order { find maybe(oid: Order id): Order? where this.id == oid }
  workflow w {
    create(e: string, s: string, oid: Order id) {
      let c = Customers.byEmail(e)
      precondition c != null
      let p = Products.bySku(s)
      requires p == null
      let r = Orders.maybe(oid)
      if let q = Orders.maybe(oid) { q.bump() }
      if let t = r { t.bump() }
    }
  }
}}}
`;
    const { text, report } = migrateSource(src, "m.ddd");
    expect(report).toEqual([]);
    expect(text).toContain("let c = Customers.find(CustomersByEmail(e))");
    expect(text).toContain("let p = Products.findBy(sku: s)");
    expect(text).toContain("let r = Orders.findById(oid)");
    expect(text).toContain("if let q = Orders.findById(oid) { q.bump() }");
    expect(await errorCodes(text)).toEqual([]);
  });

  it("migrates a must-exist find nothing calls", () => {
    const src = `context C {
  aggregate Order { owner: string }
  repository Orders for Order { find mustOwner(o: string): Order envelope where this.owner == o }
}
`;
    const { text, report } = migrateSource(src, "m.ddd");
    expect(report).toEqual([]);
    expect(text).toContain("repository Orders for Order { }");
    expect(text).toContain("criterion OrdersMustOwner(o: string) of Order = this.owner == o");
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
