// The redelivery witness every `channels-e2e-rabbit*` leg runs against its
// booted consumer fleet: a durable envelope delivered more than once — one
// replica after the other, or two replicas at the same time — changes the
// consumer's state once.
//
// Fixture contract (the same in every rabbit leg): the consumer deployable
// hosts `workflow Fulfil { create(p: OrderPlaced) by p.order { Shipment.create
// … } }` and the event-sourced `workflow Track eventSourced { create(p:
// OrderPlaced) by p.order { emit Tracked … } }` — two consumers of one event,
// claiming under two keys — wired to the producer's `queue`/`work` channel at
// `address`, and serves `/api/shipments`.  Each case counts both effects: the
// Shipments, and the appends to the context's event log.  The witness publishes straight to the channel's
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
  /** The postgres sidecar container holding the consumer's `ship_api`
   *  database; under `LOOM_CHANNELS_PG_URL` the witness reaches that server
   *  with the host's `psql` instead. */
  postgres: () => string;
}

const sh = (cmd: string): string => execSync(cmd, { encoding: "utf8", stdio: "pipe" });

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

/** One `rabbitmqadmin publish` of `body`, as a shell word list for `sh -c`. */
function publishCmd(address: string, body: string): string {
  return `rabbitmqadmin publish message --exchange ${address} --payload '${body}'`;
}

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
  it("applies a redelivered envelope of a foreign durable channel once", async () => {
    const container = opts.container();
    if (!container) return; // AMQP override: no container to publish from
    const base = opts.consumer();
    const pg = opts.postgres();
    const before = await shipments(base);
    const appendsBefore = trackAppends(pg);
    const body = envelope(opts.address, randomUUID());
    // The same envelope id twice, one after the other: the broker's
    // redelivery of one outbox row.
    for (let i = 0; i < 2; i++) sh(`docker exec ${container} ${publishCmd(opts.address, body)}`);
    await settle(container, base, before + 1);
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
    // attempt passes.  The broker's retry redelivers the same envelope id.
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
    try {
      sh(`docker exec ${container} ${publishCmd(opts.address, envelope(opts.address, id, order))}`);
      await settle(container, base, before + 1);
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
  }, 120_000);

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
