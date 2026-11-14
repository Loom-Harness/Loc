import { foldInboxPurgeSql } from "../../../ir/plan/index.js";
import type { EventIR, FieldIR, TypeIR, ValueObjectIR } from "../../../ir/types/loom-ir.js";
import {
  OUTBOX_PENDING_PREDICATE,
  OUTBOX_PURGE_BATCH,
  OUTBOX_PURGE_INTERVAL_SECONDS,
  OUTBOX_RETENTION_DEFAULT_DAYS,
  OUTBOX_RETENTION_ENV,
} from "../../../util/channels.js";
import { lines } from "../../../util/code-builder.js";
import { emissionSink } from "../../../util/emission-sink.js";
import { lowerFirst } from "../../../util/naming.js";
import {
  type BrokerBinding,
  kafkaStartsAtEarliest,
  uniqueBindings,
} from "../../_channels/bindings.js";
import {
  CHANNEL_CONSUMER,
  CHANNEL_RECONNECT,
  OUTBOX_RELAY,
} from "../../_channels/delivery-policy.js";
import {
  decodeField,
  type WireDecodeLeaf,
  type WireDecodeTarget,
} from "../../_channels/wire-codec.js";
import { javaRef } from "../../_imports/java.js";
import { numericEncode } from "../../_numeric/target.js";
import { javaLogEvent } from "../../_obs/render-java.js";
import { javaCalendarDateWire, javaEnvelopeInstant } from "../codec-spelling.js";
import { jid } from "../java-ident.js";
import { J } from "../java-symbols.js";
import { JAVA_NUMERIC } from "../numeric-codec.js";

// ---------------------------------------------------------------------------
// Broker transport classes (M-T4.4 slices 6b + 7c — the Java/Spring Boot leg
// of the Hono reference driver in `src/generator/typescript/emit/channels.ts`).
// Emitted only when the deployable wires a broker-bound channelSource via
// `channels:`; channel-less projects stay byte-identical.
//
// Carries the CloudEvents 1.0 envelope (same field pin —
// `src/util/channels.ts`), a per-event codec over the DSL field names (wire
// parity with the Hono/Python/.NET drivers: datetimes as ISO-8601 round-trip
// strings, money as decimal strings, ids as their string form), the
// `ChannelTransport` seam, the Lettuce pub/sub driver (Apache 2.0 — design
// §6a; `broadcast`/`ephemeral`), the com.rabbitmq:amqp-client driver
// (Apache 2.0 — §6a; `queue`/`ephemeral`+`work`, design §4 topology: durable
// fanout exchange per address, one durable queue per consuming deployable so
// replicas compete, manual ack → bounded retry → DLX `loom.dlx` →
// `loom.dlq.<address>` parking), the `DomainEvent`-typed publish-tee
// `@EventListener` enforcing the §4 delivery-uniformity rule (its
// counterpart: dispatcher handlers for broker-routed events DROP their local
// `@EventListener` — see `DispatchCtx.brokerEvents`), and — where a hosted
// reactor subscribes — the `ChannelConsumerService` invoking the SAME
// dispatcher handler methods local events would reach.
//
// Producer path split (design §5): the tee publishes EPHEMERAL
// broker-routed events inline; DURABLE (`work`) events land in
// `__loom_outbox` inside the caller's @Transactional write (the tee IS the
// outbox recorder on java) and are published by the `OutboxRelayService` on
// drain via `ChannelRelayPublisher`, with the outbox row id as the envelope
// id — the stable consumer-side idempotency key across broker redeliveries.
//
// Java one-public-class-per-file: this module returns one rendered file per
// class, all placed under the `config` category (the CatalogLog package);
// the outbox entity/repository render separately (persistence categories).
// ---------------------------------------------------------------------------

/** Lettuce (Apache 2.0) — the redis pub/sub client; wiring-gated into
 *  build.gradle.kts by the orchestrator. */
export const LETTUCE_CORE_VERSION = "6.5.5.RELEASE";

/** com.rabbitmq:amqp-client (Apache 2.0) — the plain AMQP 0-9-1 driver
 *  (consistent with the Lettuce plain-driver choice; never MassTransit-style
 *  frameworks); wiring-gated into build.gradle.kts by the orchestrator. */
export const AMQP_CLIENT_VERSION = "5.25.0";

/** org.apache.kafka:kafka-clients (Apache 2.0) — the plain Kafka driver
 *  (design §6a; the Lettuce/amqp-client plain-driver choice). */
export const KAFKA_CLIENTS_VERSION = "3.9.1";

/** One consumer dispatch target: a dispatcher handler method the
 *  ChannelConsumerService invokes when the named event arrives. */
export interface ChannelConsumerHandler {
  dispatcherClass: string;
  /** The dispatcher's package (layout-routed `workflow-service`). */
  dispatcherPkg: string;
  method: string;
  event: string;
}

/** The per-binding driver pick in `ChannelTransports` — a ctor reference
 *  when one driver is wired, a transport-discriminated conditional chain
 *  when several are (fixed kafka → rabbitmq → redis order; the last wired
 *  driver is the fallback arm, so pre-kafka outputs stay byte-identical). */
function transportPickLine(hasRedis: boolean, hasRabbit: boolean, hasKafka: boolean): string {
  const drivers: [string, string][] = [];
  if (hasKafka) drivers.push(["kafka", "KafkaChannelTransport"]);
  if (hasRabbit) drivers.push(["rabbitmq", "RabbitChannelTransport"]);
  if (hasRedis) drivers.push(["redis", "RedisChannelTransport"]);
  const last = drivers[drivers.length - 1];
  if (!last) throw new Error("renderJavaChannelFiles called with no wired broker transport");
  if (drivers.length === 1) {
    return `            byCsName.put(binding.csName(), byUrl.computeIfAbsent(url, ${last[1]}::new));`;
  }
  const arms = drivers
    .slice(0, -1)
    .map(
      ([t, cls]) =>
        `${JSON.stringify(t)}.equals(binding.transport())\n                            ? new ${cls}(u)\n                            : `,
    )
    .join("");
  return `            byCsName.put(binding.csName(), byUrl.computeIfAbsent(url,\n                    u -> ${arms}new ${last[1]}(u)));`;
}

/** Java expression serialising one event record component into its
 *  envelope-data value (DSL-keyed JSON; parity with the Hono/Python/.NET
 *  codecs). */
function toDataExpr(access: string, t: TypeIR, vo?: JavaVoEncode): string {
  const inner = t.kind === "optional" ? t.inner : t;
  const conv = (): string | null => {
    // A value object crosses as a DSL-keyed record whose leaves use the SAME
    // wire forms as a top-level field (money as a fixed-scale string, …) —
    // not Jackson's record serialisation, which writes a `BigDecimal` as a
    // JSON number the decoders read as a string.  Rendered through a
    // per-VO `encode<Vo>` helper the codec class declares.
    if (inner.kind === "valueobject" && vo?.fields.has(inner.name)) {
      vo.used.add(inner.name);
      return `encode${inner.name}(${access})`;
    }
    if (inner.kind === "primitive" && inner.name === "datetime") return javaEnvelopeInstant(access);
    if (inner.kind === "primitive" && inner.name === "date") return javaCalendarDateWire(access);
    // money pins the FIXED wire scale (RS-12) — a bare `toPlainString()` echoes
    // whatever scale the domain `BigDecimal` happens to carry (the write scale,
    // an arithmetic result's scale), which need not be 4dp: the SAME class of
    // divergence #2549 fixed for the REST wire, unfixed here until now (no
    // corpus fixture exercises a money field on a channel payload — F18).
    if (inner.kind === "primitive" && inner.name === "money")
      return numericEncode(JAVA_NUMERIC, "money", "dto-map", access);
    if (inner.kind === "id") return `${access}.toString()`;
    if (inner.kind === "enum") return `${access}.name()`;
    return null;
  };
  const converted = conv();
  if (converted === null) return access;
  return t.kind === "optional" ? `${access} == null ? null : ${converted}` : converted;
}

/** The VO field lookup plus the set of VOs whose `encode<Vo>` helper the
 *  codec must declare (filled as `toDataExpr` reaches them). */
interface JavaVoEncode {
  readonly fields: ReadonlyMap<string, readonly FieldIR[]>;
  readonly used: Set<string>;
}

/** The `encode<Vo>` helper methods for every VO `toDataExpr` reached —
 *  transitively, since a helper body may reach a nested VO. */
function renderVoEncoders(vo: JavaVoEncode): string[] {
  const out: string[] = [];
  const done = new Set<string>();
  for (;;) {
    const next = [...vo.used].find((n) => !done.has(n));
    if (next === undefined) break;
    done.add(next);
    const fields = vo.fields.get(next) ?? [];
    out.push(
      ``,
      `    private static Map<String, Object> encode${next}(${next} v) {`,
      `        var m = new LinkedHashMap<String, Object>();`,
      ...fields.map(
        (f) =>
          `        m.put(${JSON.stringify(f.name)}, ${toDataExpr(`v.${jid(f.name)}()`, f.type, vo)});`,
      ),
      `        return m;`,
      `    }`,
    );
  }
  return out;
}

/** Java's `WireDecodeTarget` — the leaf half of the shared channel wire codec
 *  (`src/generator/_channels/wire-codec.ts`).  The leaves' `java.*` types are
 *  markers, so the unit's import block is derived.  The `TypeIR.kind`
 *  DISPATCH lives once there, is exhaustive, and `never`-checks — so a new IR
 *  type kind cannot land silently in the `(String) ...` arm.
 *
 *  Of the five backends this is the codec that was already MOST complete: it
 *  is the only pre-port one with a real optional null-guard. */
function javaWireDecode(): WireDecodeTarget {
  const asString: WireDecodeLeaf = (e) => `(String) ${e}`;
  return {
    lang: "java",
    read: (payload, field) => `${payload}.get(${JSON.stringify(field)})`,
    primitive: {
      int: (e) => numericEncode(JAVA_NUMERIC, "int", "find-param", e),
      long: (e) => numericEncode(JAVA_NUMERIC, "long", "find-param", e),
      bool: (e) => `(Boolean) ${e}`,
      decimal: (e) => numericEncode(JAVA_NUMERIC, "decimal", "find-param", e),
      money: (e) => numericEncode(JAVA_NUMERIC, "money", "find-param", `(String) ${e}`),
      datetime: (e) => `${J.Instant}.parse((String) ${e})`,
      date: (e) => `${J.LocalDate}.parse((String) ${e})`,
      string: asString,
      guid: asString,
      json: asString,
      File: asString,
      duration: asString,
    },
    id: (e, targetName) => `new ${targetName}Id(${J.UUID}.fromString((String) ${e}))`,
    enumValue: (e, name) => `${name}.valueOf((String) ${e})`,
    optional: (e, decoded) => `${e} == null ? null : ${decoded}`,
    passthrough: asString,
    // A value object crosses as a DSL-keyed JSON object (a `Map` after
    // Jackson) and is rebuilt through its record constructor — never cast to
    // `String` for the VO-typed component (eval item 11).
    valueObject: {
      view: (e) => `((Map<?, ?>) ${e})`,
      build: (name, fields) => `new ${name}(${fields.map((f) => f.decoded).join(", ")})`,
    },
  };
}

/** Java expression reconstructing one event record component from the
 *  envelope's `data` map. */
function fromDataExpr(
  name: string,
  t: TypeIR,
  vos?: ReadonlyMap<string, readonly FieldIR[]>,
): string {
  return decodeField(
    "data",
    { name, type: t, optional: t.kind === "optional" },
    javaWireDecode(),
    vos,
  );
}

/** The relay's poll loop: a failed pass (database or broker unreachable) is
 *  logged and the next one waits the shared policy's capped exponential
 *  backoff; a clean pass resets it. */
function javaRelayLoop(): string[] {
  return [
    `        executor.submit(() -> {`,
    `            var failures = 0;`,
    `            while (running) {`,
    `                try {`,
    `                    maybePurge();`,
    `                    drain();`,
    `                    failures = 0;`,
    `                } catch (RuntimeException e) {`,
    `                    CatalogLog.event(${javaLogEvent("outboxRelayError")}, "error", String.valueOf(e.getMessage()));`,
    `                    failures++;`,
    `                }`,
    `                var delay = failures == 0`,
    `                        ? INTERVAL_MS`,
    `                        : Math.min(INTERVAL_MS << Math.min(failures, ${OUTBOX_RELAY.maxBackoffDoublings}), ${OUTBOX_RELAY.maxBackoffMs}L);`,
    `                try {`,
    `                    Thread.sleep(delay);`,
    `                } catch (InterruptedException e) {`,
    `                    Thread.currentThread().interrupt();`,
    `                    return;`,
    `                }`,
    `            }`,
    `        });`,
  ];
}

