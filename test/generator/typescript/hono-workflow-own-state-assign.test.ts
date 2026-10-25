// Workflow own-state mutation (workflow.md, "handle = own-state mutation") on
// Hono.  A `field := value` in a workflow `create`/`handle`/`on` body that
// targets one of the workflow's OWN state fields writes onto the loaded
// correlation-state row (`state.<field>`), which `save<Wf>` flushes at handler
// exit — NOT an aggregate `this`.
//
// A MONEY compound (`total -= money(…)`) renders the Decimal method
// (`state.total.minus(…)`), which only works if `state.total` IS a `Decimal`
// on every path into the body — including a reactor's, which runs on a row
// RELOADED from Postgres, where both adapters hand a `numeric` back as text.
// So the pin is the persistence-boundary codec, not the arithmetic spelling:
// the state type carries the domain form, load converts text → `Decimal`,
// save converts back at the fixed scale, and a fresh row starts at a `Decimal`
// zero.  The runtime proof is `corpus/workflow-create-state` (a reactor
// `credit -= …` on the reloaded row, read back at "7.0000", node and mikroorm).
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = (persistence: string) => `
  system S {
    subdomain C {
      context C {
        aggregate Order {
          status: string
          operation place() { status := "Placed"  emit OrderPlaced { order: id, at: now() } }
        }
        repository Orders for Order {}
        event OrderPlaced { order: Order id, at: datetime }
        channel Lifecycle { carries: OrderPlaced  delivery: broadcast  retention: ephemeral }
        workflow OrderFulfillment {
          orderId: Order id
          attempts: int
          total: money
          rate: decimal
          create(p: OrderPlaced) by p.order { attempts += 1  total -= money("5.00")  rate += 0.5 }
        }
      }
    }
    api A from C
    storage pg { type: postgres }
    resource sagaState { for: C, kind: state, use: pg }
    deployable d { platform: node${persistence}  contexts: [C]  dataSources: [sagaState]  serves: A  port: 4000 }
  }
`;

const workflows = async (persistence: string): Promise<string> =>
  [...(await generateSystemFiles(SRC(persistence))).entries()].find(([k]) =>
    k.endsWith("/http/workflows.ts"),
  )?.[1] ?? "";

describe("Hono workflow own-state — numeric state crosses the persistence boundary typed", () => {
  for (const [label, persistence, rowType] of [
    ["drizzle", "", "typeof schema.orderFulfillments.$inferInsert"],
    ["mikroorm", " { persistence: mikroorm }", "OrderFulfillmentRow"],
  ] as const) {
    it(`${label}: load decodes, save encodes, a fresh row starts at the domain zero`, async () => {
      const wf = await workflows(persistence);
      expect(wf).toContain(
        `type OrderFulfillmentState = Omit<${rowType}, "total" | "rate"> & { total: Decimal; rate: number };`,
      );
      expect(wf).toContain(
        "return row ? { ...row, total: new Decimal(row.total), rate: Number(row.rate) } : undefined;",
      );
      expect(wf).toContain(
        `const row: ${rowType} = { ...state, total: state.total.toFixed(4), rate: String(state.rate) };`,
      );
      expect(wf).toContain('total: new Decimal("0"), rate: 0 }');
      const start = wf.slice(wf.indexOf("orderFulfillmentStartOrderPlaced"));
      expect(start).toContain('state.total = state.total.minus(new Decimal("5.00"));');
    });
  }
});
