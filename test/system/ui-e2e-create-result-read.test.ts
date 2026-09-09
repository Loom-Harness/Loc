import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

// ---------------------------------------------------------------------------
// A `let` bound to `ui.<aggregate>.create({…})` names a row that exists — the
// form submit landed on its detail page.  Reading a field off it used to reach
// no locator at all, and `expect(<create-result>.<field>).toHaveText("…")`
// validated clean and then killed `generate system` with
// `expect requires a matcher` out of `renderExpectStmt`
// (audit 2026-09-03 F6, packet W1.4 / M-T5.27).
//
// Two halves, and both are the point:
//   • the create-result read RENDERS — the id is enough to navigate to the
//     row's detail page, which is exactly what `getById` lowers to;
//   • a receiver that genuinely cannot be a locator is REFUSED with
//     `loom.locator-matcher-receiver`, so nothing reaches the internal throw.
// ---------------------------------------------------------------------------

const src = (assertions: string): string => `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Order {
        customerId: string
        status: string
        contains lines: OrderLine[]
        entity OrderLine { sku: string  qty: int }
      }
      repository Orders for Order { }
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  ui WebApp with scaffold(subdomains: [Sales]) {
    api Sales: SalesApi
  }
  deployable api {
    platform: node
    contexts: [Orders]
    dataSources: [ordersState]
    serves: SalesApi
    port: 8080
  }
  deployable web {
    platform: react
    targets: api
    ui: WebApp { Sales: api }
    port: 3000
  }
  test e2e "read the row the form just created" against web {
    let ord = ui.orders.create({ customerId: "c-1", status: "Draft" })
${assertions}
  }
}
`;

describe("ui e2e — a create result is a readable row", () => {
  it("lowers a field read on a create-result local to the same detail-page locator `getById` produces", async () => {
    const files = await generateSystemFiles(src(`    expect(ord.status).toHaveText("Draft")`));
    const spec = files.get("web/e2e/Shop.ui.spec.ts")!;
    expect(spec).toContain(
      'await expect((await new OrderDetailPage(page, ord.id).goto()).field("status")).toHaveText("Draft");',
    );
    // The navigation the read needs pulls its page object in with it.
    expect(spec).toContain("OrderDetailPage");
  });

  it("lowers a contained-collection read on a create-result local to the rows locator", async () => {
    const files = await generateSystemFiles(src(`    expect(ord.lines).toHaveCount(0)`));
    const spec = files.get("web/e2e/Shop.ui.spec.ts")!;
    expect(spec).toContain(
      "await expect((await new OrderDetailPage(page, ord.id).goto()).linesRows()).toHaveCount(0);",
    );
  });

  it("refuses a locator matcher whose receiver can never be a locator", async () => {
    // `id` is the page object's own property, not a rendered cell — the shape
    // that still had no locator to reach after the create-result fix.
    const { errors } = await parseString(src(`    expect(ord.id).toHaveText("x")`));
    const hit = errors.filter((e) => e.includes("asserts against a DOM element"));
    expect(hit).toHaveLength(1);
    expect(hit[0]).toContain("toHaveText");
    expect(hit[0]).toContain("ord.id");
  });

  it("refuses a locator matcher on a plain value", async () => {
    const { errors } = await parseString(src(`    expect("Draft").toHaveText("Draft")`));
    expect(errors.filter((e) => e.includes("asserts against a DOM element"))).toHaveLength(1);
  });
});
