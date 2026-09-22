// The WORKFLOW accessor's PAYLOAD and RESPONSE contract (P9 follow-up).
//
// #2985 lifted three route families onto the `test e2e` surface —
// `api.<wf>.run(…)`, `.instances()`, `.instance(key)`.  #2958 had meanwhile
// added payload + response-field checking, but only for AGGREGATES
// (`SHAPED_RESPONSE_VERBS` was `{getById, create}`, and `checkApiPayload` ran
// only under a resolved aggregate), so the newly-reachable routes became the
// only ones in the surface with no contract check at all.  Measured before
// building, in one file:
//
//   api.fulfillment.run({ orderId: ord.id, bogusKey: "nope" })   → 0 error(s)
//   let one = api.fulfillment.instance(ord); one.noSuchField     → 0 error(s)
//   api.orders.create({ …, bogusKey: "nope" }); read.noSuchField → 2 error(s)
//
// The RUNTIME consequence is not the aggregate's, and the wording must not be
// copy-pasted from it: `<Wf>Request` is a plain `z.object` on hono and a plain
// `BaseModel` on python — neither strict — so an unknown key is SILENTLY
// DROPPED and the POST still answers 204.  The body sends a key the workflow
// never receives, and an assertion resting on it goes green having proved
// nothing.  That is worse than the aggregate's 422, not milder, and the
// diagnostic says so.
//
// Both contracts are pinned against the SAME inputs the emitters read —
// `wf.params` for the request, `instanceWireShape` for the response — so a
// change to either moves the gate with it rather than past it.

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { toLoomModel } from "../_helpers/index.js";
import { parseString } from "../_helpers/parse.js";

