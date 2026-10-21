// The vanilla `run/1` params destructure binds exactly the params the body
// reads — so the collector that decides "reads" must see every child slot an
// expression has.  A param read only inside a `days(n)` duration (or any other
// slot a hand-rolled walk forgets) was left out of the destructure while the
// rendered body still named it: `undefined variable "n"` on `mix compile`, on a
// model `ddd parse` called clean.  Both collectors — the workflow create-param
// one and the explicit handler's flattened-record one — now ride `walk.ts`.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system Shop {
  subdomain Sales {
    context Orders {
      criterion Pending(d: bool) of Order = this.open == d
      aggregate Order {
        open: bool
        until: datetime
        operation extend(at: datetime) { until := at }
      }
      repository Orders for Order { }
      command ExtendOrder { orderId: Order id  n: int }
      commandHandler ExtendIt(cmd: ExtendOrder): Order id {
        let o = Orders.getById(cmd.orderId)
        o.extend(now() + days(cmd.n))
        return o.id
      }
      workflow extendPending {
        create(d: bool, n: int) {
          if let o = Orders.find(Pending(d)) {
            o.extend(now() + days(n))
          }
        }
      }
    }
  }
  api OrdersApi from Sales {
    route POST "/orders/extend" -> Orders.ExtendIt
  }
  storage primary { type: postgres }
  resource ordersState { for: Orders, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Orders]
    dataSources: [ordersState]
    serves: OrdersApi
    port: 4000
  }
}
`;

function fileEndingWith(m: Map<string, string>, suffix: string): string {
  const key = [...m.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return m.get(key!)!;
}

describe("vanilla run/1 destructure sees a param read inside a duration", () => {
  it("workflow: a create-param used only as `days(n)` is destructured", async () => {
    const wf = fileEndingWith(await generateSystemFiles(SRC), "workflows/extend_pending.ex");
    expect(wf).toContain("((n) * 86400000)");
    expect(wf).toContain('%{"d" => d, "n" => n} = params');
  });

  it("handler: a record field used only as `days(cmd.n)` is destructured", async () => {
    const h = fileEndingWith(await generateSystemFiles(SRC), "handlers/extend_it.ex");
    expect(h).toContain("((n) * 86400000)");
    expect(h).toContain('%{"order_id" => order_id, "n" => n} = params');
  });
});
