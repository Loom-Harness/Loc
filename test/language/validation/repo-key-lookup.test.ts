// Natural-key reads (D-REPO-KEY-LOOKUP) — `Repo.getBy(<col>: v, …)` /
// `Repo.findBy(…)` must name exactly one declared `unique (…)` tuple.
//
//   loom.repo-key-not-unique  — no declared tuple covers the names (with a
//                               did-you-mean over the declared tuples);
//   loom.repo-key-incomplete  — part of a tuple, or a positional argument.
//
// The positives carry as much weight as the negatives: argument order is free,
// an inherited key counts, and `ignoring` is accepted on both binding forms.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

const model = (body: string, agg = "unique (sku)  unique (region, name)") => `
  system S { subdomain M { context C {
    aggregate Product with crudish, softDeletable {
      sku: string  name: string  region: string  price: int
      ${agg}
      operation reprice(to: int) { price := to }
    }
    repository Products for Product { }
    workflow w {
      create(s: string, n: string, r: string) {
        ${body}
      }
    }
  }}}`;

async function errors(src: string) {
  const { diagnostics } = await parseString(src, { validate: true });
  return diagnostics
    .filter((d) => d.severity === 1)
    .map((d) => ({ code: String(d.code ?? ""), message: d.message }))
    .filter(
      (d) => d.code.startsWith("loom.repo-key") || d.code === "loom.ignoring-clause-placement",
    );
}

describe("natural-key reads — accepted", () => {
  it("a single-column tuple", async () => {
    expect(await errors(model("let p = Products.getBy(sku: s)\np.reprice(1)"))).toEqual([]);
  });

  it("a composite tuple, in either argument order", async () => {
    expect(
      await errors(
        model(`let p = Products.getBy(region: r, name: n)
        p.reprice(1)
        let q = Products.getBy(name: n, region: r)
        q.reprice(2)`),
      ),
    ).toEqual([]);
  });

  it("findBy as an `if let` source, with `ignoring`", async () => {
    expect(
      await errors(
        model("if let p = Products.findBy(sku: s) ignoring softDeletable { p.reprice(1) }"),
      ),
    ).toEqual([]);
  });

  it("getBy bound by a `let`, with `ignoring *`", async () => {
    expect(await errors(model("let p = Products.getBy(sku: s) ignoring *\np.reprice(1)"))).toEqual(
      [],
    );
  });

  it("a key the aggregate inherits from its base", async () => {
    const src = `
      system S { subdomain M { context C {
        abstract aggregate Item { sku: string  unique (sku) }
        aggregate Book extends Item with crudish { title: string  operation retitle(t: string) { title := t } }
        repository Books for Book { }
        workflow w { create(s: string) { let b = Books.getBy(sku: s)
          b.retitle("x") } }
      }}}`;
    expect(await errors(src)).toEqual([]);
  });
});

describe("ignoring on a loop iterable", () => {
  it("parses (the rule is shared with `if let`) but is refused there", async () => {
    const src = model("for y in Products.findAll(Cheap) ignoring * { y.reprice(2) }").replace(
      "repository Products for Product { }",
      "repository Products for Product { }\n    criterion Cheap of Product = price < 10",
    );
    const d = await errors(src);
    expect(d.map((x) => x.code)).toContain("loom.ignoring-clause-placement");
  });
});

describe("loom.repo-key-not-unique", () => {
  it("names a column no tuple covers, and suggests the closest tuple", async () => {
    const d = await errors(model("let p = Products.getBy(skew: s)\np.reprice(1)"));
    expect(d.map((x) => x.code)).toEqual(["loom.repo-key-not-unique"]);
    expect(d[0]!.message).toContain("(skew) is not a declared unique key of 'Product'");
    expect(d[0]!.message).toContain("Its unique keys are (sku), (region, name).");
    expect(d[0]!.message).toContain("Did you mean 'Products.getBy(sku: …)'?");
  });

  it("suggests the tuple sharing the most columns", async () => {
    const d = await errors(model("if let p = Products.findBy(name: n, price: 1) { p.reprice(1) }"));
    expect(d.map((x) => x.code)).toEqual(["loom.repo-key-not-unique"]);
    expect(d[0]!.message).toContain("Did you mean 'Products.findBy(region: …, name: …)'?");
  });

  it("says so when the aggregate declares no key at all", async () => {
    const d = await errors(model("let p = Products.getBy(sku: s)\np.reprice(1)", ""));
    expect(d.map((x) => x.code)).toEqual(["loom.repo-key-not-unique"]);
    expect(d[0]!.message).toContain("'Product' declares no 'unique (…)' key.");
  });
});

describe("loom.repo-key-incomplete", () => {
  it("names the missing column of a partial tuple", async () => {
    const d = await errors(model("let p = Products.getBy(name: n)\np.reprice(1)"));
    expect(d.map((x) => x.code)).toEqual(["loom.repo-key-incomplete"]);
    expect(d[0]!.message).toContain("names part of the unique key (region, name)");
    expect(d[0]!.message).toContain("but not 'region'");
  });

  it("refuses a positional argument", async () => {
    const d = await errors(model("let p = Products.getBy(s)\np.reprice(1)"));
    expect(d.map((x) => x.code)).toEqual(["loom.repo-key-incomplete"]);
    expect(d[0]!.message).toContain("takes NAMED arguments");
  });
});
