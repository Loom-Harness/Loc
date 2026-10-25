import { describe, expect, it } from "vitest";
import { csMemberScope, csParamIdent } from "../../../src/generator/dotnet/bcl-collision.js";
import { csSingleCharLiteral, renderCsExpr } from "../../../src/generator/dotnet/render-expr.js";
import type { ExprIR } from "../../../src/ir/types/loom-ir.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Legal models whose generated .NET project failed `dotnet build /warnaserror`
// (sdk:10.0, EF and Dapper adapters) — measured before each fix:
//
//   1. A field spelled with a capital (`Guid: string`, `Total: int`) gave a
//      constructor / `with crudish` update parameter identical to its property:
//        public Tag(string Guid, int Total, string label) { Guid = Guid; … }
//        error CS1717: Assignment made to same variable
//        error CS8618: Non-nullable property 'Guid' must contain a non-null value
//      → the parameter is renamed on a collision only (`guid`).
//   2. `startsWith("x")` / `endsWith("y")` with a ONE-character literal:
//        error CA1865: Use 'string.StartsWith(char)' instead of
//                      'string.StartsWith(string)' …
//      → the domain position takes the char overload.  The EF query position
//      (find `where`, criterion) cannot — EF Core 10/Npgsql throws "could not
//      be translated" on every char overload — so its CA1866 is NoWarn'd.
//   3. `Guid.Parse` in the `this.id == <string>` lift ignored the member scope
//      (the shared `binary` leaf had no ctx) → qualified when shadowed.
//   4. CA1720 "Identifier 'Guid' contains type name" on every surface of the
//      field → NoWarn'd (the name is the author's wire contract).
//   +  --trace: CA1861 on the controller's inline `new[] { "p" }` wire_in
//      argument, CA2254 on DomainLog's forwarding `LogTrace(template, args)`.
// ---------------------------------------------------------------------------

const MODEL = (persistence: "ef" | "dapper") => `
system Probe {
  subdomain Shop {
    context Sales {
      valueobject Tag {
        Guid: string
        Total: int
        label: string
      }
      aggregate Item with crudish {
        Guid: string
        Total: int
        name: string
        tag: Tag
        operation probe(p: string) {
          precondition name.startsWith("x")
          precondition name.endsWith("y")
          precondition name.contains("z")
          precondition name.startsWith("ab")
        }
      }
      criterion XItem of Item = this.name.startsWith("q")
      repository Items for Item {
        find xs(): Item[] where this.name.startsWith("w")
      }
    }
  }
  api SalesApi from Shop
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable api {
    platform: dotnet${persistence === "dapper" ? " { persistence: dapper }" : ""}
    contexts: [Sales]
    dataSources: [salesState]
    serves: SalesApi
    port: 5000
  }
}
`;

const strip = (cs: string) =>
  cs
    .split("\n")
    .filter((l) => !l.startsWith("#line"))
    .join("\n");

