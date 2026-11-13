// The channel plan: for one deployable, where does each event go, is it
// durable here, and is a redelivery deduped here?
//
// Every backend answers those questions for the deployable it emits: which
// broker bindings it wires, which wired channels it does not host, which
// events ride the transactional outbox, which ones a broker carries instead of
// the in-process dispatcher, and whether it drains a broker at all.  Two
// backends answering any of them differently is a delivery bug (an event that
// is durable on one backend and at-most-once on the next), so the answers are
// decided once here and each backend only renders them.
//
// The broker client, worker hosting and DI stay per backend; the relay numbers
// (attempts, poll interval, backoff) are `src/generator/_channels/
// delivery-policy.ts`, and the envelope and outbox constants are
// `src/util/channels.ts`.

import { deriveEventSubscriptions } from "../enrich/enrichments.js";
import type {
  BoundedContextIR,
  ChannelIR,
  DeployableIR,
  EventSubscriptionIR,
  SystemIR,
} from "../types/loom-ir.js";
import { consumedEventNames } from "../util/channel-consumption.js";
import { type BrokerBinding, brokerChannelBindings, uniqueBindings } from "./channel-bindings.js";

/** How an event this deployable RAISES leaves the raising transaction.
 *
 *  - `inline-local`  — in-process dispatch, at-most-once, no broker.
 *  - `outbox-local`  — written to `__loom_outbox` in the raising transaction;
 *                      the relay redelivers it in-process.
 *  - `broker-inline` — published to the broker by the ephemeral tee after
 *                      commit (at-most-once).
 *  - `broker-outbox` — written to `__loom_outbox`; the relay publishes it. */
export type EventRoute = "inline-local" | "outbox-local" | "broker-inline" | "broker-outbox";

export interface ChannelPlan {
  /** Every broker binding the deployable wires (one per channelSource ×
   *  context that declares the channel). */
  bindings: BrokerBinding[];
  /** One binding per channelSource — the set a broker client connects. */
  uniqueBindings: BrokerBinding[];
  /** Wired channels declared in a context this deployable does not host, as
   *  `ChannelIR` stubs carrying the channel's real delivery/retention. */
  foreignChannels: ChannelIR[];
  /** Event subscriptions over every hosted context's workflows and
   *  projections, routed off the hosted channels and the foreign stubs. */
  subscriptions: EventSubscriptionIR[];
  /** Every event some wired binding carries.  These leave the in-process
   *  dispatcher: a local subscriber gets them back from the broker. */
  brokerEvents: ReadonlySet<string>;
  /** Events a hosted context's `retention: log | work` channel carries. */
  hostedDurable: ReadonlySet<string>;
  /** Events a wired, non-hosted `retention: log | work` channel carries — the
   *  durable events this deployable can only CONSUME. */
  foreignDurable: ReadonlySet<string>;
  /** Hosted durable events a wired durable binding carries: their producer
   *  path is the outbox relay publishing to the broker. */
  durableBrokerEvents: ReadonlySet<string>;
  /** Broker-carried events a hosted reactor, event-triggered `create` or
   *  projection fold consumes. */
  brokerConsumedEvents: ReadonlySet<string>;
  /** The deployable runs a broker consumer: it wires a binding and consumes
   *  some event that binding carries. */
  consumesFromBroker: boolean;
  /** The deployable owns an outbox tier (table, capture, relay): some event
   *  it raises is durable. */
  hasOutbox: boolean;
  /** The outbox tier runs with no in-process subscriber — every drained row
   *  goes to the broker. */
  producerOnly: boolean;
  /** Consumed events whose redelivery the consumer must dedupe on the
   *  envelope id: every consumed durable event, hosted or foreign. */
  dedupedEvents: ReadonlySet<string>;
}

/** The deployable a plan is built for, when the backend has one. */
export interface ChannelPlanSystem {
  deployable: DeployableIR;
  sys: SystemIR;
}

function durableCarries(channels: readonly ChannelIR[]): Set<string> {
  const out = new Set<string>();
  for (const ch of channels) {
    if (ch.retention === "log" || ch.retention === "work") for (const ev of ch.carries) out.add(ev);
  }
  return out;
}

/** The channel plan of the deployable hosting `contexts`.  Without a system
 *  (a single-context emit) nothing is wired, so every route is local. */
export function channelPlan(
  contexts: readonly BoundedContextIR[],
  system?: ChannelPlanSystem,
): ChannelPlan {
  const bindings = system ? brokerChannelBindings(system.deployable, system.sys) : [];

  const hostedChannels = contexts.flatMap((c) => c.channels ?? []);
  const hostedChannelNames = new Set(hostedChannels.map((ch) => ch.name));
  const seenForeign = new Set<string>();
  const foreignChannels: ChannelIR[] = [];
  for (const b of bindings) {
    if (hostedChannelNames.has(b.channelName) || seenForeign.has(b.channelName)) continue;
    seenForeign.add(b.channelName);
    foreignChannels.push({
      name: b.channelName,
      carries: b.events,
      delivery: b.delivery,
      retention: b.retention,
    });
  }

  const subscriptions = deriveEventSubscriptions(
    [...hostedChannels, ...foreignChannels],
    contexts.flatMap((c) => c.workflows ?? []),
    contexts.flatMap((c) => c.projections ?? []),
  );

  const brokerEvents = new Set(bindings.flatMap((b) => b.events));
  const hostedDurable = durableCarries(hostedChannels);
  const foreignDurable = durableCarries(foreignChannels);
  const durableBrokerEvents = new Set(
    bindings
      .filter((b) => b.retention === "log" || b.retention === "work")
      .flatMap((b) => b.events)
      .filter((ev) => hostedDurable.has(ev)),
  );

  const ctxByName = new Map(contexts.map((c) => [c.name, c] as const));
  const consumed = consumedEventNames({ contextNames: [...ctxByName.keys()] }, ctxByName);
  const brokerConsumedEvents = new Set([...consumed].filter((ev) => brokerEvents.has(ev)));
  const consumesFromBroker = brokerConsumedEvents.size > 0;

  const hasOutbox = hostedDurable.size > 0;
  const producerOnly = hasOutbox && subscriptions.length === 0;
  const dedupedEvents = new Set(
    [...consumed].filter((ev) => hostedDurable.has(ev) || foreignDurable.has(ev)),
  );

  return {
    bindings,
    uniqueBindings: uniqueBindings(bindings),
    foreignChannels,
    subscriptions,
    brokerEvents,
    hostedDurable,
    foreignDurable,
    durableBrokerEvents,
    brokerConsumedEvents,
    consumesFromBroker,
    hasOutbox,
    producerOnly,
    dedupedEvents,
  };
}

/** How `event`, raised by a hosted context, leaves its transaction. */
export function eventRoute(plan: ChannelPlan, event: string): EventRoute {
  const durable = plan.hostedDurable.has(event);
  if (plan.brokerEvents.has(event)) return durable ? "broker-outbox" : "broker-inline";
  return durable ? "outbox-local" : "inline-local";
}

/** True when the in-process dispatcher delivers `event` to local
 *  subscribers; a broker-carried event reaches them from the broker instead,
 *  so each delivery happens once. */
export function deliversLocally(plan: ChannelPlan, event: string): boolean {
  return !plan.brokerEvents.has(event);
}
