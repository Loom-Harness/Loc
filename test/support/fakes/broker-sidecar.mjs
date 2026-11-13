// Broker sidecar — the message-broker half of the hermetic fake-service kit.
//
// A protocol fake would be a second broker to maintain, so this one is the
// real thing: ONE digest-pinned container per broker type, started with
// `docker run` (pulled through the daemon's registry mirror locally), or the
// workflow `services:` container CI provides, named by `LOOM_FAKE_AMQP_URL` /
// `LOOM_FAKE_REDIS_URL`.  Nothing here is a compose stack: the generated
// backend runs on the host and dials the published loopback port.
//
// RabbitMQ.  A case's generated `broker-init/<storage>-definitions.json` (the
// vhost, the per-deployable user and its permission regexes, the dead-letter
// topology) is imported through the management API, so a backend runs
// against the topology and grants it is deployed with, not against an open
// admin account.  Every publish is captured by the broker's own firehose:
// tracing is switched on per vhost and a tap queue bound to
// `amq.rabbitmq.trace` with `publish.#` copies each message — so a publish to
// an exchange with no consumer bound is still observed.
//
// Valkey (the `redis` channel transport).  A `PSUBSCRIBE *` tap on a raw RESP
// connection records every pub/sub publish.
//
// `observe()` returns the effect list the behavioural runners append to the
// wire recording: one row per (exchange|channel, routing key, CloudEvent
// `type`) with its publish count, sorted — no ids, no timestamps, no payload.
// It is ASYNC (the tap is drained over HTTP / a socket); callers `await` it.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The images, pinned by digest so a re-tag upstream cannot change a leg,
 *  and pulled through `mirror.gcr.io` so neither CI nor a sandbox depends on
 *  Docker Hub (its pull limit and its outages). */
export const BROKER_IMAGES = {
  rabbitmq:
    "mirror.gcr.io/library/rabbitmq:4.1-management-alpine@sha256:42c6214e0e2093caa2484718faacb733631cc9ddc869b3298397613237dbea4a",
  redis: "mirror.gcr.io/valkey/valkey:8-alpine@sha256:2602ace2be6569bc2bbb06f873776516ab9089821525be34f4305c67eb9db02a",
  kafka: "mirror.gcr.io/apache/kafka:4.1.0@sha256:bff074a5d0051dbc0bbbcd25b045bb1fe84833ec0d3c7c965d1797dd289ec88f",
};

/** RabbitMQ refuses the default `guest` account from anything but loopback,
 *  and a published container port is not loopback to the broker.  Lifting
 *  the restriction is what lets the harness (and a resource URL that names
 *  `guest`) reach a container; CI's `services:` entry sets the same env. */
export const RABBITMQ_CONTAINER_ENV = {
  RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS: "-rabbit loopback_users []",
};

const TAP = "loom.fake.tap";
/** The pub/sub channel the valkey tap's observe() barrier rides on. */
const BARRIER = "loom.fake.barrier";
const ADMIN = { user: "guest", pass: "guest" };

async function envNames() {
  const [re, ch] = await Promise.all([
    import(join(REPO, "out", "util", "resource-env.js")),
    import(join(REPO, "out", "util", "channels.js")),
  ]);
  return {
    resourceUrlVar: re.resourceEnvUrlVar,
    resourceSidecarUrl: re.resourceSidecarUrl,
    channelUrlVar: ch.channelSourceEnvVar,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(what, fn, { timeoutMs = 90_000, everyMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return;
    } catch (e) {
      last = e;
    }
    await sleep(everyMs);
  }
  throw new Error(`fake sidecar: timed out waiting for ${what}${last ? ` (${last.message ?? last})` : ""}`);
}

export function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** `docker run` one pinned image with loopback-published ports; returns the
 *  container id and the host port each container port landed on.  Every
 *  sidecar carries a `loom.fake=<kind>` label, so a leftover from a killed
 *  run is findable with `docker ps --filter label=loom.fake`. */
export function runContainer(image, ports, env = {}, cmd = [], kind = "broker") {
  const args = ["run", "-d", "--rm", "--label", `loom.fake=${kind}`];
  for (const p of ports) args.push("-p", `127.0.0.1::${p}`);
  for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
  const id = docker([...args, image, ...cmd]);
  const hostPorts = {};
  for (const p of ports) {
    const line = docker(["port", id, String(p)]).split("\n")[0];
    hostPorts[p] = Number(line.slice(line.lastIndexOf(":") + 1));
  }
  return { id, hostPorts };
}

/** The compose service name of a storage (`src/util/resource-env.ts`'s
 *  `storageServiceHost`: snake_case, lower). */
const serviceSlug = (storageName) => storageName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** A compose scalar as written by `generate system`: bare, or a JSON-style
 *  double-quoted string. */
function composeScalar(raw) {
  const v = raw.trim();
  return v.startsWith('"') ? JSON.parse(v) : v;
}

/** The `environment:` map of one compose service. */
export function composeServiceEnv(compose, service) {
  const lines = compose.split("\n");
  const start = lines.findIndex((l) => l === `  ${service}:`);
  if (start < 0) return null;
  const env = {};
  let inEnv = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^ {0,2}\S/.test(l)) break;
    if (/^ {4}environment:\s*$/.test(l)) {
      inEnv = true;
      continue;
    }
    if (inEnv) {
      const m = /^ {6}([A-Za-z0-9_]+):\s*(.*)$/.exec(l);
      if (!m) {
        if (/^ {4}\S/.test(l)) inEnv = false;
        continue;
      }
      env[m[1]] = composeScalar(m[2]);
    }
  }
  return env;
}

