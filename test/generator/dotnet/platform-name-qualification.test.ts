import { describe, expect, it } from "vitest";
import {
  csNameRef,
  csProjectRef,
  csRef,
  finalizeCsUnit,
} from "../../../src/generator/_imports/dotnet.js";
import {
  dotnetPlatformNameTaken,
  isDotnetRootNamespace,
} from "../../../src/generator/_symbols/plan.js";
import { dedupeUsings, layerClashAliases } from "../../../src/generator/dotnet/bcl-collision.js";
import { csCodeMask, rewriteCode } from "../../../src/generator/dotnet/cs-code-scan.js";
import type { BoundedContextIR } from "../../../src/ir/types/loom-ir.js";

// ---------------------------------------------------------------------------
// A domain type may take a simple name a .NET platform type the emitters name
// also has — a BCL type (`DateTime`), a type every generated project declares
// for itself (`DomainException`, `ProblemDetailsError`), a namespace
// (`System`, `<Root>.Infrastructure.Persistence`).  The domain type keeps the
// bare name; what it displaces is spelled `global::`.  These pin the rule at
// its two seams — the unit finalizer (reference markers) and the project
// post-pass (aliases and qualifier rewrites) — as exact text, since the
// claim is the spelling; the compile proof is the reserved-names proof run.
// ---------------------------------------------------------------------------

const ctx = (decls: { aggs?: string[]; vos?: string[]; enums?: string[] }): BoundedContextIR =>
  ({
    aggregates: (decls.aggs ?? []).map((name) => ({ name, parts: [] })),
    valueObjects: (decls.vos ?? []).map((name) => ({ name })),
    enums: (decls.enums ?? []).map((name) => ({ name })),
    events: [],
    payloads: [],
    domainServices: [],
    projections: [],
  }) as unknown as BoundedContextIR;

describe("the decision (symbol plan)", () => {
  it("a platform name is taken exactly when a domain type of the project has it", () => {
    expect(dotnetPlatformNameTaken("DateTime", new Set(["DateTime", "Order"]))).toBe(true);
    expect(dotnetPlatformNameTaken("DateTime", new Set(["Order"]))).toBe(false);
  });
  it("the referenced assemblies' root namespaces", () => {
    for (const ns of ["System", "Microsoft", "OpenTelemetry"]) {
      expect(isDotnetRootNamespace(ns), ns).toBe(true);
    }
    expect(isDotnetRootNamespace("Persistence")).toBe(false);
  });
});

describe("the unit finalizer spells a taken platform name global::", () => {
  const unit = (body: string): string => `using System;\n\nnamespace Shop.Api;\n\n${body}\n`;
  const taken = {
    project: { root: "Shop", projectTypes: new Set(["DateTime", "DomainException", "Regex"]) },
  };

  it("a name reference: bare without a collision, qualified with one, never a using", () => {
    const text = unit(`class C { ${csNameRef("System", "DateTime")} At; }`);
    expect(finalizeCsUnit(text)).toBe(unit("class C { DateTime At; }"));
    expect(finalizeCsUnit(text, taken)).toBe(unit("class C { global::System.DateTime At; }"));
    const elsewhere = `namespace Shop.Api;\nclass C { ${csNameRef("System.Text", "Rune")} R; }\n`;
    expect(finalizeCsUnit(elsewhere)).toBe("namespace Shop.Api;\nclass C { Rune R; }\n");
  });

  it("a project reference resolves below the root namespace", () => {
    const text = unit(
      `class C { void F() => throw new ${csProjectRef("Domain.Common", "DomainException")}("x"); }`,
    );
    expect(finalizeCsUnit(text)).toBe(
      unit(`class C { void F() => throw new DomainException("x"); }`),
    );
    expect(finalizeCsUnit(text, taken)).toBe(
      unit(`class C { void F() => throw new global::Shop.Domain.Common.DomainException("x"); }`),
    );
  });

  it("an importing reference is qualified too and keeps its derived using", () => {
    const text = `namespace Shop.Api;\n\nclass C { bool F(string s) => ${csRef("System.Text.RegularExpressions", "Regex")}.IsMatch(s, "a"); }\n`;
    expect(finalizeCsUnit(text, taken)).toBe(
      `using System.Text.RegularExpressions;\n\nnamespace Shop.Api;\n\nclass C { bool F(string s) => global::System.Text.RegularExpressions.Regex.IsMatch(s, "a"); }\n`,
    );
  });
});

describe("the code positions of a C# unit", () => {
  it("masks strings, chars and comments but keeps interpolation holes", () => {
    const src = `var a = System.X; // System.Y\nvar b = "System.Z" + $"{System.W}" + @"System.V" + 'S'; /* System.U */`;
    const got = rewriteCode(src, /System\.(\w)/g, (m) => `global::System.${m[1]}`);
    expect(got).toBe(
      `var a = global::System.X; // System.Y\nvar b = "System.Z" + $"{global::System.W}" + @"System.V" + 'S'; /* System.U */`,
    );
    expect(csCodeMask(`a"b"c`)).toBe(`a   c`);
  });
});

