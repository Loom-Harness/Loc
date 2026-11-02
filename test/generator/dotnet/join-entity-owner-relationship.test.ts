// An `X id[]` join entity declares its relationship to the owning aggregate so
// EF orders the owner INSERT before the join rows (the migration's owner FK
// would otherwise reject the join row first: 23503).

import { describe, expect, it } from "vitest";
import { generateDotnet } from "../../_helpers/generate.js";
import { parseValid } from "../../_helpers/parse.js";

const SRC = `
  context Catalog {
    aggregate Product { name: string }
    repository Products for Product { }
    aggregate Provider {
      name: string
      products: Product id[]
    }
    repository Providers for Provider { }
  }
`;

describe("dotnet generator — join entity owner relationship", () => {
  it("configures HasOne<Owner>().WithMany() with a cascading owner FK", async () => {
    const model = await parseValid(SRC);
    const cfg = generateDotnet(model).get(
      "Infrastructure/Persistence/Configurations/ProviderProductsConfiguration.cs",
    )!;
    expect(cfg).toContain("using Catalog.Domain.Providers;");
    expect(cfg).toContain(
      "builder.HasOne<Provider>().WithMany().HasForeignKey(x => x.ProviderId).OnDelete(DeleteBehavior.Cascade);",
    );
  });
});
