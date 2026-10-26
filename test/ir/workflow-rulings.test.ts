// -------------------------------------------------------------------------
// M-T5.34 — a WORKFLOW ruling of the validator packet:
//
//   loom.reactor-without-starter       (#2864 G2)
//
// The ruling gets a model that FAILS the gate and a sibling that PASSES, so
// the test pins the boundary rather than just the diagnostic.  The entity-part
// ruling lives in `entity-part-param.test.ts`.
//
// The packet drafted a third gate here for #2850's deferred case (B); it landed
// independently on `main` as `loom.workflow-create-correlation-unsupplied`, with
// a better rule (it also accepts `<corr> := <param>`, and only fires when the
// body touches own state), so the draft was dropped rather than duplicated.
// -------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

/** Every IR diagnostic code raised by a whole `.ddd` source. */
async function codesFor(source: string): Promise<string[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => d.code ?? "");
}

const wrap = (body: string) => `
system S {
  subdomain D { context Ops {
    aggregate Order { ref: string }
    repository Orders for Order { }
    event OrderPaid { order: Order id }
    channel bus { carries: OrderPaid  delivery: broadcast  retention: ephemeral }
${body}
  } }
}`;

// -------------------------------------------------------------------------
describe("loom.reactor-without-starter (#2864 G2)", () => {
  const reactorOnly = wrap(`
    workflow Settle {
      order: Order id
      st: string
      on(e: OrderPaid) { st := "paid" }
    }`);

  const withEventStarter = wrap(`
    workflow Settle {
      order: Order id
      st: string
      create(e: OrderPaid) by e.order { st := "started" }
      on(e: OrderPaid) { st := "paid" }
    }`);

  const withCommandStarter = wrap(`
    workflow Settle {
      order: Order id
      st: string
      create(order: Order id) { st := "started" }
      on(e: OrderPaid) { st := "paid" }
    }`);

  it("rejects reactors with no starter — no instance can ever exist", async () => {
    expect(await codesFor(reactorOnly)).toContain("loom.reactor-without-starter");
  });

  it("an event-triggered starter satisfies it", async () => {
    expect(await codesFor(withEventStarter)).not.toContain("loom.reactor-without-starter");
  });

  it("a command-triggered starter satisfies it too", async () => {
    expect(await codesFor(withCommandStarter)).not.toContain("loom.reactor-without-starter");
  });

  it("a workflow with NO reactors is none of its business", async () => {
    const noReactors = wrap(`
      workflow Plain {
        order: Order id
        st: string
        create(order: Order id) { st := "x" }
      }`);
    expect(await codesFor(noReactors)).not.toContain("loom.reactor-without-starter");
  });

  it("is independent of the carried-event gate — the sibling cause stays quiet", async () => {
    // `bus` carries OrderPaid, so `loom.reactor-event-uncarried` (the other
    // cause in this class) cannot fire; the missing starter is the only defect.
    const codes = await codesFor(reactorOnly);
    expect(codes).toContain("loom.reactor-without-starter");
    expect(codes).not.toContain("loom.reactor-event-uncarried");
  });
});
