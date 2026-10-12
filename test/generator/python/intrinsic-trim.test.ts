// A1 pilot for the scalar-intrinsic catalogue (docs/old/plans/stdlib.md):
// `string.trim()` end-to-end on the Python backend — in-memory rendering in
// domain bodies (`.strip()`, NOT the snake-cased fallthrough `.trim()`) AND
// SQL rendering in a queryable `find … where` position (`func.trim(col)`).
// The catalogue row lives in src/util/intrinsics.ts; the Python snippet in
// render-expr.ts (PY_INTRINSIC_RENDERERS); the SQL snippet in
// find-predicate.ts (SQLALCHEMY_INTRINSIC_SQL).  The node analogue is
// test/generator/typescript/intrinsic-trim.test.ts.

import { describe, expect, it } from "vitest";
import { generateSystems } from "../../../src/system/index.js";
import { parseString } from "../../_helpers/index.js";

const DOMAIN = "api/app/domain/product.py";
const REPO = "api/app/db/repositories/product_repository.py";

async function build(source: string): Promise<Map<string, string>> {
  const { model, errors } = await parseString(source);
  if (errors.length) throw new Error(`source has validation errors:\n${errors.join("\n")}`);
  return generateSystems(model).files;
}

describe("python generator — string.trim() intrinsic (stdlib A1 pilot)", () => {
  it("renders a value-side trim (param receiver) as plain Python .strip()", async () => {
    const src = `
system Shop {
  subdomain Catalog {
    context Catalog {
      aggregate Product { name: string }
      repository Products for Product {
        find byName(q: string): Product[] where this.name == q.trim()
      }
    }
  }
  api CatalogApi from Catalog
  storage pg { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: pg }
  deployable api { platform: python, contexts: [Catalog], dataSources: [catalogState], serves: CatalogApi, port: 4000 }
}
`;
    const repo = (await build(src)).get(REPO)!;
    expect(repo).toBeDefined();
    expect(repo).toContain("select(ProductRow).where((ProductRow.name == q.strip()))");
  });
});

// A2 string batch — chained case-mapping in a domain body plus the queryable
// `toLower` in a find where-clause (`func.lower(col)`), mirroring the trim
// pilot above.
describe("python generator — string case intrinsics (stdlib A2)", () => {
  const SRC_A2 = `
system Shop {
  subdomain Catalog {
    context Catalog {
      aggregate Product {
        name: string
        derived slug: string = name.trim().toLower()
      }
      repository Products for Product {
        find byNameCi(q: string): Product[] where this.name.toLower() == q
      }
    }
  }
  api CatalogApi from Catalog
  storage pg { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: pg }
  deployable api { platform: python, contexts: [Catalog], dataSources: [catalogState], serves: CatalogApi, port: 4000 }
}
`;

  it("parses + validates cleanly", async () => {
    const { errors } = await parseString(SRC_A2);
    expect(errors).toEqual([]);
  });
});

// A3 math batch — abs/min/max on the four numeric receivers plus
// round/floor/ceil on decimal (float-backed) and money (Decimal-backed).
// Round is HALF-AWAY-FROM-ZERO by catalogue contract: the money path forces
// ROUND_HALF_UP on quantize (Decimal's default is context half-even), and so
// does the float-backed decimal path, on its shortest-repr `Decimal` (RS-37 —
// builtin round() is banker's and must not appear).  SQL side: func.round/floor/ceil + two-value
// least/greatest.
describe("python generator — numeric math intrinsics (stdlib A3)", () => {
  const SRC_A3 = `
system Shop {
  subdomain Catalog {
    context Catalog {
      aggregate Product {
        qty: int
        weight: decimal
        price: money
        cap: money
        derived qtyAbs: int = qty.abs()
        derived qtyFloor: int = qty.min(5)
        derived priceRounded: money = price.round(2)
        derived priceWhole: money = price.round()
        derived priceFloor: money = price.floor()
        derived priceCapped: money = price.min(cap)
        derived weightRounded: decimal = weight.round(1)
        derived weightCeil: decimal = weight.ceil()
      }
      repository Products for Product {
        find byRoundedPrice(q: money): Product[] where this.price.round(2) == q
        find byWholeWeight(q: decimal): Product[] where this.weight.round() == q
        find byMinQty(q: int): Product[] where this.qty.min(5) == q
        find byNormalizedWeight(q: decimal): Product[] where this.weight == q.round(1)
      }
    }
  }
  api CatalogApi from Catalog
  storage pg { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: pg }
  deployable api { platform: python, contexts: [Catalog], dataSources: [catalogState], serves: CatalogApi, port: 4000 }
}
`;

  it("parses + validates cleanly (all A3 ops typed + queryable)", async () => {
    const { errors } = await parseString(SRC_A3);
    expect(errors).toEqual([]);
  });

  it("renders abs/min/floor/ceil keeping the receiver type", async () => {
    const domain = (await build(SRC_A3)).get(DOMAIN)!;
    expect(domain).toContain("abs(self._qty)");
    expect(domain).toContain("min(self._qty, 5)");
    expect(domain).toContain("min(self._price, self._cap)");
    expect(domain).toContain('self._price.to_integral_value(rounding="ROUND_FLOOR")');
    expect(domain).toContain("float(math.ceil(self._weight))");
  });

  it("threads the math + Decimal imports through the domain module header", async () => {
    const domain = (await build(SRC_A3)).get(DOMAIN)!;
    expect(domain).toContain("import math");
    expect(domain).toContain("from decimal import Decimal");
  });

  it("renders queryable math as func.round/least in the find where-clauses", async () => {
    const repo = (await build(SRC_A3)).get(REPO)!;
    expect(repo).toContain("select(ProductRow).where((func.round(ProductRow.price, 2) == q))");
    expect(repo).toContain("select(ProductRow).where((func.round(ProductRow.weight) == q))");
    expect(repo).toContain("select(ProductRow).where((func.least(ProductRow.qty, 5) == q))");
    expect(repo).toMatch(/from sqlalchemy import [^\n]*\bfunc\b/);
  });

  it("renders a value-side decimal.round (param receiver) as host Python and imports Decimal", async () => {
    const repo = (await build(SRC_A3)).get(REPO)!;
    expect(repo).toContain(
      '(ProductRow.weight == float(Decimal(str(q)).quantize(Decimal(1).scaleb(-(1)), rounding="ROUND_HALF_UP")))',
    );
    expect(repo).toContain("from decimal import Decimal");
  });
});