describe("dotnet — a parameter spelled like a member of its class", () => {
  it("csParamIdent renames only on a collision", () => {
    const scope = csMemberScope(["Guid", "Total", "name"], "Api");
    expect(csParamIdent("Guid", scope)).toBe("guid");
    expect(csParamIdent("Total", scope)).toBe("total");
    // Byte-identical for an ordinary lower-case param (and keyword-escaped as before).
    expect(csParamIdent("name", scope)).toBe("name");
    expect(csParamIdent("event", scope)).toBe("@event");
    expect(csParamIdent("Guid", undefined)).toBe("Guid");
    // A lowered spelling that is a C# keyword is escaped.
    expect(csParamIdent("Event", csMemberScope(["Event"], "Api"))).toBe("@event");
    // Nothing to lower → a trailing underscore.
    expect(csParamIdent("_x", csMemberScope(["_x"], "Api"))).toBe("_x_");
  });

  for (const persistence of ["ef", "dapper"] as const) {
    it(`value-object ctor + crudish update never self-assign (${persistence})`, async () => {
      const files = await generateSystemFiles(MODEL(persistence));
      const vo = strip(files.get("api/Domain/ValueObjects/Tag.cs")!);
      expect(vo).toContain("    public Tag(string guid, int total, string label)");
      expect(vo).toContain("        Guid = guid;\n        Total = total;\n        Label = label;");
      expect(vo).not.toMatch(/(\w+) = \1;/);

      const item = strip(files.get("api/Domain/Items/Item.cs")!);
      expect(item).toContain(
        "    public void Update(string guid, int total, string name, Tag tag)",
      );
      expect(item).toContain("        Guid = guid;\n        Total = total;\n        Name = name;");
      expect(item).not.toMatch(/^\s+(\w+) = \1;/m);
      // The static factory is unaffected (it assigns through `e.`), and the
      // handler still calls the update positionally.
      expect(item).toContain(
        "    public static Item Create(string Guid, int Total, string name, Tag tag)",
      );
      expect(files.get("api/Application/Items/Commands/UpdateHandler.cs")).toContain(
        "aggregate.Update(command.Guid, command.Total, command.Name, command.Tag);",
      );
    });
  }

  it("an op-body ref to a renamed param follows the rename", () => {
    const ref: ExprIR = {
      kind: "ref",
      name: "Guid",
      refKind: "param",
      type: { kind: "primitive", name: "string" },
    } as ExprIR;
    expect(
      renderCsExpr(ref, { thisName: "this", memberScope: csMemberScope(["Guid"], "Api") }),
    ).toBe("guid");
    expect(renderCsExpr(ref, { thisName: "this" })).toBe("Guid");
  });
});

describe("dotnet — one-character string literal → char overload (CA1865)", () => {
  it("csSingleCharLiteral recognises exactly one UTF-16 unit", () => {
    expect(csSingleCharLiteral('"x"')).toBe("'x'");
    expect(csSingleCharLiteral(JSON.stringify("'"))).toBe("'\\''");
    expect(csSingleCharLiteral(JSON.stringify("\\"))).toBe("'\\\\'");
    expect(csSingleCharLiteral(JSON.stringify('"'))).toBe("'\\\"'");
    expect(csSingleCharLiteral(JSON.stringify("\n"))).toBe("'\\n'");
    expect(csSingleCharLiteral('"ab"')).toBeNull();
    expect(csSingleCharLiteral('""')).toBeNull();
    expect(csSingleCharLiteral(JSON.stringify("😀"))).toBeNull();
    expect(csSingleCharLiteral("this.P")).toBeNull();
    expect(csSingleCharLiteral('"a" + this.P + "b"')).toBeNull();
  });

  it("domain position takes the char overload; longer literals and contains are unchanged", async () => {
    const files = await generateSystemFiles(MODEL("ef"));
    const item = files.get("api/Domain/Items/Item.cs")!;
    expect(item).toContain("this.Name.StartsWith('x')");
    expect(item).toContain("this.Name.EndsWith('y')");
    expect(item).toContain('this.Name.Contains("z", StringComparison.Ordinal)');
    expect(item).toContain('this.Name.StartsWith("ab", StringComparison.Ordinal)');
  });

  it("EF query position keeps the translatable string overload; CA1866 is NoWarn'd", async () => {
    const files = await generateSystemFiles(MODEL("ef"));
    expect(files.get("api/Infrastructure/Repositories/ItemRepository.cs")).toContain(
      'x.Name.StartsWith("w")',
    );
    expect(files.get("api/Domain/Criteria/XItemCriterion.cs")).toContain('StartsWith("q")');
    const csproj = files.get("api/Api.csproj")!;
    expect(csproj).toMatch(/<NoWarn>[^<]*\bCA1866\b[^<]*<\/NoWarn>/);
    expect(csproj).not.toMatch(/<NoWarn>[^<]*\bCA1865\b[^<]*<\/NoWarn>/);
  });

  // A reified criterion renders ONE body for both faces (criteria-emit.ts:
  // `efQuery: true`), so the in-memory `IsSatisfiedBy` carries the EF spelling
  // too.  That needs no split for /warnaserror: the two analyzers key on the
  // CALL SHAPE, not on the position —
  //   CA1865  StartsWith("x", StringComparison.Ordinal)  → domain renderer;
  //           avoided there by the char overload, never emitted by a criterion.
  //   CA1866  StartsWith("x")  (bare string overload)    → BOTH criterion faces
  //           (measured: CodeXCriterion.cs lines 14 + 16 under sdk:10.0, EF and
  //           Dapper, once CA1866 is removed from NoWarn) — suppressed.
  // So the shared body builds clean; splitting would only change the in-memory
  // semantics from culture-default to ordinal (the caveat render-expr.ts's
  // CS_INTRINSIC_QUERY_RENDERERS comment records), not the build verdict.
  for (const persistence of ["ef", "dapper"] as const) {
    it(`criterion faces share the bare StartsWith("q") — CA1866-suppressed, never CA1865 (${persistence})`, async () => {
      const files = await generateSystemFiles(MODEL(persistence));
      const crit = files.get("api/Domain/Criteria/XItemCriterion.cs")!;
      expect(crit).toContain(
        '    public override bool IsSatisfiedBy(Item candidate) => candidate.Name.StartsWith("q");',
      );
      expect(crit).toContain(
        '    public Expression<Func<Item, bool>> ToExpression() => candidate => candidate.Name.StartsWith("q");',
      );
      expect(crit).not.toContain("StringComparison");
      const csproj = files.get("api/Api.csproj")!;
      expect(csproj).toMatch(/<NoWarn>[^<]*\bCA1866\b[^<]*<\/NoWarn>/);
    });
  }
});

