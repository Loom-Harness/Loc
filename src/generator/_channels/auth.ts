// Broker service-to-service auth — dev-credential derivation (M-T4.4
// design §7).
//
// v1 stance: broker-level, per-deployable credentials; envelope claims stay
// observability-only (consumers authorize by their OWN scoping, never by
// envelope fields).  Credentials ride the existing `LOOM_CHANNEL_<NAME>_URL`
// env var — the one seam every driver already consumes — so production
// overrides the URL (secret-classified in the k8s chart) and the drivers
// need no second credential channel:
//
// - redis:    `redis://:<pass>@<svc>:6379` — single credential v1
//             (`requirepass`; ACL-per-service deferred).
// - rabbitmq: `amqp://<user>:<pass>@<svc>:5672/loom` — one vhost `loom`,
//             one user per deployable, permissions scoped to its
//             compiler-known exchanges/queues (definitions.json).
// - kafka:    `kafka://<user>:<pass>@<svc>:9092` — SASL/PLAIN per
//             deployable (topic ACLs deferred); each driver parses the
//             userinfo into its SASL config.  A URL WITHOUT userinfo keeps
//             the driver on plain PLAINTEXT — the pre-auth contract, which
//             is what the native e2e harnesses still use.
//
// The dev credentials are DETERMINISTIC (generation is pure/idempotent —
// the same stance as the compose `POSTGRES_PASSWORD: postgres` dev
// default): they secure the compose-internal network's brokers against
// credential-less access and give each deployable a distinct identity, and
// they are exactly as overridable as every other compose env value.

import type { SystemIR } from "../../ir/types/loom-ir.js";
import { consumedEventNames, contextsByName } from "../../ir/util/channel-consumption.js";
import { sha256 } from "../../util/sha256.js";
import { type BrokerBinding, type BrokerTransport, brokerChannelBindings } from "./bindings.js";

/** The single RabbitMQ vhost all Loom channels live in (design §7). */
export const RABBIT_VHOST = "loom";

const slug = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** Deterministic dev password for the broker `storageName` grants
 *  `user` — `loom-dev-<storage>` for the broker-wide redis credential
 *  (user "") or `loom-dev-<storage>-<user>` for a per-deployable one. */
export function devPassword(storageName: string, user = ""): string {
  return user === "" ? `loom-dev-${slug(storageName)}` : `loom-dev-${slug(storageName)}-${user}`;
}

/** The per-deployable broker username — the deployable's service slug (the
 *  same name its compose service and database already use). */
export function brokerUser(deployableName: string): string {
  return slug(deployableName);
}

/** RabbitMQ `password_hash` for definitions.json —
 *  base64(salt ++ sha256(salt ++ utf8(password))), the
 *  `rabbit_password_hashing_sha256` scheme.  The 4-byte salt is fixed
 *  ("LOOM"): definitions are generated deterministically and these are dev
 *  credentials (see module header). */
export function rabbitPasswordHash(password: string): string {
  const salt = new Uint8Array([0x4c, 0x4f, 0x4f, 0x4d]);
  const pw = new TextEncoder().encode(password);
  const salted = new Uint8Array(salt.length + pw.length);
  salted.set(salt);
  salted.set(pw, salt.length);
  const digest = sha256(salted);
  const out = new Uint8Array(salt.length + digest.length);
  out.set(salt);
  out.set(digest, salt.length);
  // btoa is browser-global; Buffer is Node-only — build base64 by hand so
  // this stays runnable in both (the playground imports the toolchain).
  let bin = "";
  for (const b of out) bin += String.fromCharCode(b);
  return typeof btoa === "function" ? btoa(bin) : Buffer.from(out).toString("base64");
}

/** The RabbitMQ permission regex for one deployable on the `loom` vhost —
 *  an exact-match alternation over its compiler-known resources: the
 *  channel exchanges (`loom.<ctx>.<channel>`), its group queues
 *  (`<address>.<deployable>`), and the shared dead-letter topology
 *  (`loom.dlx`, `loom.dlq.<address>`).  Used for configure/write/read
 *  alike: the split per AMQP operation is finer than v1 needs, and the
 *  name scope is what keeps one service out of another's queues. */
/** The credentialed broker URL one deployable's binding rides in compose —
 *  see the module header for the per-transport scheme. */
