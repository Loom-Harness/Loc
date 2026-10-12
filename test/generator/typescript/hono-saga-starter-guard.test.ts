// Event-sourced saga starter guard (S5b) — no double-append on Hono.  When an
// event-sourced workflow declares BOTH `create(e)` and `on(e)` for the SAME
// event, the `on` reactor guards on an empty stream and the `create` starter
// must guard on a NON-empty one (its inverse), so the event folds exactly once:
// a brand-new correlation runs the create, an existing one runs the on, never
// both.  A create with no paired `on` on the same event stays byte-identical.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// create + on on DIFFERENT events — no pairing, so the starter must NOT guard.
const UNPAIRED = `system S { subdomain O { context O {
  aggregate Order { status: string  operation place() { status := "P"  emit OrderPlaced { order: id } } }
  repository Orders for Order { }
  event OrderPlaced { order: Order id }
  event PaymentReceived { order: Order id, amount: int }
  channel L { carries: OrderPlaced, PaymentReceived  delivery: broadcast  retention: ephemeral }
  workflow Tally eventSourced {
    orderId: Order id
    total: int
    create(p: OrderPlaced) by p.order { emit PaymentReceived { order: p.order, amount: 0 } }
    on(pr: PaymentReceived) by pr.order { emit PaymentReceived { order: pr.order, amount: total } }
    apply(pr: PaymentReceived) { total := total + pr.amount }
  }
} } api A from O storage pg { type: postgres }
  resource oState { for: O, kind: state, use: pg }
  deployable api { platform: node contexts: [O] serves: A dataSources: [oState] port: 8080 } }`;

async function gen(src: string): Promise<Map<string, string>> {
  return await generateSystemFiles(src);
}

const file = (files: Map<string, string>, suffix: string): string =>
  [...files.entries()].find(([k]) => k.endsWith(suffix))?.[1] ?? "";

const fn = (src: string, name: string): string => {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return "";
  const after = src.indexOf("\nexport ", start + 1);
  return src.slice(start, after < 0 ? undefined : after);
};

describe("hono event-sourced saga starter guard (S5b)", () => {
  it("a create with no paired on stays byte-identical (no exists-guard)", async () => {
    const src = file(await gen(UNPAIRED), "http/workflows.ts");
    const starter = fn(src, "tallyStartOrderPlaced");
    expect(starter).not.toContain("if (__stream.length !== 0)");
  });
});
