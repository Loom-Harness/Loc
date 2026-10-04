// ---------------------------------------------------------------------------
// Which server-owned fields `loom.unconstructible-server-field` refuses — and,
// just as load-bearing, which it must NOT.
//
// The gate's first shape refused every non-optional `managed`/`internal` field
// with no default and no stamp, exempting only `bool` and collections. That
// swept up three idioms that already work on every backend, measured on `main`
// before the narrowing:
//
//   placedAt: datetime managed     node `new Date()`, python `datetime.now()`
//   loginCount: int managed        node `0`, python `0`, java/dotnet primitive 0
//   adminNotes: string internal    node `""`, python `""`
//
// and it refused them alongside the one shape that genuinely has no value:
//
//   total: money managed           node `total: null` into a non-nullable Decimal
//
// So the acceptance half below is not padding — it is the half that says the
// gate did not become a ban on `managed`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { TypeIR } from "../../src/ir/types/loom-ir.js";
import { serverInitSeed } from "../../src/ir/util/server-init-seed.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.unconstructible-server-field";

const SYS = (field: string) => `
system Acct {
  subdomain S {
    context C {
      valueobject Money { amount: money  currency: string }
      enum Tier { Free, Paid }
      aggregate Account with crudish {
        email: string
        ${field}
      }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: node contexts: [C] dataSources: [st] serves: A port: 3000 }
}`;

async function refusedFields(field: string): Promise<string[]> {
  const { model } = await parseString(SYS(field));
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error" && d.code === CODE)
    .map((d) => d.source ?? "");
}

const prim = (name: string): TypeIR => ({ kind: "primitive", name }) as TypeIR;

describe("the server-init seed table", () => {
  it.each([
    ["datetime", "now"],
    ["int", "zero"],
    ["long", "zero"],
    ["decimal", "zero"],
    ["bool", "false"],
    ["string", "empty-string"],
    ["guid", "empty-string"],
  ] as const)("%s seeds to %s", (name, expected) => {
    expect(serverInitSeed(prim(name))).toBe(expected);
  });

  it.each(["money", "json"] as const)("%s has no seed", (name) => {
    expect(serverInitSeed(prim(name))).toBeNull();
  });

  it("a collection is the empty collection", () => {
    expect(serverInitSeed({ kind: "array", element: prim("string") } as TypeIR)).toBe(
      "empty-collection",
    );
  });
});

describe("loom.unconstructible-server-field", () => {
  describe("REFUSED — the type has no absent value", () => {
    it.each([
      ["a managed money", "total: money managed"],
      ["an internal money", "total: money internal"],
      ["a managed value object", "price: Money managed"],
      ["a managed enum", "tier: Tier managed"],
    ] as const)("%s", async (_label, field) => {
      expect(await refusedFields(field)).toHaveLength(1);
    });
  });

  describe("ACCEPTED — the type has one, or the model supplies one", () => {
    it.each([
      ["a managed datetime (the placement-stamp idiom)", "placedAt: datetime managed"],
      ["a managed int counter", "loginCount: int managed"],
      ["an internal string", "adminNotes: string internal"],
      ["a managed decimal", "score: decimal managed"],
      ["a managed bool", "flagged: bool managed"],
      ["a managed collection", "tags: string[] managed"],
      ["a managed money WITH a default", 'total: money managed = money("0.00")'],
      ["an optional managed money", "total: money? managed"],
    ] as const)("%s", async (_label, field) => {
      expect(await refusedFields(field)).toEqual([]);
    });

    it("a managed money written by a stamp onCreate", async () => {
      expect(
        await refusedFields(
          'total: money managed\n        stamp onCreate { total := money("0.00") }',
        ),
      ).toEqual([]);
    });
  });
});