/** All broker transport files for the deployable, keyed by file name (placed
 *  under the `config` category alongside CatalogLog). */
export function renderJavaChannelFiles(
  basePkg: string,
  bindings: BrokerBinding[],
  /** The carried events' IRs (foreign ones already resolved system-wide by
   *  the orchestrator) — drives the codec arms. */
  carriedEvents: EventIR[],
  /** Dispatcher handler methods for broker-routed events — gates the
   *  ChannelConsumerService (a pure producer ships publish-only). */
  consumerHandlers: ChannelConsumerHandler[],
  /** M-T4.4: hosted durable events ride a broker-bound
   *  `queue`/`work` channel — the tee records them in `__loom_outbox` and
   *  the relay publishes on drain (design §5).  False on consumers that
   *  don't host the durable channel's context (their module migrations
   *  carry no outbox table; broker ack semantics own redelivery).  The two
   *  packages are the layout-routed homes of the outbox entity/repository
   *  (`renderJavaOutboxFiles`). */
  opts: {
    durableBroker: boolean;
    outboxEntityPkg?: string;
    outboxRepoPkg?: string;
    /** The value objects in scope (hosted + the foreign-event closure) — a
     *  carried VO is encoded as a DSL-keyed record and rebuilt on decode. */
    valueObjects?: readonly ValueObjectIR[];
    /** The deployable carries auth: every envelope carries the raising
     *  thread's EVENT ORIGIN (`tenantid` / `loomcausedby`,
     *  ruling D1), the outbox row records it, and the consumer dispatches each
     *  event as the system principal of that origin (`auth/EventOrigin.java`). */
    carriesOrigin?: boolean;
  } = {
    durableBroker: false,
  },
): Map<string, string> {
  const pkg = `${basePkg}.config`;
  const vos: ReadonlyMap<string, readonly FieldIR[]> = new Map(
    (opts.valueObjects ?? []).map((v) => [v.name, v.fields] as const),
  );
  const voEncode: JavaVoEncode = { fields: vos, used: new Set() };
  const carriesOrigin = opts.carriesOrigin ?? false;
  const unique = uniqueBindings(bindings);
  const hasRedis = unique.some((b) => b.transport === "redis");
  const hasRabbit = unique.some((b) => b.transport === "rabbitmq");
  const hasKafka = unique.some((b) => b.transport === "kafka");
  // event type -> address, split by durability (design §5): ephemeral events
  // publish inline in the tee; durable (`work`) events ride the outbox relay.
  // First-by-declaration within each tier, mirroring the in-process
  // dispatcher's routing rule.
  const routing = new Map<string, string>();
  const durableRouting = new Map<string, string>();
  for (const b of unique) {
    const target = b.retention === "ephemeral" ? routing : durableRouting;
    for (const ev of b.events) {
      if (!target.has(ev)) target.set(ev, b.address);
    }
  }
  const routed = new Set([...routing.keys(), ...durableRouting.keys()]);
  const carried = carriedEvents.filter((e) => routed.has(e.name));

  const out = emissionSink("generator/java/emit/channels");

  out.set(
    "LoomEventEnvelope.java",
    lines(
      `package ${pkg};`,
      ``,
      `import java.util.LinkedHashMap;`,
      `import java.util.Map;`,
      ``,
      `import tools.jackson.databind.json.JsonMapper;`,
      ``,
      carriesOrigin ? `import ${basePkg}.auth.EventOrigin;` : null,
      carriesOrigin ? `` : null,
      `/** CloudEvents 1.0 JSON envelope — the cross-backend wire contract`,
      ` *  (loom envelope pin, src/util/channels.ts). */`,
      `public record LoomEventEnvelope(`,
      `        String specVersion,`,
      `        String id,`,
      `        String type,`,
      `        String source,`,
      `        String time,`,
      `        String dataContentType,`,
      `        String loomChannel,`,
      ...(hasKafka
        ? [
            `        /** The channel's key: field value — kafka's partition key`,
            `         *  (loomkey ?? id, design §4); null off the kafka path. */`,
            `        String loomKey,`,
          ]
        : []),
      ...(carriesOrigin
        ? [
            `        /** The raising principal's tenant (ruling D1) — the consuming`,
            `         *  reactor runs as the system principal OF this tenant. */`,
            `        String tenantId,`,
            `        /** The originating user id — audit and logs only. */`,
            `        String loomCausedBy,`,
          ]
        : []),
      `        Map<String, Object> data) {`,
      ``,
      // WRITE_BIGDECIMAL_AS_PLAIN (M-T6.46): the REST response path no longer
      // hands Jackson a `BigDecimal` (a response `decimal` is a `double`), but
      // the CloudEvents `data` map still does — `toDataExpr` converts
      // datetime/money/id/enum and passes a plain `decimal` through raw.  Left
      // at the default, a negative-scale value serializes in SCIENTIFIC
      // notation (`1E+40`), which a consumer on another backend reads as a
      // different literal than the one java holds.  This pins PLAIN notation;
      // it does not change the value, and it deliberately does NOT redefine the
      // broker's numeric precision contract (that gap is cross-backend — .NET's
      // channel codec has the identical raw-decimal shape).
      `    private static final JsonMapper JSON = JsonMapper.builder()`,
      `        .enable(tools.jackson.core.StreamWriteFeature.WRITE_BIGDECIMAL_AS_PLAIN)`,
      `        .build();`,
      ``,
      `    public String toJson() {`,
      `        var m = new LinkedHashMap<String, Object>();`,
      `        m.put("specversion", specVersion);`,
      `        m.put("id", id);`,
      `        m.put("type", type);`,
      `        m.put("source", source);`,
      `        m.put("time", time);`,
      `        m.put("datacontenttype", dataContentType);`,
      `        m.put("loomchannel", loomChannel);`,
      ...(hasKafka
        ? [`        if (loomKey != null) {`, `            m.put("loomkey", loomKey);`, `        }`]
        : []),
      ...(carriesOrigin
        ? [
            `        if (tenantId != null) {`,
            `            m.put("tenantid", tenantId);`,
            `        }`,
            `        if (loomCausedBy != null) {`,
            `            m.put("loomcausedby", loomCausedBy);`,
            `        }`,
          ]
        : []),
      `        m.put("data", data);`,
      `        return JSON.writeValueAsString(m);`,
      `    }`,
      ``,
      `    @SuppressWarnings("unchecked")`,
      `    public static LoomEventEnvelope fromJson(String json) {`,
      `        Map<String, Object> m = JSON.readValue(json, Map.class);`,
      `        return new LoomEventEnvelope(`,
      `                (String) m.get("specversion"),`,
      `                (String) m.get("id"),`,
      `                (String) m.get("type"),`,
      `                (String) m.get("source"),`,
      `                (String) m.get("time"),`,
      `                (String) m.get("datacontenttype"),`,
      `                (String) m.get("loomchannel"),`,
      ...(hasKafka ? [`                (String) m.get("loomkey"),`] : []),
      ...(carriesOrigin
        ? [
            `                (String) m.get("tenantid"),`,
            `                (String) m.get("loomcausedby"),`,
          ]
        : []),
      `                (Map<String, Object>) m.get("data"));`,
      `    }`,
      ...(carriesOrigin
        ? [
            ``,
            `    /** The event origin this envelope names, or null (a producer`,
            `     *  without auth, a timer-raised event). */`,
            `    public EventOrigin origin() {`,
            `        return tenantId == null && loomCausedBy == null`,
            `                ? null`,
            `                : new EventOrigin(tenantId, loomCausedBy);`,
            `    }`,
          ]
        : []),
      `}`,
      ``,
    ),
  );

  out.set(
    "ChannelTransport.java",
    lines(
      `package ${pkg};`,
      ``,
      `import java.util.function.Consumer;`,
      ``,
      `/** The publish/subscribe seam every broker driver implements, shared`,
      ` *  with the realtime relay.  A null group is broadcast; a group`,
      ` *  name makes replicas competing consumers. */`,
      `public interface ChannelTransport {`,
      `    void publish(String address, LoomEventEnvelope envelope);`,
      ``,
      `    void subscribe(String address, String group, Consumer<LoomEventEnvelope> handler);`,
      ``,
      ...(hasKafka
        ? [
            `    /** Kafka only: {@code fromBeginning} starts a NEW consumer group at the`,
            `     *  earliest offset (work-queue channels) instead of the latest (log`,
            `     *  channels).  Other drivers have no offsets and ignore it. */`,
            `    default void subscribe(String address, String group, boolean fromBeginning,`,
            `            Consumer<LoomEventEnvelope> handler) {`,
            `        subscribe(address, group, handler);`,
            `    }`,
            ``,
          ]
        : []),
      `    void close();`,
      `}`,
      ``,
    ),
  );

  if (hasRedis)
    out.set(
      "RedisChannelTransport.java",
      lines(
        `package ${pkg};`,
        ``,
        `import java.util.function.Consumer;`,
        ``,
        `import io.lettuce.core.ClientOptions;`,
        `import io.lettuce.core.RedisClient;`,
        `import io.lettuce.core.api.StatefulRedisConnection;`,
        `import io.lettuce.core.pubsub.RedisPubSubAdapter;`,
        `import io.lettuce.core.pubsub.StatefulRedisPubSubConnection;`,
        ``,
        `/** Redis (Valkey) driver — pub/sub over Lettuce (Apache 2.0, design §6a).`,
        ` *  \`redis://host:port\` URLs come from LOOM_CHANNEL_*_URL; Lettuce parses`,
        ` *  them natively. */`,
        `public final class RedisChannelTransport implements ChannelTransport {`,
        `    private final RedisClient client;`,
        `    private StatefulRedisConnection<String, String> pub;`,
        `    private StatefulRedisPubSubConnection<String, String> sub;`,
        ``,
        `    public RedisChannelTransport(String url) {`,
        `        this.client = RedisClient.create(url);`,
        `        // A command issued while the server is unreachable fails at once`,
        `        // instead of queueing until the reconnect: an ephemeral publish is`,
        `        // at-most-once, and a queued one would hold the request that raised`,
        `        // it.  Reconnect and resubscribe still run in the background.`,
        `        this.client.setOptions(ClientOptions.builder()`,
        `            .disconnectedBehavior(ClientOptions.DisconnectedBehavior.REJECT_COMMANDS)`,
        `            .build());`,
        `    }`,
        ``,
        `    @Override`,
        `    public synchronized void publish(String address, LoomEventEnvelope envelope) {`,
        `        if (pub == null) {`,
        `            pub = client.connect();`,
        `        }`,
        `        pub.sync().publish(address, envelope.toJson());`,
        `    }`,
        ``,
        `    @Override`,
        `    public synchronized void subscribe(String address, String group, Consumer<LoomEventEnvelope> handler) {`,
        `        if (sub == null) {`,
        `            sub = client.connectPubSub();`,
        `        }`,
        `        sub.addListener(new RedisPubSubAdapter<String, String>() {`,
        `            @Override`,
        `            public void message(String channel, String message) {`,
        `                if (!address.equals(channel)) {`,
        `                    return;`,
        `                }`,
        `                LoomEventEnvelope envelope;`,
        `                try {`,
        `                    envelope = LoomEventEnvelope.fromJson(message);`,
        `                } catch (RuntimeException e) {`,
        `                    CatalogLog.event(${javaLogEvent("channelConsumeFailed")}, "address", address, "error", "malformed envelope");`,
        `                    return;`,
        `                }`,
        `                handler.accept(envelope);`,
        `            }`,
        `        });`,
        `        sub.sync().subscribe(address);`,
        `    }`,
        ``,
        `    @Override`,
        `    public synchronized void close() {`,
        `        if (pub != null) {`,
        `            pub.close();`,
        `        }`,
        `        if (sub != null) {`,
        `            sub.close();`,
        `        }`,
        `        client.shutdown();`,
        `    }`,
        `}`,
        ``,
      ),
    );

  if (hasRabbit)
    out.set(
      "RabbitChannelTransport.java",
      lines(
        `package ${pkg};`,
        ``,
        `import java.io.IOException;`,
        `import java.nio.charset.StandardCharsets;`,
        `import java.util.HashMap;`,
        `import java.util.List;`,
        `import java.util.concurrent.CopyOnWriteArrayList;`,
        `import java.util.concurrent.ExecutorService;`,
        `import java.util.concurrent.Executors;`,
        `import java.util.concurrent.TimeoutException;`,
        `import java.util.function.Consumer;`,
        ``,
        `import com.rabbitmq.client.AMQP;`,
        `import com.rabbitmq.client.BuiltinExchangeType;`,
        `import com.rabbitmq.client.Channel;`,
        `import com.rabbitmq.client.Connection;`,
        `import com.rabbitmq.client.ConnectionFactory;`,
        `import com.rabbitmq.client.DefaultConsumer;`,
        `import com.rabbitmq.client.Envelope;`,
        ``,
        `/** RabbitMQ driver — com.rabbitmq:amqp-client over AMQP 0-9-1 (design §4`,
        ` *  topology): a durable fanout exchange per channel address; one durable`,
        ` *  queue per consuming deployable (the consumer group) so replicas`,
        ` *  compete; manual ack; a failed handler republishes with an attempt`,
        ` *  header up to MAX_ATTEMPTS, then parks via DLX \`loom.dlx\` into`,
        ` *  \`loom.dlq.&lt;address&gt;\`.`,
        ` *`,
        ` *  Every subscription consumes on its own channel, apart from the publish`,
        ` *  channel, so a channel-level error on one never silences another.  A`,
        ` *  connection the broker drops is redialled with capped exponential`,
        ` *  backoff and every subscription re-attached (the client's own automatic`,
        ` *  recovery is off: it gives up on a consumer whose channel it cannot`,
        ` *  restore, and this transport must not). */`,
        `public final class RabbitChannelTransport implements ChannelTransport {`,
        `    /** Bounded per-message retries before a poisoned message parks in the`,
        `     *  DLQ (mirrors the outbox relay's MAX_ATTEMPTS). */`,
        `    private static final int MAX_ATTEMPTS = ${CHANNEL_CONSUMER.maxAttempts};`,
        `    private static final long RECONNECT_BASE_MS = ${CHANNEL_RECONNECT.baseDelayMs};`,
        `    private static final long RECONNECT_MAX_MS = ${CHANNEL_RECONNECT.maxDelayMs};`,
        ``,
        `    /** One subscription and the channel it currently consumes on. */`,
        `    private static final class Subscription {`,
        `        final String address;`,
        `        final String group;`,
        `        final Consumer<LoomEventEnvelope> handler;`,
        `        Channel channel;`,
        ``,
        `        Subscription(String address, String group, Consumer<LoomEventEnvelope> handler) {`,
        `            this.address = address;`,
        `            this.group = group;`,
        `            this.handler = handler;`,
        `        }`,
        `    }`,
        ``,
        `    private final String url;`,
        `    private final List<Subscription> subscriptions = new CopyOnWriteArrayList<>();`,
        `    private final ExecutorService reconnector = Executors.newSingleThreadExecutor(r -> {`,
        `        var t = new Thread(r, "loom-rabbitmq-reconnect");`,
        `        t.setDaemon(true);`,
        `        return t;`,
        `    });`,
        `    private final Object reconnectLock = new Object();`,
        `    private boolean reconnecting;`,
        `    private volatile boolean closing;`,
        `    private Connection connection;`,
        `    private Channel publishChannel;`,
        ``,
        `    public RabbitChannelTransport(String url) {`,
        `        this.url = url;`,
        `    }`,
        ``,
        `    /** The open connection, dialled on first use and after a drop. */`,
        `    private synchronized Connection connection() throws IOException, TimeoutException {`,
        `        if (connection == null || !connection.isOpen()) {`,
        `            var factory = new ConnectionFactory();`,
        `            try {`,
        `                factory.setUri(url);`,
        `            } catch (Exception e) {`,
        `                throw new IllegalStateException("rabbitmq url invalid: " + e.getMessage(), e);`,
        `            }`,
        `            factory.setAutomaticRecoveryEnabled(false);`,
        `            var conn = factory.newConnection();`,
        `            // Runs on the connection's own thread: hand off, never block it.`,
        `            conn.addShutdownListener(cause -> {`,
        `                if (!cause.isInitiatedByApplication()) {`,
        `                    scheduleReconnect();`,
        `                }`,
        `            });`,
        `            connection = conn;`,
        `            publishChannel = null;`,
        `        }`,
        `        return connection;`,
        `    }`,
        ``,
        `    /** Drop the connection without waiting on a broker that is gone. */`,
        `    private synchronized void forget() {`,
        `        if (connection != null) {`,
        `            connection.abort(1000);`,
        `        }`,
        `        connection = null;`,
        `        publishChannel = null;`,
        `    }`,
        ``,
        `    private void scheduleReconnect() {`,
        `        synchronized (reconnectLock) {`,
        `            if (reconnecting || closing) {`,
        `                return;`,
        `            }`,
        `            reconnecting = true;`,
        `        }`,
        `        reconnector.execute(this::reconnect);`,
        `    }`,
        ``,
        `    /** Redial with capped exponential backoff and re-attach every`,
        `     *  subscription whose channel is gone; one run at a time, until it`,
        `     *  succeeds or the transport closes. */`,
        `    private void reconnect() {`,
        `        var delay = RECONNECT_BASE_MS;`,
        `        for (var attempt = 1; !closing; attempt++) {`,
        `            try {`,
        `                synchronized (this) {`,
        `                    var conn = connection();`,
        `                    for (var sub : subscriptions) {`,
        `                        if (sub.channel == null || !sub.channel.isOpen()) {`,
        `                            attach(conn, sub);`,
        `                        }`,
        `                    }`,
        `                }`,
        `                CatalogLog.event(${javaLogEvent("channelReconnected")}, "transport", "rabbitmq",`,
        `                        "attempts", String.valueOf(attempt));`,
        `                break;`,
        `            } catch (Exception e) {`,
        `                forget();`,
        `                try {`,
        `                    Thread.sleep(delay);`,
        `                } catch (InterruptedException interrupted) {`,
        `                    Thread.currentThread().interrupt();`,
        `                    return;`,
        `                }`,
        `                delay = Math.min(delay * 2, RECONNECT_MAX_MS);`,
        `            }`,
        `        }`,
        `        synchronized (reconnectLock) {`,
        `            reconnecting = false;`,
        `        }`,
        `        // A drop that landed while this run was finishing found it busy.`,
        `        synchronized (this) {`,
        `            if (!closing && (connection == null || !connection.isOpen())) {`,
        `                scheduleReconnect();`,
        `            }`,
        `        }`,
        `    }`,
        ``,
        `    @Override`,
        `    public synchronized void publish(String address, LoomEventEnvelope envelope) {`,
        `        try {`,
        `            if (publishChannel == null || !publishChannel.isOpen()) {`,
        `                publishChannel = connection().createChannel();`,
        `            }`,
        `            var ch = publishChannel;`,
        `            ch.exchangeDeclare(address, BuiltinExchangeType.FANOUT, true);`,
        `            var props = new AMQP.BasicProperties.Builder()`,
        `                    .contentType("application/json").deliveryMode(2).build();`,
        `            ch.basicPublish(address, "", props, envelope.toJson().getBytes(StandardCharsets.UTF_8));`,
        `        } catch (IOException | TimeoutException e) {`,
        `            throw new IllegalStateException("rabbitmq publish failed: " + e.getMessage(), e);`,
        `        }`,
        `    }`,
        ``,
        `    @Override`,
        `    public synchronized void subscribe(String address, String group, Consumer<LoomEventEnvelope> handler) {`,
        `        var sub = new Subscription(address, group, handler);`,
        `        subscriptions.add(sub);`,
        `        try {`,
        `            attach(connection(), sub);`,
        `        } catch (IOException | TimeoutException e) {`,
        `            throw new IllegalStateException("rabbitmq subscribe failed: " + e.getMessage(), e);`,
        `        }`,
        `    }`,
        ``,
        `    /** Declare the subscription's topology and consume on a fresh channel. */`,
        `    private void attach(Connection conn, Subscription sub) throws IOException {`,
        `        var address = sub.address;`,
        `        var handler = sub.handler;`,
        `        // The queue name IS the consumer group: replicas of one deployable`,
        `        // share it and compete; other deployables bind their own queue to`,
        `        // the same exchange (fan-out across deployables, one-of-N within).`,
        `        var queue = sub.group == null ? address : sub.group;`,
        `        var ch = conn.createChannel();`,
        `        ch.basicQos(1);`,
        `        ch.exchangeDeclare(address, BuiltinExchangeType.FANOUT, true);`,
        `        ch.exchangeDeclare("loom.dlx", BuiltinExchangeType.DIRECT, true);`,
        `        var dlq = "loom.dlq." + address;`,
        `        ch.queueDeclare(dlq, true, false, false, null);`,
        `        ch.queueBind(dlq, "loom.dlx", address);`,
        `        var args = new HashMap<String, Object>();`,
        `        args.put("x-dead-letter-exchange", "loom.dlx");`,
        `        args.put("x-dead-letter-routing-key", address);`,
        `        ch.queueDeclare(queue, true, false, false, args);`,
        `        ch.queueBind(queue, address, "");`,
        `        // The retry route: loom.dlx hands a message published under`,
        `        // loom.retry.<queue> back to this queue (the broker ACL grants`,
        `        // loom.dlx, not the default exchange).`,
        `        ch.queueBind(queue, "loom.dlx", "loom.retry." + queue);`,
        `        // A channel the broker closes on its own (the connection still up)`,
        `        // is re-attached too.`,
        `        ch.addShutdownListener(cause -> {`,
        `            if (!cause.isInitiatedByApplication() && !cause.isHardError()) {`,
        `                scheduleReconnect();`,
        `            }`,
        `        });`,
        `        sub.channel = ch;`,
        `        ch.basicConsume(queue, false, new DefaultConsumer(ch) {`,
        `            @Override`,
        `            public void handleDelivery(String consumerTag, Envelope delivery,`,
        `                    AMQP.BasicProperties properties, byte[] body) throws IOException {`,
        `                LoomEventEnvelope envelope;`,
        `                try {`,
        `                    envelope = LoomEventEnvelope.fromJson(new String(body, StandardCharsets.UTF_8));`,
        `                } catch (RuntimeException e) {`,
        `                    // Malformed body: no retry can fix it — nack without`,
        `                    // requeue routes through the queue's DLX into the DLQ.`,
        `                    ch.basicNack(delivery.getDeliveryTag(), false, false);`,
        `                    CatalogLog.event(${javaLogEvent("channelDeadLettered")}, "address", address,`,
        `                            "error", "malformed envelope");`,
        `                    return;`,
        `                }`,
        `                try {`,
        `                    handler.accept(envelope);`,
        `                    ch.basicAck(delivery.getDeliveryTag(), false);`,
        `                } catch (RuntimeException e) {`,
        `                    var headers = properties.getHeaders();`,
        `                    var attempts = 1;`,
        `                    if (headers != null && headers.get("x-loom-attempts") != null) {`,
        `                        attempts = Integer.parseInt(String.valueOf(headers.get("x-loom-attempts"))) + 1;`,
        `                    }`,
        `                    if (attempts >= MAX_ATTEMPTS) {`,
        `                        // Parked, not lost: the DLX routes it into the DLQ.`,
        `                        ch.basicNack(delivery.getDeliveryTag(), false, false);`,
        `                        CatalogLog.event(${javaLogEvent("channelDeadLettered")}, "address", address,`,
        `                                "type", envelope.type(), "id", envelope.id(),`,
        `                                "attempts", String.valueOf(attempts), "error", String.valueOf(e.getMessage()));`,
        `                    } else {`,
        `                        // Bounded retry: republish with the attempt header and`,
        `                        // ack the original (immediate nack-requeue would hot-loop).`,
        `                        var retryHeaders = new HashMap<String, Object>();`,
        `                        if (headers != null) {`,
        `                            retryHeaders.putAll(headers);`,
        `                        }`,
        `                        retryHeaders.put("x-loom-attempts", attempts);`,
        `                        var props = new AMQP.BasicProperties.Builder()`,
        `                                .contentType("application/json").deliveryMode(2)`,
        `                                .headers(retryHeaders).build();`,
        `                        ch.basicPublish("loom.dlx", "loom.retry." + queue, props, body);`,
        `                        ch.basicAck(delivery.getDeliveryTag(), false);`,
        `                    }`,
        `                }`,
        `            }`,
        `        });`,
        `    }`,
        ``,
        `    @Override`,
        `    public void close() {`,
        `        closing = true;`,
        `        reconnector.shutdownNow();`,
        `        synchronized (this) {`,
        `            try {`,
        `                if (connection != null) {`,
        `                    connection.close();`,
        `                }`,
        `            } catch (Exception e) {`,
        `                // Already closed / never connected — shutdown is best-effort.`,
        `            }`,
        `        }`,
        `    }`,
        `}`,
        ``,
      ),
    );

  if (hasKafka)
    out.set(
      "KafkaChannelTransport.java",
      lines(
        `package ${pkg};`,
        ``,
        `import java.time.Duration;`,
        `import java.util.ArrayList;`,
        `import java.util.Collection;`,
        `import java.util.List;`,
        `import java.util.Properties;`,
        `import java.util.concurrent.CountDownLatch;`,
        `import java.util.concurrent.TimeUnit;`,
        `import java.util.function.Consumer;`,
        ``,
        `import org.apache.kafka.clients.admin.Admin;`,
        `import org.apache.kafka.clients.admin.NewTopic;`,
        `import org.apache.kafka.clients.consumer.ConsumerConfig;`,
        `import org.apache.kafka.clients.consumer.ConsumerRebalanceListener;`,
        `import org.apache.kafka.clients.consumer.KafkaConsumer;`,
        `import org.apache.kafka.clients.producer.KafkaProducer;`,
        `import org.apache.kafka.clients.producer.ProducerConfig;`,
        `import org.apache.kafka.clients.producer.ProducerRecord;`,
        `import org.apache.kafka.common.TopicPartition;`,
        `import org.apache.kafka.common.errors.TopicExistsException;`,
        `import org.apache.kafka.common.errors.WakeupException;`,
        `import org.apache.kafka.common.serialization.StringDeserializer;`,
        `import org.apache.kafka.common.serialization.StringSerializer;`,
        ``,
        `/** Kafka driver — kafka-clients over the log (design §4 topology): one`,
        ` *  topic per channel address (idempotently admin-created before the`,
        ` *  group join); per-partition ordering with partition key = loomkey ??`,
        ` *  envelope id; consumption always rides the deployable's consumer`,
        ` *  GROUP (broadcast across deployables, competing within).  Offsets`,
        ` *  commit after the batch's handlers resolve.  Dead-letter v1: a`,
        ` *  failed or malformed record parks onto &lt;address&gt;.dlq and the`,
        ` *  offset advances — logged and kept, never a hot-loop. */`,
        `public final class KafkaChannelTransport implements ChannelTransport {`,
        `    private final String bootstrap;`,
        `    private final String saslUser;`,
        `    private final String saslPass;`,
        `    private KafkaProducer<String, String> producer;`,
        `    private final List<KafkaConsumer<String, String>> consumers = new ArrayList<>();`,
        `    private final List<Thread> loops = new ArrayList<>();`,
        `    private volatile boolean closing;`,
        ``,
        `    public KafkaChannelTransport(String url) {`,
        `        // kafka://user:pass@host:port[,host2] — userinfo (when present)`,
        `        // becomes SASL/PLAIN; a credential-less URL stays`,
        `        // on PLAINTEXT, the pre-auth contract.`,
        `        var bare = url.startsWith("kafka://") ? url.substring("kafka://".length()) : url;`,
        `        var at = bare.lastIndexOf('@');`,
        `        if (at >= 0) {`,
        `            var userinfo = bare.substring(0, at);`,
        `            var colon = userinfo.indexOf(':');`,
        `            this.saslUser = urlDecode(colon >= 0 ? userinfo.substring(0, colon) : userinfo);`,
        `            this.saslPass = urlDecode(colon >= 0 ? userinfo.substring(colon + 1) : "");`,
        `        } else {`,
        `            this.saslUser = null;`,
        `            this.saslPass = null;`,
        `        }`,
        `        this.bootstrap = at >= 0 ? bare.substring(at + 1) : bare;`,
        `    }`,
        ``,
        `    private static String urlDecode(String s) {`,
        `        return java.net.URLDecoder.decode(s, java.nio.charset.StandardCharsets.UTF_8);`,
        `    }`,
        ``,
        `    private void applySasl(Properties props) {`,
        `        if (saslUser == null) return;`,
        `        props.put("security.protocol", "SASL_PLAINTEXT");`,
        `        props.put("sasl.mechanism", "PLAIN");`,
        `        props.put("sasl.jaas.config",`,
        `                "org.apache.kafka.common.security.plain.PlainLoginModule required username=\\""`,
        `                        + saslUser + "\\" password=\\"" + saslPass + "\\";");`,
        `    }`,
        ``,
        `    private synchronized KafkaProducer<String, String> producer() {`,
        `        if (producer == null) {`,
        `            var props = new Properties();`,
        `            props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap);`,
        `            applySasl(props);`,
        `            producer = new KafkaProducer<>(props, new StringSerializer(), new StringSerializer());`,
        `        }`,
        `        return producer;`,
        `    }`,
        ``,
        `    private void ensureTopic(String topic) {`,
        `        // Subscribing to a not-yet-produced topic stalls the group join;`,
        `        // idempotently create it (3 partitions / rf 1 — the compose`,
        `        // sidecar's defaults; an existing topic keeps its own shape).`,
        `        var props = new Properties();`,
        `        props.put("bootstrap.servers", bootstrap);`,
        `        applySasl(props);`,
        `        try (var admin = Admin.create(props)) {`,
        `            admin.createTopics(List.of(new NewTopic(topic, 3, (short) 1))).all().get();`,
        `        } catch (Exception e) {`,
        `            if (!(e.getCause() instanceof TopicExistsException)) {`,
        `                throw new IllegalStateException("kafka topic ensure failed: " + e.getMessage(), e);`,
        `            }`,
        `        }`,
        `    }`,
        ``,
        `    @Override`,
        `    public synchronized void publish(String address, LoomEventEnvelope envelope) {`,
        `        var key = envelope.loomKey() != null ? envelope.loomKey() : envelope.id();`,
        `        try {`,
        `            producer().send(new ProducerRecord<>(address, key, envelope.toJson())).get();`,
        `        } catch (InterruptedException e) {`,
        `            Thread.currentThread().interrupt();`,
        `            throw new IllegalStateException("kafka publish interrupted", e);`,
        `        } catch (Exception e) {`,
        `            throw new IllegalStateException("kafka publish failed: " + e.getMessage(), e);`,
        `        }`,
        `    }`,
        ``,
        `    private void park(String address, String key, String raw) {`,
        `        try {`,
        `            producer().send(new ProducerRecord<>(address + ".dlq", key, raw)).get();`,
        `        } catch (InterruptedException e) {`,
        `            Thread.currentThread().interrupt();`,
        `        } catch (Exception e) {`,
        `            CatalogLog.event(${javaLogEvent("channelConsumeFailed")}, "address", address,`,
        `                    "error", "dlq park failed: " + e.getMessage());`,
        `        }`,
        `    }`,
        ``,
        `    @Override`,
        `    public void subscribe(String address, String group, Consumer<LoomEventEnvelope> handler) {`,
        `        subscribe(address, group, false, handler);`,
        `    }`,
        ``,
        `    @Override`,
        `    public synchronized void subscribe(String address, String group, boolean fromBeginning,`,
        `            Consumer<LoomEventEnvelope> handler) {`,
        `        ensureTopic(address);`,
        `        var props = new Properties();`,
        `        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap);`,
        `        props.put(ConsumerConfig.GROUP_ID_CONFIG, group != null ? group : address);`,
        `        props.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false");`,
        `        // A NEW group's start offset (D3): a work-queue channel starts at`,
        `        // the earliest offset so events published before the group's`,
        `        // first join are not lost; a log channel starts at the latest.`,
        `        // A group with committed offsets resumes from them either way.`,
        `        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, fromBeginning ? "earliest" : "latest");`,
        `        applySasl(props);`,
        `        var consumer = new KafkaConsumer<>(props, new StringDeserializer(), new StringDeserializer());`,
        `        // Counted down by the rebalance callback — see the await at the`,
        `        // end of this method for why the group JOIN, not the subscribe`,
        `        // call, is what "subscribed" has to mean on kafka.`,
        `        var assigned = new CountDownLatch(1);`,
        `        consumer.subscribe(List.of(address), new ConsumerRebalanceListener() {`,
        `            @Override`,
        `            public void onPartitionsRevoked(Collection<TopicPartition> partitions) {`,
        `            }`,
        ``,
        `            @Override`,
        `            public void onPartitionsAssigned(Collection<TopicPartition> partitions) {`,
        `                assigned.countDown();`,
        `            }`,
        `        });`,
        `        consumers.add(consumer);`,
        `        var loop = new Thread(() -> {`,
        `            try {`,
        `                while (!closing) {`,
        `                    var records = consumer.poll(Duration.ofMillis(500));`,
        `                    for (var record : records) {`,
        `                        LoomEventEnvelope envelope;`,
        `                        try {`,
        `                            envelope = LoomEventEnvelope.fromJson(record.value());`,
        `                        } catch (RuntimeException e) {`,
        `                            // Malformed record: park + advance (v1 log + park).`,
        `                            park(address, record.key(), record.value());`,
        `                            CatalogLog.event(${javaLogEvent("channelDeadLettered")}, "address", address,`,
        `                                    "error", "malformed envelope");`,
        `                            continue;`,
        `                        }`,
        `                        try {`,
        `                            handler.accept(envelope);`,
        `                        } catch (RuntimeException e) {`,
        `                            // v1 log + park: keep the partition moving (a raw`,
        `                            // retry would stall every record behind this one).`,
        `                            park(address, record.key(), record.value());`,
        `                            CatalogLog.event(${javaLogEvent("channelDeadLettered")}, "address", address,`,
        `                                    "type", envelope.type(), "id", envelope.id(),`,
        `                                    "error", String.valueOf(e.getMessage()));`,
        `                        }`,
        `                    }`,
        `                    // Offsets commit after the batch's handlers resolved (or`,
        `                    // parked) — at-least-once with the envelope id as the`,
        `                    // consumer-side dedup key.`,
        `                    if (!records.isEmpty()) {`,
        `                        consumer.commitSync();`,
        `                    }`,
        `                }`,
        `            } catch (WakeupException e) {`,
        `                // close() woke the poll — the shutdown path.`,
        `            } finally {`,
        `                consumer.close();`,
        `            }`,
        `        }, "loom-kafka-" + (group != null ? group : address));`,
        `        loop.setDaemon(true);`,
        `        loop.start();`,
        `        loops.add(loop);`,
        `        // Block until the group has ASSIGNED us partitions, not merely`,
        `        // until subscribe() returned.  subscribe() only records the`,
        `        // intent; the join happens on the first poll(), inside the loop`,
        `        // above.  A replica that reports ready before its join lands`,
        `        // makes the group rebalance mid-flight, and a rebalance moves`,
        `        // partitions between replicas — which splits a partition key's`,
        `        // events across two consumers and breaks the same-replica`,
        `        // ordering guarantee the key exists to give.  Bounded: a broker`,
        `        // that never assigns must not wedge boot, and the loop keeps`,
        `        // retrying either way.`,
        `        try {`,
        `            if (!assigned.await(30, TimeUnit.SECONDS)) {`,
        `                CatalogLog.event(${javaLogEvent("channelSubscribeSlow")}, "address", address,`,
        `                        "error", "no partition assignment within 30s");`,
        `            }`,
        `        } catch (InterruptedException e) {`,
        `            Thread.currentThread().interrupt();`,
        `        }`,
        `    }`,
        ``,
        `    @Override`,
        `    public synchronized void close() {`,
        `        closing = true;`,
        `        for (var consumer : consumers) {`,
        `            consumer.wakeup();`,
        `        }`,
        `        for (var loop : loops) {`,
        `            try {`,
        `                loop.join(5000);`,
        `            } catch (InterruptedException e) {`,
        `                Thread.currentThread().interrupt();`,
        `            }`,
        `        }`,
        `        if (producer != null) {`,
        `            producer.close();`,
        `        }`,
        `    }`,
        `}`,
        ``,
      ),
    );

  out.set(
    "ChannelBindings.java",
    lines(
      `package ${pkg};`,
      ``,
      `import java.util.List;`,
      `import java.util.Map;`,
      ``,
      `/** The deployable's wired broker bindings (connection URL injected by`,
      ` *  compose/k8s as LOOM_CHANNEL_&lt;NAME&gt;_URL; \`group\` is the durable`,
      ` *  queue the deployable's replicas COMPETE on for \`queue\` channels) +`,
      ` *  the event-type → address routing (first carrying broker-bound channel`,
      ` *  — mirrors the in-process dispatcher's routing rule).  Ephemeral`,
      ` *  events publish inline in the tee; durable (\`work\`) events pass`,
      ` *  through the outbox and publish on relay drain (design §5). */`,
      `public final class ChannelBindings {`,
      hasKafka
        ? `    public record Binding(String csName, String address, String envVar, String context,`
        : `    public record Binding(String csName, String address, String envVar, String context,`,
      hasKafka
        ? `            String transport, String group, boolean queue, String key, boolean fromBeginning) {`
        : `            String transport, String group, boolean queue) {`,
      `    }`,
      ``,
      `    public static final List<Binding> ALL = List.of(`,
      unique
        .map(
          (b) =>
            `            new Binding(${JSON.stringify(b.csName)}, ${JSON.stringify(b.address)}, ${JSON.stringify(b.envVar)}, ${JSON.stringify(b.contextName)}, ${JSON.stringify(b.transport)}, ${JSON.stringify(b.group)}, ${b.delivery === "queue"}${hasKafka ? `, ${b.key === undefined ? "null" : JSON.stringify(b.key)}, ${kafkaStartsAtEarliest(b)}` : ""})`,
        )
        .join(",\n") + ");",
      ``,
      `    public static final Map<String, String> ROUTING = Map.ofEntries(`,
      [...routing.entries()]
        .map(
          ([ev, addr]) => `            Map.entry(${JSON.stringify(ev)}, ${JSON.stringify(addr)})`,
        )
        .join(",\n") + ");",
      ``,
      `    public static final Map<String, String> DURABLE_ROUTING = Map.ofEntries(`,
      [...durableRouting.entries()]
        .map(
          ([ev, addr]) => `            Map.entry(${JSON.stringify(ev)}, ${JSON.stringify(addr)})`,
        )
        .join(",\n") + ");",
      ``,
      `    private ChannelBindings() {`,
      `    }`,
      `}`,
      ``,
    ),
  );

  const toArms = carried.map((ev) => {
    const puts = ev.fields.map(
      (f) =>
        `                m.put(${JSON.stringify(f.name)}, ${toDataExpr(`e.${jid(f.name)}()`, f.type, voEncode)});`,
    );
    return [
      `            case ${ev.name} e -> {`,
      `                var m = new LinkedHashMap<String, Object>();`,
      ...puts,
      `                yield m;`,
      `            }`,
    ].join("\n");
  });
  const fromArms = carried.map(
    (ev) =>
      `            case ${JSON.stringify(ev.name)} -> new ${ev.name}(${ev.fields
        .map((f) => fromDataExpr(f.name, f.type, vos))
        .join(", ")});`,
  );
  // Rendered before the header: a helper body can reach a nested VO, and
  // `voEncode.used` (every VO the codec names) decides the package import.
  const voEncoders = renderVoEncoders(voEncode);
  out.set(
    "ChannelCodec.java",
    lines(
      `package ${pkg};`,
      ``,
      `import java.util.LinkedHashMap;`,
      `import java.util.Map;`,
      ``,
      `import ${basePkg}.domain.enums.*;`,
      `import ${basePkg}.domain.events.*;`,
      `import ${basePkg}.domain.ids.*;`,
      voEncode.used.size > 0 ? `import ${basePkg}.domain.valueobjects.*;` : null,
      ``,
      `/** Per-event envelope-data codec over the DSL field names — wire parity`,
      ` *  with the Hono/Python/.NET drivers (datetimes as ISO-8601 round-trip`,
      ` *  strings, money as decimal strings, ids by string form). */`,
      `public final class ChannelCodec {`,
      `    public static Map<String, Object> toData(DomainEvent ev) {`,
      `        return switch (ev) {`,
      ...toArms,
      `            default -> throw new IllegalStateException(`,
      `                    "event not carried by a wired channel: " + ev.getClass().getSimpleName());`,
      `        };`,
      `    }`,
      ``,
      `    public static DomainEvent fromData(String eventType, Map<String, Object> data) {`,
      `        return switch (eventType) {`,
      ...fromArms,
      `            default -> throw new IllegalStateException("unknown carried event type: " + eventType);`,
      `        };`,
      `    }`,
      ...voEncoders,
      ``,
      `    private ChannelCodec() {`,
      `    }`,
      `}`,
      ``,
    ),
  );

  out.set(
    "ChannelTransports.java",
    lines(
      `package ${pkg};`,
      ``,
      `import java.util.HashMap;`,
      `import java.util.HashSet;`,
      ``,
      `import jakarta.annotation.PreDestroy;`,
      `import org.springframework.stereotype.Component;`,
      ``,
      `/** One shared transport per broker URL for the process (publisher tee +`,
      ` *  consumer loop reuse the same connections), keyed by channelSource`,
      ` *  name.  Closed on context shutdown. */`,
      `@Component`,
      `public class ChannelTransports {`,
      `    private final HashMap<String, ChannelTransport> byCsName = new HashMap<>();`,
      ``,
      `    public ChannelTransports() {`,
      `        var byUrl = new HashMap<String, ChannelTransport>();`,
      `        for (var binding : ChannelBindings.ALL) {`,
      `            var url = System.getenv(binding.envVar());`,
      `            if (url == null || url.isEmpty()) {`,
      `                throw new IllegalStateException("channel binding '" + binding.csName()`,
      `                        + "' needs " + binding.envVar() + " (the broker URL compose/k8s injects)");`,
      `            }`,
      transportPickLine(hasRedis, hasRabbit, hasKafka),
      `        }`,
      `    }`,
      ``,
      `    public ChannelTransport forSource(String csName) {`,
      `        return byCsName.get(csName);`,
      `    }`,
      ``,
      `    public ChannelTransport forAddress(String address) {`,
      `        for (var b : ChannelBindings.ALL) {`,
      `            if (b.address().equals(address)) {`,
      `                return byCsName.get(b.csName());`,
      `            }`,
      `        }`,
      `        throw new IllegalStateException("no transport wired for channel address " + address);`,
      `    }`,
      ``,
      `    @PreDestroy`,
      `    public void close() {`,
      `        for (var transport : new HashSet<>(byCsName.values())) {`,
      `            transport.close();`,
      `        }`,
      `    }`,
      `}`,
      ``,
    ),
  );

  out.set(
    "ChannelEnvelopes.java",
    lines(
      `package ${pkg};`,
      ``,
      `import java.time.Instant;`,
      `import java.util.Map;`,
      `import java.util.concurrent.atomic.AtomicLong;`,
      ``,
      carriesOrigin ? `import ${basePkg}.auth.User;` : null,
      carriesOrigin ? `` : null,
      `/** Envelope construction shared by the inline tee and the outbox relay`,
      ` *  publisher.  Relay-published (durable) events pass their outbox row`,
      ` *  id — the stable consumer-side idempotency key; inline (ephemeral)`,
      ` *  publishes mint a process-local one. */`,
      `public final class ChannelEnvelopes {`,
      `    private static final AtomicLong COUNTER = new AtomicLong();`,
      ``,
      `    public static LoomEventEnvelope forData(String type, Map<String, Object> data,`,
      `            String address, String eventId) {`,
      `        ChannelBindings.Binding bound = null;`,
      `        for (var b : ChannelBindings.ALL) {`,
      `            if (b.address().equals(address)) {`,
      `                bound = b;`,
      `                break;`,
      `            }`,
      `        }`,
      `        if (bound == null) {`,
      `            throw new IllegalStateException("no transport wired for channel address " + address);`,
      `        }`,
      `        var id = eventId != null ? eventId`,
      `                : Long.toHexString(System.currentTimeMillis()) + "-"`,
      `                        + Long.toHexString(ProcessHandle.current().pid()) + "-"`,
      `                        + Long.toHexString(COUNTER.incrementAndGet());`,
      ...(carriesOrigin
        ? [
            `        // The raising thread's event origin (ruling D1).`,
            `        var origin = User.currentEventOrigin();`,
          ]
        : []),
      ...(hasKafka
        ? [
            `        // The channel's key: field value rides as loomkey — kafka's`,
            `        // partition key (design §4), so one aggregate's events keep order.`,
            `        String loomKey = null;`,
            `        if (bound.key() != null && data.get(bound.key()) != null) {`,
            `            loomKey = String.valueOf(data.get(bound.key()));`,
            `        }`,
            `        return new LoomEventEnvelope("1.0", id, bound.context() + "." + type,`,
            `                "/loom/" + bound.context(), ${javaEnvelopeInstant("Instant.now()")}, "application/json",`,
            `                address, loomKey, ${carriesOrigin ? "origin == null ? null : origin.tenant(),\n                origin == null ? null : origin.causedBy(), " : ""}data);`,
          ]
        : [
            `        return new LoomEventEnvelope("1.0", id, bound.context() + "." + type,`,
            `                "/loom/" + bound.context(), ${javaEnvelopeInstant("Instant.now()")}, "application/json",`,
            `                address, ${carriesOrigin ? "origin == null ? null : origin.tenant(),\n                origin == null ? null : origin.causedBy(), " : ""}data);`,
          ]),
      `    }`,
      ``,
      `    private ChannelEnvelopes() {`,
      `    }`,
      `}`,
      ``,
    ),
  );

  out.set(
    "ChannelPublishTee.java",
    lines(
      `package ${pkg};`,
      ``,
      `import org.springframework.context.event.EventListener;`,
      `import org.springframework.stereotype.Component;`,
      ``,
      `import ${basePkg}.domain.events.DomainEvent;`,
      opts.durableBroker ? `import ${opts.outboxEntityPkg}.LoomOutboxMessage;` : null,
      opts.durableBroker ? `import ${opts.outboxRepoPkg}.LoomOutboxRepository;` : null,
      opts.durableBroker && carriesOrigin ? `import ${basePkg}.auth.EventOrigin;` : null,
      ``,
      `/** Producer tee — the delivery-uniformity rule (design §4): an event`,
      ` *  carried by a broker-bound channel is PUBLISHED and not fanned out`,
      ` *  locally (its dispatcher handlers drop their local @EventListener);`,
      ` *  co-located consumers receive it through their subscription exactly`,
      ` *  like remote ones.  Events on no broker-bound channel are ignored here`,
      ` *  — Spring's local fan-out already reaches their listeners.`,
      ...(opts.durableBroker
        ? [
            ` *`,
            ` *  Durable (\`work\`) events land in __loom_outbox instead (design §5):`,
            ` *  this listener runs inside the service's @Transactional write, so`,
            ` *  the row commits atomically with the aggregate change; the`,
            ` *  OutboxRelayService publishes on drain. */`,
          ]
        : [` */`]),
      `@Component`,
      `public class ChannelPublishTee {`,
      `    private final ChannelTransports transports;`,
      opts.durableBroker ? `    private final LoomOutboxRepository outbox;` : null,
      ``,
      opts.durableBroker
        ? `    public ChannelPublishTee(ChannelTransports transports, LoomOutboxRepository outbox) {`
        : `    public ChannelPublishTee(ChannelTransports transports) {`,
      `        this.transports = transports;`,
      opts.durableBroker ? `        this.outbox = outbox;` : null,
      `    }`,
      ``,
      `    @EventListener`,
      `    public void on(DomainEvent event) {`,
      `        var type = event.getClass().getSimpleName();`,
      ...(durableRouting.size > 0
        ? opts.durableBroker
          ? [
              `        if (ChannelBindings.DURABLE_ROUTING.containsKey(type)) {`,
              `            // Design §5: durable events ride the outbox — the relay publishes.`,
              carriesOrigin
                ? `            outbox.save(new LoomOutboxMessage(type, EventOrigin.capture(ChannelCodec.toData(event))));`
                : `            outbox.save(new LoomOutboxMessage(type, ChannelCodec.toData(event)));`,
              `            return;`,
              `        }`,
            ]
          : [
              `        if (ChannelBindings.DURABLE_ROUTING.containsKey(type)) {`,
              `            // Design §5: a durable event rides its OWNING producer's outbox`,
              `            // relay — never an inline publish.`,
              `            return;`,
              `        }`,
            ]
        : []),
      `        var address = ChannelBindings.ROUTING.get(type);`,
      `        if (address == null) {`,
      `            return;`,
      `        }`,
      `        var envelope = ChannelEnvelopes.forData(type, ChannelCodec.toData(event), address, null);`,
      `        // An ephemeral channel is at-most-once and publishes after the command`,
      `        // committed: a broker that is down loses the envelope, never the`,
      `        // command's answer.`,
      `        try {`,
      `            transports.forAddress(address).publish(address, envelope);`,
      `        } catch (RuntimeException e) {`,
      `            CatalogLog.event(${javaLogEvent("channelPublishFailed")}, "address", address, "type", type, "id", envelope.id(), "error", String.valueOf(e.getMessage()));`,
      `            return;`,
      `        }`,
      `        CatalogLog.event(${javaLogEvent("channelPublished")}, "address", address, "type", type, "id", envelope.id());`,
      `    }`,
      `}`,
      ``,
    ),
  );

  if (opts.durableBroker)
    out.set(
      "ChannelRelayPublisher.java",
      lines(
        `package ${pkg};`,
        ``,
        `import java.util.Map;`,
        ``,
        `/** Design §5, the relay half of the producer split: a drained durable`,
        ` *  outbox row whose channel is broker-bound publishes here, carrying`,
        ` *  its outbox row id as the envelope id (the consumer-side idempotency`,
        ` *  key).  Rows on non-broker durable channels return false. */`,
        `public final class ChannelRelayPublisher {`,
        `    public static boolean tryPublish(ChannelTransports transports, String type,`,
        `            Map<String, Object> data, String eventId) {`,
        `        var address = ChannelBindings.DURABLE_ROUTING.get(type);`,
        `        if (address == null) {`,
        `            return false;`,
        `        }`,
        `        var envelope = ChannelEnvelopes.forData(type, data, address, eventId);`,
        `        try {`,
        `            transports.forAddress(address).publish(address, envelope);`,
        `        } catch (RuntimeException e) {`,
        `            // The relay halts its pass on this and spends no attempt.`,
        `            throw new BrokerUnavailableException(e);`,
        `        }`,
        `        CatalogLog.event(${javaLogEvent("channelPublished")}, "address", address, "type", type, "id", eventId);`,
        `        return true;`,
        `    }`,
        ``,
        `    /** A relay publish the broker could not take: the outbox relay halts its`,
        `     *  pass on it and backs off without spending the row's attempt. */`,
        `    public static final class BrokerUnavailableException extends RuntimeException {`,
        `        private static final long serialVersionUID = 1L;`,
        ``,
        `        public BrokerUnavailableException(RuntimeException cause) {`,
        `            super("broker unavailable: " + cause.getMessage(), cause);`,
        `        }`,
        `    }`,
        ``,
        `    private ChannelRelayPublisher() {`,
        `    }`,
        `}`,
        ``,
      ),
    );

  if (consumerHandlers.length > 0) {
    // One switch arm per event; each arm invokes every subscribed handler
    // method (a projection fold + a workflow reactor can share an event).
    const byEvent = new Map<string, ChannelConsumerHandler[]>();
    for (const h of consumerHandlers) {
      const list = byEvent.get(h.event) ?? [];
      list.push(h);
      byEvent.set(h.event, list);
    }
    const dispatchers = [
      ...new Map(consumerHandlers.map((h) => [h.dispatcherClass, h] as const)).values(),
    ].sort((a, b) => a.dispatcherClass.localeCompare(b.dispatcherClass));
    const arms = [...byEvent.entries()].map(([event, hs]) =>
      [
        `            case ${JSON.stringify(event)} -> {`,
        `                var e = (${event}) ChannelCodec.fromData(bare, envelope.data());`,
        ...hs.map((h) => `                ${lowerFirst(h.dispatcherClass)}.${h.method}(e);`),
        `            }`,
      ].join("\n"),
    );
    // Queue (rabbit) subscriptions ride the STRICT path — a failed dispatch
    // must propagate on the driver's delivery thread so its bounded-retry /
    // DLX-park owns it.  Broadcast (redis) subscriptions keep the logged
    // single-thread-executor path (fire-and-forget contract).
    const strictSubscribe = [
      hasKafka
        ? `            transports.forSource(binding.csName()).subscribe(binding.address(), binding.group(), binding.fromBeginning(),`
        : `            transports.forSource(binding.csName()).subscribe(binding.address(), binding.group(),`,
      `                    envelope -> {`,
      `                        dispatch(envelope);`,
      hasKafka
        ? `                        CatalogLog.event(${javaLogEvent("channelConsumed")}, "address", binding.address(),\n                                "type", envelope.type(), "id", envelope.id(),\n                                "key", String.valueOf(envelope.loomKey()));`
        : `                        CatalogLog.event(${javaLogEvent("channelConsumed")}, "address", binding.address(),\n                                "type", envelope.type(), "id", envelope.id());`,
      `                    });`,
    ];
    const loggedSubscribe = [
      `            transports.forSource(binding.csName()).subscribe(binding.address(), null,`,
      `                    envelope -> executor.submit(() -> {`,
      `                        try {`,
      `                            dispatch(envelope);`,
      `                            CatalogLog.event(${javaLogEvent("channelConsumed")}, "address", binding.address(),`,
      `                                    "type", envelope.type(), "id", envelope.id());`,
      `                        } catch (RuntimeException e) {`,
      `                            CatalogLog.event(${javaLogEvent("channelConsumeFailed")}, "address", binding.address(),`,
      `                                    "type", envelope.type(), "error", String.valueOf(e.getMessage()));`,
      `                        }`,
      `                    }));`,
    ];
    const subscribeBody =
      hasRedis && (hasRabbit || hasKafka)
        ? [
            hasKafka
              ? `            if (binding.queue() || "kafka".equals(binding.transport())) {`
              : `            if (binding.queue()) {`,
            ...strictSubscribe.map((l) => `    ${l}`),
            `            } else {`,
            ...loggedSubscribe.map((l) => `    ${l}`),
            `            }`,
          ]
        : hasRabbit || hasKafka
          ? // rabbit and kafka both dispatch strictly on the driver thread.
            strictSubscribe
          : loggedSubscribe;
    out.set(
      "ChannelConsumerService.java",
      lines(
        `package ${pkg};`,
        ``,
        `import org.springframework.context.SmartLifecycle;`,
        `import org.springframework.stereotype.Component;`,
        ``,
        ...dispatchers
          .filter((h) => h.dispatcherPkg !== pkg)
          .map((h) => `import ${h.dispatcherPkg}.${h.dispatcherClass};`),
        carriesOrigin ? `import ${basePkg}.auth.CurrentUserAccessor;` : null,
        opts.durableBroker ? `import ${basePkg}.domain.common.OutboxDelivery;` : null,
        `import ${basePkg}.domain.events.*;`,
        ``,
        `/** Consumer loop — subscribes every wired address (competing-consumer`,
        ` *  group on \`queue\` channels, broadcast otherwise) and invokes the SAME`,
        ` *  dispatcher handler methods local events would reach, so reactors and`,
        ` *  event-triggered starters run identically for local and remote events.`,
        ...(hasRabbit
          ? [
              ` *  Queue deliveries dispatch ON the driver's delivery thread so a`,
              ` *  failure propagates into its bounded-retry / DLX-park path.`,
            ]
          : []),
        ...(hasRedis
          ? [
              ` *  Broadcast handler work leaves the driver's event loop through a`,
              ` *  single-thread executor (per-connection ordering preserved).`,
            ]
          : []),
        ` */`,
        `@Component`,
        `public class ChannelConsumerService implements SmartLifecycle {`,
        `    private final ChannelTransports transports;`,
        ...dispatchers.map(
          (h) => `    private final ${h.dispatcherClass} ${lowerFirst(h.dispatcherClass)};`,
        ),
        hasRedis
          ? `    private final ${javaRef("java.util.concurrent", "ExecutorService")} executor = ${javaRef("java.util.concurrent", "Executors")}.newSingleThreadExecutor();`
          : null,
        `    private volatile boolean running;`,
        ``,
        `    public ChannelConsumerService(ChannelTransports transports${dispatchers
          .map((h) => `, ${h.dispatcherClass} ${lowerFirst(h.dispatcherClass)}`)
          .join("")}) {`,
        `        this.transports = transports;`,
        ...dispatchers.map(
          (h) =>
            `        this.${lowerFirst(h.dispatcherClass)} = ${lowerFirst(h.dispatcherClass)};`,
        ),
        `    }`,
        ``,
        ...(carriesOrigin
          ? [
              `    private void dispatch(LoomEventEnvelope envelope) {`,
              `        // The reactor runs as the system principal of the envelope's`,
              `        // event origin — the tenant that raised it (ruling D1).`,
              `        CurrentUserAccessor.runAsEventOrigin(envelope.origin(), () -> dispatchAsOrigin(envelope));`,
              `    }`,
              ``,
              `    private void dispatchAsOrigin(LoomEventEnvelope envelope) {`,
            ]
          : [`    private void dispatch(LoomEventEnvelope envelope) {`]),
        `        var bare = envelope.type().contains(".")`,
        `                ? envelope.type().substring(envelope.type().indexOf('.') + 1)`,
        `                : envelope.type();`,
        // Idempotent-consumer marker (dispatch-delivery-semantics.md §3): park
        // the envelope id (= producer's outbox row id) so hosted saga handlers
        // no-op on a redelivery of the same id.  Only where this deployable
        // hosts the durable channel's context (its state rows carry
        // last_event_id); foreign consumers keep the ack-semantics stance.
        opts.durableBroker ? `        OutboxDelivery.setCurrentEventId(envelope.id());` : null,
        opts.durableBroker ? `        try {` : null,
        `        switch (bare) {`,
        ...arms,
        `            default -> {`,
        `            }`,
        `        }`,
        opts.durableBroker ? `        } finally {` : null,
        opts.durableBroker ? `            OutboxDelivery.clear();` : null,
        opts.durableBroker ? `        }` : null,
        `    }`,
        ``,
        // Subscribe BEFORE the web server accepts traffic.  SmartLifecycle
        // beans start in ASCENDING phase order, and Spring Boot's
        // `WebServerStartStopLifecycle` sits at `Integer.MAX_VALUE - 1`; the
        // default phase for a SmartLifecycle that does not override this is
        // `Integer.MAX_VALUE`, i.e. AFTER it.  At the default we opened the
        // port — so `/ready` answered 200 — while this service had not yet
        // subscribed, and an ephemeral pub/sub envelope published in that
        // window is dropped by the broker and never redelivered.  Measured
        // on the generated app: Tomcat up at T+0ms, subscriptions live at
        // T+667ms, and a publish inside the gap NEVER arrives (vs ~1s when
        // published after it).  That was `channels-e2e-redis (java)` failing
        // intermittently with an ample 20s budget.
        `    @Override`,
        `    public int getPhase() {`,
        `        return Integer.MAX_VALUE - 2048;`,
        `    }`,
        ``,
        `    @Override`,
        `    public void start() {`,
        `        for (var binding : ChannelBindings.ALL) {`,
        ...subscribeBody,
        `        }`,
        `        running = true;`,
        `    }`,
        ``,
        `    @Override`,
        `    public void stop() {`,
        hasRedis ? `        executor.shutdown();` : null,
        `        running = false;`,
        `    }`,
        ``,
        `    @Override`,
        `    public boolean isRunning() {`,
        `        return running;`,
        `    }`,
        `}`,
        ``,
      ),
    );
  }

  return out;
}

