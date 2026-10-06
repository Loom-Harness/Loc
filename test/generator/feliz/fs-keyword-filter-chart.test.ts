// F-022 follow-up — two field-READ sites `fs-keyword-field-names.test.ts` does
// not reach, both found by `dotnet fable` on a generated app whose aggregate has
// a field named `default` (legal Loom, an F# keyword):
//
//   App.fs(938,118): error FSHARP: Unexpected keyword 'default' in expression.
//
// from the client-side `Table(filter:)` row predicate (`string r.default`), and
// the same bare read in the `Chart` x/y accessors (`fun r -> float r.default`).
// Both now go through `fsIdent`, like the sort comparator next to them.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYSTEM = `
system Shop {
  subdomain Sales { context Orders {
    aggregate Product { label: string  default: int  class: string }
    repository Products for Product { }
    projection ByLabel {
      label: string
      default: int
      from Product as p
      group by p.label
      select label = p.label, default = count()
    }
  } }
  api ShopApi from Sales
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  ui App {
    api Shop: ShopApi
    page Sorted { route: "/sorted"
      state { q: string = "" }
      body: QueryView { of: Shop.Product.all, data: rows => Table(
        Column("D", p => p.default), Column("C", p => p.class), Column("L", p => p.label),
        rows: rows, filter: q) } }
    page Dash { route: "/dash"
      body: Stack { Chart { kind: "bar", of: Shop.ByLabel, x: r => r.label, y: r => r.default } } }
  }
  deployable api { platform: node contexts: [Orders] dataSources: [ordersState] serves: ShopApi port: 3000 }
  deployable web { platform: feliz targets: api ui: App { Shop: api } port: 3001 }
}`;

async function appFs(): Promise<string> {
  const files = await generateSystemFiles(SYSTEM);
  return [...files.entries()]
    .filter(([p]) => p.endsWith(".fs"))
    .map(([, c]) => c)
    .join("\n");
}

describe("feliz — F# keyword field read in a Table filter and a Chart", () => {
  it("escapes the filter predicate's field reads, leaving a plain field bare", async () => {
    const src = await appFs();
    expect(src).toContain("[ string r.``default``; string r.``class``; string r.label ]");
    expect(src).not.toMatch(/string r\.default\b/);
  });

  it("escapes the chart accessor's field read", async () => {
    const src = await appFs();
    expect(src).toContain("(fun r -> float r.``default``)");
    expect(src).toContain("(fun r -> string r.label)");
  });
});
