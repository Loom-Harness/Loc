import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// Every dispatcher node's boot builds folds the projections on the way
// through.  When boot wires an outbox (a durable channel feeding a reactor),
// it hands `createApp` an explicit dispatcher chain and starts the relay on a
// second one; both must contain `projectionTee`, or a folded projection is
// never written.
//
// String tier, deliberately: this is wiring nothing boots.  The behavioural
// legs dispatch through `createApp`'s default chain and never run `boot.ts`.

const SOURCE = `
system S {
  subdomain M {
    context Orders {
      aggregate Order with crudish {
        code: string
        operation place() { emit OrderPlaced { order: id } }
      }
      aggregate Note with crudish { text: string }
      repository Orders for Order
      repository Notes for Note
      event OrderPlaced { order: Order id }
      channel Lifecycle { carries: OrderPlaced  delivery: queue  retention: work }
      workflow NoteIt {
        orderId: Order id
        create(e: OrderPlaced) by e.order { let n = Note.create(text: "placed") }
      }
      projection OrderBook keyed by order {
        order: Order id
        status: string
        on(e: OrderPlaced) { status := "Placed" }
      }
    }
  }
  api A from M
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  deployable d { platform: node contexts: [Orders] dataSources: [st] serves: A port: 3000 }
}`;

describe("node boot folds projections on every dispatch path", () => {
  it("wraps the relay's and the request path's dispatchers in projectionTee", async () => {
    const files = await generateSystemFiles(SOURCE);
    const boot = files.get("d/boot.ts")!;
    expect(boot).toContain("startOutboxRelay(db, inProcessEvents)");
    expect(boot).toMatch(
      /const inProcessEvents = projectionTee\(db, createInProcessDispatcher\(db\)\);/,
    );
    expect(boot).toMatch(
      /const requestEvents = projectionTee\(db, createInProcessDispatcher\(db, \{ isolateReactorFailures: true \}\)\);/,
    );
    expect(boot).toMatch(/import \{[^}]*\bprojectionTee\b[^}]*\} from "\.\/http\/projections"/);
  });
});
