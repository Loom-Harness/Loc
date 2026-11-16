// The redelivery witness behind D-CONSUMER-INBOX (docs/decisions).
// The redelivery witness every durable broker leg (`channels-e2e-rabbit*` and
// `channels-e2e-kafka*`) runs against its booted consumer fleet: a durable
// envelope delivered more than once — one replica after the other, or two
// replicas at the same time — changes the consumer's state once.
//
// Fixture contract (the same in every leg): the consumer deployable hosts
// `workflow Fulfil { create(p: OrderPlaced) by p.order { Shipment.create
// … } }` and the event-sourced `workflow Track eventSourced { create(p:
// OrderPlaced) by p.order { emit Tracked … } }` — two consumers of one event,
// claiming under two keys — wired to the producer's durable channel at
// `address`, and serves `/api/shipments`.  Each case counts both effects: the
// Shipments, and the appends to the context's event log.  The witness
// publishes straight to the channel (the rabbitmq exchange, or the kafka
// topic) from inside the broker sidecar, so it needs the docker container.

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

export interface RedeliveryWitnessOptions {
  /** The broker the leg runs; rabbitmq when omitted. */
  broker?: "rabbitmq" | "kafka";
  /** The broker sidecar container, or `undefined` when the leg runs against
   *  a broker override with no container to publish from (the cases skip). */
  container: () => string | undefined;
  /** The channel exchange (rabbitmq) or topic (kafka) the consumer reads. */
  address: string;
  /** Base URL of one consumer replica (`http://localhost:<port>`). */
  consumer: () => string;
  /** The postgres sidecar container holding the consumer's `ship_api`
   *  database; under `LOOM_CHANNELS_PG_URL` the witness reaches that server
   *  with the host's `psql` instead. */
  postgres: () => string;
}

const sh = (cmd: string, input?: string): string =>
  execSync(cmd, { encoding: "utf8", stdio: "pipe", ...(input === undefined ? {} : { input }) });

/** Runs `sql` against the consumer's `ship_api` database, in the sidecar
 *  container or, under `LOOM_CHANNELS_PG_URL`, on that server; returns the
 *  unaligned output. */
function psql(container: string, sql: string): string {
  const override = process.env.LOOM_CHANNELS_PG_URL;
  const target = override
    ? `psql "${new URL("/ship_api", override).toString()}"`
    : `docker exec -i ${container} psql -U postgres -d ship_api`;
  return execSync(`${target} -v ON_ERROR_STOP=1 -tA`, {
    encoding: "utf8",
    stdio: "pipe",
    input: sql,
  }).trim();
}

function envelope(address: string, id: string, order: string = randomUUID()): string {
  return JSON.stringify({
    specversion: "1.0",
    id,
    type: "Orders.OrderPlaced",
    source: "/loom/Orders",
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    loomchannel: address,
    data: { order, at: new Date().toISOString() },
  });
}

/** One copy of an envelope on the wire, with the partition key kafka routes
 *  it by (rabbitmq ignores it). */
interface Copy {
  key: string;
  body: string;
}

/** How the witness reaches one broker from inside its sidecar container. */
interface Broker {
  /** Publishes every copy, one after the other. */
  publish(container: string, address: string, copies: Copy[]): void;
  /** Publishes groups of copies of one id so that two replicas of the
   *  consumer receive the copies of each group at the same time. */
  publishToReplicas(container: string, address: string, groups: string[]): void;
  /** True when every consumer of `address` has taken and acknowledged every
   *  message published to it. */
  drained(container: string, address: string): boolean;
}

/** One `rabbitmqadmin publish` of `body`, as a shell word list for `sh -c`. */
function rabbitPublishCmd(address: string, body: string): string {
  return `rabbitmqadmin publish message --exchange ${address} --payload '${body}'`;
}

