// F58 / M-T6.62 — the validator half: a command `create` that names no saga
// instance is refused instead of emitted against an unbound receiver.
//
// A workflow's `Property` members live in a persisted correlation row keyed by
// its one id-shaped state field, and every backend renders a body that touches
// them against that LOADED row.  `commandCreateCorrelationParam`
// (`src/ir/util/workflow-own-state.ts`) is the one rule that decides whether
// such a row can be addressed, and it accepts TWO spellings:
//
//   create(orderId: Order id) { … }                     the param IS the field
//   create start(order: Order id) { orderId := order }  assigned from a param
//
// #2850 shipped only the first.  The second — the shape
// `test/generator/workflow-instance-gate.test.ts` drives on all five backends —
// stayed on the unbound path: `this.orderId = order` in a Hono module-scope
// arrow (TS2683), `this.OrderId` on a .NET handler with no such member,
// `this.setOrderId(...)` on a Java service without it, an unbound `state` in
// the Elixir `with`-chain, and — silently — a request-scoped
// `self = SimpleNamespace(...)` on python whose write never reached the saga
// table at all.
//
// This file pins the REFUSALS: everything that rule cannot address.  The
// emitter half (both spellings producing a loaded, bound, saved row on all
// five) is `test/generator/workflow-create-state.test.ts`.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

const CODE = "loom.workflow-create-correlation-unsupplied";

const sys = (body: string) => `
system S {
  subdomain M { context C {
    aggregate Order with crudish { sku: string }
    repository Orders for Order { }
    command FileClaim { orderId: Order id, reason: string }
    event OrderShipped { orderId: Order id, at: datetime }
    channel Lifecycle { carries: OrderShipped  delivery: broadcast  retention: ephemeral }
${body}
  } }
}`;

async function diags(body: string) {
  const { model } = await parseString(sys(body), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

const codes = async (body: string) => (await diags(body)).map((d) => d.code ?? "");
const messageFor = async (body: string) =>
  (await diags(body)).find((d) => d.code === CODE)?.message ?? "";

describe("workflow command-create correlation addressability (F58 / M-T6.62)", () => {
  describe("refused — no spelling names the instance", () => {
    const NO_KEY = `    workflow W {
      orderId: Order id
      status: string
      create(oid: Order id) { status := "Pending" }
    }`;

    it("refuses a param that neither name-matches nor is assigned to the field", async () => {
      expect(await codes(NO_KEY)).toContain(CODE);
    });

    it("names the correlation field, both spellings, and the params it has", async () => {
      const m = await messageFor(NO_KEY);
      expect(m).toContain("'orderId'");
      expect(m).toContain("Parameters today: oid");
      expect(m).toContain("orderId := <param>");
      // A create has no `by` clause — saying so is the whole reason the rule is
      // parameter-based, and an author who does not know that writes `by`.
      expect(m).toContain("no 'by' clause");
    });

    it("refuses a CONDITIONAL correlation assignment — a key only sometimes set", async () => {
      // The row is loaded-or-allocated BEFORE the body runs, so the assignment
      // has to be unconditional to be an address.  A `<corr> :=` inside a
      // branch may never run; refused rather than emitted unbound.
      expect(
        await codes(`    workflow W {
      orderId: Order id
      stage: string
      create start(order: Order id) {
        if true { orderId := order }
        stage := "started"
      }
    }`),
      ).toContain(CODE);
    });
  });

  describe("accepted — both spellings of the rule", () => {
    it("accepts the param NAMED for the correlation field (#2850's rule)", async () => {
      expect(
        await codes(`    workflow W {
      orderId: Order id
      status: string
      create(orderId: Order id) { status := "Pending" }
    }`),
      ).not.toContain(CODE);
    });

    it("accepts a create that ASSIGNS the field from a differently-named param", async () => {
      // The `workflow-instance-gate` shape, and the residue #2850 left behind.
      expect(
        await codes(`    workflow W {
      orderId: Order id
      stage: string
      create start(order: Order id) {
        orderId := order
        stage := "started"
      }
    }`),
      ).not.toContain(CODE);
    });
  });

  describe("out of scope — shapes that are not this defect", () => {
    it("stays silent on a create that does not touch own state", async () => {
      // Nothing renders against the instance, so nothing is unbound.  The row
      // is still never allocated — recorded on M-T6.62, deliberately not gated,
      // because refusing it would refuse a stateless command starter.
      expect(
        await codes(`    workflow W {
      orderId: Order id
      status: string
      create(oid: Order id) { let o = Order.create({ sku: "x" }) }
    }`),
      ).not.toContain(CODE);
    });

    it("stays silent on an EVENT-triggered facade — `by` addresses it", async () => {
      expect(
        await codes(`    workflow W {
      orderId: Order id
      status: string
      create(e: OrderShipped) by e.orderId { status := "Shipped" }
    }`),
      ).not.toContain(CODE);
    });

    it("stays silent on a workflow with NO id-shaped state field", async () => {
      // A SHIPPED shape, not a gap: M-T6.50 (b) made python emit a
      // request-scoped `SimpleNamespace` scratch for it.  node / .NET / java
      // still emit an unbound `this` there — a parity gap on M-T6.62, not
      // something for this gate to refuse.
      expect(
        await codes(`    workflow W {
      total: int
      create(base: int) { total := base }
    }`),
      ).not.toContain(CODE);
    });

    it("stays silent on a stateless workflow", async () => {
      expect(
        await codes(`    workflow W {
      create(sku: string) { let o = Order.create({ sku: sku }) }
    }`),
      ).not.toContain(CODE);
    });
  });

  describe("the payload-typed create reported on #2850", () => {
    const PAYLOAD_CREATE = `    workflow W {
      orderId: Order id
      status: string
      create(c: FileClaim) { status := "Pending" }
    }`;

    it("refuses it under the same code", async () => {
      expect(await codes(PAYLOAD_CREATE)).toContain(CODE);
    });

    it("uses the #payload wording: it FOUND the key, one level down", async () => {
      const m = await messageFor(PAYLOAD_CREATE);
      expect(m).toContain("'FileClaim'");
      expect(m).toContain("parameter 'c'");
      expect(m).toContain("reads no nested field");
      // The remedy has to be spellable, or the refusal is a dead end.
      expect(m).toContain("create(orderId: …, c: FileClaim)");
    });

    it("accepts the spelling the message recommends", async () => {
      expect(
        await codes(`    workflow W {
      orderId: Order id
      status: string
      create(orderId: Order id, c: FileClaim) { status := "Pending" }
    }`),
      ).not.toContain(CODE);
    });
  });
});
