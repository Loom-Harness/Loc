// Generate-crash residue (M-T9.82): eleven shapes `ddd parse` accepted and
// `ddd generate system` then crashed on, plus two compile/crash findings beside
// them.  Each one either now GENERATES (the emitter renders what the other
// backends already render) or is REFUSED in phase ④/⑦ with a coded diagnostic,
// so `generate` is never the first place a user hears about it.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles, lspCodes, parseString } from "../_helpers/index.js";

/** Every error code a `.ddd` earns from phase ④ (AST) and, when that is clean,
 *  phase ⑦ (IR) — what `ddd parse` reports. */
async function errorCodes(src: string): Promise<string[]> {
  const { model, diagnostics } = await parseString(src);
  const astErrors = diagnostics.filter((d) => d.severity === 1);
  if (astErrors.length) return lspCodes(astErrors);
  const diags = validateLoomModel(enrichLoomModel(lowerModel(model)));
  return diags.filter((d) => d.severity === "error").map((d) => d.code ?? "");
}

const STORAGE = `
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }`;
const deploy = (platform: string): string =>
  `deployable d { platform: ${platform}, contexts: [C], dataSources: [st], serves: A, port: 4000 }`;

/** One emitted file whose path ends with `suffix`. */
function file(files: Map<string, string>, suffix: string): string {
  const hits = [...files.keys()].filter((p) => p.endsWith(suffix));
  expect(hits, `one emitted path ending in ${suffix}`).toHaveLength(1);
  return files.get(hits[0]!)!;
}

describe("loom.collection-field-unpersisted — a collection with no table to live in", () => {
  const sys = (body: string): string => `
system S {
  subdomain Sd { context C {
    aggregate Tag with crudish { label: string }
    valueobject Label { text: string }
    ${body}
  } }
  api A from Sd
  ${STORAGE}
  ${deploy("node")}
}`;

  it("refuses an optional reference collection `X id[]?`", async () => {
    const codes = await errorCodes(
      sys(`aggregate Order with crudish { code: string  tags: Tag id[]? }`),
    );
    expect(codes).toContain("loom.collection-field-unpersisted");
  });

  it("refuses a reference collection on an entity part", async () => {
    const codes = await errorCodes(
      sys(`aggregate Order with crudish {
        code: string
        contains lines: Line[]
        entity Line { qty: int  refs: Tag id[] }
      }`),
    );
    expect(codes).toContain("loom.collection-field-unpersisted");
  });

  it("refuses a value-object collection on a projection state row", async () => {
    const codes = await errorCodes(
      sys(`aggregate Order with crudish { code: string }
      event Placed { orderId: Order id }
      projection Board keyed by orderId {
        orderId: Order id
        labels: Label[]
        on(e: Placed) { orderId := e.orderId }
      }`),
    );
    expect(codes).toContain("loom.collection-field-unpersisted");
  });

  it("refuses a collection nested inside a persisted value object", async () => {
    const codes = await errorCodes(
      sys(`valueobject Bag { labels: Label[] }
      aggregate Order with crudish { code: string  bag: Bag }`),
    );
    expect(codes).toContain("loom.collection-field-unpersisted");
  });

  it("keeps the supported positions silent (root `X id[]`, root and part `<VO>[]`)", async () => {
    const codes = await errorCodes(
      sys(`aggregate Order with crudish {
        code: string
        tags: Tag id[]
        labels: Label[]
        contains lines: Line[]
        entity Line { qty: int  notes: Label[] }
      }`),
    );
    expect(codes).not.toContain("loom.collection-field-unpersisted");
  });
});

