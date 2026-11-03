import { describe, expect, it } from "vitest";
import {
  collectWireValidationMessages,
  hasWireValidationMessages,
} from "../../../src/generator/_i18n/validation-catalog.js";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import type { BoundedContextIR } from "../../../src/ir/types/loom-ir.js";
import { parseString } from "../../_helpers/parse.js";

// ---------------------------------------------------------------------------
// The backend validation-message CATALOG collector (M-T1.11).
//
// The one place that decides which named rules' messages a backend ships and
// what key each has (the rule's identity key `<Ctx>.<Owner>.rule.<name>`).  All five backends build their catalog from it,
// so what it includes / excludes IS the cross-backend contract.
// ---------------------------------------------------------------------------

const wrap = (body: string) => `
  system S {
    subdomain Sales {
      context Cat {
        ${body}
      }
    }
    api CatApi from Sales
    storage db { type: postgres }
    resource st { for: Cat, kind: state, use: db }
    deployable api { platform: node contexts: [Cat] dataSources: [st] serves: CatApi port: 8080 }
  }
`;

async function contextsOf(body: string): Promise<BoundedContextIR[]> {
  const { model } = await parseString(wrap(body), { validate: false });
  const enriched = enrichLoomModel(lowerModel(model));
  return enriched.systems[0]!.subdomains.flatMap((s) => s.contexts);
}

async function catalogOf(body: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const m of collectWireValidationMessages(await contextsOf(body))) out[m.code] = m.text;
  return out;
}

describe("validation-message catalog — what it collects", () => {
  it("collects an aggregate invariant, a field check, and an operation precondition", async () => {
    const catalog = await catalogOf(`
      aggregate Product {
        sku: string check skuRequired: sku.length > 0
        name: string
        qty: int
        invariant nameMinLength: name.length >= 2
        create(n: string, s: string, q: int) { name := n  sku := s  qty := q }
        operation restock(amount: int) {
          precondition amountPositive: amount >= 1
          qty := qty + amount
        }
      }
      repository Products for Product { }
    `);
    expect(catalog).toEqual({
      "Cat.Product.rule.skuRequired": "Sku required",
      "Cat.Product.rule.nameMinLength": "Name min length",
      "Cat.Product.rule.amountPositive": "Amount positive",
    });
  });

  it("collects a value-object invariant (the `<Vo>Request` validator shape)", async () => {
    const catalog = await catalogOf(`
      valueobject Sku {
        code: string
        invariant code.length >= 3 message "SKU code needs at least 3 characters"
      }
      aggregate Product {
        sku: Sku
        create(s: Sku) { sku := s }
      }
      repository Products for Product { }
    `);
    expect(catalog).toEqual({
      // The removed `message "…"` clause still compiles — named as the codemod
      // names it, its text the English default.
      "Cat.Sku.rule.skuCodeNeedsAt": "SKU code needs at least 3 characters",
    });
  });

  it("keys by the rule's identity, so a reword keeps the key", async () => {
    const catalog = await catalogOf(`
      aggregate Product {
        name: string
        invariant nameLong: name.length >= 2
        create(n: string) { name := n }
      }
      repository Products for Product { }
    `);
    expect(Object.keys(catalog)).toEqual(["Cat.Product.rule.nameLong"]);
  });

  it("keeps two rules with the same text as two entries — each has its own key", async () => {
    const catalog = await catalogOf(`
      aggregate Product {
        a: int
        b: int
        invariant a >= 0 message "Must not be negative"
        invariant b >= 0 message "Must not be negative"
        create(x: int, y: int) { a := x  b := y }
      }
      repository Products for Product { }
    `);
    expect(catalog).toEqual({
      "Cat.Product.rule.notNegative": "Must not be negative",
      "Cat.Product.rule.notNegative2": "Must not be negative",
    });
  });

  it("excludes an UNNAMED rule — it answers the generic message and carries no code", async () => {
    const catalog = await catalogOf(`
      aggregate Product {
        qty: int
        invariant qty >= 0
        create(q: int) { qty := q }
      }
      repository Products for Product { }
    `);
    expect(catalog).toEqual({});
    expect(hasWireValidationMessages(await contextsOf("aggregate P { n: int }"))).toBe(false);
  });

  it("INCLUDES a `private` (server-only) named rule — the domain floor carries its code", async () => {
    const catalog = await catalogOf(`
      aggregate Product {
        name: string
        private invariant nameLong: name.length >= 2
        create(n: string) { name := n }
      }
      repository Products for Product { }
    `);
    // No wire validator sees it, but it enforces at the DOMAIN FLOOR — and the
    // domain floor answers with the rule's `code` on its errors[] entry, which
    // the 422 handler resolves through this catalog.
    expect(catalog).toEqual({ "Cat.Product.rule.nameLong": "Name long" });
  });

  it("sorts by key, so the emitted catalog is byte-stable across runs", async () => {
    const messages = collectWireValidationMessages(
      await contextsOf(`
        aggregate Product {
          a: int
          b: int
          c: int
          invariant zzz: a >= 0
          invariant aaa: b >= 0
          invariant mmm: c >= 0
          create(x: int, y: int, z: int) { a := x  b := y  c := z }
        }
        repository Products for Product { }
      `),
    );
    const codes = messages.map((m) => m.code);
    expect(codes).toEqual([...codes].sort());
  });
});
