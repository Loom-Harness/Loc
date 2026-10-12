// ---------------------------------------------------------------------------
// Java backend — event-sourced saga double-append (S5b).  When an event-sourced
// workflow declares BOTH `create(e)` and `on(e)` for the SAME event, the two
// @EventListener methods would fan out in unspecified Spring order and both
// append.  The fix merges them into ONE ordered @EventListener that reads the
// per-context `<ctx>_events` stream once and branches (empty → create-logic, non-empty →
// on-logic), so exactly one appends regardless of fan-out order.  A create + on
// on DIFFERENT events stays two independent handlers (byte-identical).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const UNPAIRED = `system S { subdomain O { context O {
  aggregate Order { status: string  operation place() { status := "P"  emit OrderPlaced { order: id } } }
  repository Orders for Order { }
  event OrderPlaced { order: Order id }
  event PaymentRegistered { order: Order id, amount: int }
  channel L { carries: OrderPlaced, PaymentRegistered  delivery: broadcast  retention: ephemeral }
  workflow Tally eventSourced {
    orderId: Order id
    total: int
    create(p: OrderPlaced) by p.order { emit PaymentRegistered { order: p.order, amount: 0 } }
    on(pr: PaymentRegistered) by pr.order { precondition total >= 0  emit PaymentRegistered { order: pr.order, amount: total } }
    apply(pr: PaymentRegistered) { total := total + pr.amount }
  }
} } api A from O storage pg { type: postgres }
  resource oState { for: O, kind: state, use: pg }
  deployable api { platform: java contexts: [O] serves: A dataSources: [oState] port: 8080 } }`;

const file = (files: Map<string, string>, suffix: string): string =>
  [...files.entries()].find(([k]) => k.endsWith(suffix))?.[1] ?? "";

describe("java event-sourced saga double-append (S5b)", () => {
  it("create+on on DIFFERENT events stay two independent @EventListener methods", async () => {
    const d = file(await generateSystemFiles(UNPAIRED), "workflows/ODispatcher.java");
    expect(d).toContain("onTallyStartOrderPlaced");
    expect(d).toContain("onTallyOnPaymentRegistered");
  });
});
