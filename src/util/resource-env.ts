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
 *  address (`smtp` → Mailpit, `rabbitmq` → the queue broker).  Compose
 *  injects it as `<RESOURCE>_URL` and every backend's client bakes the same
 *  string as its fallback, so the two cannot disagree.  `undefined` for a
 *  type with no such sidecar (cloud SaaS mailers, s3's per-store endpoint). */
export function resourceSidecarUrl(storageType: string, storageName: string): string | undefined {
  const host = storageServiceHost(storageName);
  if (storageType === "smtp") return `smtp://${host}:1025`;
  if (storageType === "rabbitmq") return `amqp://guest:guest@${host}:5672`;
  return undefined;
}
