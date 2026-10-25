// Workflow own-state mutation (workflow.md, "handle = own-state mutation") on
// the vanilla Ecto/Phoenix (non-Ash) foundation.  A `field := value` in a
// command-triggered workflow body targeting one of the workflow's OWN state
// fields rebinds the immutable workflow `state` struct via a struct update
// (`%{state | field: value}`) in the workflow execution module — the vanilla
// sibling of the dispatch-emit persisted-saga path.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// A COMMAND-triggered create (`create(orderId: Order id, n: int)`, no `by`) drives the vanilla
// workflow-execution path; an event-triggered `create … by` persists through
// dispatch-emit instead (covered by the phoenix/ash test).

// Scalar COMPOUND own-state mutation (`field += value` / `field -= value`) on
// the vanilla foundation.  It lowers to the same `assign` node with the value
// rewritten to a `binary` over the current value, so the struct update's new
// value is a read-modify-write off the shared expression renderer — int as
// `state.attempts + n`, money as `Decimal.sub(state.total, …)`.  The self-read
// resolves to the loaded saga row the create keys on `orderId`.
const COMPOUND_SRC = `
  system S {
    subdomain M {
      context C {
        aggregate Order { status: string }
        repository Orders for Order {}
        workflow OrderFulfillment transactional {
          orderId: Order id
          attempts: int
          total: money
          create(orderId: Order id, n: int) { attempts += n  total -= money("5.00") }
        }
      }
    }
    api A from M
    storage pg { type: postgres }
    resource sagaState { for: C, kind: state, use: pg }
    deployable d { platform: elixir  contexts: [C]  dataSources: [sagaState]  serves: A  port: 4000 }
  }
`;

describe("vanilla foundation — workflow own-state compound assignment", () => {
  it("emits Decimal arithmetic for a money `total -= money(...)`", async () => {
    const files = await generateSystemFiles(COMPOUND_SRC);
    const wf = [...files.entries()].find(([k]) =>
      k.endsWith("workflows/order_fulfillment.ex"),
    )?.[1];
    expect(wf).toContain(
      'state <- (%{state | total: Decimal.sub(state.total, Decimal.new("5.00"))})',
    );
  });
});
