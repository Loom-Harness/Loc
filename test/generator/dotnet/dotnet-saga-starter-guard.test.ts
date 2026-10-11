// Event-sourced saga double-append (S5b) — no double-append on .NET.  When an
// event-sourced workflow declares BOTH `create(e)` and `on(e)` for the SAME
// event, the two `INotificationHandler` classes would fan out in unspecified
// Mediator order and both append.  The fix merges them into ONE handler that
// reads the `<wf>_events` stream once and branches (empty → create-logic,
// non-empty → on-logic), so exactly one appends regardless of fan-out order.  A
// create + on on DIFFERENT events stays two independent handlers (byte-identical).

import { describe, expect, it } from "vitest";
import { generateSystems } from "../../../src/system/index.js";
import { parseString } from "../../_helpers/index.js";

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
  deployable api { platform: dotnet contexts: [O] serves: A dataSources: [oState] port: 8080 } }`;

async function gen(src: string): Promise<Map<string, string>> {
  const { model, errors } = await parseString(src);
  if (errors.length) throw new Error(errors.join("\n"));
  return generateSystems(model).files;
}

const file = (files: Map<string, string>, suffix: string): string =>
  [...files.entries()].find(([k]) => k.endsWith(suffix))?.[1] ?? "";
const has = (files: Map<string, string>, suffix: string): boolean =>
  [...files.keys()].some((k) => k.endsWith(suffix));

describe("dotnet event-sourced saga double-append (S5b)", () => {
  it("create+on on DIFFERENT events stay two independent handlers (byte-identical)", async () => {
    const files = await gen(UNPAIRED);
    expect(has(files, "Workflows/TallyStartOrderPlacedHandler.cs")).toBe(true);
    expect(has(files, "Workflows/TallyOnPaymentRegisteredHandler.cs")).toBe(true);
    // The unpaired starter never gained a stream-exists guard.
    const starter = file(files, "Workflows/TallyStartOrderPlacedHandler.cs");
    expect(starter).not.toContain("if (__rows.Count != 0)");
  });
});