/** The first value compose assigns to `name` in any service's environment. */
export function composeEnvValue(compose, name) {
  const m = new RegExp(`^\\s+${name}:\\s*(.+)$`, "m").exec(compose);
  return m ? composeScalar(m[1]) : undefined;
}

/** Fill a plan's broker inputs from the case's generated tree: the broker-init
 *  definitions, each channel binding's compose URL (its credentials, vhost and
 *  for valkey its password), and kafka's service env.  Explicit options win. */
async function withGenerated(opts) {
  if (!opts.genDir) return opts;
  const composePath = join(opts.genDir, "docker-compose.yml");
  if (!existsSync(composePath)) return opts;
  const compose = readFileSync(composePath, "utf8");
  const names = await envNames();
  const slug = serviceSlug(opts.storage.name);
  const out = { ...opts };
  const defsPath = [opts.storage.name, slug]
    .map((n) => join(opts.genDir, "broker-init", `${n}-definitions.json`))
    .find((p) => existsSync(p));
  if (out.definitions === undefined && defsPath) out.definitions = JSON.parse(readFileSync(defsPath, "utf8"));
  out.channelSources = (opts.channelSources ?? []).map((c) => ({
    ...c,
    url: c.url ?? composeEnvValue(compose, names.channelUrlVar(c.name)),
  }));
  if (out.password === undefined && opts.storage.type === "redis") {
    const withPw = out.channelSources.find((c) => c.url && new URL(c.url).password);
    if (withPw) out.password = decodeURIComponent(new URL(withPw.url).password);
  }
  if (out.containerEnv === undefined && opts.storage.type === "kafka") {
    out.containerEnv = composeServiceEnv(compose, slug) ?? undefined;
  }
  return out;
}

/** Point a compose-network broker URL (`amqp://d:pw@bus:5672/loom`) at the
 *  fake, keeping its credentials, vhost and query — the parts the generated
 *  backend and its deployed grants actually depend on. */
export function rehost(url, host, port) {
  const u = new URL(url);
  u.hostname = host;
  u.port = String(port);
  return u.toString();
}

