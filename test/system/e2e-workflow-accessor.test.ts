// The `test e2e` WORKFLOW ACCESSOR — `api.<wf>.run(…)` / `.instances()` /
// `.instance(key)` (M-T5.36 §1, testability finding F5).
//
// Before this, a `test e2e` body could reach aggregates and folded projections
// and nothing else.  The transactional orchestration tier — where multi-
// aggregate consistency bugs live — had NO runtime test path from the DSL, and
// the refusal was actively misleading:
//
//     $ node bin/cli.js parse workflow-create-state.ddd
//     loom.e2e-unknown-aggregate …: e2e: unknown aggregate 'api.fulfillment'
//       on this deployable. Available aggregates: orders.
//
// A workflow named an unknown AGGREGATE reads as a typo, which is what sent the
// testability audit looking for one.  Both halves are gated below: the three
// verbs render onto the three routes every backend already mounts, and the
// residual unknown-slug message names the deployable's workflows.
//
// The routes are NOT hand-written strings here — the whole point of the finding
// is that they already exist on all five backends, so the assertions pin the
// emitted call against `emitsCommandRoute` / `correlationField`, the same two
// predicates each backend's workflow emitter gates its own emission on.

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles, toLoomModel } from "../_helpers/index.js";
import { parseString } from "../_helpers/parse.js";

/** A command-triggered, correlation-bearing workflow (the `.run()` shape) plus
 *  an event-triggered reactor over the same event (the `.run()`-less shape). */
const sys = (body: string, opts: { workflows?: string } = {}): string => `
  system Shop {
    subdomain Sales {
      context Orders {
        aggregate Order with crudish {
          code: string
          status: string
          operation ship() {
            status := "Shipped"
            emit OrderShipped { orderId: id, at: now() }
          }
        }
        repository Orders for Order { }
        event OrderShipped { orderId: Order id, at: datetime }
        channel Lifecycle {
          carries: OrderShipped
          delivery: broadcast
          retention: ephemeral
        }
        ${
          opts.workflows ??
          `
        workflow Fulfillment {
          orderId: Order id
          status: string
          create(orderId: Order id) {
            status := "Pending"
          }
          on(e: OrderShipped) {
            status := "Shipped"
          }
        }`
        }
      }
    }
    api OrdersApi from Sales
    storage pg { type: postgres }
    resource st { for: Orders, kind: state, use: pg }
    deployable d {
      platform: node
      contexts: [Orders]
      dataSources: [st]
      serves: OrdersApi
      port: 4000
    }
    test e2e "t" against d {
      ${body}
    }
  }
`;

const e2eOf = async (src: string): Promise<string> =>
  (await generateSystemFiles(src)).get("e2e/Shop.e2e.test.ts")!;

async function diagsFor(src: string): Promise<{ codes: string[]; messages: string[] }> {
  const { model, errors } = await parseString(src);
  expect(errors).toEqual([]);
  const ds = validateLoomModel(toLoomModel(model)).filter((d) => d.severity === "error");
  return { codes: ds.map((d) => d.code ?? "<uncoded>"), messages: ds.map((d) => d.message) };
}

// ---------------------------------------------------------------------------
// The three verbs
// ---------------------------------------------------------------------------

describe("e2e workflow accessor — the three verbs", () => {
  it("`run(body)` POSTs the command route every backend mounts", async () => {
    const e2e = await e2eOf(sys(`api.fulfillment.run({ orderId: "x" })`));
    expect(e2e).toContain('await __post(`${base}/api/workflows/fulfillment`, ({ orderId: "x" }))');
  });

  it("`run()` with no argument still sends a body, like `create()`", async () => {
    const e2e = await e2eOf(sys(`api.fulfillment.run()`));
    expect(e2e).toContain("await __post(`${base}/api/workflows/fulfillment`, {})");
  });

  it("`instances()` GETs the list read", async () => {
    const e2e = await e2eOf(
      sys(`let xs = api.fulfillment.instances()
      expect(xs.length).toBe(0)`),
    );
    expect(e2e).toContain("await __get(`${base}/api/workflows/fulfillment/instances`)");
  });

  it("`instance(key)` GETs the by-correlation read", async () => {
    const e2e = await e2eOf(
      sys(`let one = api.fulfillment.instance("k")
      expect(one.status).toBe("Pending")`),
    );
    expect(e2e).toContain('await __get(`${base}/api/workflows/fulfillment/instances/${"k"}`)');
  });

  it("the workflow slug is `snake(name)` — the segment the backends route on", async () => {
    // `POST /api/workflows/order_fulfillment`, not `/orderFulfillment`.  The
    // spelling in the SOURCE may be either; the emitted PATH is snake on all
    // five backends.
    const wf = `
        workflow OrderFulfillment {
          orderId: Order id
          status: string
          create(orderId: Order id) { status := "Pending" }
        }`;
    const e2e = await e2eOf(sys(`api.orderFulfillment.run({ orderId: "x" })`, { workflows: wf }));
    expect(e2e).toContain("`${base}/api/workflows/order_fulfillment`");
  });
});