/** The idempotent-consumer marker carrier (dispatch-delivery-semantics.md §3),
 *  the Java analogue of dotnet's `OutboxDelivery` AsyncLocal.  The
 *  ChannelConsumerService parks the received envelope's id (= the producer's
 *  outbox row id) here around each dispatch; saga handlers compare/stamp their
 *  `last_event_id` so at-least-once redelivery becomes effectively-once.  A
 *  ThreadLocal is correct: the consumer invokes handlers on its own delivery
 *  thread (the strict rabbit/kafka path) or a single-thread executor (redis).
 *  Emitted whenever a hosted context carries a durable channel. */
export function renderJavaOutboxDelivery(basePkg: string): string {
  return lines(
    `package ${basePkg}.domain.common;`,
    ``,
    `/** Ambient outbox-delivery context: the id of the outbox row being`,
    ` *  delivered, or null for inline (ephemeral) dispatch.  Saga handlers no-op`,
    ` *  when their state row already records this id (idempotent consumer —`,
    ` *  at-least-once becomes effectively-once). */`,
    `public final class OutboxDelivery {`,
    `    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();`,
    ``,
    `    private OutboxDelivery() {`,
    `    }`,
    ``,
    `    public static String currentEventId() {`,
    `        return CURRENT.get();`,
    `    }`,
    ``,
    `    public static void setCurrentEventId(String id) {`,
    `        if (id == null) {`,
    `            CURRENT.remove();`,
    `        } else {`,
    `            CURRENT.set(id);`,
    `        }`,
    `    }`,
    ``,
    `    public static void clear() {`,
    `        CURRENT.remove();`,
    `    }`,
    `}`,
    ``,
  );
}