describe("a state row's `X id[]` renders as one jsonb id-array column", () => {
  const src = (platform: string): string => `
system S {
  subdomain Sd { context C {
    aggregate Order with crudish { code: string }
    event Placed { orderId: Order id }
    projection Board keyed by orderId {
      orderId: Order id
      refs: Order id[]
      on(e: Placed) { orderId := e.orderId }
    }
    workflow Tracker {
      orderId: Order id
      refs: Order id[]
      create(e: Placed) by e.orderId { orderId := e.orderId }
    }
  } }
  api A from Sd
  ${STORAGE}
  ${deploy(platform)}
}`;

  it("java maps it through the per-target IdJsonListConverter", async () => {
    const files = await generateSystemFiles(src("java"));
    for (const entity of ["BoardRow.java", "TrackerState.java"]) {
      expect(file(files, entity)).toContain("@Convert(converter = OrderIdJsonListConverter.class)");
    }
    expect(file(files, "OrderIdJsonListConverter.java")).toContain(
      "class OrderIdJsonListConverter",
    );
  });

  it("node drizzle declares the jsonb column the migration creates", async () => {
    const schema = file(await generateSystemFiles(src("node")), "d/db/schema.ts");
    expect(schema).toContain(`refs: jsonb("refs").$type<string[]>(),`);
    expect(schema).toContain(`refs: jsonb("refs").$type<string[]>().notNull(),`);
  });

  it("node mikroorm maps it as a jsonb column", async () => {
    const files = await generateSystemFiles(src("node { persistence: mikroorm }"));
    const entities = [...files.entries()].filter(([p]) => p.includes("entities")).map(([, c]) => c);
    expect(entities.join("\n")).toMatch(/refs[^\n]*jsonb/);
  });
});

describe("loom.projection-event-unkeyed — a keyless fold, even with `on(e) by …`", () => {
  it("refuses a folded projection with no `keyed by` whose handler routes `by` an id", async () => {
    const codes = await errorCodes(`
system F {
  subdomain Sd { context C {
    aggregate Order with crudish { code: string }
    event Placed { orderId: Order id  code: string }
    projection Latest {
      lastCode: string = ""
      on(e: Placed) by e.orderId { lastCode := e.code }
    }
  } }
  api A from Sd
  ${STORAGE}
  ${deploy("java")}
}`);
    expect(codes).toContain("loom.projection-event-unkeyed");
  });
});

describe("java query-time projections", () => {
  it("groups by a json / File column", async () => {
    const files = await generateSystemFiles(`
system G {
  subdomain Sd { context C {
    aggregate Order with crudish { code: string  meta: json  doc: File }
    projection ByMeta { k: json  n: int  from Order as o  group by o.meta  select k = o.meta, n = count() }
    projection ByDoc  { k: File  n: int  from Order as o  group by o.doc   select k = o.doc,  n = count() }
  } }
  api A from Sd
  storage pg { type: postgres }
  storage blobs { type: s3, config: { bucket: "b" } }
  resource st { for: C, kind: state, use: pg }
  resource files { for: C, kind: objectStore, use: blobs }
  deployable d { platform: java, contexts: [C], dataSources: [st, files], serves: A, port: 4000 }
}`);
    const reads = file(files, "CQueryProjections.java");
    expect(reads).toContain("(JsonNode) r[0]");
    expect(reads).toContain("(FileRef) r[0]");
  });

  it("a projection named `Count` does not redeclare Spring Data's `count()`", async () => {
    const files = await generateSystemFiles(`
system K {
  subdomain Sd { context C {
    aggregate Order with crudish { code: string }
    projection Count { from Order as o  select code = o.code }
  } }
  api A from Sd
  ${STORAGE}
  ${deploy("java")}
}`);
    const jpa = file(files, "OrderJpaRepository.java");
    expect(jpa).toContain("List<Order> countSource();");
    expect(jpa).not.toMatch(/List<Order> count\(\)/);
    // The route and service keep the projection's own name.
    expect(file(files, "CQueryProjectionsController.java")).toContain(
      "public List<CountRow> count()",
    );
  });

  it("refuses a `duration` select (loom.projection-select-duration)", async () => {
    const codes = await errorCodes(`
system S {
  subdomain Sd { context C {
    aggregate Order with crudish { code: string  openedAt: datetime  closedAt: datetime }
    projection Spans { from Order as o  select code = o.code, span = o.closedAt - o.openedAt }
  } }
  api A from Sd
  ${STORAGE}
  ${deploy("node")}
}`);
    expect(codes).toContain("loom.projection-select-duration");
  });
});

describe("loom.aggregate-test-context — a part builder in an aggregate unit test", () => {
  it("refuses `Line { … }` in a nested test (no aggregate id to parent it)", async () => {
    const codes = await errorCodes(`
system N {
  subdomain Sd { context C {
    aggregate Order with crudish {
      code: string
      contains lines: Line[]
      entity Line { qty: int }
      test "builds a line" {
        let l = Line { qty: 1 }
        expect(l.qty).toBe(1)
      }
    }
  } }
  api A from Sd
  ${STORAGE}
  ${deploy("java")}
}`);
    expect(codes).toContain("loom.aggregate-test-context");
  });
});

