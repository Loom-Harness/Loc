// Transactional legality: `transactional` makes a workflow's command body one
// transaction, and each `on(...)` handler is always its own transaction, so
// the keyword and `on` handlers combine (D-WORKFLOW-TX-BOUNDARY).  The
// behaviour is proved on every backend by the `workflow-tx-continuation`
// corpus fixture; this pins that the validator accepts the shape.

import { describe, expect, it } from "vitest";
import { parseString } from "../_helpers/index.js";

const ctx = (wf: string) =>
  `system S { subdomain M { context C {
    aggregate Order { total: int }
    event PaymentReceived { order: Order id, amount: int }
    ${wf}
  }}}`;

describe("workflow transactional legality", () => {
  it("accepts a transactional workflow with no continuations", async () => {
    const { errors } = await parseString(
      ctx(`workflow Place transactional { create(x: int) { let y = x } }`),
    );
    expect(errors).toEqual([]);
  });

  it("accepts a transactional workflow with an on(...) reactor", async () => {
    const { errors } = await parseString(
      ctx(`workflow Held transactional {
        orderId: Order id
        on(paid: PaymentReceived) by paid.order { let z = paid.amount }
      }`),
    );
    expect(errors).toEqual([]);
  });
});
