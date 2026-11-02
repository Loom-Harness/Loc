// A1 pilot for the scalar-intrinsic catalogue (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/stdlib.md):
// `string.trim()` end-to-end on the Elixir/Phoenix (vanilla Ecto) backend —
// in-memory rendering in domain-evaluated bodies AND SQL-fragment rendering in
// a queryable position (a `criterion` predicate, run as its retrieval).  The catalogue row lives in
// src/util/intrinsics.ts; the in-memory snippet in render-expr.ts
// (ELIXIR_INTRINSIC_RENDERERS → `String.trim(...)`); the Ecto where-fragment in
// the same file (ECTO_INTRINSIC_FRAGMENTS → `fragment("btrim(?)", ...)`).
// The Elixir sibling of test/generator/typescript/intrinsic-trim.test.ts.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { parseString } from "../../_helpers/parse.js";

function fileEndingWith(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key!)!;
}

/** Every criterion retrieval module the system emits, concatenated — the
 *  queryable position each `criterion` predicate lowers into. */
function retrievals(files: Map<string, string>): string {
  const out = [...files].filter(([k]) => k.includes("/retrievals/")).map(([, v]) => v);
  expect(out.length, "no retrieval module emitted").toBeGreaterThan(0);
  return out.join("\n");
}

describe("elixir generator — string.trim() intrinsic (stdlib A1 pilot)", () => {
  it("renders a value-side trim (param receiver) as a fragment over the pinned param", async () => {
    const files = await generateSystemFiles(`
      system Shop {
        subdomain Core {
          context Catalog {
            aggregate Product with crudish { name: string }
            repository Products for Product { }
            criterion ProductsByName(q: string) of Product = this.name == q.trim()
            queryHandler ListProductsByName(q: string): Product[] {
              let r = Products.run(ProductsByName(q))
              return r
            }
          }
        }
        api CatalogApi from Core
        storage pg { type: postgres }
        resource st { for: Catalog, kind: state, use: pg }
        deployable api {
          platform: elixir
          contexts: [Catalog]
          dataSources: [st]
          serves: CatalogApi
          port: 4000
        }
      }
    `);
    // Inside an Ecto `where:` the value side is still query territory — a
    // `String.trim(^q)` call would be invalid there, so the fragment form
    // applies to a pinned param receiver too.
    const repo = retrievals(files);
    expect(repo).toContain('record.name == fragment("btrim(?)", ^q)');
  });
});

// A2 string batch — chained intrinsics in-memory + the queryable toLower in a
// criterion predicate (SQL lower() fragment).
const A2_SRC = `
system Shop {
  subdomain Core {
    context Catalog {
      aggregate Product with crudish {
        name: string
        derived slug: string = name.trim().toLower()
      }
      repository Products for Product { }
      criterion ProductsByNameCi(q: string) of Product = this.name.toLower() == q
      queryHandler ListProductsByNameCi(q: string): Product[] {
        let r = Products.run(ProductsByNameCi(q))
        return r
      }
    }
  }
  api CatalogApi from Core
  storage pg { type: postgres }
  resource st { for: Catalog, kind: state, use: pg }
  deployable api {
    platform: elixir
    contexts: [Catalog]
    dataSources: [st]
    serves: CatalogApi
    port: 4000
  }
}
`;

describe("elixir generator — string intrinsics batch (stdlib A2)", () => {
  it("parses + validates cleanly", async () => {
    const { errors } = await parseString(A2_SRC);
    expect(errors).toEqual([]);
  });
});

// A3 math batch — abs/min/max on int/long/decimal/money + round/floor/ceil on
// decimal/money.  int/long are native integers (Kernel abs/min/max); decimal
// AND money both map to the Decimal struct, so their arms go through
// Decimal.* — `:half_up` IS half-away-from-zero (verified against decimal
// 3.1.1, the version ecto_sql resolves).  In queryable positions everything
// renders as a SQL fragment (Kernel `abs/1` etc. are not Ecto query exprs).
const A3_SRC = `
system Shop {
  subdomain Core {
    context Catalog {
      aggregate Product with crudish {
        qty: int
        rate: decimal
        amount: money
        derived absQty: int = qty.abs()
        derived qtyFloor: int = qty.max(0)
        derived qtyCap: int = qty.min(100)
        derived absAmount: money = amount.abs()
        derived rateRounded: decimal = rate.round(2)
        derived rateWhole: decimal = rate.round()
        derived amountDown: money = amount.floor()
        derived rateUp: decimal = rate.ceil()
        derived amountLo: money = amount.min(amount)
      }
      repository Products for Product { }
      criterion ProductsByRoundedRate(q: decimal) of Product = this.rate.round(2) == q
      queryHandler ListProductsByRoundedRate(q: decimal): Product[] {
        let r = Products.run(ProductsByRoundedRate(q))
        return r
      }
      criterion ProductsByWholeRate(q: decimal) of Product = this.rate.round() == q
      queryHandler ListProductsByWholeRate(q: decimal): Product[] {
        let r = Products.run(ProductsByWholeRate(q))
        return r
      }
      criterion ProductsByAbsQty(q: int) of Product = this.qty.abs() == q
      queryHandler ListProductsByAbsQty(q: int): Product[] {
        let r = Products.run(ProductsByAbsQty(q))
        return r
      }
      criterion ProductsByMinCap(cap: money) of Product = this.amount.min(cap) == cap
      queryHandler ListProductsByMinCap(cap: money): Product[] {
        let r = Products.run(ProductsByMinCap(cap))
        return r
      }
      criterion ProductsByMaxQty(q: int) of Product = this.qty.max(q) == q
      queryHandler ListProductsByMaxQty(q: int): Product[] {
        let r = Products.run(ProductsByMaxQty(q))
        return r
      }
      criterion ProductsByFloorAmount(q: money) of Product = this.amount.floor() == q
      queryHandler ListProductsByFloorAmount(q: money): Product[] {
        let r = Products.run(ProductsByFloorAmount(q))
        return r
      }
      criterion ProductsByCeilRate(q: decimal) of Product = this.rate.ceil() == q
      queryHandler ListProductsByCeilRate(q: decimal): Product[] {
        let r = Products.run(ProductsByCeilRate(q))
        return r
      }
    }
  }
  api CatalogApi from Core
  storage pg { type: postgres }
  resource st { for: Catalog, kind: state, use: pg }
  deployable api {
    platform: elixir
    contexts: [Catalog]
    dataSources: [st]
    serves: CatalogApi
    port: 4000
  }
}
`;