export function brokerUrl(binding: BrokerBinding, deployableName: string, svc: string): string {
  const user = brokerUser(deployableName);
  const pass = devPassword(binding.storageName, user);
  switch (binding.transport) {
    case "redis":
      return `redis://:${devPassword(binding.storageName)}@${svc}:6379`;
    case "rabbitmq":
      return `amqp://${user}:${pass}@${svc}:5672/${RABBIT_VHOST}`;
    case "kafka":
      return `kafka://${user}:${pass}@${svc}:9092`;
  }
}

/** One deployable's grant on one broker storage — the unit both the
 *  RabbitMQ definitions renderer and the Kafka JAAS line consume. */
export interface BrokerGrant {
  deployableName: string;
  user: string;
  password: string;
  /** Channel addresses the deployable binds on this storage. */
  addresses: string[];
  /** Its consumer groups on this storage (`<address>.<deployable>`). */
  groups: string[];
}

/** Per-deployable grants for one broker storage, in deployable order. */
export function brokerGrants(sys: SystemIR, storageName: string): BrokerGrant[] {
  const out: BrokerGrant[] = [];
  for (const d of sys.deployables) {
    const bindings = brokerChannelBindings(d, sys).filter((b) => b.storageName === storageName);
    if (bindings.length === 0) continue;
    const user = brokerUser(d.name);
    out.push({
      deployableName: d.name,
      user,
      password: devPassword(storageName, user),
      addresses: [...new Set(bindings.map((b) => b.address))].sort(),
      groups: [...new Set(bindings.map((b) => b.group))].sort(),
    });
  }
  return out;
}

/** RabbitMQ definitions.json for one broker storage: the `loom` vhost, one
 *  user per deployable (salted-SHA-256 password hash), and permissions
 *  scoped to each deployable's compiler-known resources (§7 — the
 *  derivable ACL).  Loaded at boot via `load_definitions`, which also
 *  suppresses the image's default open `guest` account. */
export function renderRabbitDefinitions(sys: SystemIR, storageName: string): string {
  const grants = brokerGrants(sys, storageName);
  const { exchanges, queues, bindings } = rabbitTopology(sys, storageName);
  return `${JSON.stringify(
    {
      vhosts: [{ name: RABBIT_VHOST }],
      users: grants.map((g) => ({
        name: g.user,
        password_hash: rabbitPasswordHash(g.password),
        hashing_algorithm: "rabbit_password_hashing_sha256",
        tags: [],
      })),
      permissions: grants.map((g) => ({
        user: g.user,
        vhost: RABBIT_VHOST,
        configure: rabbitPermissionRegex(g.addresses, g.groups),
        write: rabbitPermissionRegex(g.addresses, g.groups),
        read: rabbitPermissionRegex(g.addresses, g.groups),
      })),
      exchanges,
      queues,
      bindings,
    },
    null,
    2,
  )}\n`;
}

/** The RabbitMQ topology this storage needs, declared UP FRONT in the
 *  definitions file rather than left to whichever client connects first.
 *
 *  Each consuming deployable's client already declares its own queue at boot
 *  — but a fanout exchange only copies to the queues bound AT PUBLISH TIME, so
 *  anything published before a consumer's first boot goes nowhere.  Measured
 *  against a live stack: with the consumer not yet started, the producer's
 *  `ClaimApproved` left the outbox marked delivered (`dispatched = t`) and
 *  existed in no queue and no dead-letter queue.  That is a lost event on a
 *  `retention: work` channel, whose entire promise is at-least-once — and the
 *  ordinary deploy order (producer up first) is enough to trigger it.
 *
 *  The shapes here MUST match what the clients assert, or the first client to
 *  connect gets `PRECONDITION_FAILED` on the redeclare and the channel dies
 *  instead of merely losing a message.  Pinned against the node emitter
 *  (`typescript/emit/channels.ts`) and cross-checked with java's
 *  (`java/emit/channels.ts`): fanout+durable per address, one durable
 *  dead-letter queue per address bound to the direct `loom.dlx` by the address
 *  as routing key, and one durable consumer queue per consuming deployable
 *  carrying the two dead-letter arguments.
 *
 *  Only deployables that actually CONSUME get a queue: `brokerChannelBindings`
 *  emits a group name for every listed channelSource, producer side included,
 *  and a durable queue bound to a fanout that nothing drains grows without
 *  bound.  `consumedEventNames` is the same derivation
 *  `loom.deployable-channel-unrelated` reads. */