describe("mikroorm capability filter over a reference collection", () => {
  it("renders `filter this.owners.contains(<id>)` through the join table", async () => {
    const files = await generateSystemFiles(`
system S {
  subdomain Sd { context C {
    aggregate U with crudish { label: string }
    aggregate A with crudish {
      name: string
      owners: U id[]
      filter this.owners.contains("00000000-0000-0000-0000-000000000001")
    }
  } }
  api A2 from Sd
  ${STORAGE}
  deployable d { platform: node { persistence: mikroorm }, contexts: [C], dataSources: [st], serves: A2, port: 4000 }
}`);
    expect(file(files, "a-repository.ts")).toContain(
      "id in (select __j.a_id from a_owners __j where __j.u_id = ?)",
    );
  });
});

describe("HEEx", () => {
  it("a store-action handler gets its own event, beside a component action of the same name", async () => {
    const files = await generateSystemFiles(`
system StoreCollide {
  subdomain Sd { context C {
    aggregate Order with crudish { customerId: string }
  } }
  api A from Sd
  ui WebApp {
    api Sales: A
    store Cart { state { count: int = 0 }  action clear() { count := 0 } }
    component CartSummary() {
      state { n: int = 0 }
      action clear() { n := 1 }
      body: Stack { Button { "Reset", onClick: clear } }
    }
    page CartPage {
      route: "/cart"
      body: Stack { Heading { Cart.count, level: 2 }, CartSummary(), Button { "Discard", onClick: Cart.clear } }
    }
  }
  ${STORAGE}
  deployable phoenixApp { platform: elixir, contexts: [C], dataSources: [st], serves: A, ui: WebApp { Sales: phoenixApp }, port: 4000 }
}`);
    const live = file(files, "cart_page_live.ex");
    expect(live).toContain(`def handle_event("store-cart-clear", _params, socket) do`);
    expect(live).toContain(`def handle_event("clear", _params, socket) do`);
    expect(live).toContain(`phx-click="store-cart-clear"`);
  });

  it("refuses a page reading an aggregate the self-hosting deployable does not serve", async () => {
    const codes = await errorCodes(`
system MatchAwait {
  subdomain Sales { context Orders { aggregate Order with crudish { code: string } } }
  subdomain Billing { context Invoices {
    error Rejected { reason: string }
    aggregate Invoice with crudish {
      code: string
      operation confirm(): Invoice or Rejected { return Rejected { reason: code } }
    }
  } }
  api OrdersApi from Sales
  api BillingApi from Billing { httpStatus Rejected -> 409 }
  ui Console {
    api Orders: OrdersApi
    page InvoiceDetail {
      route: "/invoices/:id"
      state { message: string = "" }
      action confirmNow() { match await Invoice.confirm() { Invoice o => { message := o.code } } }
      body: Stack { Button { "Confirm", onClick: confirmNow } }
    }
  }
  storage pg { type: postgres }
  resource orderState { for: Orders, kind: state, use: pg }
  resource invState { for: Invoices, kind: state, use: pg }
  deployable billing { platform: node, contexts: [Invoices], dataSources: [invState], serves: BillingApi, port: 4001 }
  deployable phoenixApp { platform: elixir, contexts: [Orders], dataSources: [orderState], serves: OrdersApi, ui: Console { Orders: phoenixApp }, port: 4000 }
}`);
    expect(codes).toContain("loom.ui-aggregate-unserved");
  });
});

describe("loom.union-position — an inline union as a payload field", () => {
  it("refuses a union-typed field on an error payload", async () => {
    const codes = await errorCodes(`
system U {
  subdomain Sd { context C {
    payload Circle { r: int }
    payload Square { side: int }
    error Rejected { reason: string  shape: Circle or Square }
    aggregate Order with crudish { code: string }
  } }
  api A from Sd
  ${STORAGE}
  ${deploy("node")}
}`);
    expect(codes).toContain("loom.union-position");
  });
});
