// Feliz — three defects found by building a generated app (`dotnet fable`):
//
// 1. Model names still emitted bare in two keyword-sensitive positions:
//    - a `match await` arm binder: `| GoResult (Ok (Some (ConfirmOrderOrder
//      begin))) ->` — "Unexpected keyword 'begin' in pattern";
//    - a store ACTION's page-shell wrapper + its use: `let fixed () = dispatch
//      CartFixed` / `fun _ -> fixed()`.
// 2. A component `state {}` cell seeded from a component param:
//    `component Tag(start: int) { state { n: int = start } }` emitted
//    `N = start` into the app-level `init ()` — "The value or constructor
//    'start' is not defined".  `init` has no props; the agreeing call-site
//    constant now substitutes (`N = 7`), and call sites that do not agree are a
//    `loom.user-component-deferred-target` instead of a broken build.
// 3. A `let` in an action resolved to a same-named STATE cell:
//    `let v = 100  count := v` emitted `{ model with Count = model.V }` — a
//    silent wrong value (or an FS0039 when no such Model field exists).

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import {
  buildLoomModel,
  generateSystemFiles,
  generateSystemFilesUnchecked,
} from "../../_helpers/index.js";

const sys = (tagCalls: string) => `
system Shop {
  subdomain Sales { context Orders {
    error Rejected { reason: string }
    aggregate Order with crudish {
      code: string
      operation confirm(): Order or Rejected { code := "c" }
    }
    repository Orders for Order { }
  } }
  api ShopApi from Sales
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  ui App {
    api Shop: ShopApi
    store Cart {
      state { count: int = 0 }
      action base(done: int) { let val = done + 1  count := val }
      action fixed() { count := 0 }
    }
    component Tag(start: int, label: string) {
      state { n: int = start * 2  total: int = 0 }
      action bump() { let total = n + 10  n := total }
      body: Card { Stack {
        Text { \`{label} {n} {total}\` },
        Button { "bump", onClick: bump }
      } }
    }
    page Home {
      route: "/"
      state { count: int = 0  v: int = 5 }
      action shadow() { let v = 100  count := v }
      body: Stack {
        Text { \`{count} {Cart.count} {v}\` },
        ${tagCalls},
        Button { "shadow", onClick: shadow },
        Button { "cm", onClick: Cart.fixed }
      }
    }
    page Detail(id: Order id) {
      route: "/o/:id"
      state { message: string = "" }
      action go() {
        match await Shop.Order.confirm() {
          Order begin => { message := begin.code }
          Rejected member => { message := member.reason }
        }
      }
      body: Stack { Text { message }, Button { "go", onClick: go } }
    }
  }
  deployable api { platform: node contexts: [Orders] dataSources: [ordersState] serves: ShopApi port: 3000 }
  deployable web { platform: feliz targets: api ui: App { Shop: api } port: 3005 }
}`;

const appFs = async (src: string) => (await generateSystemFiles(src)).get("web/src/App.fs")!;
const AGREE = `Tag(start: 7, label: "t"), Tag(7, "u")`;

describe("feliz — keyword match-arm binders and store-action wrappers", () => {
  it("escapes a `match await` arm binder in the result pattern", async () => {
    const fs = await appFs(sys(AGREE));
    expect(fs).toContain("| GoResult (Ok (Some (ConfirmOrderOrder ``begin``))) ->");
    expect(fs).toContain("let model = { model with Message = ``begin``.code }");
    expect(fs).toContain("| GoResult (Ok (Some (ConfirmOrderRejected ``member``))) ->");
  });

  it("escapes a store action's wrapper binding and its use", async () => {
    const fs = await appFs(sys(AGREE));
    expect(fs).toContain("let ``fixed`` () = dispatch CartFixed");
    expect(fs).toContain("prop.onClick (fun _ -> ``fixed``())");
  });
});

describe("feliz — a component `state {}` cell seeded from a param", () => {
  it("substitutes the call sites' agreed constant into `init`", async () => {
    const fs = await appFs(sys(AGREE));
    expect(fs).toContain("      N = (7 * 2)\n");
    expect(fs).not.toMatch(/N = \(?start/);
    expect(fs).toContain("let Tag (model: Model)");
  });

  it("call sites that disagree are a deferral diagnostic, not a broken init", async () => {
    const loom = await buildLoomModel(sys(`Tag(start: 7, label: "t"), Tag(start: 8, label: "u")`));
    const diags = validateLoomModel(loom).filter(
      (d) => d.code === "loom.user-component-deferred-target",
    );
    expect(diags.map((d) => d.message).join("\n")).toMatch(
      /component 'Tag'[\s\S]*seeded from param 'start'[\s\S]*different values/,
    );
  });

  it("the emitter defers that component and seeds its cell with the zero", async () => {
    const files = await generateSystemFilesUnchecked(
      sys(`Tag(start: 7, label: "t"), Tag(start: 8, label: "u")`),
      "the emitter's deferral of a component whose param-seeded state has no single init value is the subject; loom.user-component-deferred-target rejects this model and documents that same deferral",
    );
    const fs = files.get("web/src/App.fs")!;
    expect(fs).not.toContain("let Tag (model: Model)");
    expect(fs).toContain("unknown layout component: Tag");
    expect(fs).toContain("      N = 0\n");
  });

  it("a non-constant argument is a deferral diagnostic too", async () => {
    const loom = await buildLoomModel(sys(`Tag(start: count, label: "t")`));
    const diags = validateLoomModel(loom).filter(
      (d) => d.code === "loom.user-component-deferred-target",
    );
    expect(diags.map((d) => d.message).join("\n")).toMatch(/not a constant/);
  });
});

describe("feliz — a `let` shadows a same-named state cell", () => {
  it("page action: the read after the let is the local, not the Model field", async () => {
    const fs = await appFs(sys(AGREE));
    expect(fs).toContain("      let v = 100\n      let model = { model with Count = v }");
  });

  it("component action: likewise", async () => {
    const fs = await appFs(sys(AGREE));
    expect(fs).toContain(
      "      let total = (model.N + 10)\n      let model = { model with N = total }",
    );
  });
});
