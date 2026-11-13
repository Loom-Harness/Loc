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
  storage: { name: string; type: "rabbitmq" | "redis" };
  /** rabbitmq: the case's generated `broker-init/<storage>-definitions.json`. */
  definitions?: object;
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
  /** Drain the tap and return the order-stable golden rows. */
  observe(): Promise<BrokerEffect[]>;
  /** Swap in another case's definitions and wipe the broker. */
  load(definitions?: object): Promise<void>;
  reset(): Promise<void>;
  stop(): Promise<void>;
}

export const BROKER_IMAGES: { rabbitmq: string; redis: string };
export const RABBITMQ_CONTAINER_ENV: Record<string, string>;

export function start(opts: BrokerStartOptions): Promise<BrokerFake>;
export function rehost(url: string, host: string, port: number): string;
export function summarise(
  publishes: Array<{ exchange: string; routingKey: string; type?: string | null }>,
): BrokerEffect[];
export function cloudEventType(body: string | Uint8Array): string | null;
export function parseResp(buf: Buffer): { values: unknown[]; rest: Buffer };
