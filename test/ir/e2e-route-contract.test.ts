// The e2e suite must only call routes the SAME compilation emits — Wave 4 F-003.
//
// The "no drift between layers" claim failing inside one `generate system` run,
// on the README's own Quick Example:
//
//   $ node bin/cli.js generate system <readme-quick-example> -o out
//   0 error(s), 0 warning(s)
//
//   the node backend's routes, in full:
//     GET /api/orders   GET /api/orders/{id}
//     POST /api/orders/{id}/add_line   POST /api/orders/{id}/confirm
//     GET /api/products   GET /api/products/{id}
//
//   out/e2e/Acme.e2e.test.ts, from that same run:
//     const prod = await __post(`${base}/api/products`, …);
//     const ord  = await __post(`${base}/api/orders`, …);
//
//   against the booted stack: 3 failed / 3,
//   `POST http://localhost:3000/api/products → 405 Method Not Allowed`.
//
// The source declares no `create` and no `crudish` on those aggregates, so no
// POST route is emitted — correct, and documented (`emitsRestCreate`).  The
// hole was that `checkMagicCall` (`test-checks.ts`) waved the two lifecycle
// verbs through by NAME without ever asking whether a route existed:
//
//     if (method === "create" || method === "getById") return;
//
// `validateE2ERouteContract` (`checks/e2e-route-checks.ts`) asks the routing
// question instead, and asks it of `deriveAggregateOperations` — the derivation
// all five backend route builders render from — so the gate cannot drift from
// the emitters.
//
// NON-VACUITY is load-bearing here: a gate that refused every `create` would
// pass the positive cases below and break every shipped model.  The `crudish`
// control is what separates "the route is missing" from "the verb is create".

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { toLoomModel } from "../_helpers/ir.js";
import { parseString } from "../_helpers/parse.js";

/** A system whose `Order` carries whatever `orderDecl` spells, plus an e2e
 *  body.  `Order` deliberately has an operation so the non-`create` verbs have
 *  something real to resolve against; `repo` supplies the repository (and any
 *  declared finds) the find/list verbs need. */
const sys = (orderDecl: string, body: string, opts: { extra?: string; repo?: string } = {}) => `
  system S {
    subdomain D {
      context Sales {
        aggregate ${orderDecl} {
          code: string
          qty: int
          operation bump(by: int) { qty := qty + by }
          ${opts.extra ?? ""}
        }
        ${opts.repo ?? ""}
      }
    }
    storage pg { type: postgres }
    resource st { for: Sales, kind: state, use: pg }
    deployable d {
      platform: node
      contexts: [Sales]
      dataSources: [st]
      port: 4000
    }
    test e2e "t" against d {
      ${body}
    }
  }
`;

async function codesFor(
  orderDecl: string,
  body: string,
  opts: { extra?: string; repo?: string } = {},
): Promise<string[]> {
  const { model, errors } = await parseString(sys(orderDecl, body, opts));
  expect(errors).toEqual([]);
  return validateLoomModel(toLoomModel(model))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "<uncoded>");
}

async function messagesFor(
  orderDecl: string,
  body: string,
  opts: { extra?: string; repo?: string } = {},
): Promise<string[]> {
  const { model, errors } = await parseString(sys(orderDecl, body, opts));
  expect(errors).toEqual([]);
  return validateLoomModel(toLoomModel(model))
    .filter((d) => d.severity === "error")
    .map((d) => d.message);
}

describe("e2e route contract — `create`", () => {
  it("refuses `create` on an aggregate that declares none (the README defect)", async () => {
    expect(await codesFor("Order", `let o = api.orders.create({ code: "c", qty: 1 })`)).toContain(
      "loom.e2e-unrouted-verb",
    );
  });

  it("names the aggregate, the verb and the fix", async () => {
    const [msg] = await messagesFor("Order", `let o = api.orders.create({ code: "c", qty: 1 })`);
    expect(msg).toContain("api.orders.create");
    expect(msg).toContain("'Order'");
    expect(msg).toContain("with crudish");
    expect(msg).toContain("create(...)");
    // The wire consequence, so the reader can connect the diagnostic to the
    // 405 they would otherwise have hit at runtime.
    expect(msg).toContain("POST /api/orders");
  });

  it("NON-VACUITY: the same model `with crudish` produces zero diagnostics", async () => {
    expect(
      await codesFor("Order with crudish", `let o = api.orders.create({ code: "c" })`),
    ).toEqual([]);
  });

  it("NON-VACUITY: an explicit canonical create also satisfies it", async () => {
    expect(
      await codesFor("Order", `let o = api.orders.create({ code: "c", qty: 1 })`, {
        extra: `create(code: string, qty: int) { code := code  qty := qty }`,
      }),
    ).toEqual([]);
  });
});

