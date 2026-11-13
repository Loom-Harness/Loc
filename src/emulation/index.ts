// The emulated external services — one model per service, shared by every host
// that stands them in for the real thing: the browser playground's infra worker
// and the Node test kit (`test/support/fakes/`).  Each model is pure (no Node,
// DOM or worker globals; WebCrypto and TextEncoder only) and built by a
// factory, so a host makes as many independent instances as it needs.
//
// A host owns the transport (a worker port, a loopback server) and persistence
// (`BlobStore`); the model owns the semantics.  It emulates what Loom's
// generated clients rely on, not the full wire protocol of the real service.

export { createS3, createSes, type S3, type S3ObjectEntry, type Ses } from "./aws.js";
export { type BlobStore, blobNameOf, memoryBlobStore, splitBlobName } from "./blob-store.js";
export {
  BROKER_EMULATION_NOTES,
  BrokerModel,
  type BrokerModelOptions,
  createBroker,
  KAFKA_RETAINED_PER_PARTITION,
} from "./broker-model.js";
export * from "./broker-protocol.js";
export {
  CACHE_EMULATION_NOTES,
  CACHE_MAX_KEYS,
  type CacheKeyInfo,
  CacheModel,
  type CacheOptions,
  type CacheServerInfo,
  createCache,
  runCommand,
} from "./cache.js";
export { createDisk, type Disk, type DiskEntry, normDiskPath } from "./disk.js";
export type { HttpRequestData, HttpResponseData } from "./http.js";
export {
  createHttpMock,
  type HttpMock,
  type HttpMockRequest,
  type MockOverride,
  type OpenApiDoc,
  type SchemaSampler,
  type ServedRequest,
} from "./http-mock.js";
export { createMailbox, type Mailbox, type MailInput, type MailMessage } from "./mailbox.js";
export {
  createOidcProvider,
  discovery,
  type IssuedToken,
  KEYCLOAK_ROUTES,
  type MintParams,
  OIDC_EMULATION_NOTES,
  type OidcGrant,
  type OidcPersona,
  type OidcProvider,
  type OidcProviderOptions,
  type OidcRealm,
  type OidcRoutes,
  type TokenSet,
} from "./oidc.js";
