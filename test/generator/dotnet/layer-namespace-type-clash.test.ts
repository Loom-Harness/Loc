import { describe, expect, it } from "vitest";
import { layerClashAliases } from "../../../src/generator/dotnet/bcl-collision.js";
import type { BoundedContextIR } from "../../../src/ir/types/loom-ir.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// A .NET domain type named like a generated LAYER namespace (claims eval, W2).
//
// Every file lives under `Shop.<Layer>…`, so `aggregate Application` in
// deployable `shop` was unreachable by its simple name from every other file
// — the enclosing `Shop` namespace's member namespace `Application` wins
// lookup before the `using Shop.Domain.Applications;` import — and its id
// `ApplicationId` was ambiguous with `System.ApplicationId`:
//
//     Infrastructure/Repositories/ApplicationRepository.cs(29,23):
//       error CS0118: 'Application' is a namespace but is used like a type
//     Domain/Applications/Application.cs(15,12):
//       error CS0104: 'ApplicationId' is an ambiguous reference between
//                     'Shop.Domain.Ids.ApplicationId' and 'System.ApplicationId'
//
// The fix appends a namespace-level alias to the colliding files' namespace
// line (`layerClashAliases` in bcl-collision.ts); a model without the
// collision is byte-identical.  `dotnet build /warnaserror` of the colliding
// output is the compile leg (see the PR); this pins the emitted spelling.
// ---------------------------------------------------------------------------

const systemSource = (agg: string): string => `
system S {
  subdomain Sales {
    context Orders {
      aggregate ${agg} {
        name: string
        create(name: string) { name := name }
      }
      repository ${agg}s for ${agg} { find byName(n: string): ${agg}? where this.name == n }
    }
  }
  api ShopApi from Sales
  storage db { type: postgres }
  resource st { for: Orders, kind: state, use: db }
  deployable shop {
    platform: dotnet
    contexts: [Orders]
    dataSources: [st]
    serves: ShopApi
    port: 8080
  }
}
`;

const APP_ALIAS = "using Application = global::Shop.Domain.Applications.Application;";
const APP_ID_ALIAS = "using ApplicationId = global::Shop.Domain.Ids.ApplicationId;";

describe("dotnet — a domain type named like a layer namespace (CS0118/CS0104)", () => {
  it("aliases the type inside every other namespace that names it", async () => {
    const files = await generateSystemFiles(systemSource("Application"));
    const repo = files.get("shop/Infrastructure/Repositories/ApplicationRepository.cs")!;
    expect(repo).toContain(
      `namespace Shop.Infrastructure.Repositories; ${APP_ALIAS} ${APP_ID_ALIAS}\n`,
    );
    // The type's own namespace declares it — an alias there is CS0576.
    const entity = files.get("shop/Domain/Applications/Application.cs")!;
    expect(entity).toContain(`namespace Shop.Domain.Applications; ${APP_ID_ALIAS}\n`);
    expect(entity).not.toContain(APP_ALIAS);
    // No generated line moves — the alias rides on the namespace line.
    const plain = await generateSystemFiles(systemSource("Applicant"));
    expect(repo.split("\n").length).toBe(
      plain.get("shop/Infrastructure/Repositories/ApplicantRepository.cs")!.split("\n").length,
    );
  });

  it("a type named like the Domain layer is aliased too", async () => {
    const files = await generateSystemFiles(systemSource("Domain"));
    expect(files.get("shop/Infrastructure/Repositories/DomainRepository.cs")).toContain(
      "using Domain = global::Shop.Domain.Domains.Domain;",
    );
  });

  it("a non-colliding model gets no alias (byte-identical)", async () => {
    const files = await generateSystemFiles(systemSource("Applicant"));
    for (const [path, src] of files) {
      if (path.endsWith(".cs")) expect(src, path).not.toMatch(/^namespace [\w.]+;.*using/m);
    }
  });

  // The legacy `generate dotnet` entry (root = the context name) calls this same
  // helper per context; it is pinned here rather than through the legacy entry,
  // whose callers the M-T9.49 ratchet only lets shrink.
  it("the shared helper: aliases under its own root only, skips the home and CS0576 sites", () => {
    const ctx = {
      aggregates: [{ name: "Application", parts: [] }],
      valueObjects: [],
      enums: [],
      events: [],
      payloads: [],
      domainServices: [],
      projections: [],
    } as unknown as BoundedContextIR;
    const out = new Map<string, string>([
      [
        "Domain/Applications/Application.cs",
        "namespace Shop.Domain.Applications;\npublic sealed class Application { ApplicationId Id; }\n",
      ],
      [
        "Domain/Ids/Ids.cs",
        "namespace Shop.Domain.Ids;\npublic readonly record struct ApplicationId(Guid Value);\n",
      ],
      [
        "Application/X.cs",
        "namespace Shop.Application.Applications\n{\n  class X { Application A; }\n}\n",
      ],
      ["Api/Y.cs", "namespace Shop.Api;\nclass Y { Application A; }\n"],
      ["Api/Z.cs", "namespace Shop.Api;\nclass Z { }\n"],
      ["Other/W.cs", "namespace Other.Api;\nclass W { Application A; }\n"],
    ]);
    const got = layerClashAliases(out, "Shop", [ctx]);
    const app = " using Application = global::Shop.Domain.Applications.Application;";
    const id = " using ApplicationId = global::Shop.Domain.Ids.ApplicationId;";
    expect(got.get("Api/Y.cs")).toBe(`namespace Shop.Api;${app}\nclass Y { Application A; }\n`);
    expect(got.get("Application/X.cs")).toBe(
      `namespace Shop.Application.Applications\n{${app}\n  class X { Application A; }\n}\n`,
    );
    expect(got.get("Domain/Applications/Application.cs")).toBe(
      `namespace Shop.Domain.Applications;${id}\npublic sealed class Application { ApplicationId Id; }\n`,
    );
    // No mention, another root, or a non-colliding model: untouched.
    expect(got.has("Api/Z.cs")).toBe(false);
    expect(got.has("Other/W.cs")).toBe(false);
    expect(got.has("Domain/Ids/Ids.cs")).toBe(false);
    const plain = {
      ...ctx,
      aggregates: [{ name: "Applicant", parts: [] }],
    } as unknown as BoundedContextIR;
    expect(layerClashAliases(out, "Shop", [plain]).size).toBe(0);
  });
});