/** The transactional-outbox tier (dispatch-delivery-
 *  semantics.md on java): the JPA entity mapped onto the MigrationsIR-owned
 *  `__loom_outbox` table, its Spring Data repository, and the polling relay
 *  that publishes drained rows to the broker (design §5; the tee in
 *  `renderJavaChannelFiles` is the recording half).  The payload stores the
 *  DSL-keyed `ChannelCodec.toData` map, so the relay builds envelopes
 *  without reconstructing event records.  Emitted only when hosted durable
 *  events ride a broker-bound channel.  The envelope carries the row id as the
 *  consumer-side idempotency key — the ChannelConsumerService parks it on
 *  `OutboxDelivery` so a saga handler no-ops on a redelivery of the same id. */
/** The outbox relays' retention settings: the purge cadence and the window
 *  read once from the environment (a missing, non-numeric or non-positive
 *  value falls back to the default). */
function javaOutboxRetentionConstants(): string[] {
  return [
    `    private static final long PURGE_INTERVAL_MS = ${OUTBOX_PURGE_INTERVAL_SECONDS * 1000};`,
    `    private static final int RETENTION_DAYS = retentionDays();`,
  ];
}

/** `retentionDays` + `maybePurge`: at most once per purge interval, delete a
 *  bounded batch of dispatched rows older than the retention window.  The
 *  timestamp advances before the delete, so a failing purge (logged by the
 *  loop's catch) costs one drain tick and is retried next interval. */
