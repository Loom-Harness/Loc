// A1 pilot for the scalar-intrinsic catalogue (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/stdlib.md):
// `string.trim()` end-to-end on the .NET backend — in-memory rendering in
// domain bodies AND the LINQ expression tree of a criterion (`ToExpression()`,
// the queryable position — EF Core translates `.Trim()` to SQL natively, so no
// separate query renderer exists).  The catalogue row lives in src/util/intrinsics.ts;
// the C# snippet in render-expr.ts (CS_INTRINSIC_RENDERERS).

import { describe, expect, it } from "vitest";
import { generateDotnet } from "../../_helpers/generate.js";
import { parseValid } from "../../_helpers/parse.js";

describe("dotnet generator — string.trim() intrinsic (stdlib A1 pilot)", () => {
  it("renders a value-side trim (param receiver) the same way", async () => {
    const src = `
      context Catalog {
        aggregate Product { name: string }
        repository Products for Product
        criterion ProductsByName(q: string) of Product = this.name == q.trim()
      }
    `;
    const model = await parseValid(src);
    const crit = generateDotnet(model).get("Domain/Criteria/ProductsByNameCriterion.cs")!;
    expect(crit).toContain("ToExpression() => candidate => candidate.Name == q.Trim();");
  });
});
