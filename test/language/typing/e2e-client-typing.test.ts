// The `test e2e` client is typed from the model, as the values the backend
// SENDS (#3837): the create `{ id }` envelope, records read member by member
// as their JSON (a `money` field is a string, an id a uuid string, an enum its
// value's name), an `or`-union result tagged, a projection / workflow /
// routed-handler read by the client's own resolution order.

import { readFileSync } from "node:fs";
import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { isExpression, type Model } from "../../../src/language/generated/ast.js";
import { tyKey, typingSession } from "../../../src/language/typing/index.js";
import { parseString } from "../../_helpers/index.js";

async function typeOfText(src: string, text: string): Promise<string> {
  const model = (await parseString(src, { validate: false })).model as Model;
  const s = typingSession([model]);
  for (const n of AstUtils.streamAst(model)) {
    if (isExpression(n) && n.$cstNode?.text === text) {
      const t = s.typeAt(n);
      return t ? (t.kind === "unknown" ? `unknown:${t.cause}` : tyKey(t)) : "(unreached)";
    }
  }
  throw new Error(`no expression \`${text}\``);
}

const sys = (body: string) => `system S {
  subdomain D {
    context Sales {
      enum Status { Open, Closed }
      valueobject Address { city: string  zip: string }
      error Unsettled { code: string }
      aggregate Customer with crudish { name: string }
      aggregate WorkOrder with crudish { ref: string }
      aggregate Order with crudish {
        code: string
        total: money
        shipTo: Address?
        placedAt: datetime
        status: Status
        customer: Customer id
        operation retitle(t: string): string { code := t  return code }
        operation settle(): int or Unsettled { return 1 }
        operation close() { status := Closed }
      }
      repository Orders for Order
      repository Customers for Customer
      repository WorkOrders for WorkOrder
      projection Totals { orders: int  revenue: money  from Order as o  select orders = count, revenue = sum(o.total) }
      workflow Checkout {
        order: Order id
        create(o: Order id): Order or Unsettled { order := o  return Orders.get(o) }
      }
      queryHandler ByCode(code: string): Order { let o = Orders.get(code)  return o }
    }
  }
  api A from D { route GET "/by-code/{code}" -> Sales.ByCode }
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable d { platform: node contexts: [Sales] dataSources: [st] serves: A port: 3000 }
  test e2e "client" against d {
${body}
  }
}`;

