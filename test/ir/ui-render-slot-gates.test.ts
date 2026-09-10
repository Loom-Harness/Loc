// A page-body gate over what an expression in a RENDERED SLOT may be (audit
// D3).  The shape used to report `0 error(s), 0 warning(s)`, generate a full
// tree, and then fail the GENERATED frontend's own typecheck:
//
//   `rows.map(i => Card { Text { i.name } })`
//     → `{(…).map((i) => Card(Text(i.name)))}` — `Cannot find name 'Card'`.
//
// The check is IR-level, so it holds for all six frontends at once.

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
    .filter((d) => d.code === "loom.markup-primitive-in-collection-lambda")
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
