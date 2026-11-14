// Wiring no booted tier reaches yet: the broker consumer each backend starts on
// a deployable whose only consumer of a broker event is a projection fold.
//
// Why the string tier: observing it means booting two deployables around a
// broker, which the behavioural legs do not do yet (#5613).  The claim moves to
// `channels-broker-projection`'s behavioural block once they do.  (That the
// node boot chain folds is behavioural already: `projection-explicit-dispatcher`
// on the mikroorm leg, which boots the generated entrypoint.)

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";
import type { Backend } from "../fixtures/corpus/backends.js";
import { corpusSourceFor } from "../fixtures/corpus/harness.js";

async function files(fixture: string, backend: Backend): Promise<Map<string, string>> {
  return generateSystemFiles(corpusSourceFor(fixture, backend));
}

function file(out: Map<string, string>, path: string): string {
  const text = out.get(path);
  if (text === undefined) throw new Error(`not emitted: ${path}`);
  return text;
}

describe("a projection-only broker consumer runs a broker consumer on every backend", () => {
  const fixture = "channels-broker-projection";

  it("node: boot starts the consumer into a chain that folds", async () => {
    const boot = file(await files(fixture, "node"), "ship_api/boot.ts");
    expect(boot).toMatch(/startChannelConsumers\(channelTransports, inProcessEvents\)/);
    expect(boot).toMatch(/const inProcessEvents = projectionTee\(db, /);
  });

  it("dotnet: the consumer service is hosted", async () => {
    const program = file(await files(fixture, "dotnet"), "ship_api/Program.cs");
    expect(program).toContain("AddHostedService<ChannelConsumerService>()");
  });

  it("python: main starts the consumer task", async () => {
    const main = file(await files(fixture, "python"), "ship_api/app/main.py");
    expect(main).toContain("await start_channel_consumers()");
  });

  it("java: the consumer routes the event to the fold", async () => {
    const out = await files(fixture, "java");
    const path = [...out.keys()].find(
      (p) => p.startsWith("ship_api/") && p.endsWith("/ChannelConsumerService.java"),
    );
    expect(path, "ChannelConsumerService.java").toBeDefined();
    expect(file(out, path as string)).toContain("onOrderBookOnOrderPlaced(");
  });

  it("elixir: the consumer routes the event", async () => {
    const consumer = file(
      await files(fixture, "vanilla"),
      "ship_api/lib/ship_api/channel_consumer.ex",
    );
    expect(consumer).toContain("Events.OrderPlaced{}");
  });
});

describe("node: the outbox relay runs whenever the deployable has an outbox tier", () => {
  // The durable event is raised in one hosted context and consumed by a saga in
  // another.  Request-path capture and the relay must agree, or the captured
  // rows are never drained.  Booted witness: C2's node legs of
  // saga-redelivery-e2e; the corpus `test e2e` vocabulary cannot wait on the
  // asynchronous relay.
  it("a cross-context consumer starts the relay", async () => {
    const boot = file(await files("saga-durable-cross-context", "node"), "d/boot.ts");
    expect(boot).toContain("const stopOutboxRelay = startOutboxRelay(db, inProcessEvents);");
    expect(boot).toContain("createApp(db, createOutboxDispatcher(db, requestEvents))");
  });
});

describe("java: a broker-wired deployable keeps the outbox for its unbound durable channel", () => {
  // `OrderNoted` rides a durable channel no binding carries, on a deployable
  // that relays `OrderPlaced` to the broker.  It must be recorded by the local
  // tee and redelivered by the local relay; the two relays split the table by
  // event type so each row has one relay.  Booting it needs the broker sidecar
  // (#5613), and the redelivery is asynchronous.
  it("records the unbound durable event and partitions the two relays", async () => {
    const out = await files("channels-broker-mixed-durable", "java");
    const find = (suffix: string): string => {
      const path = [...out.keys()].find((p) => p.endsWith(suffix));
      if (!path) throw new Error(`not emitted: *${suffix}`);
      return file(out, path);
    };
    expect(find("/LoomEventOutbox.java")).toContain(
      'static final Set<String> DURABLE = Set.of("OrderNoted");',
    );
    expect(find("/LocalOutboxRelay.java")).toContain(
      "AndTypeInOrderByOccurredAtAsc(LoomEventOutbox.DURABLE)",
    );
    expect(find("/OutboxRelayService.java")).toContain(
      "outbox.claimPendingOfTypes(ChannelBindings.DURABLE_ROUTING.keySet())",
    );
  });
});

describe("elixir: a broker-wired deployable keeps the outbox for its unbound durable channel", () => {
  it("the broker tee falls through to the local outbox and the relays split the table", async () => {
    const out = await files("channels-broker-mixed-durable", "vanilla");
    expect(file(out, "d/lib/d/channels.ex")).toContain(
      "D.LocalOutbox.dispatch(ev, local_dispatcher)",
    );
    expect(file(out, "d/lib/d/local_outbox.ex")).toContain('@durable MapSet.new(["OrderNoted"])');
    expect(file(out, "d/lib/d/local_outbox_relay.ex")).toContain('@types ["OrderNoted"]');
    expect(file(out, "d/lib/d/outbox_relay.ex")).toContain('@types ["OrderPlaced"]');
  });
});