const sys = (body: string, opts: { workflow?: string } = {}): string => `
  system Shop {
    subdomain Sales {
      context Orders {
        aggregate Order with crudish {
          code: string
          status: string
        }
        repository Orders for Order { }
        ${
          opts.workflow ??
          `
        workflow Fulfillment {
          orderId: Order id
          status: string
          attempts: int
          create(orderId: Order id) {
            status := "Pending"
            attempts := 0
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

async function diagsFor(src: string): Promise<{ codes: string[]; messages: string[] }> {
  const { model, errors } = await parseString(src);
  expect(errors).toEqual([]);
  const ds = validateLoomModel(toLoomModel(model)).filter((d) => d.severity === "error");
  return { codes: ds.map((d) => d.code ?? "<uncoded>"), messages: ds.map((d) => d.message) };
}

// ---------------------------------------------------------------------------
// The body half — `api.<wf>.run({…})`
// ---------------------------------------------------------------------------

describe("workflow `run` body — against the facade's declared parameters", () => {
  it("rejects a key the workflow does not declare", async () => {
    const { codes, messages } = await diagsFor(
      sys(`api.fulfillment.run({ orderId: "11111111-1111-4111-8111-111111111111", bogus: "x" })`),
    );
    expect(codes).toEqual(["loom.e2e-unknown-body-key"]);
    expect(messages[0]).toContain("api.fulfillment.run({…})");
    expect(messages[0]).toContain("'bogus'");
    expect(messages[0]).toContain("'Fulfillment'");
    expect(messages[0]).toContain("Accepted keys: orderId.");
  });

  it("says the key is DROPPED, not rejected — the aggregate's 422 wording would be wrong", async () => {
    // The whole reason this message is not the aggregate's: `<Wf>Request` is a
    // plain object schema on every backend, so the POST still answers 204 and
    // the test goes green.  A reader told "the backend rejects it (422)" would
    // look for a failing request that never happens.
    const { messages } = await diagsFor(
      sys(`api.fulfillment.run({ orderId: "11111111-1111-4111-8111-111111111111", bogus: "x" })`),
    );
    expect(messages[0]).toContain("DROPPED");
    expect(messages[0]).toContain("204");
    expect(messages[0]).not.toContain("422");
  });

  it("rejects an omitted required parameter", async () => {
    const { codes, messages } = await diagsFor(sys(`api.fulfillment.run({ })`));
    expect(codes).toEqual(["loom.e2e-missing-required-field"]);
    expect(messages[0]).toContain("'orderId'");
    expect(messages[0]).toContain("'Fulfillment'");
    // Here the 422 IS the truth — a MISSING required key fails the schema even
    // though an extra one does not. The asymmetry is the point.
    expect(messages[0]).toContain("422");
  });

  it("an `= default` does NOT make a parameter omittable — the default runs in the body", async () => {
    const wf = `
        workflow Fulfillment {
          orderId: Order id
          status: string
          create(orderId: Order id, tier: string = "std") {
            status := tier
          }
        }`;
    const { codes, messages } = await diagsFor(
      sys(`api.fulfillment.run({ orderId: "11111111-1111-4111-8111-111111111111" })`, {
        workflow: wf,
      }),
    );
    expect(codes).toEqual(["loom.e2e-missing-required-field"]);
    expect(messages[0]).toContain("'tier'");
  });

  it("an OPTIONAL parameter may be omitted", async () => {
    const wf = `
        workflow Fulfillment {
          orderId: Order id
          status: string
          create(orderId: Order id, note: string?) {
            status := "Pending"
          }
        }`;
    const { codes } = await diagsFor(
      sys(`api.fulfillment.run({ orderId: "11111111-1111-4111-8111-111111111111" })`, {
        workflow: wf,
      }),
    );
    expect(codes).toEqual([]);
  });

  it("a correct body is silent", async () => {
    const { codes } = await diagsFor(
      sys(`api.fulfillment.run({ orderId: "11111111-1111-4111-8111-111111111111" })`),
    );
    expect(codes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The read half — `let one = api.<wf>.instance(key)`
// ---------------------------------------------------------------------------

const SEED = `let ord = api.orders.create({ code: "A", status: "Placed" })
      api.fulfillment.run({ orderId: ord.id })`;

describe("workflow instance read — against `instanceWireShape`", () => {
  it("rejects a field the instance row does not carry", async () => {
    const { codes, messages } = await diagsFor(
      sys(`${SEED}
      let one = api.fulfillment.instance(ord)
      expect(one.noSuchField).toBe("x")`),
    );
    expect(codes).toEqual(["loom.e2e-unknown-response-field"]);
    expect(messages[0]).toContain("'one.noSuchField'");
    expect(messages[0]).toContain("api.fulfillment.instance(…)");
    expect(messages[0]).toContain("'Fulfillment'");
    // The correlation token FIRST, then the state fields — the row's own order.
    expect(messages[0]).toContain("Readable: orderId, status, attempts.");
  });

  it("admits the correlation field and every state field", async () => {
    const { codes } = await diagsFor(
      sys(`${SEED}
      let one = api.fulfillment.instance(ord)
      expect(one.orderId).toBe(ord.id)
      expect(one.status).toBe("Pending")
      expect(one.attempts).toBe(0)`),
    );
    expect(codes).toEqual([]);
  });

  it("reports one read once, however often the body repeats it", async () => {
    const { codes } = await diagsFor(
      sys(`${SEED}
      let one = api.fulfillment.instance(ord)
      expect(one.nope).toBe("x")
      expect(one.nope).toBe("y")`),
    );
    expect(codes).toEqual(["loom.e2e-unknown-response-field"]);
  });

  it("`instances()` is NOT judged — its binding is an ARRAY, so `.length` is the point", async () => {
    // The list read answers a JSON array; a member on its binding is an array
    // member, not an instance field.  Judging it against the row shape would
    // reject the one read such a binding exists for — the same reason `all` is
    // absent from the aggregate set (its paged envelope).
    const { codes } = await diagsFor(
      sys(`${SEED}
      let running = api.fulfillment.instances()
      expect(running.length).toBe(1)`),
    );
    expect(codes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The two halves must not fire on a call that has no route
// ---------------------------------------------------------------------------

describe("workflow contract checks — only on a verb that ROUTES", () => {
  it("an event-triggered `run()` is refused once, not also body-checked", async () => {
    // A call aimed at a route that does not exist has no contract to be
    // measured against, and a second complaint about an already-refused call is
    // the double-report the one-mistake-one-diagnostic rule exists to remove.
    const wf = `
        event OrderShipped { orderId: Order id, at: datetime }
        channel Lifecycle {
          carries: OrderShipped
          delivery: broadcast
          retention: ephemeral
        }
        workflow Fulfillment {
          orderId: Order id
          status: string
          create(e: OrderShipped) by e.orderId {
            status := "Shipped"
          }
        }`;
    const { codes } = await diagsFor(sys(`api.fulfillment.run({ bogus: "x" })`, { workflow: wf }));
    expect(codes).toEqual(["loom.e2e-unrouted-verb"]);
  });
});
