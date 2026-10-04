import { describe, expect, it } from "vitest";
import {
  csSystemRoot,
  shadowsSystemNamespace,
  typeShadowsSystemNamespace,
} from "../../../src/generator/dotnet/bcl-collision.js";
import { renderValueObject } from "../../../src/generator/dotnet/emit/enums-vos.js";
import { renderCsExpr } from "../../../src/generator/dotnet/render-expr.js";
import type { ExprIR, ValueObjectIR } from "../../../src/ir/types/loom-ir.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// A domain member named `system` shadows the `System` namespace (.NET).
//
// `system: string` is emitted as the C# property `System`.  Inside the
// declaring class, C# simple-name lookup finds that MEMBER before the
// namespace, so every expression-position `System.X.Y` the emitter writes
// there binds `.X` against `string`:
//
//     public string Inspect => … this.Check.ToString(System.Globalization.CultureInfo.InvariantCulture) …
//     error CS1061: 'string' does not contain a definition for 'Globalization'
//
// The fix renders `global::System.…` in that scope only (conditional, so a
// model without a `System` member is byte-identical).  The grammar still
// reserves lower-case `system` as a field name, so the end-to-end case spells
// the member `System` — it reaches the identical C# member.
// ---------------------------------------------------------------------------

const intRef: ExprIR = {
  kind: "ref",
  name: "check",
  refKind: "this-prop",
  type: { kind: "primitive", name: "int" },
} as ExprIR;
const toStr = (value: ExprIR, from: string): ExprIR =>
  ({ kind: "convert", target: "string", from, value }) as ExprIR;