describe("e2e route contract — `destroy`", () => {
  it("refuses `destroy` when no canonical destroy is declared", async () => {
    // `test-checks.ts` already flags this as an unknown METHOD; the route gate
    // must agree rather than contradict it, so both codes are acceptable —
    // what must not happen is a clean validation.
    const codes = await codesFor("Order", `api.orders.destroy("x")`);
    expect(codes.length).toBeGreaterThan(0);
  });

  it("NON-VACUITY: `with crudish` gives it a DELETE route", async () => {
    expect(await codesFor("Order with crudish", `api.orders.destroy("x")`)).toEqual([]);
  });
});

describe("e2e route contract — the rest of the verb table stays reachable", () => {
  it("`getById` is always routed", async () => {
    expect(await codesFor("Order with crudish", `let r = api.orders.getById("x")`)).toEqual([]);
  });

  it("`all` resolves to the bare-collection list route", async () => {
    expect(
      await codesFor("Order with crudish", `let xs = api.orders.all()`, {
        repo: "repository Orders for Order { }",
      }),
    ).toEqual([]);
  });

  it("a public operation resolves to its POST /{id}/<op> route", async () => {
    expect(
      await codesFor(
        "Order with crudish",
        `api.orders.bump(api.orders.create({ code: "c" }), { by: 1 })`,
      ),
    ).toEqual([]);
  });

  it("a declared find resolves to its GET /<aggs>/<find> route", async () => {
    expect(
      await codesFor("Order with crudish", `let xs = api.orders.byCode({ code: "c" })`, {
        repo: "repository Orders for Order { find byCode(code: string): Order[] where this.code == code }",
      }),
    ).toEqual([]);
  });
});

describe("e2e route contract — it does not fire on what it cannot route-check", () => {
  it("stays silent on an unresolved aggregate slug (that is a different diagnostic)", async () => {
    const codes = await codesFor("Order with crudish", `api.nope.create({ code: "c" })`);
    expect(codes).toContain("loom.e2e-unknown-aggregate");
    expect(codes).not.toContain("loom.e2e-unrouted-verb");
  });
});

// ---------------------------------------------------------------------------
// The `ui` half — page objects, not routes.
// ---------------------------------------------------------------------------

/** A system with a react frontend, so `test e2e … against web` classifies as a
 *  `ui` test and its body lowers to Playwright page objects. */
const uiSys = (orderDecl: string, body: string) => `
  system U {
    subdomain D { context Sales {
      aggregate ${orderDecl} {
        code: string
        derived display: string = code
        operation bump() { }
      }
      repository Orders for Order { }
    } }
    storage pg { type: postgres }
    resource st { for: Sales, kind: state, use: pg }
    deployable api {
      platform: node
      contexts: [Sales]
      dataSources: [st]
      port: 4300
    }
    ui W with scaffold(subdomains: [D]) { }
    deployable web { platform: react, targets: api, ui: W, port: 4301 }
    test e2e "t" against web {
      ${body}
    }
  }
`;

async function uiCodesFor(orderDecl: string, body: string): Promise<string[]> {
  const { model, errors } = await parseString(uiSys(orderDecl, body));
  expect(errors).toEqual([]);
  return validateLoomModel(toLoomModel(model))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "<uncoded>");
}

describe("e2e route contract — the ui page-object vocabulary", () => {
  it("refuses `ui.<agg>.create` when the aggregate has no create surface", async () => {
    // The same `emitsRestCreate` gate drops the scaffolded `New` page, so the
    // List → New → Detail flow the renderer emits has no New page to drive.
    expect(await uiCodesFor("Order", `let o = ui.orders.create({ code: "c" })`)).toContain(
      "loom.e2e-unrouted-verb",
    );
  });

  it("NON-VACUITY: `with crudish` keeps the New page and the verb", async () => {
    expect(
      await uiCodesFor("Order with crudish", `let o = ui.orders.create({ code: "c" })`),
    ).toEqual([]);
  });

  it("leaves `getById` and a public operation alone", async () => {
    expect(
      await uiCodesFor(
        "Order with crudish",
        `let o = ui.orders.create({ code: "c" })
      let r = ui.orders.getById(o)
      ui.orders.bump(o)`,
      ),
    ).toEqual([]);
  });

  it("refuses a find verb — the harness drives no page object for one", async () => {
    // `test-checks.ts` accepts a find for EITHER magic id; the ui renderer then
    // throws at phase ⑨ ("unknown method"), which is a crash rather than a
    // diagnostic.  This turns it into one.
    const codes = await uiCodesFor("Order with crudish", `let xs = ui.orders.all()`);
    expect(codes).toContain("loom.e2e-unrouted-verb");
  });
});