const rabbitmq: Broker = {
  publish(container, address, copies) {
    for (const c of copies) sh(`docker exec ${container} ${rabbitPublishCmd(address, c.body)}`);
  },
  publishToReplicas(container, address, groups) {
    for (const body of groups) {
      // Both copies leave one shell together, so the competing replicas
      // receive them back to back and run their handlers concurrently.
      const pub = rabbitPublishCmd(address, body).replace(/"/g, '\\"');
      sh(`docker exec ${container} sh -c "${pub} & ${pub} & wait"`);
    }
  },
  /** No `loom.*` work queue holds a ready or unacknowledged message.
   *  `rabbitmqctl` asks the queue processes directly, so unlike the
   *  management API it does not lag. */
  drained(container) {
    const out = sh(
      `docker exec ${container} rabbitmqctl -q list_queues name messages_ready messages_unacknowledged`,
    );
    return out
      .split("\n")
      .map((l) => l.trim().split(/\s+/))
      .filter(([name]) => name?.startsWith("loom.") && !name.startsWith("loom.dlq."))
      .every(([, ready, unacked]) => ready === "0" && unacked === "0");
  },
};

const KAFKA_BIN = "/opt/kafka/bin";
const KAFKA_BOOTSTRAP = "--bootstrap-server localhost:9092";

/** Kafka's default partitioner hash (`Utils.murmur2`), so the witness can
 *  choose a key per partition. */
function murmur2(data: Buffer): number {
  const m = 0x5bd1e995;
  const length = data.length;
  let h = 0x9747b28c ^ length;
  const tail = length & ~3;
  for (let i = 0; i < tail; i += 4) {
    let k = data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
    k = Math.imul(k, m);
    k ^= k >>> 24;
    k = Math.imul(k, m);
    h = Math.imul(h, m);
    h ^= k;
  }
  const rest = length % 4;
  if (rest >= 3) h ^= data[tail + 2] << 16;
  if (rest >= 2) h ^= data[tail + 1] << 8;
  if (rest >= 1) {
    h ^= data[tail];
    h = Math.imul(h, m);
  }
  h ^= h >>> 13;
  h = Math.imul(h, m);
  h ^= h >>> 15;
  return h;
}

/** One key per partition of a topic with `partitions` partitions. */
function keyPerPartition(partitions: number): string[] {
  const keys: (string | undefined)[] = new Array(partitions).fill(undefined);
  for (let i = 0; keys.includes(undefined); i++) {
    const key = `witness-${i}`;
    const p = (murmur2(Buffer.from(key)) & 0x7fffffff) % partitions;
    keys[p] ??= key;
  }
  return keys as string[];
}

function kafkaProduce(container: string, address: string, copies: Copy[]): void {
  sh(
    `docker exec -i ${container} ${KAFKA_BIN}/kafka-console-producer.sh ${KAFKA_BOOTSTRAP} --topic ${address} --property parse.key=true --property key.separator='|'`,
    `${copies.map((c) => `${c.key}|${c.body}`).join("\n")}\n`,
  );
}

const kafka: Broker = {
  publish(container, address, copies) {
    for (const c of copies) kafkaProduce(container, address, [c]);
  },
  /** Each group's copies go to every partition of the topic: the consumer's
   *  group spreads the partitions over its replicas, so every replica takes
   *  a copy of each id, and the replicas work their partitions at once. */
  publishToReplicas(container, address, groups) {
    const described = sh(
      `docker exec ${container} ${KAFKA_BIN}/kafka-topics.sh ${KAFKA_BOOTSTRAP} --describe --topic ${address}`,
    );
    const partitions = Number(/PartitionCount:\s*(\d+)/.exec(described)?.[1] ?? "1");
    const keys = keyPerPartition(partitions);
    kafkaProduce(
      container,
      address,
      groups.flatMap((body) => keys.map((key) => ({ key, body }))),
    );
  },
  /** Every group reading `address` has committed its offset up to the end of
   *  each partition. */
  drained(container, address) {
    const out = sh(
      `docker exec ${container} ${KAFKA_BIN}/kafka-consumer-groups.sh ${KAFKA_BOOTSTRAP} --describe --all-groups 2>/dev/null || true`,
    );
    const rows = out
      .split("\n")
      .map((l) => l.trim().split(/\s+/))
      // GROUP TOPIC PARTITION CURRENT-OFFSET LOG-END-OFFSET LAG …
      .filter((cols) => cols[1] === address);
    return (
      rows.length > 0 &&
      rows.every(([, , , current, end]) => current === end || (current === "-" && end === "0"))
    );
  },
};

/** Rows in the consumer's event log — only `Track` appends there. */
function trackAppends(pg: string): number {
  const table = psql(
    pg,
    "select quote_ident(table_schema) || '.' || quote_ident(table_name) from information_schema.columns where column_name = 'stream_type' limit 1",
  );
  return table === "" ? 0 : Number(psql(pg, `select count(*) from ${table}`));
}

async function shipments(base: string): Promise<number> {
  // A pooled keep-alive socket the server has already closed after an idle
  // pause fails the first request ("other side closed"); one retry opens a
  // fresh connection.
  const get = () => fetch(`${base}/api/shipments?pageSize=1`);
  const res = await get().catch(get);
  return ((await res.json()) as { total: number }).total;
}

async function settle(
  broker: Broker,
  container: string,
  address: string,
  base: string,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  // Wait for every first application, then for the channel to drain: a
  // duplicate that is still in flight would otherwise land after the check.
  while (Date.now() < deadline) {
    if ((await shipments(base)) >= expected && broker.drained(container, address)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  // One more beat for a handler that acked before its transaction committed.
  await new Promise((r) => setTimeout(r, 1_000));
}

/** The claims `seedInboxForPurge` planted, per postgres container. */
const seeded = new Map<string, { expired: string; live: string }>();

/** Plants one claim older than any retention window and one fresh claim in
 *  the consumer's inbox.  A leg calls it once its first consumer replica has
 *  migrated the database and before the next replica boots: every
 *  deployable whose consumers claim purges its inbox at start, so the next
 *  boot prunes the expired claim and keeps the fresh one. */
export function seedInboxForPurge(container: string): void {
  const expired = `witness-expired-${randomUUID()}`;
  const live = `witness-live-${randomUUID()}`;
  psql(
    container,
    `insert into __loom_inbox (consumer, event_id, received_at) values
  ('witness/purge', '${expired}', now() - interval '400 days'),
  ('witness/purge', '${live}', now());`,
  );
  seeded.set(container, { expired, live });
}

/** Registers the redelivery cases on the enclosing `describe`. */
export function redeliveryWitness(opts: RedeliveryWitnessOptions): void {
  const broker = opts.broker === "kafka" ? kafka : rabbitmq;
  const address = opts.address;

  it("applies a redelivered envelope of a foreign durable channel once", async () => {
    const container = opts.container();
    if (!container) return; // broker override: no container to publish from
    const base = opts.consumer();
    const pg = opts.postgres();
    const before = await shipments(base);
    const appendsBefore = trackAppends(pg);
    const order = randomUUID();
    const body = envelope(address, randomUUID(), order);
    // The same envelope id twice, one after the other: the broker's
    // redelivery of one outbox row.
    broker.publish(container, address, [
      { key: order, body },
      { key: order, body },
    ]);
    await settle(broker, container, address, base, before + 1);
    expect(await shipments(base)).toBe(before + 1);
    expect(trackAppends(pg), "event-sourced appends").toBe(appendsBefore + 1);
  }, 90_000);

  it("applies an envelope delivered to two replicas at once exactly once", async () => {
    const container = opts.container();
    if (!container) return;
    const base = opts.consumer();
    const pg = opts.postgres();
    const N = 20;
    const before = await shipments(base);
    const appendsBefore = trackAppends(pg);
    broker.publishToReplicas(
      container,
      address,
      Array.from({ length: N }, () => envelope(address, randomUUID())),
    );
    await settle(broker, container, address, base, before + N);
    expect(await shipments(base)).toBe(before + N);
    expect(trackAppends(pg), "event-sourced appends").toBe(appendsBefore + N);
  }, 120_000);

  it("rolls a failed application back with its claim, so the redelivery applies once", async () => {
    const container = opts.container();
    if (!container) return;
    const pg = opts.postgres();
    const base = opts.consumer();
    const before = await shipments(base);
    const order = randomUUID();
    // The saga row's write fails once for this order, inside the handler's
    // transaction, after (or, where the starter allocates first, around) the
    // Shipment it creates.  `nextval` is not transactional, so the second
    // attempt passes.
    const table = psql(
      pg,
      "select quote_ident(table_schema) || '.' || quote_ident(table_name) from information_schema.tables where table_name = 'fulfils'",
    );
    expect(table, "the Fulfil saga table").not.toBe("");
    psql(
      pg,
      `create sequence loom_witness_crash;
create function loom_witness_crash() returns trigger as $$
begin
  if new.order_id::text = '${order}' and nextval('loom_witness_crash') = 1 then
    raise exception 'redelivery witness: the application fails once';
  end if;
  return new;
end $$ language plpgsql;
create trigger loom_witness_crash before insert or update on ${table}
  for each row execute function loom_witness_crash();`,
    );
    const appendsBefore = trackAppends(pg);
    const id = randomUUID();
    const copy = { key: order, body: envelope(address, id, order) };
    try {
      broker.publish(container, address, [copy]);
      if (broker === kafka) {
        // A kafka consumer parks a failed record and moves on, so the
        // redelivery is the same envelope id published again once the
        // failure has happened — the outbox relay's re-publish of its row.
        const deadline = Date.now() + 60_000;
        while (
          Date.now() < deadline &&
          !(
            psql(pg, "select is_called from loom_witness_crash") === "t" &&
            broker.drained(container, address)
          )
        ) {
          await new Promise((r) => setTimeout(r, 500));
        }
        broker.publish(container, address, [copy]);
      }
      // On rabbitmq the broker's retry redelivers the same envelope id.
      await settle(broker, container, address, base, before + 1);
      expect(await shipments(base)).toBe(before + 1);
      // The failure really happened: the trigger ran for both attempts.
      expect(Number(psql(pg, "select last_value from loom_witness_crash"))).toBeGreaterThanOrEqual(
        2,
      );
      // The other handler of the same delivery (the event-sourced Track) is
      // not touched by Fulfil's failure: whether it committed on the first
      // attempt or ran only on the redelivery, its append lands once, and
      // each handler holds exactly one claim for the id.
      expect(trackAppends(pg), "event-sourced appends").toBe(appendsBefore + 1);
      expect(
        psql(pg, `select consumer from __loom_inbox where event_id = '${id}' order by consumer`)
          .trim()
          .split("\n")
          .map((k) => k.replace(/^.*\/create\//, "create/")),
      ).toEqual(["create/Fulfil.OrderPlaced", "create/Track.OrderPlaced"]);
    } finally {
      psql(
        pg,
        `drop trigger if exists loom_witness_crash on ${table};
drop function if exists loom_witness_crash();
drop sequence if exists loom_witness_crash;`,
      );
    }
  }, 150_000);

  it("purges inbox claims past the retention window at start, and keeps live ones", async () => {
    const pg = opts.postgres();
    const planted = seeded.get(pg);
    expect(planted, "the leg seeds the inbox with seedInboxForPurge").toBeDefined();
    if (!planted) return;
    const count = (id: string): number =>
      Number(psql(pg, `select count(*) from __loom_inbox where event_id = '${id}'`));
    const deadline = Date.now() + 30_000;
    while (count(planted.expired) > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(count(planted.expired), "the expired claim").toBe(0);
    expect(count(planted.live), "the live claim").toBe(1);
  }, 60_000);
}