describe("elixir generator — numeric intrinsics batch (stdlib A3)", () => {
  it("parses + validates cleanly", async () => {
    const { errors } = await parseString(A3_SRC);
    expect(errors).toEqual([]);
  });

  it("renders round in-memory via Decimal.round/:half_up — with and without places", async () => {
    const files = await generateSystemFiles(A3_SRC);
    const ctrl = fileEndingWith(files, "/controllers/product_controller.ex");
    expect(ctrl).toContain(
      '"rateRounded" => __decimal_num(Decimal.round(record.rate, 2, :half_up))',
    );
    // Omitted places defaults to 0 (whole-value commercial rounding).
    expect(ctrl).toContain('"rateWhole" => __decimal_num(Decimal.round(record.rate, 0, :half_up))');
    // Never the invalid method-call fallthrough.
    expect(ctrl).not.toContain(".round()");
  });

  it("renders abs in-memory — Decimal.abs on money, Kernel abs on int", async () => {
    const files = await generateSystemFiles(A3_SRC);
    const ctrl = fileEndingWith(files, "/controllers/product_controller.ex");
    // A money-typed derived is pinned to the fixed wire scale (RS-12).
    expect(ctrl).toContain('"absAmount" => __money_round(Decimal.abs(record.amount))');
    expect(ctrl).toContain('"absQty" => abs(record.qty)');
  });

  it("renders min/max in-memory — Kernel min/max on int, Decimal.min on money", async () => {
    const files = await generateSystemFiles(A3_SRC);
    const ctrl = fileEndingWith(files, "/controllers/product_controller.ex");
    expect(ctrl).toContain('"qtyCap" => min(record.qty, 100)');
    expect(ctrl).toContain('"qtyFloor" => max(record.qty, 0)');
    expect(ctrl).toContain(
      '"amountLo" => __money_round(Decimal.min(record.amount, record.amount))',
    );
  });

  it("renders floor/ceil in-memory via Decimal.round modes (receiver-typed whole values)", async () => {
    const files = await generateSystemFiles(A3_SRC);
    const ctrl = fileEndingWith(files, "/controllers/product_controller.ex");
    expect(ctrl).toContain(
      '"amountDown" => __money_round(Decimal.round(record.amount, 0, :floor))',
    );
    // `rateUp` is a `decimal` derived — not money, so it is NOT scale-pinned;
    // it IS number-coerced (RS-24), because Jason would otherwise ship the
    // `%Decimal{}` as a JSON string where every other backend sends a number.
    expect(ctrl).toContain('"rateUp" => __decimal_num(Decimal.round(record.rate, 0, :ceiling))');
  });

  it("renders queryable ops as SQL fragments in the criterion where-clause", async () => {
    const files = await generateSystemFiles(A3_SRC);
    const repo = retrievals(files);
    // round — with places (two-hole fragment) and without (single-hole).
    expect(repo).toContain(
      'from(record in Api.Catalog.Product.base_query(), where: fragment("round(?, ?)", record.rate, 2) == ^q)',
    );
    expect(repo).toContain(
      'from(record in Api.Catalog.Product.base_query(), where: fragment("round(?)", record.rate) == ^q)',
    );
    // min/max against a pinned param → least()/greatest() (args arrive with
    // the `^` pin already applied by the arg renderer — no extra pinning).
    expect(repo).toContain(
      'from(record in Api.Catalog.Product.base_query(), where: fragment("least(?, ?)", record.amount, ^cap) == ^cap)',
    );
    expect(repo).toContain(
      'from(record in Api.Catalog.Product.base_query(), where: fragment("greatest(?, ?)", record.qty, ^q) == ^q)',
    );
    expect(repo).toContain('fragment("floor(?)", record.amount)');
    expect(repo).toContain('fragment("ceil(?)", record.rate)');
    // Never the in-memory Decimal.* forms inside an Ecto query.
    expect(repo).not.toContain("Decimal.round(");
    expect(repo).not.toContain("Decimal.min(");
  });

  it("renders int abs in filter position as the fragment, not Kernel abs", async () => {
    const files = await generateSystemFiles(A3_SRC);
    const repo = retrievals(files);
    expect(repo).toContain(
      'from(record in Api.Catalog.Product.base_query(), where: fragment("abs(?)", record.qty) == ^q)',
    );
    expect(repo).not.toMatch(/where: abs\(/);
  });
});
