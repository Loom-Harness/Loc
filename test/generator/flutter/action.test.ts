// Phase 5 — Action(<instance>.<op>).  On a byId detail page, a parameter-less
// public op on the loaded record renders as a one-click ElevatedButton that
// POSTs /<coll>/${record.id}/<op>; the page gains http + config imports on
// demand.  A parameterised op is REFUSED at phase ⑦ (loom.action-op-has-params),
// and the walker steers to OperationForm for the model that reaches it.

import { describe, expect, it } from "vitest";
import { generateSystemFiles, generateSystemFilesUnchecked } from "../../_helpers/generate.js";

const SRC = `
system Shop {
  api A from S
  subdomain S { context C {
    aggregate Product {
      name: string  active: bool
      operation activate() { active := true }
      operation discount(percent: int) { requires percent > 0 }
    }
    repository Products for Product {}
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  ui App {
    framework: flutter
    api Shop: A
    page ProductDetail {
      route: "/products/:id"
      body: QueryView {
        of: Shop.Product.byId(id), single: true,
        loading: Text { "…" }, error: Text { "e" }, empty: Text { "none" },
        data: p => Stack { Heading { p.name, level: 1 }, Action { p.activate } }
      }
    }
  }
  deployable api1 { platform: node contexts: [C] dataSources: [st] serves: A port: 8081 }
  deployable app { platform: flutter targets: api1 ui: App { Shop: api1 } port: 3006 }
}
`;

describe("flutter Action buttons", () => {
  it("emits a POST button for a parameter-less op + wires http/config imports", async () => {
    const files = await generateSystemFiles(SRC);
    const page = [...files.entries()].find(([k]) => k.endsWith("product_detail_page.dart"));
    expect(page, "no detail page").toBeDefined();
    const src = page![1];
    expect(src).toContain("ElevatedButton(onPressed: () async {");
    expect(src).toContain("http.post(apiUri('/products/${id}/activate'))");
    expect(src).toContain("child: Text('Activate')");
    expect(src).toContain("import 'package:http/http.dart' as http;");
    expect(src).toContain("import '../config.dart';");
    expect([...files.keys()].some((k) => k.endsWith("lib/config.dart"))).toBe(true);
  });

  it("REFUSES a parameterised op at phase ⑦, and steers to OperationForm", async () => {
    // `loom.action-op-has-params` reads the instance ref's declared aggregate
    // type (`ui-action-body-checks.ts` — `recv.type?.kind !== "entity"` bails
    // otherwise).  A `QueryView`'s `data:` binding used to carry the `string`
    // placeholder, so the gate was silent on the ONE shape it exists for — a
    // detail page's loaded record — and this case degraded to a comment inside
    // generated Dart instead.  Now the binding carries `entity Product`, so the
    // model is rejected before emission, which is the honest outcome.
    const bad = SRC.replace("Action { p.activate }", "Action { p.discount }");
    await expect(generateSystemFiles(bad)).rejects.toThrow(/loom\.action-op-has-params/);
    // The walker's own give-up still steers to `OperationForm`, for the model
    // that reaches it (a `--dry-run` read of a rejected model, say).
    const files = await generateSystemFilesUnchecked(
      bad,
      "the phase-⑦ refusal above IS the subject; this asserts what the walker " +
        "emits for the model that reaches it",
    );
    const page = [...files.entries()].find(([k]) => k.endsWith("product_detail_page.dart"))![1];
    expect(page).toContain("no parameter-less public operation");
    expect(page).not.toContain("/products/${id}/discount");
  });
});
