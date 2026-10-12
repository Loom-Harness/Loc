import { describe, expect, it } from "vitest";
import { clashFreeRootNamespace } from "../../../src/generator/dotnet/bcl-collision.js";
import { DOTNET_TFM } from "../../../src/generator/dotnet/emit/program.js";
import type { BoundedContextIR } from "../../../src/ir/types/loom-ir.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// A .NET root namespace equal to a hosted type name (claims eval, P12).
//
// The root namespace is the deployable's Pascal name (system mode) or the
// context's name (legacy `generate dotnet`).  `deployable pay` hosting
// `aggregate Pay` emitted `namespace Pay.…;` everywhere, so a bare `Pay`
// resolved to the NAMESPACE before the `using Pay.Domain.Pays;` import:
//
//     Infrastructure/Persistence/AppDbContext.cs(10,18):
//       error CS0118: 'Pay' is a namespace but is used like a type
//
// The fix suffixes the root namespace (`PayApp`) only on that collision; the
// csproj, DLL and every `namespace`/`using` follow it, and a model without the
// collision is byte-identical.  `dotnet build` of the colliding output is the
// compile leg (see the PR); this pins the emitted spelling.
// ---------------------------------------------------------------------------

const systemSource = (deployable: string): string => `
system S {
  subdomain Billing {
    context Payments {
      enum Kind { Card, Cash }
      aggregate Pay {
        amount: int
        kind: Kind
        create(amount: int, kind: Kind) { amount := amount kind := kind }
        operation bump(n: int) { amount := amount + n }
      }
    }
  }
  api PayApi from Billing
  storage db { type: postgres }
  resource payState { for: Payments, kind: state, use: db }
  deployable ${deployable} {
    platform: dotnet
    contexts: [Payments]
    dataSources: [payState]
    serves: PayApi
    port: 8080
  }
}
`;

/** The deployable's own C# files whose `namespace`/`using` lines are rooted at
 *  `root.` — e.g. `filesRootedAt(files, "pay/", "Pay")`. */
function filesRootedAt(files: Map<string, string>, prefix: string, root: string): string[] {
  const re = new RegExp(`^(?:namespace|using) ${root}\\.`, "m");
  return [...files]
    .filter(
      ([path, content]) => path.startsWith(prefix) && path.endsWith(".cs") && re.test(content),
    )
    .map(([path]) => path);
}

describe("dotnet — root namespace equal to a hosted type (CS0118)", () => {
  it("a deployable named like a hosted aggregate gets a suffixed root namespace", async () => {
    const files = await generateSystemFiles(systemSource("pay"));
    expect(files.has("pay/PayApp.csproj")).toBe(true);
    expect(files.has("pay/Pay.csproj")).toBe(false);
    expect(files.get("pay/PayApp.csproj")).toContain("<RootNamespace>PayApp</RootNamespace>");
    // The adapter-dispatched files (Application/…, Infrastructure/…) and the
    // direct-path files agree on ONE root — no `Pay.` namespace survives.
    expect(filesRootedAt(files, "pay/", "Pay")).toEqual([]);
    expect(filesRootedAt(files, "pay/", "PayApp")).toContain(
      "pay/Infrastructure/Persistence/AppDbContext.cs",
    );
    expect(files.get("pay/Dockerfile")).toContain('ENTRYPOINT ["dotnet", "PayApp.dll"]');
  });

  it("a non-colliding deployable keeps its name (byte-identical path)", async () => {
    const files = await generateSystemFiles(systemSource("shop"));
    expect(files.has("shop/Shop.csproj")).toBe(true);
    expect(filesRootedAt(files, "shop/", "ShopApp")).toEqual([]);
    expect(filesRootedAt(files, "shop/", "Shop")).toContain(
      "shop/Infrastructure/Persistence/AppDbContext.cs",
    );
  });

  it("a deployable named like its CONTEXT is not a collision", async () => {
    const files = await generateSystemFiles(systemSource("payments"));
    expect(files.has("payments/Payments.csproj")).toBe(true);
  });

  it("the coreclr launch config names the suffixed assembly", async () => {
    const files = await generateSystemFiles(systemSource("pay"), { sourcemap: true });
    const launch = JSON.parse(files.get(".vscode/launch.json")!) as {
      configurations: Array<{ program?: string }>;
    };
    expect(launch.configurations.map((c) => c.program)).toContain(
      `\${workspaceFolder}/pay/bin/Debug/${DOTNET_TFM}/PayApp.dll`,
    );
  });

  // The legacy `generate dotnet` entry (root namespace = the context name, so
  // `context Pay { aggregate Pay }` hit the same CS0118) calls this same helper;
  // it is pinned here rather than through the legacy entry, whose callers the
  // M-T9.49 ratchet only lets shrink.  Its compile leg ran in docker (see PR).
  it("the shared helper: suffix only on an exact declared-type match, repeated until free", () => {
    const ctx = (names: { aggs?: string[]; vos?: string[]; enums?: string[] }) =>
      ({
        aggregates: (names.aggs ?? []).map((name) => ({ name, parts: [] })),
        valueObjects: (names.vos ?? []).map((name) => ({ name })),
        enums: (names.enums ?? []).map((name) => ({ name })),
        events: [],
        payloads: [],
        domainServices: [],
        projections: [],
      }) as unknown as BoundedContextIR;
    expect(clashFreeRootNamespace("Pay", [ctx({ aggs: ["Pay"] })])).toBe("PayApp");
    expect(clashFreeRootNamespace("Pay", [ctx({ aggs: ["Pay"], vos: ["PayApp"] })])).toBe(
      "PayAppApp",
    );
    expect(clashFreeRootNamespace("Kind", [ctx({ enums: ["Kind"] })])).toBe("KindApp");
    expect(clashFreeRootNamespace("Payments", [ctx({ aggs: ["Pay", "Payment"] })])).toBe(
      "Payments",
    );
  });
});