describe("the e2e api client, typed as the wire values it receives", () => {
  it("a create answers its { id } envelope", async () => {
    const src = sys(`let c = api.customers.create({ name: "x" })  let i = c.id`);
    expect(await typeOfText(src, `api.customers.create({ name: "x" })`)).toBe(
      "rec:CustomerCreated",
    );
    expect(await typeOfText(src, "c.id")).toBe("p:string");
  });

  it("a read's fields are their JSON: money, datetime, ids and enums are strings", async () => {
    const src = sys(`let rd = api.orders.getById("x")
      let a = rd.total  let b = rd.placedAt  let c = rd.customer  let d = rd.status  let e = rd.code`);
    for (const f of ["rd.total", "rd.placedAt", "rd.customer", "rd.status", "rd.code"])
      expect(await typeOfText(src, f), f).toBe("p:string");
  });

  it("the implicit list is the paged envelope over wire rows", async () => {
    const src = sys(`let all = api.orders.all()  let n = all.total  let first = all.items`);
    expect(await typeOfText(src, "all.total")).toBe("p:int");
    expect(await typeOfText(src, "all.items")).toMatch(/^\[rec:Order/);
  });

  it("an operation's result: a value as JSON, a union tagged, none for 204", async () => {
    const src = sys(`let r = api.orders.retitle("x", { t: "y" })
      let st = api.orders.settle("x", {})  let v = st.value  let t = st.type  let k = st.code
      let cl = api.orders.close("x", {})`);
    expect(await typeOfText(src, `api.orders.retitle("x", { t: "y" })`)).toBe("p:string");
    expect(await typeOfText(src, "st.value")).toBe("p:int");
    expect(await typeOfText(src, "st.type")).toBe("p:string");
    expect(await typeOfText(src, "st.code")).toBe("p:string");
    expect(await typeOfText(src, `api.orders.close("x", {})`)).toBe("never");
  });

  it("a multi-word aggregate answers to its route segment too", async () => {
    const src = sys(`let w = api.work_orders.getById("x")  let r = w.ref`);
    expect(await typeOfText(src, "w.ref")).toBe("p:string");
  });

  it("a projection list, a workflow run and a routed handler", async () => {
    const src = sys(`let t = api.totals.list()  let rev = t.revenue
      let run = api.checkout.run({ o: "x" })  let rt = run.type
      let byCode = api.sales.byCode("A")  let bc = byCode.total`);
    expect(await typeOfText(src, "t.revenue")).toBe("p:string");
    expect(await typeOfText(src, "run.type")).toBe("p:string");
    expect(await typeOfText(src, "byCode.total")).toBe("p:string");
  });
});

describe("the e2e api client's request bodies, typed as what the client sends", () => {
  it("a create body is the create's record; a nested value object is its wire record", async () => {
    const src = sys(
      `let made = api.orders.create({ code: "A", total: "1.00", status: "Open", customer: "c", placedAt: "2026-01-01T00:00:00Z", shipTo: { city: "Oslo", zip: "0150" } })`,
    );
    expect(await typeOfText(src, `{ city: "Oslo", zip: "0150" }`)).toBe("rec:Address");
    expect(
      await typeOfText(
        src,
        `{ code: "A", total: "1.00", status: "Open", customer: "c", placedAt: "2026-01-01T00:00:00Z", shipTo: { city: "Oslo", zip: "0150" } }`,
      ),
    ).toBe("rec:__Request__");
  });

  it("an operation body called as a statement is the operation's record", async () => {
    const src = sys(`api.orders.retitle("x", { t: "renamed" })`);
    expect(await typeOfText(src, `{ t: "renamed" }`)).toBe("rec:__Request__");
  });

  it("a workflow run body is its create's record", async () => {
    const src = sys(`let started = api.checkout.run({ o: "x" })`);
    expect(await typeOfText(src, `{ o: "x" }`)).toBe("rec:__Request__");
  });

  it("a route a macro splices (an unlinked context reference) still resolves", async () => {
    // `scaffoldGetApi` splices the `route … -> Shop.<Handler>` binding; a
    // macro-built reference is never linked.
    const src = readFileSync("test/fixtures/corpus/scaffold-get-find.ddd", "utf8").replace(
      "__PLATFORM__",
      "node",
    );
    expect(await typeOfText(src, `api.shop.getOrderByCode("C2").code`)).toBe("p:string");
  });
});

describe("the e2e ui client, typed from the page objects it drives", () => {
  it("a create answers its { id }; a getById answers the record as its JSON", async () => {
    const src = sys(`let c = ui.customers.create({ name: "x" })  let i = c.id
      let rd = ui.orders.getById(c)  let t = rd.total  let code = rd.code`);
    expect(await typeOfText(src, `ui.customers.create({ name: "x" })`)).toBe("rec:CustomerCreated");
    expect(await typeOfText(src, "c.id")).toBe("p:string");
    expect(await typeOfText(src, "rd.total")).toBe("p:string");
    expect(await typeOfText(src, "rd.code")).toBe("p:string");
  });

  it("a body is the create's / operation's / workflow form's record", async () => {
    const src = sys(`let o = ui.orders.create({ code: "A", shipTo: { city: "Oslo", zip: "0150" } })
      ui.orders.retitle(o, { t: "renamed" })
      ui.workflows.checkout({ o: "x" })`);
    expect(await typeOfText(src, `{ city: "Oslo", zip: "0150" }`)).toBe("rec:Address");
    expect(await typeOfText(src, `{ t: "renamed" }`)).toBe("rec:__Request__");
    expect(await typeOfText(src, `{ o: "x" }`)).toBe("rec:__Request__");
  });

  it("an operation and a workflow form answer nothing", async () => {
    const src = sys(`let o = ui.orders.create({ code: "A" })
      let r = ui.orders.retitle(o, { t: "y" })  let w = ui.workflows.checkout({ o: "x" })`);
    expect(await typeOfText(src, `ui.orders.retitle(o, { t: "y" })`)).toBe("never");
    expect(await typeOfText(src, `ui.workflows.checkout({ o: "x" })`)).toBe("never");
  });

  it("the api-only surface and an invented verb do not resolve", async () => {
    const src = sys(`let a = ui.totals.list()  let b = ui.checkout.run({ o: "x" })
      let c = ui.orders.nope()  let d = ui.workflows.nope({})`);
    for (const call of [
      "ui.totals.list()",
      `ui.checkout.run({ o: "x" })`,
      "ui.orders.nope()",
      "ui.workflows.nope({})",
    ])
      expect(await typeOfText(src, call), call).toBe("unknown:unresolved-member");
  });
});

describe("the rest of the e2e api client's surface", () => {
  const audited = (body: string) =>
    sys(body)
      .replace("aggregate Customer with crudish {", "aggregate Customer with crudish, audited {")
      .replace(
        "aggregate Order with crudish {",
        "aggregate Order with crudish {\n        tally: int provenanced = 0",
      );

  it("a routed handler answers even when its context slugs like an aggregate", async () => {
    const src = sys(`let r = api.sales.byCode("A")  let c = r.code`).replace(
      "context Sales {",
      "context Sales {\n      aggregate Sale with crudish { n: int }\n      repository SalesRepo for Sale",
    );
    expect(await typeOfText(src, "r.code")).toBe("p:string");
  });

  it("a workflow run with no declared result answers nothing", async () => {
    const src = sys(`let r = api.checkout.run({ o: "x" })`).replace(
      "create(o: Order id): Order or Unsettled { order := o  return Orders.get(o) }",
      "create(o: Order id) { order := o }",
    );
    expect(await typeOfText(src, `api.checkout.run({ o: "x" })`)).toBe("never");
  });

  it("history answers audit entries; a change names its field", async () => {
    const src = audited(`let h = api.customers.history("x")  let a = h.first().at
      let n = h.first().changes.where(c => c.field == "name").count()`);
    expect(await typeOfText(src, `api.customers.history("x")`)).toBe("[rec:AuditEntry]");
    expect(await typeOfText(src, "h.first().at")).toBe("p:string");
    expect(await typeOfText(src, `c.field == "name"`)).toBe("p:bool");
  });

  it("a list query and a write's options are their fixed records", async () => {
    const src = sys(`let all = api.orders.all({ sort: "code", dir: "asc", page: 1 })
      api.orders.retitle("x", { t: "y" }, { ifMatch: 3 })`);
    expect(await typeOfText(src, `{ sort: "code", dir: "asc", page: 1 }`)).toBe(
      "rec:__ListQuery__",
    );
    expect(await typeOfText(src, "{ ifMatch: 3 }")).toBe("rec:__CallOptions__");
  });

  it("a provenanced field reads as its carrier, its lineage as the lineage record", async () => {
    const src = audited(`let o = api.orders.getById("x")  let v = o.tally.value
      let cv = o.tally.lineage.computedValue  let p = o.tally.lineage.inputs.first().path`);
    expect(await typeOfText(src, "o.tally.value")).toBe("p:int");
    expect(await typeOfText(src, "o.tally.lineage.computedValue")).toBe("p:int");
    expect(await typeOfText(src, "o.tally.lineage.inputs.first().path")).toBe("p:string");
  });

  it("a per-row projection lists its rows; a whole-table aggregation is one row", async () => {
    const src = sys(
      `let rows = api.codes.list()  let n = rows.count()  let t = api.totals.list().orders`,
    ).replace(
      "projection Totals",
      "projection Codes { code: string  from Order as o  select code = o.code }\n      projection Totals",
    );
    expect(await typeOfText(src, "api.codes.list()")).toBe("[rec:Codes]");
    expect(await typeOfText(src, "rows.count()")).toBe("p:int");
    expect(await typeOfText(src, "api.totals.list().orders")).toBe("p:int");
  });
});

describe("e2e request bodies the client sends positionally or through a named create", () => {
  it("an event-sourced aggregate's create body is its first (named) create's record", async () => {
    const src = sys(`let a = api.ledgers.create({ owner: "alice" })`).replace(
      "context Sales {",
      `context Sales {
      event Opened { ledger: Ledger id  owner: string }
      aggregate Ledger persistedAs: eventLog {
        owner: string
        create open(owner: string) { emit Opened { ledger: id, owner: owner } }
        apply(e: Opened) { owner := e.owner }
      }
      repository Ledgers for Ledger`,
    );
    expect(await typeOfText(src, `{ owner: "alice" }`)).toBe("rec:__Request__");
  });

  it("a routed handler's arguments are its params, each as its JSON", async () => {
    const src = sys(
      `let r = api.sales.byCode("A")  let s = api.sales.reprice({ city: "Oslo", zip: "1" })`,
    )
      .replace(
        "queryHandler ByCode",
        "queryHandler Reprice(at: Address): string { return at.city }\n      queryHandler ByCode",
      )
      .replace(
        `route GET "/by-code/{code}" -> Sales.ByCode`,
        `route GET "/by-code/{code}" -> Sales.ByCode  route POST "/reprice" -> Sales.Reprice`,
      );
    expect(await typeOfText(src, `{ city: "Oslo", zip: "1" }`)).toBe("rec:Address");
  });
});
