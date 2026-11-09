// The broker service: `BrokerModel` behind the infra protocol.

import type { BrokerOp } from "./broker-protocol.js";
import { BrokerModel } from "./broker-model.js";
import type { InfraService, InfraServiceHost } from "./service.js";

export function createBrokerService(host: InfraServiceHost): InfraService<BrokerOp> {
  const model = new BrokerModel({ send: (client, delivery) => host.push(client, delivery) });
  return {
    name: "broker",
    handle(req, { client }) {
      switch (req.op) {
        case "publish":
          model.publish(client, req.params);
          return { ok: true };
        case "subscribe":
          if (client === null) throw new Error("broker.subscribe needs a connected deployable");
          return { subId: model.subscribe(client, req.params) };
        case "unsubscribe":
          model.unsubscribe(req.params.subId);
          return { ok: true };
        case "ack":
          model.ack(req.params.deliveryId);
          return { ok: true };
        case "nack":
          return model.nack(req.params.deliveryId, req.params.error, req.params.poison === true);
        case "inspect":
          return model.inspect();
      }
    },
    disconnect(client) {
      model.disconnect(client);
    },
    reset() {
      model.reset();
    },
  };
}