describe("the project post-pass", () => {
  it("a type named like a root namespace: aliased, the namespace spelled global::, its members kept", () => {
    const out = new Map([
      [
        "Domain/Systems/System.cs",
        "namespace Shop.Domain.Systems;\npublic sealed class System { public static System Create() => new(); public string F => 1.ToString(System.Globalization.CultureInfo.InvariantCulture); }\n",
      ],
      [
        "Api/C.cs",
        'using System;\nnamespace Shop.Api;\nclass C { System S = System.Create(); string T = System.Text.Json.JsonSerializer.Serialize(1); string U = "System.Text"; }\n',
      ],
    ]);
    const got = layerClashAliases(out, "Shop", [ctx({ aggs: ["System"] })]);
    expect(got.get("Api/C.cs")).toBe(
      'using System;\nnamespace Shop.Api; using System = global::Shop.Domain.Systems.System;\nclass C { System S = System.Create(); string T = global::System.Text.Json.JsonSerializer.Serialize(1); string U = "System.Text"; }\n',
    );
    // Its own file: the type binds the name, so the namespace is spelled in full.
    expect(got.get("Domain/Systems/System.cs")).toBe(
      "namespace Shop.Domain.Systems;\npublic sealed class System { public static System Create() => new(); public string F => 1.ToString(global::System.Globalization.CultureInfo.InvariantCulture); }\n",
    );
  });

  it("a type named like a generated type: aliased where it can be, spelled in full in that type's namespace", () => {
    const out = new Map([
      [
        "Domain/Common/DomainException.cs",
        "namespace Shop.Domain.Common;\npublic sealed class DomainException : Exception { }\n",
      ],
      [
        "Domain/ValueObjects/DomainException.cs",
        "namespace Shop.Domain.ValueObjects;\npublic sealed record DomainException(string V);\n",
      ],
      [
        "Domain/Common/Log.cs",
        "namespace Shop.Domain.Common;\nclass Log { DomainException? X; }\n",
      ],
      [
        "Domain/Orders/Order.cs",
        "using Shop.Domain.Common;\nusing Shop.Domain.ValueObjects;\nnamespace Shop.Domain.Orders;\nclass Order { DomainException? X; void F() => throw new global::Shop.Domain.Common.DomainException(); }\n",
      ],
    ]);
    const got = layerClashAliases(out, "Shop", [ctx({ vos: ["DomainException"] })]);
    expect(got.get("Domain/Orders/Order.cs")).toBe(
      "using Shop.Domain.Common;\nusing Shop.Domain.ValueObjects;\nnamespace Shop.Domain.Orders; using DomainException = global::Shop.Domain.ValueObjects.DomainException;\nclass Order { DomainException? X; void F() => throw new global::Shop.Domain.Common.DomainException(); }\n",
    );
    // The generated type's namespace declares the name (an alias is CS0576):
    // a bare reference there is the domain type's, spelled in full.
    expect(got.get("Domain/Common/Log.cs")).toBe(
      "namespace Shop.Domain.Common;\nclass Log { global::Shop.Domain.ValueObjects.DomainException? X; }\n",
    );
    expect(got.has("Domain/Common/DomainException.cs")).toBe(false);
    expect(got.has("Domain/ValueObjects/DomainException.cs")).toBe(false);
  });

  it("a type named like a member namespace: the namespace keeps its qualifiers", () => {
    const out = new Map([
      [
        "Domain/ValueObjects/Configurations.cs",
        "namespace Shop.Domain.ValueObjects;\npublic sealed record Configurations(string V);\n",
      ],
      [
        "Infrastructure/Persistence/Configurations/X.cs",
        "namespace Shop.Infrastructure.Persistence.Configurations;\nclass XConfiguration { }\n",
      ],
      [
        "Infrastructure/Persistence/AppDbContext.cs",
        "namespace Shop.Infrastructure.Persistence;\nclass AppDbContext { object A = new Configurations.XConfiguration(); Configurations? V; }\n",
      ],
      [
        "Infrastructure/Repositories/R.cs",
        "namespace Shop.Infrastructure.Repositories;\nclass R { Configurations? V; }\n",
      ],
    ]);
    const got = layerClashAliases(out, "Shop", [ctx({ vos: ["Configurations"] })]);
    expect(got.get("Infrastructure/Persistence/AppDbContext.cs")).toBe(
      "namespace Shop.Infrastructure.Persistence;\nclass AppDbContext { object A = new Configurations.XConfiguration(); global::Shop.Domain.ValueObjects.Configurations? V; }\n",
    );
    // Outside `<Root>.Infrastructure.Persistence` nothing shadows the name.
    expect(got.has("Infrastructure/Repositories/R.cs")).toBe(false);
  });

  it("a model without a collision is untouched", () => {
    const out = new Map([
      [
        "Api/C.cs",
        "using System;\nnamespace Shop.Api;\nclass C { string T = System.Text.Json.JsonSerializer.Serialize(1); }\n",
      ],
    ]);
    expect(layerClashAliases(out, "Shop", [ctx({ aggs: ["Order"], vos: ["Money"] })]).size).toBe(0);
  });

  it("a repeated using is dropped (an aggregate named like a generated namespace)", () => {
    const out = new Map([
      [
        "A.cs",
        "using Shop.Domain.Enums;\nusing Shop.Domain.Enums;\nnamespace Shop.Api;\nusing X = Y;\n",
      ],
      ["B.cs", "using Shop.Domain.Enums;\nnamespace Shop.Api;\n"],
    ]);
    const got = dedupeUsings(out);
    expect(got.get("A.cs")).toBe("using Shop.Domain.Enums;\nnamespace Shop.Api;\nusing X = Y;\n");
    expect(got.has("B.cs")).toBe(false);
  });
});
