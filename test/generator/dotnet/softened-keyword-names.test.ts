// `enum` and `static` are legal `.ddd` field / parameter names, and both are C#
// keywords.  Every C# position that spells such a name in lowerCamel must carry
// the verbatim prefix (`@static`) — including the NAMED-argument label of a
// `Create(...)` call, whose label has to match the factory's (already escaped)
// parameter — or `dotnet build` fails while generation reports nothing:
//   - a criterion's private field, constructor parameter and assignment;
//   - a value object's constructor parameter and assignment;
//   - the `Create(...)` named arguments a workflow, a domain `test`, and a
//     seed row emit.
// The analyzer rejects a keyword-named parameter on an interface member even
// when escaped (CA1716, an error under `/warnaserror`); the API csproj carries
// CA1716 in `NoWarn` — the same rule fires on a type named after a Visual
// Basic keyword (`aggregate Module`) — so no port member carries a per-member
// suppression.
//
// Verified end-to-end: the model compiles with `dotnet build /warnaserror`
// (.NET 10) on both the EF Core and Dapper adapters.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = (platform: string) => `
system S {
  subdomain D {
    context C {
      valueobject Origin {
        system: string
        static: int
      }
      aggregate Plugin {
        system: string
        enum: int
        static: int
        origin: Origin
        create(system: string, enum: int, static: int, origin: Origin) { }
      }
      repository Plugins for Plugin {
        find byLevel(enum: int, static: int): Plugin? where this.enum == enum && this.static >= static
        find bySystem(system: string): Plugin? where this.system == system
      }
      criterion StaticAtLeast(static: int) of Plugin = this.static >= static
      test "a plugin builds" {
        let p = Plugin.create({ system: "s", enum: 1, static: 2, origin: Origin { system: "s", static: 2 } })
        expect(p.static).toBe(2)
      }
      seed default {
        Plugin { system: "core", enum: 1, static: 3, origin: Origin { system: "core", static: 3 } }
      }
      workflow Bootstrap {
        create(system: string, enum: int) {
          let rows = Plugins.run(StaticAtLeast(enum), page: { offset: 0, limit: 10 })
          let p = Plugin.create({ system: system, enum: enum, static: enum, origin: Origin { system: system, static: enum } })
        }
      }
    }
  }
  storage pg { type: postgres }
  resource cState { for: C, kind: state, use: pg }
  deployable api { platform: ${platform}  contexts: [C]  dataSources: [cState]  port: 3000 }
}
`;

const cache = new Map<string, Map<string, string>>();
async function file(platform: string, suffix: string): Promise<string> {
  let f = cache.get(platform);
  if (!f) {
    f = await generateSystemFiles(SRC(platform));
    cache.set(platform, f);
  }
  const key = [...f.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return f.get(key!)!;
}

describe.each([
  ["efcore", "dotnet"],
  ["dapper", "dotnet { persistence: dapper }"],
])("%s: C#-keyword names that are legal .ddd names", (_adapter, platform) => {
  it("a criterion's field, constructor parameter and assignment", async () => {
    const crit = await file(platform, "Domain/Criteria/StaticAtLeastCriterion.cs");
    expect(crit).toContain("    private readonly int @static;");
    expect(crit).toContain("public StaticAtLeastCriterion(int @static)");
    expect(crit).toContain("        this.@static = @static;");
  });

  it("a value object's constructor parameter and assignment", async () => {
    const vo = await file(platform, "Domain/ValueObjects/Origin.cs");
    expect(vo).toContain("public Origin(string system, int @static)");
    expect(vo).toContain("        Static = @static;");
  });

  it("the Create(...) named arguments of a workflow, a test and a seed row", async () => {
    const wf = await file(platform, "Application/Workflows/BootstrapHandler.cs");
    expect(wf).toContain(
      "Plugin.Create(system: command.System, @enum: command.Enum, @static: command.Enum,",
    );
    const tests = await file(platform, "CIntegrationTests.cs");
    expect(tests).toContain(`Plugin.Create(system: "s", @enum: 1, @static: 2,`);
    const seed = await file(platform, "Infrastructure/Persistence/Seed.cs");
    expect(seed).toMatch(/Plugin\.Create\(system: "core", @enum: 1, @static: 3,/);
  });

  it("CA1716 is a project-wide NoWarn, not a per-member suppression", async () => {
    const port = await file(platform, "Domain/Plugins/IPluginRepository.cs");
    expect(port).toContain("ByLevel(int @enum, int @static,");
    expect(port).toContain("RunFindAllByStaticAtLeastAsync(int @static,");
    expect(port).not.toContain("SuppressMessage");
    const csproj = await file(platform, "api/Api.csproj");
    expect(csproj).toMatch(/<NoWarn>[^<]*\bCA1716\b[^<]*<\/NoWarn>/);
  });
});