function rabbitTopology(
  sys: SystemIR,
  storageName: string,
): {
  exchanges: { name: string; vhost: string; type: string; durable: boolean }[];
  queues: { name: string; vhost: string; durable: boolean; arguments: Record<string, string> }[];
  bindings: {
    source: string;
    vhost: string;
    destination: string;
    destination_type: string;
    routing_key: string;
  }[];
} {
  const ctxByName = contextsByName(sys);
  const addresses = new Set<string>();
  // queue name -> the address it binds to, so a deployable consuming two
  // channels contributes two distinct queues and neither is emitted twice.
  const consumerQueues = new Map<string, string>();
  for (const d of sys.deployables) {
    const consumed = consumedEventNames(d, ctxByName);
    for (const b of brokerChannelBindings(d, sys)) {
      if (b.storageName !== storageName || b.transport !== "rabbitmq") continue;
      addresses.add(b.address);
      if (b.events.some((e) => consumed.has(e))) consumerQueues.set(b.group, b.address);
    }
  }
  if (addresses.size === 0) return { exchanges: [], queues: [], bindings: [] };
  const sortedAddresses = [...addresses].sort();
  const exchanges = [
    // The shared dead-letter exchange, declared once.
    { name: "loom.dlx", vhost: RABBIT_VHOST, type: "direct", durable: true },
    ...sortedAddresses.map((a) => ({
      name: a,
      vhost: RABBIT_VHOST,
      type: "fanout",
      durable: true,
    })),
  ];
  const queues = [
    ...sortedAddresses.map((a) => ({
      name: `loom.dlq.${a}`,
      vhost: RABBIT_VHOST,
      durable: true,
      arguments: {} as Record<string, string>,
    })),
    ...[...consumerQueues.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([queue, address]) => ({
        name: queue,
        vhost: RABBIT_VHOST,
        durable: true,
        arguments: {
          "x-dead-letter-exchange": "loom.dlx",
          "x-dead-letter-routing-key": address,
        } as Record<string, string>,
      })),
  ];
  const bindings = [
    ...sortedAddresses.map((a) => ({
      source: "loom.dlx",
      vhost: RABBIT_VHOST,
      destination: `loom.dlq.${a}`,
      destination_type: "queue",
      routing_key: a,
    })),
    ...[...consumerQueues.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([queue, address]) => ({
        source: address,
        vhost: RABBIT_VHOST,
        destination: queue,
        destination_type: "queue",
        // Fanout ignores the routing key; the clients bind with "" and the
        // definitions must say the same or the binding is a DIFFERENT one.
        routing_key: "",
      })),
  ];
  return { exchanges, queues, bindings };
}

/** The Kafka SASL/PLAIN JAAS line for the client listener — one
 *  `user_<name>="<pass>"` entry per granted deployable. */
export function kafkaJaasConfig(sys: SystemIR, storageName: string): string {
  const users = brokerGrants(sys, storageName)
    .map((g) => ` user_${g.user}="${g.password}"`)
    .join("");
  return `org.apache.kafka.common.security.plain.PlainLoginModule required${users};`;
}

/** Transport of a broker storage by name (undefined for non-broker types). */
export function brokerTransportOf(sys: SystemIR, storageName: string): BrokerTransport | undefined {
  const t = sys.storages.find((s) => s.name === storageName)?.type;
  return t === "redis" || t === "rabbitmq" || t === "kafka" ? t : undefined;
}

export function rabbitPermissionRegex(addresses: string[], groups: string[]): string {
  // Addresses/groups are `[A-Za-z0-9._]` by construction (loom.<Ctx>.<Name>
  // from identifier parts) — escaping the dots makes them regex-literal.
  const lit = (s: string): string => s.replace(/\./g, "\\.");
  const names = [
    "loom\\.dlx",
    ...addresses.map(lit),
    ...addresses.map((a) => `loom\\.dlq\\.${lit(a)}`),
    ...groups.map(lit),
  ];
  return `^(${[...new Set(names)].sort().join("|")})$`;
}
