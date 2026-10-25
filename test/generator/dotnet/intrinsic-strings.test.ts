// A2 string batch of the scalar-intrinsic catalogue (https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/stdlib.md)
// end-to-end on the .NET backend: toUpper/toLower/substring/startsWith/
// endsWith/contains/replace/split from `.ddd` source through generateDotnet.
// Semantics contract (src/util/intrinsics.ts): substring is 0-based CLAMPING
// (JS-slice) over CODE POINTS, startsWith/endsWith/contains are ordinal, replace hits all
// occurrences literally, split keeps empty segments.  Only toUpper/toLower
// are queryable — they reach EF via the same renderCsExpr LINQ lambda path
// as trim (no separate SQL table on .NET).

import { describe, expect, it } from "vitest";
import { generateDotnet } from "../../_helpers/generate.js";
import { parseString, parseValid } from "../../_helpers/parse.js";

const SRC = `
  context Catalog {
    aggregate Product {
      name: string
      derived slug: string = name.trim().toLower()
      derived shout: string = name.toUpper()
      derived cleaned: string = name.replace(" ", "-")
      derived branded: bool = name.startsWith("ACME") || name.endsWith("!") || name.contains("-")
      invariant name.substring(0, 3).length <= 3
    }
    repository Products for Product {
      find byNormalizedName(q: string): Product[] where this.name.toLower() == q
    }
  }
`;

describe("dotnet generator — string intrinsics (stdlib A2 batch)", () => {
  it("parses + validates cleanly", async () => {
    const { errors } = await parseString(SRC);
    expect(errors).toEqual([]);
  });

  it("renders the string batch in-memory in derived/invariant bodies", async () => {
    const model = await parseValid(SRC);
    const domain = generateDotnet(model).get("Domain/Products/Product.cs")!;
    // derived slug — chained trim().toLower()
    expect(domain).toContain(".Trim().ToLowerInvariant()");
    expect(domain).toContain(".ToUpperInvariant()");
    // replace = all occurrences, literal
    expect(domain).toContain('.Replace(" ", "-")');
    // ordinal comparisons
    expect(domain).toContain('.StartsWith("ACME", StringComparison.Ordinal)');
    // A ONE-character literal takes the char overload (CA1865 under /warnaserror).
    expect(domain).toContain(".EndsWith('!')");
    expect(domain).toContain('.Contains("-", StringComparison.Ordinal)');
    // substring — code points, clamping, 2-arg arity (invariant)
    expect(domain).toContain(
      // Both the window and the trailing `.length` count CODE POINTS (RS-31,
      // RS-44); Skip/Take clamp.
      "string.Concat(this.Name.EnumerateRunes().Skip(0).Take(3)).EnumerateRunes().Count() <= 3",
    );
  });

  it("renders queryable toLower inside the find Where lambda (EF-translatable)", async () => {
    const model = await parseValid(SRC);
    const repo = generateDotnet(model).get("Infrastructure/Repositories/ProductRepository.cs")!;
    expect(repo).toContain(".Where(x => x.Name.ToLower() == q)");
  });

  it("renders 1-arg substring and split in a derived body", async () => {
    const src = `
      context Catalog {
        aggregate Doc {
          body: string
          derived tail: string = body.substring(5)
          derived lineCount: int = body.split("\\n").count()
        }
      }
    `;
    const model = await parseValid(src);
    const domain = generateDotnet(model).get("Domain/Docs/Doc.cs")!;
    expect(domain).toContain("string.Concat(this.Body.EnumerateRunes().Skip(5))");
    expect(domain).toContain('.Split("\\n").ToList()');
  });
});
