// A workflow reactor whose body spells the correlation rule as an ASSIGNMENT
// (`orderRef := e.orderRef` inside `create(e: OrderPlaced) by e.orderRef`)
// must not render `state.setOrderRef(e.orderRef())` on Java: the saga row's
// key is an immutable `@EmbeddedId` the JPA entity exposes no setter for —
// `_allocate(__key)` seeds it on a `create` trigger and `findById(__key)`
// selects it on an `on` trigger — so the assignment selects the row, it does
// not mutate it.  The command-workflow facade (`emit/workflow.ts`) already
// rendered the arm as a comment; the in-process dispatcher (`emit/dispatch.ts`)
// did not thread the key, and javac answered `cannot find symbol: method
// setOrderRef(OrderId)` — found by the `projection-implicit-sub` corpus
// fixture's java compile leg the moment D-PROJECTION-IMPLICIT-SUB made an
// uncarried reactor dispatch at all (wave C2 batch 2, post-flip).
//
// Pinned on both consumer shapes the dispatcher renders (the implicit
// in-process subscription and a channel-carried one) and on both triggers.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const MODEL = (channel: string) => `
system S {
  subdomain Orders {
    context Orders {
      aggregate Order with crudish {
        status: string
        operation ship() { status := "Shipped"  emit OrderShipped { orderRef: id, at: now() } }
      }
      repository Orders for Order { }
      event OrderPlaced  { orderRef: Order id, at: datetime }
      event OrderShipped { orderRef: Order id, at: datetime }
      ${channel}
      workflow Fulfilment {
        orderRef: Order id
        shippedAt: datetime?
        create(e: OrderPlaced) by e.orderRef { orderRef := e.orderRef }
        on(e: OrderShipped) by e.orderRef { orderRef := e.orderRef  shippedAt := e.at }
      }
    }
  }
  api OrdersApi from Orders
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  deployable d { platform: java contexts: [Orders] dataSources: [ordersState] serves: OrdersApi port: 4000 }
}`;

async function dispatcher(channel: string): Promise<string> {
  const files = await generateSystemFiles(MODEL(channel));
  const d = [...files.entries()].find(([k]) => k.endsWith("/OrdersDispatcher.java"))?.[1];
  expect(d, "dispatcher not emitted").toBeDefined();
  return d as string;
}

describe("java reactor: the correlation key is fixed by the row, never re-set", () => {
  for (const [label, channel] of [
    ["an uncarried (implicit in-process) subscription", ""],
    [
      "a channel-carried subscription",
      "channel Lifecycle { carries: OrderPlaced, OrderShipped  delivery: broadcast  retention: ephemeral }",
    ],
  ] as const) {
    it(`${label}: the create reactor allocates by key and renders no setter for it`, async () => {
      const d = await dispatcher(channel);
      expect(d).toContain("FulfilmentState._allocate(__key)");
      expect(d).not.toContain("state.setOrderRef(");
      expect(d).toContain("`orderRef` is the correlation key: fixed by `_allocate(__key)` above, never re-set.");
    });

    it(`${label}: the on reactor loads by key, skips the key assignment and keeps the real one`, async () => {
      const d = await dispatcher(channel);
      expect(d).toContain("fulfilmentStateRepository.findById(__key).orElse(null)");
      expect(d).not.toContain("state.setOrderRef(");
      expect(d).toContain("state.setShippedAt(e.at());");
    });
  }
});