describe("dotnet — `System` member shadows the System namespace", () => {
  it("names a `system`/`System` member as shadowing, and nothing else", () => {
    expect(shadowsSystemNamespace(["system"])).toBe(true);
    expect(shadowsSystemNamespace(["System"])).toBe(true);
    expect(shadowsSystemNamespace(["systems", "systemId", "subsystem"])).toBe(false);
    expect(csSystemRoot(true)).toBe("global::System");
    expect(csSystemRoot(undefined)).toBe("System");
  });

  it("qualifies the InvariantCulture conversions with global:: only when shadowed", () => {
    const shadowed = { thisName: "this", systemShadowed: true };
    expect(renderCsExpr(toStr(intRef, "int"), shadowed)).toBe(
      "this.Check.ToString(global::System.Globalization.CultureInfo.InvariantCulture)",
    );
    expect(renderCsExpr(toStr(intRef, "datetime"), shadowed)).toBe(
      'this.Check.ToString("O", global::System.Globalization.CultureInfo.InvariantCulture)',
    );
    // Byte-identical when nothing shadows the namespace.
    expect(renderCsExpr(toStr(intRef, "int"), { thisName: "this" })).toBe(
      "this.Check.ToString(System.Globalization.CultureInfo.InvariantCulture)",
    );
  });

  it("a value object with a `system` field renders its derived body against global::System", () => {
    const vo = {
      name: "Tag",
      fields: [
        { name: "system", type: { kind: "primitive", name: "string" } },
        { name: "weight", type: { kind: "primitive", name: "int" } },
      ],
      derived: [
        {
          name: "label",
          type: { kind: "primitive", name: "string" },
          expr: toStr(
            {
              kind: "ref",
              name: "weight",
              refKind: "this-prop",
              type: { kind: "primitive", name: "int" },
            } as ExprIR,
            "int",
          ),
        },
      ],
      invariants: [],
      functions: [],
      tests: [],
    } as unknown as ValueObjectIR;
    expect(typeShadowsSystemNamespace(vo)).toBe(true);
    const cs = renderValueObject(vo, "Api");
    expect(cs).toContain("public string System { get; init; }");
    expect(cs).toContain(
      "this.Weight.ToString(global::System.Globalization.CultureInfo.InvariantCulture)",
    );
    expect(cs).not.toMatch(/[^:]System\.Globalization/);
  });

  for (const persistence of ["", " { persistence: dapper }"]) {
    it(`an aggregate with a \`System\` member qualifies its own expressions (dotnet${persistence})`, async () => {
      const files = await generateSystemFiles(`
system S {
  subdomain Core {
    context Probes {
      aggregate Probe {
        System: string
        check: int
        seenAt: datetime
        cost: money

        operation rename(next: string) {
          System := next + string(check) + string(seenAt)
        }

        derived summary: string = System + string(check) + string(cost)
      }
      repository Probes for Probe { }
    }
  }
  storage pg { type: postgres }
  resource st { for: Probes, kind: state, use: pg }
  deployable api { platform: dotnet${persistence} contexts: [Probes] dataSources: [st] port: 3000 }
}
`);
      const key = [...files.keys()].find((k) => k.endsWith("Domain/Probes/Probe.cs"));
      expect(key, "Probe.cs emitted").toBeDefined();
      const entity = files.get(key!)!;
      expect(entity).toContain("public string System {");
      // Every expression-position `System.` in the entity body is pinned.
      const body = entity.split("\n").filter((l) => !l.startsWith("using "));
      const unpinned = body.filter((l) => /(?<![\w.:])System\.[A-Z]/.test(l));
      expect(unpinned).toEqual([]);
      expect(entity).toContain(
        "this.Check.ToString(global::System.Globalization.CultureInfo.InvariantCulture)",
      );
      expect(entity).toContain(
        'this.SeenAt.ToString("O", global::System.Globalization.CultureInfo.InvariantCulture)',
      );
    });
  }

  it("leaves a model without a `System` member on the plain `System.` spelling", async () => {
    const files = await generateSystemFiles(`
system S {
  subdomain Core {
    context Probes {
      aggregate Probe {
        name: string
        check: int
        derived summary: string = name + string(check)
      }
      repository Probes for Probe { }
    }
  }
  storage pg { type: postgres }
  resource st { for: Probes, kind: state, use: pg }
  deployable api { platform: dotnet contexts: [Probes] dataSources: [st] port: 3000 }
}
`);
    const key = [...files.keys()].find((k) => k.endsWith("Domain/Probes/Probe.cs"));
    const entity = files.get(key!)!;
    expect(entity).toContain(
      "this.Check.ToString(System.Globalization.CultureInfo.InvariantCulture)",
    );
    expect(entity).not.toContain("global::System");
  });

  // The event-sourced workflow fold class (`<Wf>State`) carries the state
  // fields as properties AND a static `System.Text.Json` codec, so a `System`
  // state field broke it four ways (CS0236 in the `__json` initializer, CS0120
  // in RowToEvent/ToData, CS1061 in an applier's `string(...)` conversion).
  it("an event-sourced workflow with a `System` state field pins its codec + appliers", async () => {
    const files = await generateSystemFiles(`
system S { subdomain O { context O {
  aggregate Order { status: string  operation place() { status := "P"  emit OrderPlaced { order: id } } }
  repository Orders for Order { }
  event OrderPlaced { order: Order id }
  event PaymentRegistered { order: Order id, amount: int }
  channel L { carries: OrderPlaced, PaymentRegistered  delivery: broadcast  retention: ephemeral }
  workflow Tally eventSourced {
    orderId: Order id
    total: int
    System: string
    create(p: OrderPlaced) by p.order { emit PaymentRegistered { order: p.order, amount: 0 } }
    on(pr: PaymentRegistered) by pr.order { emit PaymentRegistered { order: pr.order, amount: total } }
    apply(pr: PaymentRegistered) { total := total + pr.amount  System := System + string(pr.amount) }
  }
} } api A from O storage pg { type: postgres }
  resource oState { for: O, kind: state, use: pg }
  deployable api { platform: dotnet contexts: [O] serves: A dataSources: [oState] port: 8080 } }
`);
    const key = [...files.keys()].find((k) => k.endsWith("Application/Workflows/TallyState.cs"));
    expect(key, "TallyState.cs emitted").toBeDefined();
    const fold = files.get(key!)!;
    expect(fold).toContain("public string System { get; set; }");
    const unpinned = fold
      .split("\n")
      .filter((l) => !l.startsWith("using ") && /(?<![\w.:])System\.[A-Z]/.test(l));
    expect(unpinned).toEqual([]);
    expect(fold).toContain("new(global::System.Text.Json.JsonSerializerDefaults.Web);");
    expect(fold).toContain(
      "pr.Amount.ToString(global::System.Globalization.CultureInfo.InvariantCulture)",
    );
  });
});
