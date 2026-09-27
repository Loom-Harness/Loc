// Two page-body gates over what an expression in a RENDERED SLOT may be
// (audit D3 / D4).  Both shapes used to report `0 error(s), 0 warning(s)`,
// generate a full tree, and then fail the GENERATED frontend's own typecheck:
//
//   D3  `rows.map(i => Card { Text { i.name } })`
//       → `{(…).map((i) => Card(Text(i.name)))}` — `Cannot find name 'Card'`.
//   D4  `Text { p.price }` on a `money` field
//       → `TS2322: Type 'Decimal' is not assignable to type 'ReactNode'`.
//
// Both checks are IR-level, so they hold for all six frontends at once.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

function system(pageBody: string, extra = ""): string {
  return `
system Shop {
  subdomain Catalog {
    context Stock {
      aggregate Item with crudish {
        sku: string
        name: string
        price: money
        madeAt: datetime
        ref: guid
        weight: decimal
      }
      repository Items for Item { }
    }
  }
  api StockApi from Catalog
  storage primarySql { type: postgres }
  resource stockState { for: Stock, kind: state, use: primarySql }
  deployable api {
    platform: node
    contexts: [Stock]
    dataSources: [stockState]
    serves: StockApi
    port: 8080
  }
  ui WebApp {
    api Catalog: StockApi
    page Browse {
      route: "/browse"
      body: ${pageBody}
    }${extra}
  }
  deployable webApp {
    platform: static
    targets: api
    ui: WebApp { Catalog: api }
    port: 3001
  }
}
`;
}

async function diags(pageBody: string, extra = ""): Promise<{ code: string; message: string }[]> {
  const { model } = await parseString(system(pageBody, extra), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter(
      (d) =>
        d.code === "loom.markup-primitive-in-collection-lambda" ||
        d.code === "loom.money-in-text-slot",
    )
    .map((d) => ({ code: d.code!, message: d.message }));
}

const QV = (inner: string) => `QueryView { of: Item.all, data: rows => Stack { ${inner} } }`;

describe("D3 — a markup primitive inside a collection-op lambda", () => {
  it("rejects a primitive built inside `.map`, and points at `For`", async () => {
    const ds = await diags(QV(`rows.map(i => Card { Text { i.name } })`));
    expect(ds.map((d) => d.code)).toEqual(["loom.markup-primitive-in-collection-lambda"]);
    expect(ds[0]!.message).toContain("`Card { … }` is built inside a `.map(…)` lambda");
    expect(ds[0]!.message).toContain("For { each: <collection>, i => Card { … } }");
  });

  it("reports the OUTERMOST primitive once, not one per nested primitive", async () => {
    const ds = await diags(QV(`rows.map(i => Card { Text { i.name }, Badge { i.sku } })`));
    expect(ds).toHaveLength(1);
  });

  // `.map` is the shape the audit hit, but it is not special: a page-body
  // binding is type-erased, so `rows.where(λ)` lowers with `isCollectionOp`
  // OFF while `rows.map(λ)` lowers with it on.  Keying the gate on the flag
  // alone would have caught the audit's case and missed its siblings.
  it("catches it under `where` too — the gate is on the op, not on `map`", async () => {
    const ds = await diags(QV(`rows.where(i => Badge { i.sku })`));
    expect(ds.map((d) => d.code)).toEqual(["loom.markup-primitive-in-collection-lambda"]);
    expect(ds[0]!.message).toContain(".where(…)");
  });

  it("accepts the `For` spelling — the same markup in the slot that renders it", async () => {
    expect(await diags(QV(`For { each: rows, i => Card { Text { i.name } } }`))).toEqual([]);
  });

  it("accepts a collection op in a VALUE position (no markup inside the lambda)", async () => {
    expect(await diags(QV(`Text { rows.map(r => r.name).join(", ") }`))).toEqual([]);
  });
});

describe("D4 — a `money` value in a slot that renders it as text", () => {
  it("rejects `Text { <money> }` and names the `Money` primitive", async () => {
    const ds = await diags(QV(`For { each: rows, i => Text { i.price } }`));
    expect(ds.map((d) => d.code)).toEqual(["loom.money-in-text-slot"]);
    expect(ds[0]!.message).toContain("`Text { i.price }` renders a `money` value (`Item.price`)");
    expect(ds[0]!.message).toContain("Write `Money { i.price }` instead");
    // A one-slot text primitive coerces its slot, so wrapping in place is NOT
    // the fix there — the message has to say which of the two it is.
    expect(ds[0]!.message).toContain("`Text { Money { … } }` does NOT work");
  });

  it("rejects it in a `Stat` VALUE slot, where wrapping in place IS the fix", async () => {
    const ds = await diags(QV(`For { each: rows, i => Stat { "Price", i.price } }`));
    expect(ds.map((d) => d.code)).toEqual(["loom.money-in-text-slot"]);
    expect(ds[0]!.message).toContain("wrap it in place: `Money { i.price }`");
  });

  it("accepts `Money { <money> }`", async () => {
    expect(await diags(QV(`For { each: rows, i => Money { i.price } }`))).toEqual([]);
  });

  it("accepts a nested `Money` in a slot that walks one", async () => {
    expect(await diags(QV(`For { each: rows, i => Stat { "Price", Money { i.price } } }`))).toEqual(
      [],
    );
  });

  it("leaves the other typed-but-unformatted slots alone — they cross the wire as strings", async () => {
    // `datetime` and `guid` are `z.string()` on the wire and render fine; only
    // `money` deserialises to a `Decimal`.  `decimal` is a plain `z.number()`.
    expect(
      await diags(
        QV(
          `For { each: rows, i => Stack { Text { i.madeAt }, Text { i.ref }, Text { i.weight } } }`,
        ),
      ),
    ).toEqual([]);
  });

  it("resolves the row binding through a component's aggregate-typed param", async () => {
    const ds = await diags(
      `Stack { PriceRow(Item.all) }`,
      `
    component PriceRow(item: Item) {
      body: Text { item.price }
    }`,
    );
    expect(ds.map((d) => d.code)).toEqual(["loom.money-in-text-slot"]);
    expect(ds[0]!.message).toContain("`Text { item.price }`");
  });

  it("says nothing when the row binding cannot be resolved", async () => {
    // No `of:` the check can resolve to an aggregate — it declines to guess
    // rather than reporting a field it cannot type.
    expect(await diags(`Stack { Text { "not a row read" } }`)).toEqual([]);
  });
});
