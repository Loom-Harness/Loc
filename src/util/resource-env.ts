// ---------------------------------------------------------------------------
// Resource connection env-var naming — the seam between what a generated
// backend READS at runtime and what `docker-compose.yml` / the Helm chart
// WRITES for it.
//
// Lives in `src/util/` because its consumers span two layers: the per-backend
// resource-client emitters (`generator/<platform>/adapters/resource-clients.ts`)
// bake `process.env.<VAR>` / `System.getenv("<VAR>")` into the client, and the
// system composer (`src/system/`) injects the matching value.  A drift between
// the two is invisible at compile time and surfaces as a client falling back to
// its baked-in default — so the derivation belongs in exactly one place.
// ---------------------------------------------------------------------------

/** `SALES_FILES`-style SCREAMING_SNAKE env-var base for a resource name. */
export function resourceEnvBase(resourceName: string): string {
  return resourceName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

/** `SALES_FILES_URL`-style env var name for a resource's connection URL. */
export function resourceEnvUrlVar(resourceName: string): string {
  return `${resourceEnvBase(resourceName)}_URL`;
}

/** The dev-compose host of a `storage` sidecar — the service name
 *  `docker-compose.yml` gives it (`serviceSlug` in `src/system/index.ts`, the
 *  same snake-casing rule).  A resource's client must dial THIS host, never
 *  its own resource name: `resource mail { use: smtp }` reaches Mailpit at
 *  `smtp`, not `mail` (H-27). */
function storageServiceHost(storageName: string): string {
  return storageName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/** The connection URL a storage-backed resource dials inside the dev compose
 *  network, for the storage types whose sidecar compose emits with a fixed
 *  address (`smtp` → Mailpit, `rabbitmq` → the queue broker, `redis` → the
 *  valkey a cache resource reads through).  Compose
 *  injects it as `<RESOURCE>_URL` and every backend's client bakes the same
 *  string as its fallback, so the two cannot disagree.  `undefined` for a
 *  type with no such sidecar (cloud SaaS mailers, s3's per-store endpoint). */
export function resourceSidecarUrl(storageType: string, storageName: string): string | undefined {
  const host = storageServiceHost(storageName);
  if (storageType === "smtp") return `smtp://${host}:1025`;
  if (storageType === "rabbitmq") return `amqp://guest:guest@${host}:5672`;
  if (storageType === "redis") return `redis://${host}:6379`;
  return undefined;
}

/** The dev compose's S3-compatible object-store sidecar (MinIO), one per `s3`
 *  storage that declares no `endpoint`.  Compose runs it, creates the
 *  storage's bucket before it reports healthy, and hands each object-store
 *  resource on it the endpoint (`<RESOURCE>_URL_ENDPOINT`) and the standard
 *  `AWS_*` credentials every S3 SDK reads on its own.  A client with no
 *  endpoint set talks to AWS proper, with the ambient credentials. */
export const S3_DEV_SIDECAR = {
  port: 9000,
  accessKey: "minioadmin",
  secretKey: "minioadmin",
  region: "us-east-1",
} as const;

/** `http://<storage service>:9000` — the dev sidecar an `s3` storage runs as. */
export function s3SidecarEndpoint(storageName: string): string {
  return `http://${storageServiceHost(storageName)}:${S3_DEV_SIDECAR.port}`;
}

/** `SALES_FILES_URL_ENDPOINT` — the S3-compatible endpoint an object-store
 *  client dials instead of AWS (path-style addressing) when it is set. */
export function resourceEnvEndpointVar(resourceName: string): string {
  return `${resourceEnvUrlVar(resourceName)}_ENDPOINT`;
}

/** `SALES_FILES_DIR` — the directory a `localDisk` object store keeps its
 *  objects in.  Unset, each backend uses `data/<resource>` under its working
 *  directory. */
export function resourceEnvDirVar(resourceName: string): string {
  return `${resourceEnvBase(resourceName)}_DIR`;
}

/** SendGrid's public API host.  A client posts to `<base>` +
 *  `SENDGRID_SEND_PATH`, where `<base>` is the resource's endpoint override
 *  when it is set and this host otherwise. */
export const SENDGRID_API_BASE = "https://api.sendgrid.com";
export const SENDGRID_SEND_PATH = "/v3/mail/send";

/** The env var each external-service sourceType's client reads for the host it
 *  dials.  Every backend's client honours it, so one value points any backend
 *  at a fake, a sidecar or a regional endpoint; unset (or empty), the client
 *  dials the real provider.
 *
 *  - `s3`, `ses`, `sendgrid`: `<RES>_URL_ENDPOINT`, overriding the SDK's or the
 *    API's default host (S3 switches to path-style addressing).
 *  - `restApi`, `smtp`, `rabbitmq`: the connection URL `<RES>_URL` is already
 *    the host, so it is the override.
 *  - `localDisk`: no host; `<RES>_DIR` names its directory.
 *
 *  A sourceType that backs a resource client must have a row here
 *  (`test/system/resource-endpoint-env-census.test.ts`). */
export const RESOURCE_HOST_ENV = {
  s3: resourceEnvEndpointVar,
  ses: resourceEnvEndpointVar,
  sendgrid: resourceEnvEndpointVar,
  restApi: resourceEnvUrlVar,
  smtp: resourceEnvUrlVar,
  rabbitmq: resourceEnvUrlVar,
  localDisk: resourceEnvDirVar,
} as const satisfies Readonly<Record<string, (resourceName: string) => string>>;

/** The host env var a `sourceType`'s client reads for `resourceName`, or
 *  `undefined` for a sourceType with no resource client. */
export function resourceHostEnvVar(sourceType: string, resourceName: string): string | undefined {
  const row = (RESOURCE_HOST_ENV as Readonly<Record<string, (n: string) => string>>)[sourceType];
  return row?.(resourceName);
}
