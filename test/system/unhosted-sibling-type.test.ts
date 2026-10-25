// A deployable that hosts context B, whose aggregate uses an enum and a value
// object declared in sibling context A that the deployable does NOT host
// (claims D15).  The reference is legal and resolves at lowering, but each
// typed backend's "declare the foreign types" path was seeded from broker-
// consumed foreign events only — so the deployable referenced `Kind` / `Addr`
// and declared neither:
//
//   node    domain/value-objects.ts empty → TS2306 "is not a module"
//   python  app/domain/value_objects.py without Addr / Kind → mypy attr-defined
//   java    no Kind.java / Addr.java → javac "cannot find symbol"
//   .NET    no Domain/Enums/Kind.cs, Domain/ValueObjects/Addr.cs → CS0246
//   elixir  clm_response.ex names Schemas.Kind / $ref Addr; neither module
//           nor component emitted (the OpenAPI document dangles)
//
// The fix seeds the same closure (`src/ir/util/foreign-event-types.ts`) from
// the hosted contexts' own type positions too.  Compile-proven on the repro
// (node tsc, .NET build); this pins the declarations.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system R {
  subdomain S {
    context A {
      enum Kind { Fire, Theft }
      valueobject Addr { street: string city: string }
      enum Unused { X, Y }
      aggregate Pol with crudish { name: string }
      repository Pols for Pol { }
    }
    context B {
      aggregate Clm with crudish { kind: Kind  addr: Addr  title: string }
      repository Clms for Clm { }
    }
  }
  storage primary { type: postgres }
  resource a { for: A, kind: state, use: primary }
  resource b { for: B, kind: state, use: primary }
  deployable api { platform: ${platform}, contexts: [B], dataSources: [b], port: 3000 }
}
`;

function bySuffix(files: Map<string, string>, suffix: string): string | undefined {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  return key ? files.get(key) : undefined;
}

describe("a sibling-context enum / VO the deployable does not host is declared (D15)", () => {
  it("node: domain/value-objects.ts declares Kind and Addr", async () => {
    const files = await generateSystemFiles(src("node"));
    const vo = bySuffix(files, "api/domain/value-objects.ts") ?? "";
    expect(vo).toMatch(/export (type|const) Kind\b/);
    expect(vo).toMatch(/export (class|interface|type) Addr\b/);
    // Only what the hosted surface reaches — not every sibling declaration.
    expect(vo).not.toMatch(/\bUnused\b/);
  });

  it("python: app/domain/value_objects.py declares Kind and Addr", async () => {
    const files = await generateSystemFiles(src("python"));
    const vo = bySuffix(files, "app/domain/value_objects.py") ?? "";
    expect(vo).toMatch(/^class Kind\(/m);
    expect(vo).toMatch(/^class Addr\b/m);
    expect(vo).not.toMatch(/\bUnused\b/);
  });

  it("java: Kind.java and Addr.java are emitted (no channels needed)", async () => {
    const files = await generateSystemFiles(src("java"));
    expect(bySuffix(files, "/Kind.java")).toMatch(/enum Kind\b/);
    expect(bySuffix(files, "/Addr.java")).toMatch(/record Addr\b|class Addr\b/);
    expect(bySuffix(files, "/Unused.java")).toBeUndefined();
  });

  it(".NET: Domain/Enums/Kind.cs and Domain/ValueObjects/Addr.cs are emitted", async () => {
    const files = await generateSystemFiles(src("dotnet"));
    expect(bySuffix(files, "Domain/Enums/Kind.cs")).toMatch(/enum Kind\b/);
    expect(bySuffix(files, "Domain/ValueObjects/Addr.cs")).toMatch(/\bAddr\b/);
    expect(bySuffix(files, "Domain/Enums/Unused.cs")).toBeUndefined();
  });

  it("elixir: the OpenAPI Kind / Addr schema modules the responses reference exist", async () => {
    const files = await generateSystemFiles(src("elixir"));
    const resp = bySuffix(files, "api/schemas/clm_response.ex") ?? "";
    expect(resp).toContain("Schemas.Kind");
    expect(resp).toContain("Schemas.Addr");
    expect(bySuffix(files, "api/schemas/kind.ex")).toMatch(/defmodule \S+\.Schemas\.Kind\b/);
    expect(bySuffix(files, "api/schemas/addr.ex")).toMatch(/defmodule \S+\.Schemas\.Addr\b/);
    expect(bySuffix(files, "api/schemas/unused.ex")).toBeUndefined();
  });
});