function javaOutboxPurgeMethods(pruneInbox = false): string[] {
  return [
    `    private long lastPurge = System.currentTimeMillis();`,
    ``,
    `    private static int retentionDays() {`,
    `        try {`,
    `            var days = Integer.parseInt(System.getenv().getOrDefault(${JSON.stringify(OUTBOX_RETENTION_ENV)}, "").trim());`,
    `            return days > 0 ? days : ${OUTBOX_RETENTION_DEFAULT_DAYS};`,
    `        } catch (NumberFormatException e) {`,
    `            return ${OUTBOX_RETENTION_DEFAULT_DAYS};`,
    `        }`,
    `    }`,
    ``,
    `    private void maybePurge() {`,
    `        var now = System.currentTimeMillis();`,
    `        if (now - lastPurge < PURGE_INTERVAL_MS) {`,
    `            return;`,
    `        }`,
    `        lastPurge = now;`,
    `        var cutoff = Instant.now().minusSeconds(RETENTION_DAYS * 86_400L);`,
    `        outbox.purgeDispatchedBefore(cutoff);`,
    // The fold inbox shares the window: a claim outlives every redelivery.
    ...(pruneInbox ? [`        outbox.purgeFoldInboxBefore(cutoff);`] : []),
    `    }`,
    ``,
  ];
}