describe("dotnet — the `this.id == <string>` lift honours the member scope", () => {
  const eq: ExprIR = {
    kind: "binary",
    op: "==",
    left: {
      kind: "member",
      receiver: { kind: "this" },
      member: "id",
      receiverType: { kind: "entity", name: "Item" },
      memberType: { kind: "id", targetName: "Item", valueType: "guid" },
    },
    right: {
      kind: "ref",
      name: "p",
      refKind: "param",
      type: { kind: "primitive", name: "string" },
    },
  } as unknown as ExprIR;

  it("qualifies Guid.Parse only when a `Guid` member is in scope", () => {
    expect(renderCsExpr(eq, { thisName: "this" })).toBe("this.Id == new ItemId(Guid.Parse(p))");
    expect(
      renderCsExpr(eq, { thisName: "this", memberScope: csMemberScope(["name"], "Api") }),
    ).toBe("this.Id == new ItemId(Guid.Parse(p))");
    expect(
      renderCsExpr(eq, { thisName: "this", memberScope: csMemberScope(["Guid"], "Api") }),
    ).toBe("this.Id == new ItemId(global::System.Guid.Parse(p))");
    // The EF-query twin rides the same leaf.
    expect(
      renderCsExpr(eq, {
        thisName: "x",
        efQuery: true,
        memberScope: csMemberScope(["Guid"], "Api"),
      }),
    ).toBe("x.Id == new ItemId(global::System.Guid.Parse(p))");
  });
});

describe("dotnet — analyzer configuration + --trace residue", () => {
  it("CA1720 (identifier contains type name) is NoWarn'd", async () => {
    const files = await generateSystemFiles(MODEL("ef"));
    expect(files.get("api/Api.csproj")).toMatch(/<NoWarn>[^<]*\bCA1720\b[^<]*<\/NoWarn>/);
  });

  it("--trace: wire_in keys bound to a local (CA1861); DomainLog forwarder pragma'd (CA2254)", async () => {
    const files = await generateSystemFiles(MODEL("ef"), { emitTrace: true });
    const ctl = files.get("api/Api/ItemsController.cs")!;
    expect(ctl).toContain(
      '        var __wireInKeys = new[] { "p" };\n        _log.LogTrace("{Event} keys={Keys}", "wire_in", __wireInKeys);',
    );
    expect(ctl).not.toMatch(/"wire_in", new\[\]/);
    const log = files.get("api/Domain/Common/DomainLog.cs")!;
    expect(log).toContain(
      "#pragma warning disable CA2254\n        Current?.LogTrace(template, args);\n#pragma warning restore CA2254",
    );
  });
});
