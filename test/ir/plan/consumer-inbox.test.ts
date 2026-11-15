// The consumer inbox's key (`src/ir/plan/consumer-inbox.ts`): one key per
// handler that can receive an event, the same on every deployable that hosts
// it, and never shared by two handlers of the same event.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  channelPlan,
  contextReceivesDurable,
  deployableNeedsInbox,
  foldConsumerKey,
  inboxConsumerKey,
  inboxDedupes,
  workflowConsumerKey,
} from "../../../src/ir/plan/index.js";
import type { EventSubscriptionIR, SystemIR } from "../../../src/ir/types/loom-ir.js";
import { buildLoomModel } from "../../_helpers/index.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const CORPUS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/corpus");

const TWO_CONTEXTS = `
system Acme {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish { status: string }
      repository Orders for Order {}
      event OrderPlaced { order: Order id }
      channel Lifecycle { carries: OrderPlaced delivery: queue retention: work }
      projection Book keyed by order {
        order: Order id
        n: int
        on(e: OrderPlaced) { n += 1 }
      }
    }
    context Billing {
      aggregate Invoice with crudish { orderRef: Order id }
      repository Invoices for Invoice {}
      workflow Bill {
        orderId: Order id
        create(p: OrderPlaced) by p.order { let i = Invoice.create(orderRef: p.order) }
        on(p: OrderPlaced) by p.order { let i = Invoice.create(orderRef: p.order) }
        on(q: OrderPlaced) by q.order { let i = Invoice.create(orderRef: q.order) }
      }
    }
  }
  storage s { type: postgres }
  resource orders { for: Orders, kind: state, use: s }
  resource billing { for: Billing, kind: state, use: s }
  deployable d { platform: node contexts: [Orders, Billing] dataSources: [orders, billing] port: 3000 }
}
`;

/** A consumer context beside the context that hosts the durable channel, in
 *  one deployable: the consumer hosts no channel of its own. */
const SIBLING_HOST = `
system SagaRedelivery {
  subdomain Catalog {
    context Catalog {
      aggregate Product with crudish {
        sku: string
        operation record() { emit ProductLogged { product: id } }
      }
      repository Products for Product { }
      event ProductLogged { product: Product id }
      channel History { carries: ProductLogged delivery: queue retention: work }
    }
  }
  subdomain Admin {
    context AdminFeed {
      aggregate Note with crudish { text: string }
      repository Notes for Note { }
      projection Tally keyed by product {
        product: Product id
        seen: int
        on(e: ProductLogged) { seen += 1 }
      }
    }
  }
  storage pg { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: pg }
  resource adminState { for: AdminFeed, kind: state, use: pg }
  deployable d { platform: node contexts: [Catalog, AdminFeed] dataSources: [catalogState, adminState] port: 4000 }
}
`;

/** Contexts whose consumers claim on a deployable (what its handlers render)
 *  but whose migrations would not create the inbox (what the migrations ask
 *  per context). */
function inboxDisagreements(sys: SystemIR): string[] {
  const all = sys.subdomains.flatMap((d) => d.contexts);
  const out: string[] = [];
  for (const deployable of sys.deployables) {
    const hosted = all.filter((c) => deployable.contextNames.includes(c.name));
    const plan = channelPlan(hosted, { deployable, sys });
    if (!deployableNeedsInbox(hosted, plan)) continue;
    for (const c of hosted) {
      if (inboxDedupes(c, plan.receivesDurable) && !inboxDedupes(c, contextReceivesDurable(c, sys)))
        out.push(`${deployable.name}/${c.name}`);
    }
  }
  return out;
}

describe("consumer inbox key", () => {
  it("is <context>/<kind>/<owner>.<event>, with an ordinal past the first", () => {
    expect(inboxConsumerKey("Shipping", "create", "Fulfil", "OrderPlaced")).toBe(
      "Shipping/create/Fulfil.OrderPlaced",
    );
    expect(inboxConsumerKey("Shipping", "on", "Fulfil", "OrderPlaced", 1)).toBe(
      "Shipping/on/Fulfil.OrderPlaced#2",
    );
  });

  it("names the declaring context, not the merged one, and separates two `on` handlers of one event", async () => {
    // Two `on(…: OrderPlaced)` in one workflow are not refused by the
    // validator, so the ordinal keeps them apart.
    const loom = await buildLoomModel(TWO_CONTEXTS);
    const sys = loom.systems[0];
    const [orders, billing] = sys.subdomains[0].contexts;
    // A deployable hosting both emits them merged under the first name.
    const merged = { ...billing, name: orders.name };
    expect(foldConsumerKey(sys, merged, "Book", "OrderPlaced")).toBe(
      "Orders/fold/Book.OrderPlaced",
    );
    const subs: EventSubscriptionIR[] = billing.eventSubscriptions.filter((s) => !s.projection);
    const keys = subs.map((s) => workflowConsumerKey(sys, merged, s, subs));
    expect(keys.sort()).toEqual([
      "Billing/create/Bill.OrderPlaced",
      "Billing/on/Bill.OrderPlaced",
      "Billing/on/Bill.OrderPlaced#2",
    ]);
    expect(deployableNeedsInbox([orders, billing], { receivesDurable: true })).toBe(true);
    expect(deployableNeedsInbox([orders, billing], { receivesDurable: false })).toBe(false);
  });

  it("the migrations create the inbox for every context whose consumers claim", async () => {
    const loom = await buildLoomModel(SIBLING_HOST);
    expect(inboxDisagreements(loom.systems[0])).toEqual([]);
  });

  it("no two handlers of one event share a key, across the whole corpus", async () => {
    const features = fs
      .readdirSync(CORPUS)
      .filter((f) => f.endsWith(".ddd"))
      .map((f) => f.replace(/\.ddd$/, ""))
      .filter((f) =>
        fs.readFileSync(path.join(CORPUS, `${f}.ddd`), "utf8").includes("__PLATFORM__"),
      );
    expect(features.length).toBeGreaterThan(100);
    let handlers = 0;
    const clashes: string[] = [];
    // The same agreement as above, over every corpus system.
    const disagreements: string[] = [];
    for (const feature of features) {
      let loom: Awaited<ReturnType<typeof buildLoomModel>>;
      try {
        loom = await buildLoomModel(corpusSourceFor(feature, "node"));
      } catch {
        continue; // a fixture the node backend refuses has no node handlers
      }
      for (const sys of loom.systems) {
        disagreements.push(...inboxDisagreements(sys).map((d) => `${feature}: ${d}`));
        const seen = new Map<string, string>();
        for (const ctx of sys.subdomains.flatMap((d) => d.contexts)) {
          const subs = ctx.eventSubscriptions.filter((s) => !s.projection);
          const keyed = [
            ...subs.map((s) => [
              workflowConsumerKey(sys, ctx, s, subs),
              `${s.workflow}.${s.trigger}(${s.param})`,
            ]),
            ...ctx.projections.flatMap((p) =>
              p.handlers.map((h) => [
                foldConsumerKey(sys, ctx, p.name, h.event),
                `${p.name}.on(${h.param})`,
              ]),
            ),
          ];
          for (const [key, who] of keyed) {
            handlers++;
            const other = seen.get(key);
            if (other !== undefined && other !== who)
              clashes.push(`${feature}: ${key} — ${other} / ${who}`);
            seen.set(key, who);
          }
        }
      }
    }
    expect(handlers).toBeGreaterThan(40);
    expect(clashes).toEqual([]);
    expect(disagreements).toEqual([]);
  }, 300_000);
});
