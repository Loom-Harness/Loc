import { describe, expect, it } from "vitest";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import { buildLoomModel, parseString, toLoomModel } from "../_helpers/index.js";

const SRC = `
  system S { subdomain M {
    context Catalog {
      enum Status { Draft, Active }
      valueobject Money { amount: decimal  currency: string }
      aggregate Product {
        sku: string
        price: Money
        status: Status
      }
      repository Products for Product { }
      seed demo {
        Product { sku: "DEMO-1", price: { amount: 9.99, currency: "USD" }, status: Draft }
        Product { sku: "DEMO-2", price: { amount: 19.99, currency: "USD" }, status: Active }
      }
    }
  }}
`;

describe("seed — lowering", () => {
  it("lowers a declarative seed dataset onto the context IR", async () => {
    const loom = await buildLoomModel(SRC);
    const ctx = allContexts(loom).find((c) => c.name === "Catalog")!;

    expect(ctx.seeds).toHaveLength(1);
    const seed = ctx.seeds[0];
    expect(seed.dataset).toBe("demo");
    expect(seed.path).toBe("domain");
    expect(seed.rows.map((r) => r.aggregate)).toEqual(["Product", "Product"]);

    const first = seed.rows[0];
    expect(first.fields.map((f) => f.name)).toEqual(["sku", "price", "status"]);

    // String literal field.
    expect(first.fields[0].value).toMatchObject({
      kind: "literal",
      lit: "string",
      value: "DEMO-1",
    });
    // A bare object literal in a value-object-typed create field coerces to a
    // value-object ctor call (not a plain `kind: "object"` expr, which isn't
    // assignable to the VO class) — field-ordered, ready for `new Money(…)`.
    expect(first.fields[1].value).toMatchObject({
      kind: "call",
      callKind: "value-object-ctor",
      name: "Money",
      argNames: ["amount", "currency"],
    });
  });

  it("defaults the dataset name and records the `raw` path", async () => {
    const loom = await buildLoomModel(`
      system S { subdomain M {
        context Catalog {
          aggregate Product { sku: string = "x" }
          repository Products for Product { }
          seed raw {
            Product { sku: "A" }
          }
        }
      }}
    `);
    const ctx = allContexts(loom).find((c) => c.name === "Catalog")!;
    expect(ctx.seeds[0].dataset).toBe("default");
    expect(ctx.seeds[0].path).toBe("raw");
  });
});

describe("seed — raw path lowering", () => {
  it("marks a `raw` block's SeedIR with path: raw", async () => {
    const loom = await buildLoomModel(`
      system S { subdomain M { context C {
        aggregate Widget with crudish { name: string }
        repository Widgets for Widget { }
        seed reference raw { Widget { id: "w1", name: "Alpha" } }
      }}}
    `);
    const seed = allContexts(loom).find((c) => c.name === "C")!.seeds[0];
    expect(seed.path).toBe("raw");
    expect(seed.rows[0].fields.map((f) => f.name)).toEqual(["id", "name"]);
  });
});

describe("seed — parse-error recovery does not crash the lowerer", () => {
  // `seed Party { name: "x" }` LOOKS like "seed this aggregate with these
  // fields", but the grammar reads `Party` as the optional dataset name and
  // then `name` as a row's aggregate reference — so the row loses its
  // `value=ObjectLit` at the `:` that follows and error recovery hands the
  // lowerer a `SeedRow` the AST type says cannot exist.  `lowerSeed`
  // dereferenced `row.value.fields` and threw
  // `TypeError: Cannot read properties of undefined (reading 'fields')`,
  // which replaced the parse error that describes the mistake with a stack
  // trace (audit 2026-09-03 F5, packet W1.4 / M-T5.27).
  //
  // The linking error this originally also asserted is gone by DESIGN since
  // M-FT.4 (#2761): a document that does not parse is no longer validated, so
  // no linking/validator diagnostic is invented over the recovered tree.  That
  // strengthens F5's point rather than weakening it — the parse error is now
  // the ONLY thing standing between the user and a stack trace, so the
  // lowerer discarding it is the whole defect.
  const SRC = `
    system S { subdomain M {
      context Parties {
        abstract aggregate Party inheritanceUsing: sharedTable { name: string }
        aggregate Customer extends Party { creditLimit: int }
        repository Customers for Customer { }
        seed Party { name: "x" }
      }
    }}
  `;

  it("reports the parse error instead of throwing", async () => {
    const { errors } = await parseString(SRC);
    expect(errors.some((e) => e.includes("Expecting token of type '{'"))).toBe(true);
    // Post-M-FT.4 the recovered tree is NOT validated, so the linking error
    // that used to accompany this is deliberately absent.
    expect(errors.some((e) => e.includes("Could not resolve reference to Aggregate"))).toBe(false);
  });

  it("lowers the recovered row to zero fields rather than crashing", async () => {
    const { model } = await parseString(SRC);
    const loom = toLoomModel(model);
    const ctx = allContexts(loom).find((c) => c.name === "Parties")!;
    expect(ctx.seeds).toHaveLength(1);
    expect(ctx.seeds[0].rows).toHaveLength(1);
    expect(ctx.seeds[0].rows[0].fields).toEqual([]);
  });

  // The control: written the way the grammar means it, the same model reports
  // `loom.seed-abstract-aggregate` — the lowerer was never what stood between
  // the user and a diagnostic, it just shouted over the ones already raised.
  it("the dataset form of the same seed reports the abstract-aggregate gate", async () => {
    const { errors } = await parseString(
      SRC.replace(`seed Party { name: "x" }`, `seed default { Party { name: "x" } }`),
    );
    expect(errors.some((e) => e.includes("Seed row on abstract aggregate 'Party'"))).toBe(true);
  });
});