export function renderJavaOutboxFiles(pkgs: {
  configPkg: string;
  entityPkg: string;
  repoPkg: string;
  /** The deployable carries auth: the relay publishes each drained row as
   *  the system principal of its recorded EVENT ORIGIN (ruling D1). */
  carriesOrigin?: boolean;
  basePkg?: string;
  /** The outbox also holds rows the LocalOutboxRelay redelivers in-process
   *  (durable events no wired binding carries): each relay takes only its own
   *  rows, so the broker relay claims the broker-routed types and the local
   *  relay the rest. */
  partitioned?: boolean;
  /** The folds claim events in the fold inbox (`foldsDedupe`): the purge
   *  prunes it on the outbox's window. */
  pruneInbox?: boolean;
}): {
  name: string;
  category: "infra-persistence" | "spring-data-repository" | "config";
  content: string;
}[] {
  return [
    {
      name: "LoomOutboxMessage.java",
      category: "infra-persistence",
      content: lines(
        `package ${pkgs.entityPkg};`,
        ``,
        `import java.time.Instant;`,
        `import java.util.Map;`,
        `import java.util.UUID;`,
        ``,
        `import org.hibernate.annotations.JdbcTypeCode;`,
        `import org.hibernate.type.SqlTypes;`,
        ``,
        `import jakarta.persistence.Column;`,
        `import jakarta.persistence.Entity;`,
        `import jakarta.persistence.Id;`,
        `import jakarta.persistence.Table;`,
        ``,
        `/** One owed durable event (dispatch-delivery-semantics.md): written by`,
        ` *  the ChannelPublishTee inside the caller's transaction, drained by`,
        ` *  the OutboxRelayService.  Maps the shared`,
        ` *  __loom_outbox table the module migrations own. */`,
        `@Entity`,
        `@Table(name = "__loom_outbox")`,
        `public class LoomOutboxMessage {`,
        `    @Id`,
        `    private UUID id = UUID.randomUUID();`,
        ``,
        `    @Column(name = "occurred_at", nullable = false)`,
        `    private Instant occurredAt = Instant.now();`,
        ``,
        `    @Column(nullable = false)`,
        `    private String type;`,
        ``,
        `    @JdbcTypeCode(SqlTypes.JSON)`,
        `    @Column(nullable = false)`,
        `    private Map<String, Object> payload;`,
        ``,
        `    @Column(name = "dispatched_at")`,
        `    private Instant dispatchedAt;`,
        ``,
        `    @Column(nullable = false)`,
        `    private int attempts;`,
        ``,
        `    @Column(name = "dead_at")`,
        `    private Instant deadAt;`,
        ``,
        `    protected LoomOutboxMessage() {`,
        `    }`,
        ``,
        `    public LoomOutboxMessage(String type, Map<String, Object> payload) {`,
        `        this.type = type;`,
        `        this.payload = payload;`,
        `    }`,
        ``,
        `    public UUID getId() {`,
        `        return id;`,
        `    }`,
        ``,
        `    public String getType() {`,
        `        return type;`,
        `    }`,
        ``,
        `    public Map<String, Object> getPayload() {`,
        `        return payload;`,
        `    }`,
        ``,
        `    public int getAttempts() {`,
        `        return attempts;`,
        `    }`,
        ``,
        `    public void setAttempts(int attempts) {`,
        `        this.attempts = attempts;`,
        `    }`,
        ``,
        `    public void setDispatchedAt(Instant dispatchedAt) {`,
        `        this.dispatchedAt = dispatchedAt;`,
        `    }`,
        ``,
        `    public void setDeadAt(Instant deadAt) {`,
        `        this.deadAt = deadAt;`,
        `    }`,
        `}`,
        ``,
      ),
    },
    {
      name: "LoomOutboxRepository.java",
      category: "spring-data-repository",
      content: lines(
        `package ${pkgs.repoPkg};`,
        ``,
        `import java.time.Instant;`,
        `import java.util.List;`,
        `import java.util.UUID;`,
        ``,
        `import org.springframework.data.jpa.repository.JpaRepository;`,
        `import org.springframework.data.jpa.repository.Modifying;`,
        `import org.springframework.data.jpa.repository.Query;`,
        `import org.springframework.data.repository.query.Param;`,
        `import org.springframework.transaction.annotation.Transactional;`,
        ``,
        `import ${pkgs.entityPkg}.LoomOutboxMessage;`,
        ``,
        `public interface LoomOutboxRepository extends JpaRepository<LoomOutboxMessage, UUID> {`,
        `    /** The pending rows: neither dispatched nor dead-lettered. */`,
        `    List<LoomOutboxMessage> findTop${OUTBOX_RELAY.batchSize}ByDispatchedAtIsNullAndDeadAtIsNullOrderByOccurredAtAsc();`,
        ``,
        `    /** The pending rows a relay pass claims: locked for the pass's`,
        `     *  transaction, skipping rows another relay holds. */`,
        `    @Query(value = "SELECT * FROM __loom_outbox WHERE ${OUTBOX_PENDING_PREDICATE} ORDER BY occurred_at LIMIT ${OUTBOX_RELAY.batchSize} ${OUTBOX_RELAY.claimLock}", nativeQuery = true)`,
        `    List<LoomOutboxMessage> claimPending();`,
        ``,
        ...(pkgs.partitioned
          ? [
              `    /** {@link #claimPending()} restricted to the given event types. */`,
              `    @Query(value = "SELECT * FROM __loom_outbox WHERE ${OUTBOX_PENDING_PREDICATE} AND type IN (:types) ORDER BY occurred_at LIMIT ${OUTBOX_RELAY.batchSize} ${OUTBOX_RELAY.claimLock}", nativeQuery = true)`,
              `    List<LoomOutboxMessage> claimPendingOfTypes(@Param("types") java.util.Collection<String> types);`,
              ``,
              `    /** The pending rows of the given event types. */`,
              `    List<LoomOutboxMessage> findTop${OUTBOX_RELAY.batchSize}ByDispatchedAtIsNullAndDeadAtIsNullAndTypeInOrderByOccurredAtAsc(java.util.Collection<String> types);`,
              ``,
            ]
          : []),
        `    /** Retention: delete a bounded batch of rows dispatched before the`,
        `     *  cutoff.  Dead rows are never dispatched, so they are never purged. */`,
        `    @Modifying`,
        `    @Transactional`,
        `    @Query(value = "DELETE FROM __loom_outbox WHERE id IN (SELECT id FROM __loom_outbox WHERE dispatched_at < :cutoff LIMIT ${OUTBOX_PURGE_BATCH})", nativeQuery = true)`,
        `    int purgeDispatchedBefore(@Param("cutoff") Instant cutoff);`,
        ...(pkgs.pruneInbox
          ? [
              ``,
              `    @Modifying`,
              `    @Transactional`,
              `    @Query(value = ${JSON.stringify(foldInboxPurgeSql(":cutoff"))}, nativeQuery = true)`,
              `    int purgeFoldInboxBefore(@Param("cutoff") Instant cutoff);`,
            ]
          : []),
        `}`,
        ``,
      ),
    },
    {
      name: "OutboxRelayService.java",
      category: "config",
      content: lines(
        `package ${pkgs.configPkg};`,
        ``,
        `import java.time.Instant;`,
        `import java.util.concurrent.ExecutorService;`,
        `import java.util.concurrent.Executors;`,
        ``,
        `import org.springframework.context.SmartLifecycle;`,
        `import org.springframework.stereotype.Component;`,
        `import org.springframework.transaction.support.TransactionTemplate;`,
        ``,
        pkgs.carriesOrigin ? `import ${pkgs.basePkg}.auth.CurrentUserAccessor;` : null,
        pkgs.carriesOrigin ? `import ${pkgs.basePkg}.auth.EventOrigin;` : null,
        `import ${pkgs.repoPkg}.LoomOutboxRepository;`,
        ``,
        `/** Drains __loom_outbox to the broker at-least-once (design §5) —`,
        ` *  consumers must tolerate redelivery; the envelope carries the row id`,
        ` *  as the idempotency key.  A row that exhausts MAX_ATTEMPTS is`,
        ` *  stamped dead_at (it leaves the poll) and logs event_dead_lettered once.  Handlers for broker-routed`,
        ` *  events are invoked by the ChannelConsumerService on delivery, never`,
        ` *  locally (§4 delivery uniformity). */`,
        `@Component`,
        `public class OutboxRelayService implements SmartLifecycle {`,
        `    private static final int MAX_ATTEMPTS = ${OUTBOX_RELAY.maxAttempts};`,
        `    private static final long INTERVAL_MS = ${OUTBOX_RELAY.intervalMs};`,
        ...javaOutboxRetentionConstants(),
        ``,
        `    private final LoomOutboxRepository outbox;`,
        `    private final ChannelTransports transports;`,
        `    private final TransactionTemplate claim;`,
        `    private final ExecutorService executor = Executors.newSingleThreadExecutor();`,
        `    private volatile boolean running;`,
        ``,
        `    public OutboxRelayService(LoomOutboxRepository outbox, ChannelTransports transports,`,
        `            TransactionTemplate claim) {`,
        `        this.outbox = outbox;`,
        `        this.transports = transports;`,
        `        this.claim = claim;`,
        `    }`,
        ``,
        `    @Override`,
        `    public void start() {`,
        `        running = true;`,
        ...javaRelayLoop(),
        `    }`,
        ``,
        ...javaOutboxPurgeMethods(pkgs.pruneInbox),
        `    /** One pass: claims its batch inside one transaction (the rows it`,
        `     *  takes are locked, rows another relay holds are skipped), so`,
        `     *  competing replicas never publish the same row. */`,
        `    private void drain() {`,
        `        var halted = claim.execute(status -> claimAndPublish());`,
        `        if (halted != null) {`,
        `            throw halted;`,
        `        }`,
        `    }`,
        ``,
        `    private RuntimeException claimAndPublish() {`,
        pkgs.partitioned
          ? `        var rows = outbox.claimPendingOfTypes(ChannelBindings.DURABLE_ROUTING.keySet());`
          : `        var rows = outbox.claimPending();`,
        `        for (var row : rows) {`,
        `            try {`,
        `                // Design §5: broker-bound durable rows publish on drain (the`,
        `                // envelope carries the row id — the consumer-side idempotency`,
        `                // key).  A non-broker durable row has no local redelivery path`,
        `                // on java; either way the row completes.`,
        ...(pkgs.carriesOrigin
          ? [
              `                CurrentUserAccessor.runAsEventOrigin(EventOrigin.of(row.getPayload()),`,
              `                        () -> ChannelRelayPublisher.tryPublish(transports, row.getType(),`,
              `                                EventOrigin.strip(row.getPayload()), row.getId().toString()));`,
            ]
          : [
              `                ChannelRelayPublisher.tryPublish(transports, row.getType(), row.getPayload(),`,
              `                        row.getId().toString());`,
            ]),
        `                row.setDispatchedAt(Instant.now());`,
        `                outbox.save(row);`,
        `            } catch (ChannelRelayPublisher.BrokerUnavailableException e) {`,
        `                // Commit the rows already published; the pass halts here.`,
        `                return e;`,
        `            } catch (RuntimeException e) {`,
        `                row.setAttempts(row.getAttempts() + 1);`,
        `                var dead = row.getAttempts() >= MAX_ATTEMPTS;`,
        `                if (dead) {`,
        `                    row.setDeadAt(Instant.now());`,
        `                }`,
        `                outbox.save(row);`,
        `                if (dead) {`,
        `                    CatalogLog.event(${javaLogEvent("eventDeadLettered")}, "id", row.getId().toString(),`,
        `                            "type", row.getType(),`,
        `                            "attempts", String.valueOf(row.getAttempts()),`,
        `                            "error", String.valueOf(e.getMessage()));`,
        `                }`,
        `            }`,
        `        }`,
        `        return null;`,
        `    }`,
        ``,
        `    @Override`,
        `    public void stop() {`,
        `        running = false;`,
        `        executor.shutdown();`,
        `    }`,
        ``,
        `    @Override`,
        `    public boolean isRunning() {`,
        `        return running;`,
        `    }`,
        `}`,
        ``,
      ),
    },
  ];
}