/** Collapse captured publishes into the order-stable golden rows. */
export function summarise(publishes) {
  const counts = new Map();
  for (const p of publishes) {
    const row = { exchange: p.exchange, routingKey: p.routingKey, type: p.type ?? null };
    const k = JSON.stringify(row);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([k, count]) => ({ ...JSON.parse(k), count }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

/** A CloudEvent's `type`, or null for a body that is not one (a `queue`
 *  resource's plain message). */
export function cloudEventType(body) {
  try {
    const v = JSON.parse(typeof body === "string" ? body : Buffer.from(body).toString("utf8"));
    return v && typeof v === "object" && v.specversion && typeof v.type === "string" ? v.type : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// RabbitMQ
// ---------------------------------------------------------------------------

async function startRabbit(opts) {
  let host = "127.0.0.1";
  let amqpPort;
  let mgmt;
  let container = null;
  const shared = process.env.LOOM_FAKE_AMQP_URL;
  if (shared) {
    const u = new URL(shared);
    host = u.hostname;
    amqpPort = Number(u.port || 5672);
    mgmt = process.env.LOOM_FAKE_AMQP_MGMT_URL ?? `http://${host}:15672`;
  } else {
    container = runContainer(BROKER_IMAGES.rabbitmq, [5672, 15672], RABBITMQ_CONTAINER_ENV);
    amqpPort = container.hostPorts[5672];
    mgmt = `http://${host}:${container.hostPorts[15672]}`;
  }
  const auth = `Basic ${Buffer.from(`${ADMIN.user}:${ADMIN.pass}`).toString("base64")}`;
  const api = async (method, path, body) => {
    const res = await fetch(`${mgmt}/api${path}`, {
      method,
      headers: { authorization: auth, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok && !(method === "DELETE" && res.status === 404)) {
      throw new Error(`rabbitmq ${method} ${path} → ${res.status} ${await res.text()}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
  const vh = (v) => encodeURIComponent(v);

  try {
    await until("the rabbitmq management API", async () => (await api("GET", "/overview")) !== null);
    await until("the AMQP listener", () => tcpOpen(host, amqpPort));
  } catch (e) {
    if (container) docker(["rm", "-f", container.id]);
    throw e;
  }

  let definitions = opts.definitions ?? null;
  /** Publishes drained from the taps since the last reset. */
  const captured = [];

  async function vhosts() {
    return ((await api("GET", "/vhosts")) ?? []).map((v) => v.name);
  }

  async function arm() {
    if (!(await vhosts()).includes("/")) await api("PUT", `/vhosts/${vh("/")}`, {});
    if (definitions) await api("POST", "/definitions", definitions);
    for (const v of await vhosts()) {
      await api("PUT", `/permissions/${vh(v)}/${ADMIN.user}`, { configure: ".*", write: ".*", read: ".*" });
      await api("PUT", `/vhosts/${vh(v)}`, { tracing: true });
      await api("PUT", `/queues/${vh(v)}/${TAP}`, { durable: false, auto_delete: false, arguments: {} });
      await api("POST", `/bindings/${vh(v)}/e/amq.rabbitmq.trace/q/${TAP}`, { routing_key: "publish.#" });
    }
  }

  async function wipe() {
    for (const v of await vhosts()) await api("DELETE", `/vhosts/${vh(v)}`);
    for (const u of (await api("GET", "/users")) ?? []) {
      if (u.name !== ADMIN.user) await api("DELETE", `/users/${encodeURIComponent(u.name)}`);
    }
  }

  async function drain() {
    for (const v of await vhosts()) {
      for (;;) {
        const msgs = await api("POST", `/queues/${vh(v)}/${TAP}/get`, {
          count: 500,
          ackmode: "ack_requeue_false",
          encoding: "auto",
        });
        if (!msgs || msgs.length === 0) break;
        for (const m of msgs) {
          const h = m.properties?.headers ?? {};
          const body = m.payload_encoding === "base64" ? Buffer.from(m.payload, "base64") : m.payload;
          captured.push({
            vhost: v,
            exchange: h.exchange_name ?? m.routing_key.replace(/^publish\./, ""),
            routingKey: (h.routing_keys ?? [])[0] ?? "",
            type: cloudEventType(body),
          });
        }
      }
    }
  }

  await wipe();
  await arm();

  const names = await envNames();
  const env = {};
  for (const c of opts.channelSources ?? []) {
    env[names.channelUrlVar(c.name)] = c.url
      ? rehost(c.url, host, amqpPort)
      : `amqp://${ADMIN.user}:${ADMIN.pass}@${host}:${amqpPort}`;
  }
  // A queue resource's URL is the one compose hands it (and the client bakes
  // as its fallback), re-hosted onto the sidecar.
  for (const r of opts.resources ?? []) {
    const url = r.url ?? names.resourceSidecarUrl("rabbitmq", opts.storage.name);
    env[names.resourceUrlVar(r.name)] = rehost(url, host, amqpPort);
  }

  return {
    kind: "broker",
    env,
    url: `amqp://${ADMIN.user}:${ADMIN.pass}@${host}:${amqpPort}`,
    managementUrl: mgmt,
    captured,
    async observe() {
      await drain();
      return summarise(captured);
    },
    /** Swap in another case's definitions (and wipe the broker). */
    async load(defs) {
      definitions = defs ?? null;
      await this.reset();
    },
    async reset() {
      captured.length = 0;
      await wipe();
      await arm();
    },
    async stop() {
      if (container) {
        try {
          docker(["rm", "-f", container.id]);
        } catch {
          // already gone (`--rm` after an exit) — nothing to clean
        }
      }
    },
  };
}

function tcpOpen(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}

// ---------------------------------------------------------------------------
// Valkey (redis pub/sub)
// ---------------------------------------------------------------------------

/** Encode one RESP command. */
function resp(...args) {
  return `*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`).join("")}`;
}

/** Parse every complete RESP value at the front of `buf`; returns the values
 *  and the unconsumed remainder. */
export function parseResp(buf) {
  const out = [];
  let i = 0;
  const one = () => {
    const eol = buf.indexOf("\r\n", i);
    if (eol < 0) return undefined;
    const t = String.fromCharCode(buf[i]);
    const line = buf.subarray(i + 1, eol).toString("utf8");
    if (t === "+" || t === "-" || t === ":") {
      i = eol + 2;
      return t === ":" ? Number(line) : t === "-" ? new Error(line) : line;
    }
    if (t === "$") {
      const n = Number(line);
      if (n < 0) {
        i = eol + 2;
        return null;
      }
      if (buf.length < eol + 2 + n + 2) return undefined;
      const v = buf.subarray(eol + 2, eol + 2 + n).toString("utf8");
      i = eol + 2 + n + 2;
      return v;
    }
    if (t === "*") {
      const save = i;
      i = eol + 2;
      const arr = [];
      for (let k = 0; k < Number(line); k++) {
        const v = one();
        if (v === undefined) {
          i = save;
          return undefined;
        }
        arr.push(v);
      }
      return arr;
    }
    throw new Error(`RESP: unexpected type byte '${t}'`);
  };
  for (;;) {
    const start = i;
    const v = one();
    if (v === undefined) {
      i = start;
      break;
    }
    out.push(v);
  }
  return { values: out, rest: buf.subarray(i) };
}

async function startRedis(opts) {
  let host = "127.0.0.1";
  let port;
  let container = null;
  const password = opts.password;
  const shared = process.env.LOOM_FAKE_REDIS_URL;
  if (shared) {
    const u = new URL(shared);
    host = u.hostname;
    port = Number(u.port || 6379);
  } else {
    container = runContainer(
      BROKER_IMAGES.redis,
      [6379],
      {},
      password ? ["valkey-server", "--requirepass", password] : [],
    );
    port = container.hostPorts[6379];
  }
  try {
    await until("the valkey listener", () => tcpOpen(host, port));
  } catch (e) {
    if (container) docker(["rm", "-f", container.id]);
    throw e;
  }

  const captured = [];
  /** nonce → resolve, for the observe() barrier. */
  const barriers = new Map();
  let sock;
  let buf = Buffer.alloc(0);
  async function connect() {
    sock = net.connect({ host, port });
    await new Promise((resolve, reject) => {
      sock.once("connect", resolve);
      sock.once("error", reject);
    });
    let subscribed;
    const ready = new Promise((r) => {
      subscribed = r;
    });
    sock.on("data", (d) => {
      const { values, rest } = parseResp(Buffer.concat([buf, d]));
      buf = rest;
      for (const v of values) {
        if (Array.isArray(v) && v[0] === "psubscribe") subscribed();
        if (Array.isArray(v) && v[0] === "pmessage") {
          if (v[2] === BARRIER) {
            barriers.get(v[3])?.();
            continue;
          }
          captured.push({ exchange: v[2], routingKey: "", type: cloudEventType(v[3]) });
        }
      }
    });
    if (password) sock.write(resp("AUTH", password));
    sock.write(resp("PSUBSCRIBE", "*"));
    await ready;
  }
  // A fresh container can accept TCP before it serves commands.
  await until("the valkey PSUBSCRIBE tap", async () => {
    try {
      await Promise.race([connect(), sleep(2000).then(() => Promise.reject(new Error("no ack")))]);
      return true;
    } catch (e) {
      sock?.destroy();
      throw e;
    }
  });

  const auth = password ? `:${encodeURIComponent(password)}@` : "";
  const base = `redis://${auth}${host}:${port}`;
  const names = await envNames();
  const env = {};
  for (const c of opts.channelSources ?? []) {
    env[names.channelUrlVar(c.name)] = c.url ? rehost(c.url, host, port) : base;
  }

  return {
    kind: "broker",
    env,
    url: base,
    captured,
    /** Valkey delivers to a subscriber in publish order, so once the tap
     *  has seen a barrier published now, it has seen every publish made
     *  before it — the backend's included.  Without the barrier a read that
     *  lands between a publish and its delivery reports it missing. */
    async observe() {
      const nonce = `${Date.now()}-${Math.random()}`;
      const seen = new Promise((resolve) => barriers.set(nonce, resolve));
      const pub = net.connect({ host, port });
      await new Promise((resolve, reject) => {
        pub.once("connect", resolve);
        pub.once("error", reject);
      });
      pub.write((password ? resp("AUTH", password) : "") + resp("PUBLISH", BARRIER, nonce) + resp("QUIT"));
      try {
        await Promise.race([
          seen,
          sleep(10_000).then(() => Promise.reject(new Error("broker fake: the valkey tap never saw its barrier"))),
        ]);
      } finally {
        barriers.delete(nonce);
        pub.destroy();
      }
      return summarise(captured);
    },
    async load() {
      await this.reset();
    },
    async reset() {
      captured.length = 0;
    },
    async stop() {
      sock?.destroy();
      if (container) {
        try {
          docker(["rm", "-f", container.id]);
        } catch {
          // already gone
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Kafka (KRaft, single node)
// ---------------------------------------------------------------------------

/** The broker env when the case brings none: one plaintext listener for the
 *  backend (re-advertised on the host port) and one inside the container for
 *  the harness's own tools. */
export const KAFKA_DEFAULT_ENV = {
  KAFKA_NODE_ID: "1",
  KAFKA_PROCESS_ROLES: "broker,controller",
  KAFKA_LISTENERS: "CLIENT://:9092,PLAINTEXT://:9094,CONTROLLER://:9093",
  KAFKA_ADVERTISED_LISTENERS: "CLIENT://localhost:9092,PLAINTEXT://localhost:9094",
  KAFKA_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
  KAFKA_CONTROLLER_QUORUM_VOTERS: "1@localhost:9093",
  KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,CLIENT:PLAINTEXT",
  KAFKA_INTER_BROKER_LISTENER_NAME: "PLAINTEXT",
  KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: "1",
  KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: "1",
  KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: "1",
  KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: "0",
  KAFKA_NUM_PARTITIONS: "3",
};

/** `NAME://host:port,…` → `{ NAME: port }`. */
export function listenerPorts(spec) {
  const out = {};
  for (const part of String(spec).split(",")) {
    const m = /^\s*([A-Za-z_]+):\/\/[^:]*:(\d+)\s*$/.exec(part);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

/** Re-point a case's compose kafka env at a host process: the listener the
 *  backend dials (the one bound to `clientPort`) is advertised on loopback at
 *  `hostPort`; every other listener and the controller quorum stay inside
 *  the container on `localhost`.  Everything else — the SASL users, the
 *  security protocol map, partitions — is the case's, unchanged. */
export function kafkaContainerEnv(composeEnv, clientPort, hostPort) {
  const env = { ...composeEnv };
  const ports = listenerPorts(env.KAFKA_LISTENERS);
  const client = Object.keys(ports).find((n) => ports[n] === clientPort);
  if (!client) throw new Error(`kafka sidecar: no listener on :${clientPort} in ${env.KAFKA_LISTENERS}`);
  const controllers = String(env.KAFKA_CONTROLLER_LISTENER_NAMES ?? "").split(",");
  env.KAFKA_ADVERTISED_LISTENERS = Object.entries(ports)
    .filter(([n]) => !controllers.includes(n))
    .map(([n, port]) => (n === client ? `${n}://127.0.0.1:${hostPort}` : `${n}://localhost:${port}`))
    .join(",");
  env.KAFKA_CONTROLLER_QUORUM_VOTERS = String(env.KAFKA_CONTROLLER_QUORUM_VOTERS).replace(
    /@[^:,]+:/g,
    "@localhost:",
  );
  return { env, client };
}

/** The listener the harness's own tools use inside the container: the
 *  inter-broker one, which a case never puts behind SASL. */
function internalBootstrap(env) {
  const ports = listenerPorts(env.KAFKA_LISTENERS);
  const name = env.KAFKA_INTER_BROKER_LISTENER_NAME ?? "PLAINTEXT";
  if (!ports[name]) throw new Error(`kafka sidecar: no inter-broker listener '${name}'`);
  return `localhost:${ports[name]}`;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** `kafka-get-offsets.sh` lines (`topic:partition:endOffset`) → records per
 *  user topic.  Topics start empty after a reset, so the end offset summed
 *  over partitions is the topic's record count. */
export function parseKafkaOffsets(text) {
  const counts = new Map();
  for (const line of text.split("\n")) {
    const m = /^(.+):(\d+):(\d+)$/.exec(line.trim());
    if (!m || m[1].startsWith("__")) continue;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + Number(m[3]));
  }
  return counts;
}

async function startKafka(opts) {
  const clientPort = opts.channelSources?.find((c) => c.url)
    ? Number(new URL(opts.channelSources.find((c) => c.url).url).port || 9092)
    : 9092;
  const hostPort = await freePort();
  const { env } = kafkaContainerEnv(opts.containerEnv ?? KAFKA_DEFAULT_ENV, clientPort, hostPort);
  const args = ["run", "-d", "--rm", "--label", "loom.fake=kafka", "-p", `127.0.0.1:${hostPort}:${clientPort}`];
  for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
  const id = docker([...args, BROKER_IMAGES.kafka]);
  const bootstrap = internalBootstrap(env);
  const kafkaBin = (tool, ...a) =>
    docker(["exec", id, `/opt/kafka/bin/${tool}`, "--bootstrap-server", bootstrap, ...a]);
  try {
    await until(
      "the kafka broker",
      () => {
        kafkaBin("kafka-topics.sh", "--list");
        return true;
      },
      { timeoutMs: 120_000, everyMs: 1000 },
    );
    await until("the kafka client listener", () => tcpOpen("127.0.0.1", hostPort));
  } catch (e) {
    docker(["rm", "-f", id]);
    throw e;
  }

  const names = await envNames();
  const outEnv = {};
  for (const c of opts.channelSources ?? []) {
    outEnv[names.channelUrlVar(c.name)] = c.url
      ? rehost(c.url, "127.0.0.1", hostPort)
      : `kafka://127.0.0.1:${hostPort}`;
  }

  const userTopics = () =>
    kafkaBin("kafka-topics.sh", "--list")
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t && !t.startsWith("__"));

  return {
    kind: "broker",
    env: outEnv,
    url: `kafka://127.0.0.1:${hostPort}`,
    containerId: id,
    captured: [],
    /** Every record retained on every user topic, read from the beginning by
     *  a throwaway consumer (no group, so nothing is committed). */
    async observe() {
      const publishes = [];
      let offsets;
      try {
        offsets = kafkaBin("kafka-get-offsets.sh");
      } catch (e) {
        // With no topic at all the tool exits 1 rather than printing nothing.
        if (/Could not match any topic-partitions/.test(String(e?.stderr ?? e))) return [];
        throw e;
      }
      for (const [topic, count] of parseKafkaOffsets(offsets)) {
        if (count === 0) continue;
        const dump = kafkaBin(
          "kafka-console-consumer.sh",
          "--topic",
          topic,
          "--from-beginning",
          "--max-messages",
          String(count),
          "--timeout-ms",
          "15000",
        );
        for (const value of dump.split("\n").filter((l) => l !== "")) {
          publishes.push({ exchange: topic, routingKey: "", type: cloudEventType(value) });
        }
      }
      return summarise(publishes);
    },
    async load() {
      await this.reset();
    },
    /** Delete every user topic and consumer group. */
    async reset() {
      for (const t of userTopics()) kafkaBin("kafka-topics.sh", "--delete", "--topic", t);
      try {
        kafkaBin("kafka-consumer-groups.sh", "--delete", "--all-groups");
      } catch {
        // no groups to delete
      }
    },
    async stop() {
      try {
        docker(["rm", "-f", id]);
      } catch {
        // already gone
      }
    },
  };
}

/**
 * Start a broker sidecar for one `storage` of type `rabbitmq`, `redis` or `kafka`.
 *
 * @param {{ storage: { name: string, type: "rabbitmq" | "redis" | "kafka" },
 *           definitions?: object, password?: string, containerEnv?: Record<string, string>,
 *           channelSources?: Array<{ name: string, url?: string }>,
 *           resources?: Array<{ name: string, url?: string }> }} opts
 */
export async function start(given) {
  const opts = await withGenerated(given);
  const type = opts?.storage?.type;
  if (type === "rabbitmq") return startRabbit(opts);
  if (type === "redis") return startRedis(opts);
  if (type === "kafka") return startKafka(opts);
  throw new Error(`broker fake: storage type '${type}' has no sidecar`);
}
