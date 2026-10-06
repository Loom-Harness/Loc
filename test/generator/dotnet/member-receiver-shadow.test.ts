import { describe, expect, it } from "vitest";
import {
  CS_BCL_RECEIVER_HOME,
  csBcl,
  csMemberScope,
  csProjectType,
} from "../../../src/generator/dotnet/bcl-collision.js";
import { renderCsExpr } from "../../../src/generator/dotnet/render-expr.js";
import type { ExprIR } from "../../../src/ir/types/loom-ir.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// A domain member spelled like a static receiver shadows it (.NET).
//
// The sibling of system-namespace-shadow.test.ts.  `math: int` is emitted as
// the C# property `Math`; inside the declaring class C# simple-name lookup
// finds that MEMBER before the BCL type, so every expression-position static
// call the emitter writes there binds against `int` instead.  Measured under
// `dotnet build /warnaserror` (sdk:10.0), before the fix:
//
//   Math.Abs(this.N)                    CS0176 Member 'int.Abs(int)' cannot be
//                                       accessed with an instance reference
//   Math.Round(…, MidpointRounding.AwayFromZero)
//                                       CS1061 'int' does not contain a
//                                       definition for 'Round' / 'AwayFromZero'
//   Regex.IsMatch(…)                    CS1061 'string' … 'IsMatch'
//   StartsWith(…, StringComparison.Ordinal)
//                                       CS1061 'int' … 'Ordinal'
//   TimeSpan.FromDays(1)                CS1061 'int' … 'FromDays'
//   DateTime.UtcNow                     CS1061 'string' … 'UtcNow'
//   Guid.CreateVersion7()               CS1061 'string' … 'CreateVersion7'
//   Pricing.Quote(this.N)               CS1061 'string' … 'Quote'
//   DomainLog.LogTrace(…)  (--trace)    CS1929 'string' does not contain a
//                                       definition for 'LogTrace'
//
// The fix qualifies the receiver from `global::` on a collision only, so every
// other model is byte-identical.
// ---------------------------------------------------------------------------

const intRef = (name: string): ExprIR =>
  ({ kind: "ref", name, refKind: "this-prop", type: { kind: "primitive", name: "int" } }) as ExprIR;
const decRef = (name: string): ExprIR =>
  ({
    kind: "ref",
    name,
    refKind: "this-prop",
    type: { kind: "primitive", name: "decimal" },
  }) as ExprIR;
const strRef = (name: string): ExprIR =>
  ({
    kind: "ref",
    name,
    refKind: "this-prop",
    type: { kind: "primitive", name: "string" },
  }) as ExprIR;
const lit = (l: string, value: string): ExprIR => ({ kind: "literal", lit: l, value }) as ExprIR;
const call = (recv: ExprIR, member: string, args: ExprIR[], recvPrim: string): ExprIR =>
  ({
    kind: "method-call",
    receiver: recv,
    member,
    args,
    receiverType: { kind: "primitive", name: recvPrim },
  }) as ExprIR;

/** Every receiver the probes below exercise, as `.ddd` member names. */
const COLLIDING = [
  "math",
  "midpointRounding",
  "stringComparison",
  "regex",
  "timeSpan",
  "dateTime",
  "Guid",
  "pricing",
];
const shadowed = { thisName: "this", memberScope: csMemberScope(COLLIDING, "Api") };
const plain = { thisName: "this", memberScope: csMemberScope(["n", "label"], "Api") };