// ---------------------------------------------------------------------------
// The correlation key
// ---------------------------------------------------------------------------

describe("e2e workflow accessor — `.instance(key)` binds the correlation key", () => {
  it("a `let`-bound create gets `.id` appended, like every other accessor", async () => {
    const e2e = await e2eOf(
      sys(`let ord = api.orders.create({ code: "A", status: "Placed" })
      let one = api.fulfillment.instance(ord)
      expect(one.status).toBe("Pending")`),
    );
    expect(e2e).toContain("await __get(`${base}/api/workflows/fulfillment/instances/${ord.id}`)");
  });

  it("an explicit `.id` is NOT doubled", async () => {
    const e2e = await e2eOf(
      sys(`let ord = api.orders.create({ code: "A", status: "Placed" })
      let one = api.fulfillment.instance(ord.id)
      expect(one.status).toBe("Pending")`),
    );
    expect(e2e).toContain("instances/${ord.id}`)");
    expect(e2e).not.toContain("ord.id.id");
  });
});

// ---------------------------------------------------------------------------
// The refusals — a route the model does NOT mount
// ---------------------------------------------------------------------------

const EVENT_TRIGGERED = `
        workflow Fulfillment {
          orderId: Order id
          status: string
          create(e: OrderShipped) by e.orderId {
            status := "Shipped"
          }
        }`;

const CORRELATION_LESS = `
        workflow Fulfillment {
          create(code: string) { }
        }`;

describe("e2e workflow accessor — refusals", () => {
  it("`run()` on an EVENT-triggered workflow is refused — no backend mounts its POST", async () => {
    const { codes, messages } = await diagsFor(
      sys(`api.fulfillment.run({ orderId: "x" })`, { workflows: EVENT_TRIGGERED }),
    );
    expect(codes).toContain("loom.e2e-unrouted-verb");
    const msg = messages.find((m) => m.includes("api.fulfillment.run"))!;
    // The message must name the SHAPE, not just refuse: a reactor is driven by
    // emitting its trigger event, and the two read verbs still work.
    expect(msg).toContain("started by an EVENT");
    expect(msg).toContain("POST /api/workflows/fulfillment");
    expect(msg).toContain("api.fulfillment.instances()");
  });

  it("…and its instance READS are still legal — the two routes are independent", async () => {
    const { codes } = await diagsFor(
      sys(
        `let xs = api.fulfillment.instances()
        expect(xs.length).toBe(0)`,
        { workflows: EVENT_TRIGGERED },
      ),
    );
    expect(codes).not.toContain("loom.e2e-unrouted-verb");
  });

  it("`instances()` on a correlation-LESS workflow is refused — it persists no row", async () => {
    const { codes, messages } = await diagsFor(
      sys(
        `let xs = api.fulfillment.instances()
        expect(xs.length).toBe(0)`,
        { workflows: CORRELATION_LESS },
      ),
    );
    expect(codes).toContain("loom.e2e-unrouted-verb");
    const msg = messages.find((m) => m.includes("api.fulfillment.instances"))!;
    expect(msg).toContain("no correlation field");
    expect(msg).toContain("id-shaped state field");
  });

  it("…and its `run()` is still legal — a stateless command workflow has a POST", async () => {
    const { codes } = await diagsFor(
      sys(`api.fulfillment.run({ code: "A" })`, { workflows: CORRELATION_LESS }),
    );
    expect(codes).not.toContain("loom.e2e-unrouted-verb");
  });

  it("an unknown verb names the three, rather than falling through to the aggregate", async () => {
    const { codes, messages } = await diagsFor(sys(`api.fulfillment.cancel("x")`));
    expect(codes).toContain("loom.e2e-unknown-method");
    expect(codes).not.toContain("loom.e2e-unknown-aggregate");
    const msg = messages.find((m) => m.includes("api.fulfillment.cancel"))!;
    expect(msg).toContain("run, instances, instance");
  });
});

