// An `X id[]` join entity declares its relationship to the owning aggregate so
// EF orders the owner INSERT before the join rows (the migration's owner FK
// would otherwise reject the join row first: 23503).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `
  system R {
    api RA from S
    subdomain S {
      context Catalog {
        aggregate Product { name: string }
        repository Products for Product { }
        aggregate Provider {
          name: string
          products: Product id[]
        }
        repository Providers for Provider { }
      }
    }
    storage pg { type: postgres }
    resource st { for: Catalog, kind: state, use: pg }
    deployable api { platform: dotnet contexts: [Catalog] dataSources: [st] serves: RA port: 5000 }
  }
`;

describe("dotnet generator — join entity owner relationship", () => {
  it("configures HasOne<Owner>().WithMany() with a cascading owner FK", async () => {
    const files = await generateSystemFiles(SRC);
    const cfg = files.get(
      "api/Infrastructure/Persistence/Configurations/ProviderProductsConfiguration.cs",
    )!;
    expect(cfg).toContain("using Api.Domain.Providers;");
    expect(cfg).toContain(
      "builder.HasOne<Provider>().WithMany().HasForeignKey(x => x.ProviderId).OnDelete(DeleteBehavior.Cascade);",
    );
  });
});
