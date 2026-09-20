import { describe, expect, it } from "vitest";
import { generateSystemFilesUnchecked } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The renderer half of F7 (audit 2026-09-13): `ui-e2e-render.ts` must never
// emit an assertion WEAKER than the one the author wrote.
//
// `checkExpectMatcher` refuses `toThrow` in a ui e2e body at the source span
// (`loom.e2e-ui-throw-invalid`), so this path is unreachable from a validated
// model — which is exactly why it needs its own test. The defect was that the
// renderer dropped `s.status` on the floor and emitted a bare
// `.rejects.toThrow()`: a silent downgrade that then hung to the Playwright
// timeout. If the validator is ever bypassed (a model built through another
// entry point, or a future refactor that moves the check), the renderer must
// still fail LOUDLY rather than ship a green-looking spec that asserts less
// than it claims — the same rule the unsupported-statement throw beside it
// follows.
//
// `generateSystemFilesUnchecked` is the sanctioned way to emit from a model
// the product refuses; that is the entire subject here.
// ---------------------------------------------------------------------------

const WHY =
  "the model is one the AST validator refuses (loom.e2e-ui-throw-invalid); emitting " +
  "from it IS the subject — this pins the renderer's backstop behaviour";

const src = (assertion: string): string => `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish {
        customerId: string
        status: string
        invariant customerId.length > 0
        derived display: string = customerId
      }
      repository Orders for Order { }
    }
  }

  ui WebApp with scaffold(subdomains: [Sales]) { }
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }

  deployable api { platform: node, contexts: [Orders], dataSources: [ordersState], port: 3000 }
  deployable webApp { platform: react, targets: api, ui: WebApp, port: 3001 }

  test e2e "negative path" against webApp {
    ${assertion}
  }
}
`;

describe("ui e2e renderer — a dropped toThrow status is a loud failure, not a weaker assertion", () => {
  it("refuses to render toThrow(<status>) rather than emitting a bare toThrow()", async () => {
    await expect(
      generateSystemFilesUnchecked(
        src(`expect(ui.orders.create({ customerId: "", status: "Draft" })).toThrow(422)`),
        WHY,
      ),
    ).rejects.toThrow(/ui e2e: 'toThrow\(422\)' is not runnable in a ui test body/);
  });

  it("refuses a bare toThrow() too — it can only settle on a timeout", async () => {
    await expect(
      generateSystemFilesUnchecked(
        src(`expect(ui.orders.create({ customerId: "", status: "Draft" })).toThrow()`),
        WHY,
      ),
    ).rejects.toThrow(/ui e2e: 'toThrow\(\)' is not runnable in a ui test body/);
  });

  it("still renders the api e2e throw assertion, status and all", async () => {
    const files = await generateSystemFilesUnchecked(
      `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish {
        customerId: string
        status: string
        derived display: string = customerId
      }
      repository Orders for Order { }
    }
  }

  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  deployable api { platform: node, contexts: [Orders], dataSources: [ordersState], port: 3000 }

  test e2e "reading a missing order is 404" against api {
    let o = api.orders.create({ customerId: "c1", status: "Draft" })
    api.orders.destroy(o)
    expect(api.orders.getById(o)).toThrow(404)
  }
}
`,
      "a valid model — the control arm proving the refusal above is scoped to ui bodies only",
    );
    const spec = [...files.entries()].find(([p]) => p.endsWith(".e2e.test.ts"))?.[1];
    expect(spec).toBeDefined();
    // The status survives on the api path — that is the assertion the author
    // wrote, and the half of `toThrow` that genuinely works.
    expect(spec).toContain("rejects.toThrow(/→ 404\\b/)");
  });
});