/** The STANDALONE (no-broker) transactional-outbox tier
 *  (dispatch-delivery-semantics.md §1-2): the Java analogue of node's
 *  `createOutboxDispatcher`/`startOutboxRelay`.  A durable (`retention: log |
 *  work`) channel with NO `channelSource` broker still gets crash-safe delivery:
 *
 *   - `LoomEventOutbox` (@EventListener) records a durable domain event in
 *     `__loom_outbox` inside the producer's @Transactional write (so it commits
 *     atomically) instead of it being fanned out inline — closing the crash
 *     window.  The payload is a generic Jackson map (the row round-trips
 *     java→db→java only, so no bespoke wire codec is needed).  Ephemeral events
 *     are ignored here — Spring's local fan-out already reaches their listeners.
 *   - the reactor handlers for these events DROP their inline @EventListener
 *     (DispatchCtx.localDurableEvents), so the ONLY delivery is post-commit.
 *   - `LocalOutboxRelay` (SmartLifecycle poll loop) drains undispatched rows,
 *     reconstructs the event, and INVOKES the reactor methods directly
 *     (at-least-once — the row id rides `OutboxDelivery` so the saga marker
 *     no-ops on redelivery).  A reactor's own durable emit re-enters the bus →
 *     the tee → the next drain, so choreography chains ride the outbox.
 *
 *  Emitted whenever a hosted durable event rides no broker.  On a deployable
 *  that also relays broker-routed durable events, the two relays partition the
 *  table by event type (`partitioned`), so each row has exactly one relay. */
