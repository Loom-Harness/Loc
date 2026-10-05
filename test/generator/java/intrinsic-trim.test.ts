// A1 pilot for the scalar-intrinsic catalogue (docs/old/plans/stdlib.md):
// `string.trim()` end-to-end on the Java/Spring backend — in-memory
// rendering in domain bodies AND JPQL rendering in a queryable
// `find … where` position.  The catalogue row lives in
// src/util/intrinsics.ts; the Java snippet in render-expr.ts
// (JAVA_INTRINSIC_RENDERERS); the JPQL snippet in render-jpql.ts
// (JPQL_INTRINSIC_SQL).  The Java twin of the TS pilot
// (test/generator/typescript/intrinsic-trim.test.ts).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { parseString } from "../../_helpers/parse.js";

const SRC = `
system Shop {
  subdomain Sales {
    context Catalog {
      aggregate Product {
        name: string
        derived cleanName: string = name.trim()
        invariant name.trim().length > 0
      }
      repository Products for Product {
        find byExactName(q: string): Product[] where this.name.trim() == q
      }
    }
  }
  api CatalogApi from Sales
  storage primary { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: primary }
  deployable shopApi {
    platform: java
    contexts: [Catalog]
    dataSources: [catalogState]
    serves: CatalogApi
    port: 8081
  }
}
`;

const ROOT = "shop_api/src/main/java/com/loom/shopapi";

describe("java generator — string.trim() intrinsic (stdlib A1 pilot)", () => {
  it("renders a value-side trim (param receiver) as trim(:q) — JPQL trim works on parameters", async () => {
    const src = SRC.replace(
      "find byExactName(q: string): Product[] where this.name.trim() == q",
      "find byName(q: string): Product[] where this.name == q.trim()",
    );
    const { errors } = await parseString(src);
    expect(errors).toEqual([]);
    const files = await generateSystemFiles(src);
    const jpa = files.get(`${ROOT}/features/products/ProductJpaRepository.java`)!;
    expect(jpa).toContain('@Query("select e from Product e where e.name = trim(:q)")');
  });
});
