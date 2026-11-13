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
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The images, pinned by digest so a re-tag upstream cannot change a leg. */
export const BROKER_IMAGES = {
  rabbitmq:
    "rabbitmq:4.1-management-alpine@sha256:42c6214e0e2093caa2484718faacb733631cc9ddc869b3298397613237dbea4a",
  redis: "valkey/valkey:8-alpine@sha256:2602ace2be6569bc2bbb06f873776516ab9089821525be34f4305c67eb9db02a",
};

/** RabbitMQ refuses the default `guest` account from anything but loopback,
 *  and a published container port is not loopback to the broker.  Lifting
 *  the restriction is what lets the harness (and a resource URL that names
 *  `guest`) reach a container; CI's `services:` entry sets the same env. */
export const RABBITMQ_CONTAINER_ENV = {
  RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS: "-rabbit loopback_users []",
};

const TAP = "loom.fake.tap";
const ADMIN = { user: "guest", pass: "guest" };

async function envNames() {
  const [re, ch] = await Promise.all([
    import(join(REPO, "out", "util", "resource-env.js")),
    import(join(REPO, "out", "util", "channels.js")),
  ]);
  return { resourceUrlVar: re.resourceEnvUrlVar, channelUrlVar: ch.channelSourceEnvVar };
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
  for (const r of opts.resources ?? []) {
    env[names.resourceUrlVar(r.name)] = r.url
      ? rehost(r.url, host, amqpPort)
      : `amqp://${ADMIN.user}:${ADMIN.pass}@${host}:${amqpPort}`;
  }

  return {
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
    env,
    url: base,
    captured,
    async observe() {
      // A publish already on the wire lands within one event-loop turn of
      // the socket read; the kit's quiesce loop covers anything later.
      await sleep(50);
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

/**
 * Start a broker sidecar for one `storage` of type `rabbitmq` or `redis`.
 *
 * @param {{ storage: { name: string, type: "rabbitmq" | "redis" },
 *           definitions?: object, password?: string,
 *           channelSources?: Array<{ name: string, url?: string }>,
 *           resources?: Array<{ name: string, url?: string }> }} opts
 */
export async function start(opts) {
  const type = opts?.storage?.type;
  if (type === "rabbitmq") return startRabbit(opts);
  if (type === "redis") return startRedis(opts);
  throw new Error(`broker fake: storage type '${type}' has no fake (kafka stays on the channels-e2e legs)`);
}
