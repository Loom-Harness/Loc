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
      valueobject Address { city: string }
      aggregate Item with crudish {
        sku: string
        name: string
        price: money
        madeAt: datetime
        ref: guid
        weight: decimal
        address: Address
      }
      repository Items for Item { }
      projection Totals {
        gross: money
        rows: int
        from Item as i
        select gross = sum(i.price), rows = count()
      }
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
        d.code === "loom.money-in-text-slot" ||
        d.code === "loom.valueobject-in-text-slot",
    )
    .map((d) => ({ code: d.code!, message: d.message }));
}

/** `diags`, but with EXTRA context members spliced in — for the cases that
 *  need a repository declaration the shared model does not carry. */
async function diagsWith(
  contextExtra: string,
  pageBody: string,
): Promise<{ code: string; message: string }[]> {
  const src = system(pageBody).replace("      repository Items for Item { }", contextExtra.trim());
  const { model } = await parseString(src, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter(
      (d) =>
        d.code === "loom.markup-primitive-in-collection-lambda" ||
        d.code === "loom.money-in-text-slot" ||
        d.code === "loom.valueobject-in-text-slot",
    )
    .map((d) => ({ code: d.code ?? "", message: d.message }));
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

  // M-T5.33.  The gate resolved its row type by looking the `of:` receiver up
  // in the AGGREGATE index, so a `QueryView` over a PROJECTION had no row it
  // could describe and the money field went unreported — the model that found
  // it was a claims dashboard whose only money value came from a
  // `sum(claimedTotal)` projection.  It reads the resolved `memberType` now,
  // which is the same answer for an aggregate row and an available one here.
  it("rejects a money field off a PROJECTION row, not just an aggregate row", async () => {
    const ds = await diags(
      `QueryView { of: Catalog.Totals, data: s => Stat { "Gross", s.gross } }`,
    );
    expect(ds.map((d) => d.code)).toEqual(["loom.money-in-text-slot"]);
    // Named by the PROJECTION, which is what the author has to go and fix.
    expect(ds[0]!.message).toContain("(`Totals.gross`)");
    expect(ds[0]!.message).toContain("wrap it in place: `Money { s.gross }`");
  });

  // The same widening reaches a slot the scope machinery never bound: a
  // `Column`'s lambda param.  `extendScope` binds `QueryView`'s `data:` and
  // `For`'s item lambda and nothing else, so `Column { "Total", o => Text {
  // o.total } }` — the ordinary way to write a table column — was invisible to
  // this gate.  Caught by CI on `vanilla-table-client-controls.ddd`, whose
  // LiveView emitted `<%= o.total %>`: a bare `Decimal` struct interpolated
  // into HEEx, for which Phoenix ships no `Phoenix.HTML.Safe` impl.
  //
  // TWO spellings are load-bearing in these two cases and neither is cosmetic:
  // the `of:` goes through the API HANDLE (`Catalog.Item.all`), because
  // `ofReadResultType` scans the chain's SUFFIXES for the aggregate and a bare
  // `Item.all` carries it as the chain HEAD; and `Items` declares an explicit
  // non-paged `find all(): Item[]`, because the auto-`findAll` is paged and
  // `rows` would bind the envelope. Both are pre-existing type-erasure cases
  // this PR does not claim to fix — spelled around here so the assertion is
  // about the `Column` slot and nothing else.
  const COLUMN_MODEL = `
      repository Items for Item { find all(): Item[] }` as const;

  it("rejects a money read in a `Column` lambda, which the row scope never bound", async () => {
    const ds = await diagsWith(
      COLUMN_MODEL,
      `QueryView { of: Catalog.Item.all, data: rows => Table { rows: rows, Column { "Price", i => Text { i.price } } } }`,
    );
    expect(ds.map((d) => d.code)).toEqual(["loom.money-in-text-slot"]);
    expect(ds[0]!.message).toContain("(`Item.price`)");
  });

  it("accepts `Money` in that same `Column` slot", async () => {
    expect(
      await diagsWith(
        COLUMN_MODEL,
        `QueryView { of: Catalog.Item.all, data: rows => Table { rows: rows, Column { "Price", i => Money { i.price } } } }`,
      ),
    ).toEqual([]);
  });

  it("accepts the projection row's non-money field beside it", async () => {
    // The control: a gate keyed on "a field off a projection row" rather than
    // on its TYPE would flag `rows: int` too.
    expect(
      await diags(`QueryView { of: Catalog.Totals, data: s => Stat { "Rows", s.rows } }`),
    ).toEqual([]);
  });

  it("accepts the documented fix on a projection row", async () => {
    expect(
      await diags(
        `QueryView { of: Catalog.Totals, data: s => Stat { "Gross", Money { s.gross } } }`,
      ),
    ).toEqual([]);
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

describe("V7 — a value-object field in a slot that renders it as text", () => {
  it("rejects `Text { <value object> }` and points at a field of it", async () => {
    const ds = await diags(QV(`For { each: rows, i => Text { i.address } }`));
    expect(ds.map((d) => d.code)).toEqual(["loom.valueobject-in-text-slot"]);
    expect(ds[0]!.message).toContain("`Text` renders `i.address` — a `Address` value object");
    expect(ds[0]!.message).toContain("`i.address.<field>`");
  });

  it("rejects it in a `Stat` value slot too", async () => {
    const ds = await diags(QV(`For { each: rows, i => Stat { "Where", i.address } }`));
    expect(ds.map((d) => d.code)).toEqual(["loom.valueobject-in-text-slot"]);
  });

  it("accepts a scalar field read off the value object", async () => {
    expect(await diags(QV(`For { each: rows, i => Text { i.address.city } }`))).toEqual([]);
  });
});
