// The slot text of a named layout is catalogued under `<Ui>.layout.<Layout>` and
// rendered through the translation runtime — and a string that exists ONLY in a
// layout still turns the runtime on.

import { describe, expect, it } from "vitest";
import { messageKey } from "../../../src/generator/_walker/i18n-extract.js";
import { generateSystemFiles } from "../../_helpers/index.js";

const system = (pageBody: string): string => `
system S {
  subdomain Shop { context Cart { aggregate Item { name: string } repository Items for Item { } } }
  api ShopApi from Shop
  storage primary { type: postgres }
  resource cartState { for: Cart, kind: state, use: primary }
  layout Marketing {
    header { Heading { "Acme", level: 3 } }
    main
    footer { Text { "Read the ", Bold { "terms" }, " first" } }
  }
  ui Web {
    api Cart: ShopApi
    page Landing { route: "/" layout: Marketing body: ${pageBody} }
  }
  deployable api { platform: node contexts: [Cart] dataSources: [cartState] serves: ShopApi port: 3000 }
  deployable web { platform: static targets: api ui: Web { Cart: api } port: 3001 }
}`;

describe("layout slot text", () => {
  it("is catalogued under the layout key prefix, even when it is the only text", async () => {
    // The page body carries no string at all.
    const files = await generateSystemFiles(system("Stack { }"));
    const catalog = JSON.parse(files.get(".loom/messages.en.json") ?? "{}") as Record<
      string,
      string
    >;
    expect(catalog[messageKey("Web.layout.Marketing", "heading", "Acme")]).toBe("Acme");
    expect(catalog[messageKey("Web.layout.Marketing", "text", "Read the <b>terms</b> first")]).toBe(
      "Read the <b>terms</b> first",
    );
    // The runtime ships because of it.
    expect([...files.keys()].some((p) => p.endsWith("src/i18n.ts"))).toBe(true);
  });

  it("react renders the slots through t / tRich with the same keys", async () => {
    const files = await generateSystemFiles(system("Stack { }"));
    const app = files.get("web/src/App.tsx") ?? "";
    expect(app).toContain(`t("${messageKey("Web.layout.Marketing", "heading", "Acme")}", "Acme")`);
    expect(app).toContain(
      `tRich("${messageKey("Web.layout.Marketing", "text", "Read the <b>terms</b> first")}"`,
    );
    expect(app).toMatch(/import \{ tRich \} from "\.\/i18n"/);
  });
});
