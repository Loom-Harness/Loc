// A broker or database outage must not take the Phoenix application down: the
// outbox relay and the broker publisher processes absorb transient failures
// (log + capped backoff) instead of crashing past the supervisor's restart
// intensity.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const src = (transport: string) => `
system Brk {
  subdomain A {
    context Orders {
      aggregate Order with crudish {
        qty: int
        operation place() { emit Placed { order: id, qty: qty } }
      }
      repository Orders for Order { }
      event Placed { order: Order id, qty: int }
      channel Lifecycle { carries: Placed  delivery: queue  retention: work }
    }
  }
  api OrdersApi from A
  storage pg { type: postgres }
  storage mq { type: ${transport} }
  resource sa { for: Orders, kind: state, use: pg }
  channelSource lifeBus { for: Lifecycle, use: mq }
  deployable orders { platform: elixir contexts: [Orders] dataSources: [sa] channels: [lifeBus] serves: OrdersApi port: 4000 }
}`;

describe("elixir outbox relay + broker publishers — outage resilience", () => {
  it("the relay drain pass cannot crash the GenServer and backs off on failure", async () => {
    const files = await generateSystemFiles(src("rabbitmq"));
    const relay = files.get("orders/lib/orders/outbox_relay.ex") ?? "";
    expect(relay).toContain("case drain() do");
    expect(relay).toContain("Process.send_after(self(), :drain, backoff_ms(failures))");
    expect(relay).toContain(
      "    |> Enum.reduce_while(:ok, fn row, :ok ->\n      case deliver(row) do",
    );
    // DB errors and exits are returned, not raised.
    expect(relay).toContain(
      "  rescue\n    error -> {:error, error}\n  catch\n    :exit, reason -> {:error, {:exit, reason}}",
    );
    // An unreachable broker halts the pass without spending the row's attempts.
    expect(relay).toContain("error in Orders.BrokerUnavailable -> {:halt, error}");
  });

  it("the rabbit publisher answers {:error, _} instead of match-failing on connect", async () => {
    const files = await generateSystemFiles(src("rabbitmq"));
    const broker = files.get("orders/lib/orders/channel_broker.ex") ?? "";
    expect(broker).not.toContain("{:ok, conn} = AMQP.Connection.open(url)");
    expect(broker).toContain("with {:ok, conn} <- AMQP.Connection.open(url),");
    expect(broker).toContain("{:error, reason} -> {:reply, {:error, reason}, reset(state)}");
    expect(broker).toContain("Process.flag(:trap_exit, true)");
    const tee = files.get("orders/lib/orders/channels.ex") ?? "";
    expect(tee).toContain("raise Orders.BrokerUnavailable, reason: reason");
    expect(tee).toContain(":exit, reason -> raise Orders.BrokerUnavailable, reason: reason");
  });

  it("the kafka publisher answers {:error, _} for a failed produce", async () => {
    const files = await generateSystemFiles(src("kafka"));
    const broker = files.get("orders/lib/orders/kafka_broker.ex") ?? "";
    expect(broker).toContain("{:error, reason} -> {:reply, {:error, reason}, state}");
    expect(broker).toContain("error -> {:reply, {:error, error}, state}");
  });

  it("the standalone relay is equally guarded against a database error", async () => {
    const files = await generateSystemFiles(`
system S {
  subdomain A {
    context Orders {
      aggregate Order with crudish { qty: int }
      repository Orders for Order { }
      event Placed { order: Order id }
      channel Lifecycle { carries: Placed  delivery: queue  retention: work }
      workflow W { orderId: Order id  create(p: Placed) by p.order { } }
    }
  }
  api OrdersApi from A
  storage pg { type: postgres }
  resource sa { for: Orders, kind: state, use: pg }
  deployable orders { platform: elixir contexts: [Orders] dataSources: [sa] serves: OrdersApi port: 4000 }
}`);
    const relay = files.get("orders/lib/orders/local_outbox_relay.ex") ?? "";
    expect(relay).toContain("case drain() do");
    expect(relay).not.toContain("BrokerUnavailable");
  });
});
