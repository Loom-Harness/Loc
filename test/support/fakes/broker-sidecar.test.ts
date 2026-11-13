// The broker sidecar.  The pure half (URL re-hosting, the golden summary, the
// CloudEvent decode, the RESP reader) runs in the fast suite; the container
// half — a real digest-pinned rabbitmq / valkey, a generated definitions
// file imported with its grants, the firehose / PSUBSCRIBE tap — runs under
// `LOOM_FAKES_DOCKER=1` (`npm run test:fakes-docker`), which needs docker.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { channelSourceEnvVar } from "../../../src/util/channels.js";
import { resourceEnvUrlVar } from "../../../src/util/resource-env.js";
import {
  BROKER_IMAGES,
  cloudEventType,
  docker,
  KAFKA_DEFAULT_ENV,
  kafkaContainerEnv,
  listenerPorts,
  parseKafkaOffsets,
  parseResp,
  rehost,
  start,
  summarise,
} from "./broker-sidecar.mjs";

describe("broker sidecar — pure helpers", () => {
  it("re-hosts a compose URL, keeping credentials, vhost and query", () => {
    expect(rehost("amqp://d:loom-dev-bus-d@bus:5672/loom", "127.0.0.1", 40001)).toBe(
      "amqp://d:loom-dev-bus-d@127.0.0.1:40001/loom",
    );
    expect(rehost("redis://:pw@bus:6379?x=1", "127.0.0.1", 40002)).toBe(
      "redis://:pw@127.0.0.1:40002?x=1",
    );
  });

  it("summarises publishes into sorted, counted rows", () => {
    const rows = summarise([
      { exchange: "loom.B", routingKey: "", type: "B.E" },
      { exchange: "", routingKey: "jobs", type: null },
      { exchange: "loom.B", routingKey: "", type: "B.E" },
    ]);
    expect(rows).toEqual([
      { exchange: "", routingKey: "jobs", type: null, count: 1 },
      { exchange: "loom.B", routingKey: "", type: "B.E", count: 2 },
    ]);
    // Order of arrival does not reach the golden.
    expect(summarise([...rows].reverse().flatMap((r) => Array(r.count).fill(r)))).toEqual(rows);
  });

  it("reads a CloudEvent's type and nothing else", () => {
    expect(cloudEventType('{"specversion":"1.0","type":"Orders.OrderPlaced"}')).toBe(
      "Orders.OrderPlaced",
    );
    expect(cloudEventType('{"type":"not-a-cloudevent"}')).toBeNull();
    expect(cloudEventType('"plain"')).toBeNull();
    expect(cloudEventType("not json")).toBeNull();
  });

  it("reads RESP pub/sub frames, keeping a split frame for the next read", () => {
    const frame = "*4\r\n$8\r\npmessage\r\n$1\r\n*\r\n$3\r\nabc\r\n$2\r\nhi\r\n";
    const whole = parseResp(Buffer.from(`+OK\r\n${frame}`));
    expect(whole.values).toEqual(["OK", ["pmessage", "*", "abc", "hi"]]);
    expect(whole.rest.length).toBe(0);
    const half = parseResp(Buffer.from(frame.slice(0, 20)));
    expect(half.values).toEqual([]);
    expect(half.rest.toString()).toBe(frame.slice(0, 20));
  });

  it("pins every image by digest", () => {
    for (const image of Object.values(BROKER_IMAGES))
      expect(image).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it("every behavioural workflow's rabbitmq service runs the image the kit pins", () => {
    // A leg whose `services:` image drifted from BROKER_IMAGES would run a
    // different broker in CI than the kit starts locally.
    const dir = join(__dirname, "..", "..", "..", ".github", "workflows");
    const found = readdirSync(dir)
      .filter((f) => f.startsWith("behavioral-e2e-"))
      .flatMap((f) =>
        [...readFileSync(join(dir, f), "utf8").matchAll(/image:\s*(\S*rabbitmq:\S+)/g)].map((m) => [
          f,
          m[1],
        ]),
      );
    expect(found.length).toBeGreaterThanOrEqual(5);
    for (const [, image] of found) expect(image).toBe(BROKER_IMAGES.rabbitmq);
  });

  it("re-advertises only the backend's kafka listener on loopback, keeping the case's SASL setup", () => {
    // The shape `generate system` writes for a SASL-guarded kafka storage.
    const compose = {
      ...KAFKA_DEFAULT_ENV,
      KAFKA_ADVERTISED_LISTENERS: "CLIENT://bus:9092,PLAINTEXT://bus:9094",
      KAFKA_CONTROLLER_QUORUM_VOTERS: "1@bus:9093",
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP:
        "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,CLIENT:SASL_PLAINTEXT",
      KAFKA_LISTENER_NAME_CLIENT_PLAIN_SASL_JAAS_CONFIG: '…user_d="pw";',
    };
    const { env, client } = kafkaContainerEnv(compose, 9092, 41234);
    expect(client).toBe("CLIENT");
    expect(env.KAFKA_ADVERTISED_LISTENERS).toBe(
      "CLIENT://127.0.0.1:41234,PLAINTEXT://localhost:9094",
    );
    expect(env.KAFKA_CONTROLLER_QUORUM_VOTERS).toBe("1@localhost:9093");
    expect(env.KAFKA_LISTENER_SECURITY_PROTOCOL_MAP).toBe(
      compose.KAFKA_LISTENER_SECURITY_PROTOCOL_MAP,
    );
    expect(env.KAFKA_LISTENER_NAME_CLIENT_PLAIN_SASL_JAAS_CONFIG).toBe(
      compose.KAFKA_LISTENER_NAME_CLIENT_PLAIN_SASL_JAAS_CONFIG,
    );
    expect(() => kafkaContainerEnv(compose, 9999, 1)).toThrow(/no listener on :9999/);
    expect(listenerPorts("A://:1,B://h:2")).toEqual({ A: 1, B: 2 });
  });

  it("counts records per user topic from kafka-get-offsets, skipping internal topics", () => {
    expect([
      ...parseKafkaOffsets(
        "loom.A.Ch:0:5\nloom.A.Ch:1:0\nloom.A.Ch:2:4\n__consumer_offsets:0:9\nx:0:0\n",
      ),
    ]).toEqual([
      ["loom.A.Ch", 9],
      ["x", 0],
    ]);
  });

  it("refuses a broker type it has no sidecar for", async () => {
    await expect(start({ storage: { name: "k", type: "nats" as never } })).rejects.toThrow(/nats/);
  });
});

const DOCKER = process.env.LOOM_FAKES_DOCKER === "1";

/** RabbitMQ's `rabbit_password_hashing_sha256`: base64(salt ‖ sha256(salt ‖ password)). */
function rabbitHash(password: string): string {
  const salt = Buffer.from([1, 2, 3, 4]);
  const digest = createHash("sha256")
    .update(Buffer.concat([salt, Buffer.from(password)]))
    .digest();
  return Buffer.concat([salt, digest]).toString("base64");
}

/** A minimal definitions file in the generated shape: a vhost, a
 *  per-deployable user whose grants cover exactly one exchange. */
const DEFINITIONS = {
  vhosts: [{ name: "loom" }],
  users: [
    {
      name: "d",
      password_hash: rabbitHash("pw"),
      hashing_algorithm: "rabbit_password_hashing_sha256",
      tags: [],
    },
  ],
  permissions: [
    { user: "d", vhost: "loom", configure: "^loom\\.X$", write: "^loom\\.X$", read: "^loom\\.X$" },
  ],
  exchanges: [{ name: "loom.X", vhost: "loom", type: "fanout", durable: true, auto_delete: false }],
};

describe.skipIf(!DOCKER)(
  "broker sidecar — rabbitmq container",
  () => {
    let fake: Awaited<ReturnType<typeof start>>;
    let api: (method: string, path: string, body?: unknown) => Promise<Response>;
    beforeAll(async () => {
      fake = await start({
        storage: { name: "bus", type: "rabbitmq" },
        definitions: DEFINITIONS,
        channelSources: [{ name: "lifecycleBus", url: "amqp://d:pw@bus:5672/loom" }],
        resources: [{ name: "salesJobs" }],
      });
      const auth = `Basic ${Buffer.from("guest:guest").toString("base64")}`;
      api = (method, path, body) =>
        fetch(`${fake.managementUrl}/api${path}`, {
          method,
          headers: { authorization: auth, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
    }, 180_000);
    afterAll(() => fake?.stop());

    it("hands the backend its channel and queue URLs under the generated names", () => {
      expect(Object.keys(fake.env).sort()).toEqual(
        [channelSourceEnvVar("lifecycleBus"), resourceEnvUrlVar("salesJobs")].sort(),
      );
      expect(fake.env[channelSourceEnvVar("lifecycleBus")]).toMatch(
        /^amqp:\/\/d:pw@127\.0\.0\.1:\d+\/loom$/,
      );
    });

    it("imports the case's topology", async () => {
      const ex = await (await api("GET", "/exchanges/loom/loom.X")).json();
      expect(ex).toMatchObject({ name: "loom.X", type: "fanout", durable: true });
    });

    it("observes a publish to an exchange nothing consumes, with its CloudEvent type", async () => {
      const event = { specversion: "1.0", id: "1", type: "Orders.OrderPlaced", data: {} };
      for (const payload of [JSON.stringify(event), JSON.stringify(event), '"plain"']) {
        const res = await api("POST", "/exchanges/loom/loom.X/publish", {
          properties: {},
          routing_key: "",
          payload,
          payload_encoding: "string",
        });
        expect(res.ok).toBe(true);
      }
      expect(await fake.observe()).toEqual([
        { exchange: "loom.X", routingKey: "", type: "Orders.OrderPlaced", count: 2 },
        { exchange: "loom.X", routingKey: "", type: null, count: 1 },
      ]);
    });

    it("reset wipes captured publishes and re-arms the tap", async () => {
      await fake.reset();
      expect(await fake.observe()).toEqual([]);
      await api("POST", "/exchanges/loom/loom.X/publish", {
        properties: {},
        routing_key: "",
        payload: "{}",
        payload_encoding: "string",
      });
      expect(await fake.observe()).toEqual([
        { exchange: "loom.X", routingKey: "", type: null, count: 1 },
      ]);
    });
  },
  240_000,
);

describe.skipIf(!DOCKER)(
  "broker sidecar — kafka container",
  () => {
    let fake: Awaited<ReturnType<typeof start>>;
    let id: string;
    beforeAll(async () => {
      fake = await start({
        storage: { name: "bus", type: "kafka" },
        channelSources: [{ name: "lifecycleBus" }],
      });
      id = (fake as unknown as { containerId: string }).containerId;
    }, 180_000);
    afterAll(() => fake?.stop());

    const produce = (topic: string, lines: string[]) =>
      docker([
        "exec",
        id,
        "sh",
        "-c",
        `printf '%s\\n' ${lines.map((l) => `'${l}'`).join(" ")} | /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9094 --topic ${topic}`,
      ]);

    it("hands the backend a loopback kafka URL under the channel's env name", () => {
      expect(fake.env[channelSourceEnvVar("lifecycleBus")]).toMatch(/^kafka:\/\/127\.0\.0\.1:\d+$/);
    });

    it("observes every record per topic with its CloudEvent type", async () => {
      const ev = JSON.stringify({
        specversion: "1.0",
        id: "1",
        type: "Orders.OrderPlaced",
        data: {},
      });
      produce("loom.Orders.Lifecycle", [ev, ev, ev, '"plain"']);
      expect(await fake.observe()).toEqual([
        { exchange: "loom.Orders.Lifecycle", routingKey: "", type: "Orders.OrderPlaced", count: 3 },
        { exchange: "loom.Orders.Lifecycle", routingKey: "", type: null, count: 1 },
      ]);
    });

    it("reset deletes the topics", async () => {
      await fake.reset();
      expect(await fake.observe()).toEqual([]);
    });
  },
  300_000,
);
