// `this` in a ui body is refused on every walker frontend (`loom.ui-this-unbound`).
//
// A page / component / store has no aggregate instance in scope.  The shared
// JS walker and Feliz's update renderer both THROW on a `this` node, so
// `action again() { label := string(this) }` reported `0 error(s)` and then
// aborted `ddd generate system` on react / vue / svelte / angular / feliz /
// flutter.  Phoenix LiveView binds `this` to the page's `@record` assign and
// stays exempt.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const src = (action: string, web: string): string => `
system Shop {
  api ShopApi from Catalog
  subdomain Catalog {
    context Cat {
      aggregate Product with crudish { name: string }
      repository Products for Product { }
    }
  }
  storage db { type: postgres }
  resource catState { for: Cat, kind: state, use: db }
  ui WebApp {
    api Shop: ShopApi
    page Home {
      route: "/"
      state { label: string = "" }
      action save() { label := "saved" }
      action again() { ${action} }
      body: Stack {
        Button { "Save", onClick: save },
        Button { "Again", onClick: again }
      }
    }
  }
  deployable api { platform: node contexts: [Cat] dataSources: [catState] serves: ShopApi port: 3000 }
  ${web}
}
`;

const REACT = "deployable web { platform: react targets: api ui: WebApp { Shop: api } port: 3005 }";
const FELIZ = "deployable web { platform: feliz targets: api ui: WebApp { Shop: api } port: 3005 }";

async function codes(source: string): Promise<string[]> {
  const { model, errors } = await parseString(source);
  if (errors.length) throw new Error(`unexpected parse/validation errors:\n${errors.join("\n")}`);
  return validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => d.code ?? "");
}

describe("loom.ui-this-unbound", () => {
  for (const [fw, web] of [
    ["react", REACT],
    ["feliz", FELIZ],
  ] as const) {
    it(`refuses \`this\` in a page action on ${fw}`, async () => {
      expect(await codes(src("label := string(this)", web))).toContain("loom.ui-this-unbound");
    });
  }

  it("control: the same page without `this` validates clean", async () => {
    expect(await codes(src('label := "again"', REACT))).not.toContain("loom.ui-this-unbound");
  });
});

describe("feliz update arm renders an action named as a value", () => {
  it("`let f = save` binds the action's Msg case instead of aborting generate", async () => {
    const files = await generateSystemFiles(src("let f = save", FELIZ));
    const app = [...files].find(([p]) => p.endsWith("App.fs"))?.[1];
    expect(app, "App.fs emitted").toBeDefined();
    expect(app).toContain("let f = Save");
  });
});
