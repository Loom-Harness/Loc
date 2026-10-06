// Event-sourced saga starter guard (S5b) — no double-append on Python/FastAPI.
// When an event-sourced workflow declares BOTH `create(e)` and `on(e)` for the
// SAME event, the `on` reactor drops on an empty stream and the `create` starter
// must drop on a NON-empty one (its inverse), so the event folds exactly once.
// Python calls on-then-start in ONE dispatcher, so the guard alone closes both
// the new-stream and existing-stream cases.  A create with no paired `on` on the
// same event stays byte-identical.

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
  deployable api { platform: python contexts: [O] serves: A dataSources: [oState] port: 8080 } }`;

async function gen(src: string): Promise<Map<string, string>> {
  const { model, errors } = await parseString(src);
  if (errors.length) throw new Error(errors.join("\n"));
  return generateSystems(model).files;
}

const file = (files: Map<string, string>, suffix: string): string =>
  [...files.entries()].find(([k]) => k.endsWith(suffix))?.[1] ?? "";

const fn = (src: string, name: string): string => {
  const start = src.indexOf(`async def ${name}(`);
  if (start < 0) return "";
  const after = src.indexOf("\nasync def ", start + 1);
  const after2 = src.indexOf("\nclass ", start + 1);
  const end = [after, after2].filter((x) => x >= 0).sort((a, b) => a - b)[0];
  return src.slice(start, end ?? undefined);
};

describe("python event-sourced saga starter guard (S5b)", () => {
  it("a create with no paired on stays byte-identical (no exists-guard)", async () => {
    const d = file(await gen(UNPAIRED), "app/dispatch.py");
    const starter = fn(d, "_tally_create_order_placed");
    expect(starter).not.toContain("if __events:");
  });
});