describe("dotnet — a member spelled like a static receiver shadows it", () => {
  it("qualifies a receiver only when a same-named member is in scope", () => {
    const scope = csMemberScope(["math"], "Api");
    expect(csBcl("Math", scope)).toBe("global::System.Math");
    expect(csBcl("Regex", csMemberScope(["regex"], "Api"))).toBe(
      "global::System.Text.RegularExpressions.Regex",
    );
    expect(csBcl("Regex", scope)).toBe("Regex");
    expect(csBcl("Math", undefined)).toBe("Math");
    expect(csProjectType("DomainLog", "Domain.Common", csMemberScope(["domainLog"], "Shop"))).toBe(
      "global::Shop.Domain.Common.DomainLog",
    );
    expect(csProjectType("DomainLog", "Domain.Common", scope)).toBe("DomainLog");
    // Every catalogued receiver lives where its home says.
    for (const [name, home] of Object.entries(CS_BCL_RECEIVER_HOME)) {
      expect(csBcl(name as keyof typeof CS_BCL_RECEIVER_HOME, csMemberScope([name], "Api"))).toBe(
        `global::${home}.${name}`,
      );
    }
  });

  const cases: [string, ExprIR, string, string][] = [
    [
      "int.abs",
      call(intRef("n"), "abs", [], "int"),
      "Math.Abs(this.N)",
      "global::System.Math.Abs(this.N)",
    ],
    [
      "decimal.round",
      call(decRef("cost"), "round", [lit("int", "2")], "decimal"),
      "Math.Round(this.Cost, 2, MidpointRounding.AwayFromZero)",
      "global::System.Math.Round(this.Cost, 2, global::System.MidpointRounding.AwayFromZero)",
    ],
    [
      "string.startsWith",
      call(strRef("label"), "startsWith", [lit("string", "xy")], "string"),
      'this.Label.StartsWith("xy", StringComparison.Ordinal)',
      'this.Label.StartsWith("xy", global::System.StringComparison.Ordinal)',
    ],
    [
      "string.substring",
      call(strRef("label"), "substring", [lit("int", "1"), lit("int", "2")], "string"),
      '(1 >= this.Label.Length ? "" : this.Label.Substring(1, Math.Min(2, this.Label.Length - 1)))',
      '(1 >= this.Label.Length ? "" : this.Label.Substring(1, global::System.Math.Min(2, this.Label.Length - 1)))',
    ],
    [
      "string.matches",
      call(strRef("label"), "matches", [lit("string", "^a$")], "string"),
      'Regex.IsMatch(this.Label, "^a$")',
      'global::System.Text.RegularExpressions.Regex.IsMatch(this.Label, "^a$")',
    ],
    [
      "days(n)",
      { kind: "duration", unit: "days", amount: lit("int", "1") } as ExprIR,
      "TimeSpan.FromDays(1)",
      "global::System.TimeSpan.FromDays(1)",
    ],
    ["now()", lit("now", ""), "DateTime.UtcNow", "global::System.DateTime.UtcNow"],
    [
      "domain-service call",
      {
        kind: "call",
        name: "quote",
        callKind: "domain-service",
        serviceRef: { service: "Pricing", op: "quote" },
        args: [intRef("n")],
      } as unknown as ExprIR,
      "Pricing.Quote(this.N)",
      "global::Api.Domain.Services.Pricing.Quote(this.N)",
    ],
  ];
  for (const [label, expr, bare, qualified] of cases) {
    it(`${label}: bare without a collision, global::-qualified with one`, () => {
      expect(renderCsExpr(expr, plain)).toBe(bare);
      expect(renderCsExpr(expr, { thisName: "this" })).toBe(bare);
      expect(renderCsExpr(expr, shadowed)).toBe(qualified);
    });
  }

  // The end-to-end probe: the shape `dotnet build /warnaserror` was run on.
  const model = (persistence: string) => `
system S {
  subdomain Core {
    context Probes {
      enum Level { Low, High }
      domainService Pricing {
        operation quote(x: int): int { return x + 1 }
      }
      valueobject Tag {
        math: int
        regex: string
        midpointRounding: int
        stringComparison: int
        cost: decimal
        label: string
        derived a: decimal = cost.round(2)
        derived b: int = math.abs()
        derived c: bool = label.matches("^[a-z]+$")
        derived d: bool = label.startsWith("xy")
      }
      aggregate Probe with crudish {
        math: int
        regex: string
        midpointRounding: int
        stringComparison: int
        timeSpan: int
        dateTime: string
        domainLog: string
        pricing: string
        level: Level
        cost: decimal
        label: string
        seenAt: datetime
        n: int
        tag: Tag
        invariant n >= 0
        derived a: decimal = cost.round(2)
        derived b: int = n.abs()
        derived c: bool = label.matches("^[a-z]+$")
        derived d: bool = label.startsWith("xy")
        derived e: string = label.substring(1, 2)
        derived h: datetime = seenAt + days(1)
        derived i: int = Pricing.quote(n)
        operation touch() {
          precondition n > 0
          seenAt := now()
          n := Pricing.quote(n)
        }
      }
      repository Probes for Probe { }
    }
  }
  storage pg { type: postgres }
  resource st { for: Probes, kind: state, use: pg }
  deployable api { platform: dotnet${persistence} contexts: [Probes] dataSources: [st] port: 3000 }
}
`;
  /** A bare (unqualified) use of `name` as a static receiver. */
  const bareUse = (name: string) => new RegExp(`(?<![\\w.:])${name}\\.[A-Z]`);
  const RECEIVERS = [
    "Math",
    "MidpointRounding",
    "StringComparison",
    "Regex",
    "TimeSpan",
    "DateTime",
    "Pricing",
    "DomainLog",
  ];

  for (const persistence of ["", " { persistence: dapper }"]) {
    it(`an aggregate + value object with colliding members qualify every receiver (dotnet${persistence}, --trace)`, async () => {
      const files = await generateSystemFiles(model(persistence), { emitTrace: true });
      const pick = (suffix: string) => {
        const key = [...files.keys()].find((k) => k.endsWith(suffix));
        expect(key, `${suffix} emitted`).toBeDefined();
        return files.get(key!)!;
      };
      const entity = pick("Domain/Probes/Probe.cs");
      const vo = pick("Domain/ValueObjects/Tag.cs");
      for (const [file, text] of [
        ["Probe.cs", entity],
        ["Tag.cs", vo],
      ] as const) {
        const body = text.split("\n").filter((l) => !l.startsWith("using "));
        for (const name of RECEIVERS) {
          // `this.Math` (the member read) is fine; only a bare receiver binds wrong.
          const unpinned = body.filter((l) => bareUse(name).test(l));
          expect(unpinned, `${file}: bare ${name}.`).toEqual([]);
        }
      }
      expect(entity).toContain("global::System.Math.Abs(this.N)");
      expect(entity).toContain(
        "global::System.Math.Round(this.Cost, 2, global::System.MidpointRounding.AwayFromZero)",
      );
      expect(entity).toContain("global::System.Text.RegularExpressions.Regex.IsMatch(");
      expect(entity).toContain("global::System.StringComparison.Ordinal");
      expect(entity).toContain("global::System.TimeSpan.FromDays(1)");
      expect(entity).toContain("SeenAt = global::System.DateTime.UtcNow;");
      expect(entity).toContain("global::Api.Domain.Services.Pricing.Quote(this.N)");
      expect(entity).toContain("global::Api.Domain.Common.DomainLog.LogTrace(");
      expect(vo).toContain("global::System.Math.Abs(this.Math)");
    });
  }

  it("leaves a model without colliding members on the bare spellings", async () => {
    const files = await generateSystemFiles(
      model("")
        .replace(
          /^\s+(math|regex|midpointRounding|stringComparison|timeSpan|dateTime|domainLog|pricing): \w+$/gm,
          "",
        )
        .replace("math.abs()", "label.length"),
      { emitTrace: true },
    );
    const key = [...files.keys()].find((k) => k.endsWith("Domain/Probes/Probe.cs"));
    const entity = files.get(key!)!;
    expect(entity).not.toContain("global::");
    expect(entity).toContain("Math.Abs(this.N)");
    expect(entity).toContain("Regex.IsMatch(");
    expect(entity).toContain("Pricing.Quote(this.N)");
    expect(entity).toContain("DomainLog.LogTrace(");
  });
});
