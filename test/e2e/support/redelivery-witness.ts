// The redelivery witness every `channels-e2e-rabbit*` leg runs against its
// booted consumer fleet: a durable envelope delivered more than once — one
// replica after the other, or two replicas at the same time — changes the
// consumer's state once.
//
// Fixture contract (the same in every rabbit leg): the consumer deployable
// hosts `workflow Fulfil { create(p: OrderPlaced) by p.order { Shipment.create
// … } }`, wired to the producer's `queue`/`work` channel at `address`, and
// serves `/api/shipments`.  The witness publishes straight to the channel's
// exchange inside the rabbitmq sidecar, so it needs the docker container.

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

export interface RedeliveryWitnessOptions {
  /** The rabbitmq sidecar container, or `undefined` when the leg runs against
   *  an AMQP override with no container to publish from (the cases skip). */
  container: () => string | undefined;
  /** The channel exchange the consumer's queue is bound to. */
  address: string;
  /** Base URL of one consumer replica (`http://localhost:<port>`). */
  consumer: () => string;
}

const sh = (cmd: string): string => execSync(cmd, { encoding: "utf8", stdio: "pipe" });

function envelope(address: string, id: string): string {
  return JSON.stringify({
    specversion: "1.0",
    id,
    type: "Orders.OrderPlaced",
    source: "/loom/Orders",
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    loomchannel: address,
    data: { order: randomUUID(), at: new Date().toISOString() },
  });
}

/** One `rabbitmqadmin publish` of `body`, as a shell word list for `sh -c`. */
function publishCmd(address: string, body: string): string {
  return `rabbitmqadmin publish message --exchange ${address} --payload '${body}'`;
}

async function shipments(base: string): Promise<number> {
  const res = await fetch(`${base}/api/shipments?pageSize=1`);
  return ((await res.json()) as { total: number }).total;
}

/** True when no `loom.*` work queue holds a ready or unacknowledged message.
 *  `rabbitmqctl` asks the queue processes directly, so unlike the management
 *  API it does not lag. */
function drained(container: string): boolean {
  const out = sh(
    `docker exec ${container} rabbitmqctl -q list_queues name messages_ready messages_unacknowledged`,
  );
  return out
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter(([name]) => name?.startsWith("loom.") && !name.startsWith("loom.dlq."))
    .every(([, ready, unacked]) => ready === "0" && unacked === "0");
}

async function settle(container: string, base: string, expected: number): Promise<void> {
  const deadline = Date.now() + 60_000;
  // Wait for every first application, then for the queues to drain: a
  // duplicate that is still in flight would otherwise land after the check.
  while (Date.now() < deadline) {
    if ((await shipments(base)) >= expected && drained(container)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  // One more beat for a handler that acked before its transaction committed.
  await new Promise((r) => setTimeout(r, 1_000));
}

/** Registers the two redelivery cases on the enclosing `describe`. */
export function redeliveryWitness(opts: RedeliveryWitnessOptions): void {
  it("applies a redelivered envelope of a foreign durable channel once", async () => {
    const container = opts.container();
    if (!container) return; // AMQP override: no container to publish from
    const base = opts.consumer();
    const before = await shipments(base);
    const body = envelope(opts.address, randomUUID());
    // The same envelope id twice, one after the other: the broker's
    // redelivery of one outbox row.
    for (let i = 0; i < 2; i++) sh(`docker exec ${container} ${publishCmd(opts.address, body)}`);
    await settle(container, base, before + 1);
    expect(await shipments(base)).toBe(before + 1);
  }, 90_000);

  it("applies an envelope delivered to two replicas at once exactly once", async () => {
    const container = opts.container();
    if (!container) return;
    const base = opts.consumer();
    const N = 20;
    const before = await shipments(base);
    for (let k = 0; k < N; k++) {
      // Both copies leave one shell together, so the competing replicas
      // receive them back to back and run their handlers concurrently.
      const pub = publishCmd(opts.address, envelope(opts.address, randomUUID())).replace(
        /"/g,
        '\\"',
      );
      sh(`docker exec ${container} sh -c "${pub} & ${pub} & wait"`);
    }
    await settle(container, base, before + N);
    expect(await shipments(base)).toBe(before + N);
  }, 120_000);
}
