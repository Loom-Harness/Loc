// The broker service: `BrokerModel` behind the infra protocol.

import type { BrokerOp } from "../../../../src/emulation/broker-protocol.js";
import { createBroker } from "../../../../src/emulation/broker-model.js";
import type { InfraService, InfraServiceHost } from "./service.js";

export function createBrokerService(host: InfraServiceHost): InfraService<BrokerOp> {
  const model = createBroker({ send: (client, delivery) => host.push(client, delivery) });
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
        case "seek":
          return model.seek(req.params);
        case "redrive":
          return model.redrive(req.params);
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