export function renderJavaStandaloneOutboxFiles(
  basePkg: string,
  opts: {
    durableEvents: string[];
    handlers: ChannelConsumerHandler[];
    configPkg: string;
    entityPkg: string;
    repoPkg: string;
    /** The deployable carries auth: rows record the EVENT ORIGIN and the
     *  relay delivers each as its system principal (ruling D1). */
    carriesOrigin?: boolean;
    /** A broker relay drains the broker-routed rows of the same table: the
     *  local relay takes only the `DURABLE` types this tee records. */
    partitioned?: boolean;
    /** See `renderJavaOutboxFiles`. */
    pruneInbox?: boolean;
  },
): { name: string; category: "config"; content: string }[] {
  const carriesOrigin = opts.carriesOrigin ?? false;
  const durable = [...opts.durableEvents].sort();
  const byEvent = new Map<string, ChannelConsumerHandler[]>();
  for (const h of opts.handlers) {
    const list = byEvent.get(h.event) ?? [];
    list.push(h);
    byEvent.set(h.event, list);
  }
  const dispatchers = [
    ...new Map(opts.handlers.map((h) => [h.dispatcherClass, h] as const)).values(),
  ].sort((a, b) => a.dispatcherClass.localeCompare(b.dispatcherClass));
  const arms = [...byEvent.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([event, hs]) =>
      [
        `            case ${JSON.stringify(event)} -> {`,
        `                var e = mapper.convertValue(payload, ${event}.class);`,
        ...hs.map((h) => `                ${lowerFirst(h.dispatcherClass)}.${h.method}(e);`),
        `            }`,
      ].join("\n"),
    );
  return [
    {
      name: "LoomEventOutbox.java",
      category: "config",
      content: lines(
        `package ${opts.configPkg};`,
        ``,
        `import java.util.Map;`,
        `import java.util.Set;`,
        ``,
        `import org.springframework.context.event.EventListener;`,
        `import org.springframework.stereotype.Component;`,
        ``,
        `import tools.jackson.databind.ObjectMapper;`,
        `import tools.jackson.databind.json.JsonMapper;`,
        ``,
        carriesOrigin ? `import ${basePkg}.auth.EventOrigin;` : null,
        `import ${basePkg}.domain.events.DomainEvent;`,
        `import ${opts.entityPkg}.LoomOutboxMessage;`,
        `import ${opts.repoPkg}.LoomOutboxRepository;`,
        ``,
        `/** Standalone transactional-outbox tee (dispatch-delivery-semantics.md §1):`,
        ` *  a durable domain event is recorded in __loom_outbox inside the producer's`,
        ` *  @Transactional write instead of being fanned out inline; LocalOutboxRelay`,
        ` *  redelivers it post-commit.  Ephemeral events keep Spring's local fan-out. */`,
        `@Component`,
        `public class LoomEventOutbox {`,
        `    ${opts.partitioned ? "static" : "private static"} final Set<String> DURABLE = Set.of(${durable
          .map((t) => JSON.stringify(t))
          .join(", ")});`,
        ``,
        `    private final LoomOutboxRepository outbox;`,
        `    // Self-constructed (no ObjectMapper bean in the generated context); the`,
        `    // row round-trips java→db→java with this same mapper, so the format is`,
        `    // internal.  findAndAddModules() picks up jsr310 (datetimes).`,
        `    private final ObjectMapper mapper = JsonMapper.builder().findAndAddModules().build();`,
        ``,
        `    public LoomEventOutbox(LoomOutboxRepository outbox) {`,
        `        this.outbox = outbox;`,
        `    }`,
        ``,
        `    @EventListener`,
        `    public void on(DomainEvent event) {`,
        `        var type = event.getClass().getSimpleName();`,
        `        if (!DURABLE.contains(type)) {`,
        `            return;`,
        `        }`,
        `        @SuppressWarnings("unchecked")`,
        `        var payload = (Map<String, Object>) mapper.convertValue(event, Map.class);`,
        carriesOrigin
          ? `        outbox.save(new LoomOutboxMessage(type, EventOrigin.capture(payload)));`
          : `        outbox.save(new LoomOutboxMessage(type, payload));`,
        `    }`,
        `}`,
        ``,
      ),
    },
    {
      name: "LocalOutboxRelay.java",
      category: "config",
      content: lines(
        `package ${opts.configPkg};`,
        ``,
        `import java.time.Instant;`,
        `import java.util.Map;`,
        `import java.util.concurrent.ExecutorService;`,
        `import java.util.concurrent.Executors;`,
        ``,
        `import org.springframework.context.SmartLifecycle;`,
        `import org.springframework.stereotype.Component;`,
        ``,
        `import tools.jackson.databind.ObjectMapper;`,
        `import tools.jackson.databind.json.JsonMapper;`,
        ``,
        carriesOrigin ? `import ${basePkg}.auth.CurrentUserAccessor;` : null,
        carriesOrigin ? `import ${basePkg}.auth.EventOrigin;` : null,
        `import ${basePkg}.domain.common.OutboxDelivery;`,
        `import ${basePkg}.domain.events.*;`,
        `import ${opts.repoPkg}.LoomOutboxRepository;`,
        ...dispatchers
          .filter((h) => h.dispatcherPkg !== opts.configPkg)
          .map((h) => `import ${h.dispatcherPkg}.${h.dispatcherClass};`),
        ``,
        `/** Drains __loom_outbox to the LOCAL reactors at-least-once`,
        ` *  (dispatch-delivery-semantics.md §2): the row id rides OutboxDelivery so a`,
        ` *  saga handler no-ops on a redelivery.  A row that exhausts MAX_ATTEMPTS is`,
        ` *  stamped dead_at and logs event_dead_lettered once.  The reactor methods are`,
        ` *  invoked directly (not via the bus), so the tee never re-records them. */`,
        `@Component`,
        `public class LocalOutboxRelay implements SmartLifecycle {`,
        `    private static final int MAX_ATTEMPTS = ${OUTBOX_RELAY.maxAttempts};`,
        `    private static final long INTERVAL_MS = ${OUTBOX_RELAY.intervalMs};`,
        ...javaOutboxRetentionConstants(),
        ``,
        `    private final LoomOutboxRepository outbox;`,
        `    private final ObjectMapper mapper = JsonMapper.builder().findAndAddModules().build();`,
        ...dispatchers.map(
          (h) => `    private final ${h.dispatcherClass} ${lowerFirst(h.dispatcherClass)};`,
        ),
        `    private final ExecutorService executor = Executors.newSingleThreadExecutor();`,
        `    private volatile boolean running;`,
        ``,
        `    public LocalOutboxRelay(LoomOutboxRepository outbox${dispatchers
          .map((h) => `, ${h.dispatcherClass} ${lowerFirst(h.dispatcherClass)}`)
          .join("")}) {`,
        `        this.outbox = outbox;`,
        ...dispatchers.map(
          (h) =>
            `        this.${lowerFirst(h.dispatcherClass)} = ${lowerFirst(h.dispatcherClass)};`,
        ),
        `    }`,
        ``,
        `    @Override`,
        `    public void start() {`,
        `        running = true;`,
        ...javaRelayLoop(),
        `    }`,
        ``,
        ...javaOutboxPurgeMethods(opts.pruneInbox),
        `    private void drain() {`,
        opts.partitioned
          ? `        var rows = outbox.findTop${OUTBOX_RELAY.batchSize}ByDispatchedAtIsNullAndDeadAtIsNullAndTypeInOrderByOccurredAtAsc(LoomEventOutbox.DURABLE);`
          : `        var rows = outbox.findTop${OUTBOX_RELAY.batchSize}ByDispatchedAtIsNullAndDeadAtIsNullOrderByOccurredAtAsc();`,
        `        for (var row : rows) {`,
        `            try {`,
        `                OutboxDelivery.setCurrentEventId(row.getId().toString());`,
        `                try {`,
        carriesOrigin
          ? `                    CurrentUserAccessor.runAsEventOrigin(EventOrigin.of(row.getPayload()),\n                            () -> deliver(row.getType(), EventOrigin.strip(row.getPayload())));`
          : `                    deliver(row.getType(), row.getPayload());`,
        `                } finally {`,
        `                    OutboxDelivery.clear();`,
        `                }`,
        `                row.setDispatchedAt(Instant.now());`,
        `                outbox.save(row);`,
        `            } catch (RuntimeException e) {`,
        `                row.setAttempts(row.getAttempts() + 1);`,
        `                var dead = row.getAttempts() >= MAX_ATTEMPTS;`,
        `                if (dead) {`,
        `                    row.setDeadAt(Instant.now());`,
        `                }`,
        `                outbox.save(row);`,
        `                if (dead) {`,
        `                    CatalogLog.event(${javaLogEvent("eventDeadLettered")}, "id", row.getId().toString(),`,
        `                            "type", row.getType(),`,
        `                            "attempts", String.valueOf(row.getAttempts()),`,
        `                            "error", String.valueOf(e.getMessage()));`,
        `                }`,
        `            }`,
        `        }`,
        `    }`,
        ``,
        `    private void deliver(String type, Map<String, Object> payload) {`,
        `        switch (type) {`,
        ...arms,
        `            default -> {`,
        `            }`,
        `        }`,
        `    }`,
        ``,
        `    @Override`,
        `    public void stop() {`,
        `        running = false;`,
        `        executor.shutdown();`,
        `    }`,
        ``,
        `    @Override`,
        `    public boolean isRunning() {`,
        `        return running;`,
        `    }`,
        `}`,
        ``,
      ),
    },
  ];
}
