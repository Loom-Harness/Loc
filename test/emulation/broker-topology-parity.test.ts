// The emulated broker spells the generated drivers' dead-letter names itself
// (`src/emulation/` imports nothing outside it).  This holds those names equal
// to the shared topology the emitters read (`brokerTopology`,
// `src/util/channels.ts`), so the playground parks a dead letter where the
// generated consumer looks for it.

import { describe, expect, it } from "vitest";
import { BrokerModel } from "../../src/emulation/broker-model.js";
import { brokerTopology, channelAddress } from "../../src/util/channels.js";

describe("emulated broker dead-letter names follow the shared topology", () => {
  it("a rabbitmq subscription declares the topology's DLX and dead-letter queue", () => {
    const topo = brokerTopology("shop_floor");
    const address = channelAddress(topo, "Orders", "Lifecycle");
    const model = new BrokerModel({ send: () => {}, schedule: (fn) => fn() });
    model.subscribe("consumer", {
      transport: "rabbitmq",
      address,
      group: `${address}.api`,
      fromBeginning: false,
    });
    const { exchanges, queues } = model.inspect().rabbitmq;
    expect(exchanges.map((e) => e.name)).toContain(topo.deadLetterExchange);
    expect(queues.map((q) => q.name)).toContain(`${topo.deadLetterQueuePrefix}${address}`);
    expect(exchanges.find((e) => e.name === topo.deadLetterExchange)?.queues).toEqual([
      `${topo.deadLetterQueuePrefix}${address}`,
    ]);
  });
});
