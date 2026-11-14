// Types for the plain-JS broker sidecar (`broker-sidecar.mjs`).

/** One golden row: publishes to one exchange (rabbitmq) or channel (valkey)
 *  with one routing key and one CloudEvent `type` (null for a plain body). */
export interface BrokerEffect {
  exchange: string;
  routingKey: string;
  type: string | null;
  count: number;
}

export interface BrokerStartOptions {
  storage: { name: string; type: "rabbitmq" | "redis" | "kafka" };
  /** rabbitmq: the case's generated `broker-init/<storage>-definitions.json`. */
  /** "after-boot": the broker is down while the backend boots (the boot gate). */
  gate?: "after-boot";
  /** The case's generated tree: definitions, channel URLs and the broker env
   *  are read from it when not given explicitly. */
  genDir?: string;
  definitions?: object;
  /** kafka: the case's compose `environment:` for its kafka service. */
  containerEnv?: Record<string, string>;
  /** redis: the `requirepass` the case's compose URL carries. */
  password?: string;
  /** Channel bindings on this storage; `url` is the compose value, re-hosted. */
  channelSources?: Array<{ name: string; url?: string }>;
  /** `queue` resources on this storage; `url` is the compose value, re-hosted. */
  resources?: Array<{ name: string; url?: string }>;
}

export interface BrokerFake {
  /** `LOOM_CHANNEL_<X>_URL` / `<RES>_URL` pointed at the sidecar. */
  env: Record<string, string>;
  /** The admin URL of the sidecar. */
  url: string;
  managementUrl?: string;
  /** Every publish observed since the last reset, unsummarised. */
  captured: Array<{ exchange: string; routingKey: string; type: string | null }>;
  /** The backend is about to boot (arms a gated broker's backstop). */
  backendStarting(): void;
  /** Drain the tap and return the order-stable golden rows. */
  observe(): Promise<BrokerEffect[]>;
  /** Swap in another case's definitions and wipe the broker. */
  load(definitions?: object): Promise<void>;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export const BROKER_IMAGES: { rabbitmq: string; redis: string; kafka: string };
/** The kafka broker env used when a case brings none. */
export const KAFKA_DEFAULT_ENV: Record<string, string>;
export const RABBITMQ_CONTAINER_ENV: Record<string, string>;

export function start(opts: BrokerStartOptions): Promise<BrokerFake>;
export function rehost(url: string, host: string, port: number): string;
export function summarise(
  publishes: Array<{ exchange: string; routingKey: string; type?: string | null }>,
): BrokerEffect[];
export function cloudEventType(body: string | Uint8Array): string | null;
export function parseResp(buf: Buffer): { values: unknown[]; rest: Buffer };

/** The `environment:` map of one service in a generated `docker-compose.yml`. */
export function composeServiceEnv(compose: string, service: string): Record<string, string> | null;
/** The first value a generated `docker-compose.yml` assigns to env var `name`. */
export function composeEnvValue(compose: string, name: string): string | undefined;
/** Run `docker` with `args`; returns trimmed stdout, throws on failure. */
export function docker(args: string[]): string;
/** `docker run -d --rm` a pinned image with loopback-published ports. */
export function runContainer(
  image: string,
  ports: number[],
  env?: Record<string, string>,
  cmd?: string[],
  kind?: string,
): { id: string; hostPorts: Record<number, number> };
/** Poll `fn` until it returns truthy, or throw after `timeoutMs`. */
export function until(
  what: string,
  fn: () => unknown,
  opts?: { timeoutMs?: number; everyMs?: number },
): Promise<void>;
/** `NAME://host:port,…` → `{ NAME: port }`. */
export function listenerPorts(spec: string): Record<string, number>;
/** A case's compose kafka env, re-pointed at a host process on `hostPort`. */
export function kafkaContainerEnv(
  composeEnv: Record<string, string>,
  clientPort: number,
  hostPort: number,
): { env: Record<string, string>; client: string };
/** `kafka-get-offsets.sh` output → records per user topic. */
export function parseKafkaOffsets(text: string): Map<string, number>;

/** A loopback proxy that refuses connections until it opens (the boot gate). */
export interface TcpGate {
  readonly port: number;
  readonly refused: number;
  readonly open: boolean;
  setTarget(host: string, port: number): void;
  backendStarting(): void;
  close(): Promise<void>;
}
export function tcpGate(opts?: { graceMs?: number; maxClosedMs?: number }): Promise<TcpGate>;