// ---------------------------------------------------------------------------
// The message that sent the audit down the wrong path
// ---------------------------------------------------------------------------

describe("e2e workflow accessor — the unknown-slug message", () => {
  it("no longer calls a workflow an unknown aggregate", async () => {
    const { codes } = await diagsFor(sys(`api.fulfillment.run({ orderId: "x" })`));
    expect(codes).not.toContain("loom.e2e-unknown-aggregate");
  });

  it("a slug that resolves to NOTHING is told the workflows too, not just the aggregates", async () => {
    // The F5 regression gate.  A genuine typo still errors — but it now names
    // the workflow the author was reaching for, so the reading is "wrong name"
    // rather than "this tier does not exist".
    const { codes, messages } = await diagsFor(sys(`api.fulfilment.run({ orderId: "x" })`));
    expect(codes).toContain("loom.e2e-unknown-aggregate");
    const msg = messages.find((m) => m.includes("api.fulfilment"))!;
    expect(msg).toContain("Available aggregates: orders.");
    expect(msg).toContain("fulfillment");
    expect(msg).toContain("run(…)");
  });

  it("the unaddressable one-level call lists the workflow shape as addressable", async () => {
    const { codes, messages } = await diagsFor(sys(`api.run({ orderId: "x" })`));
    expect(codes).toContain("loom.e2e-unaddressable-call");
    expect(messages.join("\n")).toContain("api.<workflow>.{run,instances,instance}(…)");
  });
});

// ---------------------------------------------------------------------------
// Aggregate precedence
// ---------------------------------------------------------------------------

describe("e2e workflow accessor — precedence", () => {
  // `loom.workflow-name-collision` forbids a workflow and an aggregate SHARING
  // a name inside one context — but an aggregate is addressed by its PLURAL, so
  // a `workflow Orders` beside an `aggregate Order` slugs identically and
  // passes that guard (as would any collision across the several contexts one
  // deployable hosts).  The workflow is therefore resolved only once the
  // aggregate lookup has FAILED, so no call that resolves today changes
  // meaning.  The repository is renamed out of the way — `Orders` is otherwise
  // taken by it, which is a different collision.
  const COLLIDING = `
  system Shop {
    subdomain Sales {
      context Orders {
        aggregate Order with crudish {
          code: string
          status: string
        }
        repository OrderRepo for Order { }
        workflow Orders {
          orderId: Order id
          status: string
          create(orderId: Order id) { status := "Pending" }
        }
      }
    }
    api OrdersApi from Sales
    storage pg { type: postgres }
    resource st { for: Orders, kind: state, use: pg }
    deployable d {
      platform: node
      contexts: [Orders]
      dataSources: [st]
      serves: OrdersApi
      port: 4000
    }
    test e2e "t" against d {
      let a = api.orders.create({ code: "A", status: "Placed" })
      expect(a.id).toBe(a.id)
    }
  }
`;

  it("an aggregate slug still wins, so no existing call changes meaning", async () => {
    const e2e = await e2eOf(COLLIDING);
    // `POST /api/orders` — the aggregate's create route, NOT the workflow's
    // `POST /api/workflows/orders`.
    expect(e2e).toContain("await __post(`${base}/api/orders`,");
    expect(e2e).not.toContain("/api/workflows/orders");
  });

  it("…and the colliding workflow's own verbs are then unreachable, honestly", async () => {
    // The consequence, stated rather than hidden: with the aggregate winning
    // the slug, `api.orders.run(…)` resolves against the AGGREGATE, and is
    // refused there as a verb that routes nowhere.  That is the right trade —
    // an existing call must not change meaning — and the message lists the
    // aggregate's ROUTED verbs, which is accurate for what the slug now names.
    //
    // `loom.e2e-unrouted-verb` rather than `loom.e2e-unknown-method` because of
    // the one-mistake-one-diagnostic rule: `test-checks.ts` defers to the
    // routing answer whenever this check will speak, since that is the answer
    // that names a fix.
    const { codes, messages } = await diagsFor(
      COLLIDING.replace(
        "expect(a.id).toBe(a.id)",
        `expect(a.id).toBe(a.id)
      api.orders.run({ orderId: a.id })`,
      ),
    );
    expect(codes).toEqual(["loom.e2e-unrouted-verb"]);
    expect(messages[0]).toContain("api.orders.run");
    expect(messages[0]).toContain("'Order'");
  });
});
