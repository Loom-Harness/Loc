// Broker-binding resolution is a plan fact (`src/ir/plan/channel-bindings.ts`);
// the emitters and the system composer keep importing it from here.

export {
  type BrokerBinding,
  type BrokerTransport,
  brokerChannelBindings,
  channelTransportStorageNames,
  kafkaStartsAtEarliest,
} from "../../ir/plan/channel-bindings.js";
