// Feliz — F#-keyword names in route params, lambda / `For` binders and store
// field locals.
//
// F-022 escaped component params, `let`s and state reads through `fsIdent`, but
// three positions still emitted the bare name and `dotnet fable` stopped on
// "Unexpected keyword …" (found building a generated app):
//   - a page ROUTE param: `| [ "o"; default ] -> Other default` in `parseUrl`,
//     `(default: string)` in the view fn, and the root view's dispatch arm;
//   - an expression-lambda / `For` binder: `List.filter (fun member -> …)`;
//   - a store FIELD local: `let member = model.CartMember`.
// Each now takes the double-backtick spelling; the URL literal and every model
// field name are unchanged.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYS = `
system Shop {
  subdomain Sales { context Orders {
    aggregate Product { label: string }
    repository Products for Product { }
  } }
  api ShopApi from Sales
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  ui App {
    api Shop: ShopApi
    store Cart { state { member: int = 0  items: string[] } action bump() { member += 1 } }
    page Home {
      route: "/"
      state { tags: string[] = [] }
      body: Stack {
        Text { \`{Cart.member}\` },
        Text { \`{tags.where(base => base == "a").count}\` },
        For { each: Cart.items, end => Card { end } }
      }
    }
    page Other(default: string) { route: "/o/:default" body: Text { default } }
  }
  deployable api { platform: node contexts: [Orders] dataSources: [ordersState] serves: ShopApi port: 3000 }
  deployable web { platform: feliz targets: api ui: App { Shop: api } port: 3005 }
}`;

const appFs = async () => (await generateSystemFiles(SYS)).get("web/src/App.fs")!;

describe("feliz — F#-keyword route params, binders and store locals", () => {
  it("escapes a route param in parseUrl, the view fn and the root dispatch", async () => {
    const fs = await appFs();
    expect(fs).toContain('| [ "o"; ``default`` ] -> Other ``default``');
    expect(fs).toContain("(dispatch: Msg -> unit) (``default``: string) =");
    expect(fs).toContain("| Other ``default`` -> otherView model dispatch ``default``");
  });

  it("escapes an expression-lambda binder and a For binder", async () => {
    const fs = await appFs();
    expect(fs).toContain('List.filter (fun ``base`` -> (``base`` = "a"))');
    expect(fs).toContain("List.map (fun ``end`` ->");
    expect(fs).not.toMatch(/fun base ->/);
  });

  it("escapes a store field local at its binding and its use", async () => {
    const fs = await appFs();
    expect(fs).toContain("let ``member`` = model.CartMember");
    expect(fs).toContain("(string ``member``)");
  });
});
