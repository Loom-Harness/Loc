// A1 pilot for the scalar-intrinsic catalogue (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/stdlib.md):
// `string.trim()` end-to-end on the Hono backend — in-memory rendering in
// domain bodies AND SQL rendering in a queryable criterion read.
// The catalogue row lives in src/util/intrinsics.ts; the TS snippet in
// render-expr.ts (TS_INTRINSIC_RENDERERS); the SQL snippet in
// repository-find-predicate.ts (DRIZZLE_INTRINSIC_SQL).

//
// The value-side arms (`this.name == q.trim()`, `toLower()` on both sides) are
// asserted at run time by `corpus/intrinsics` on every leg, MikroORM included.

import { describe, expect, it } from "vitest";
import { generateHono } from "../../_helpers/generate.js";
import { parseValid } from "../../_helpers/parse.js";

describe("typescript generator — A2 string intrinsics end-to-end", () => {
  const SRC2 = `
    context Catalog {
      aggregate Product {
        name: string
        derived slug: string = name.trim().toLower()
        derived initial: string = name.substring(0, 1).toUpper()
        derived tagCount: int = name.split(",").count
      }
      repository Products for Product { }
      criterion ProductsByNameCi(q: string) of Product = this.name.toLower() == q.toLower()
    }
  `;

  it("parses + validates cleanly and renders chained intrinsics in-memory", async () => {
    const model = await parseValid(SRC2);
    const domain = generateHono(model).get("domain/product.ts")!;
    expect(domain).toContain("this._name.trim().toLowerCase()");
    expect(domain).toContain('[...this._name].slice(0, (0) + (1)).join("").toUpperCase()');
    expect(domain).toContain('this._name.split(",").length');
  });
});

describe("typescript generator — A3 math intrinsics end-to-end", () => {
  const SRC3 = `
    context Billing {
      aggregate Invoice {
        qty: int
        amount: decimal
        price: money
        derived absQty: int = qty.abs()
        derived rounded: decimal = amount.round(2)
        derived whole: decimal = amount.floor()
        derived cappedPrice: money = price.min(price.round()).max(price.ceil().abs())
      }
      repository Invoices for Invoice { }
      criterion InvoicesPricier(m: money) of Invoice = this.price.round(2) > m
      criterion InvoicesQtyNear(n: int) of Invoice = this.qty.abs() == n.abs()
      criterion InvoicesCapped(a: decimal) of Invoice = this.amount.min(a) == a
      queryHandler ListPricier(m: money): Invoice[] {
        let r = Invoices.findAll(InvoicesPricier(m))
        return r
      }
      queryHandler ListQtyNear(n: int): Invoice[] {
        let r = Invoices.findAll(InvoicesQtyNear(n))
        return r
      }
      queryHandler ListCapped(a: decimal): Invoice[] {
        let r = Invoices.findAll(InvoicesCapped(a))
        return r
      }
    }
  `;

  it("parses + validates cleanly and renders numerics in-memory", async () => {
    const model = await parseValid(SRC3);
    const domain = generateHono(model).get("domain/invoice.ts")!;
    // int → Math.*, money → decimal.js Decimal methods.
    expect(domain).toContain("Math.abs(this._qty)");
    // A `decimal` round is decimal ARITHMETIC (RS-37): half-away-from-zero on
    // the exact value, not the float-scaled `Math.round` (which rounds the
    // binary-inexact tie 1.005 DOWN).
    expect(domain).toContain(
      "new Decimal(this._amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()",
    );
    expect(domain).toContain("Math.floor(this._amount)");
    expect(domain).toContain(".toDecimalPlaces(0, Decimal.ROUND_HALF_UP)");
    expect(domain).toContain("Decimal.min(this._price,");
    expect(domain).toContain("Decimal.max(");
    expect(domain).toContain(".ceil().abs()");
  });

  it("renders numeric intrinsics as SQL on the column side of a where", async () => {
    const model = await parseValid(SRC3);
    const repo = generateHono(model).get("db/repositories/invoice-repository.ts")!;
    expect(repo).toContain("gt(sql`round(${schema.invoices.price}, ${2})`, m)");
    // Value-side abs (param receiver) stays host JS while the column side is SQL.
    expect(repo).toContain("eq(sql`abs(${schema.invoices.qty})`, Math.abs(n))");
    // Column-side LEAST with a value arg.
    expect(repo).toContain("eq(sql`least(${schema.invoices.amount}, ${a})`, a)");
  });
});
