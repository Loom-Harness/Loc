// ---------------------------------------------------------------------------
// The node backend's importable symbols, as `ref()` markers.  Interpolate one
// — `new ${T.PgBoss}(…)` — and the module's finalizer (`TsOutputMap` →
// `finalizeTsModule`) spells it and derives its import.  A project module is
// named from the project root (`~/domain/ids`); the finalizer makes the
// specifier relative to the importing file.  `TT` holds the same symbols for
// a type position.
// ---------------------------------------------------------------------------

import { ref } from "../_imports/symbol.js";
import { refType, tsDefault, tsNamed, tsNamespace } from "../_imports/ts.js";

const TS_SYM = {
  PgBoss: tsNamed("pg-boss", "PgBoss"),
  CronExpressionParser: tsNamed("cron-parser", "CronExpressionParser"),
  Ids: tsNamespace("~/domain/ids", "Ids"),
  Decimal: tsDefault("decimal.js", "Decimal"),
  amqp: tsDefault("amqplib", "amqp"),
  Redis: tsNamed("ioredis", "Redis"),
  Kafka: tsNamed("kafkajs", "Kafka"),
  logLevel: tsNamed("kafkajs", "logLevel"),
  Consumer: tsNamed("kafkajs", "Consumer"),
  Producer: tsNamed("kafkajs", "Producer"),
  currentEventOrigin: tsNamed("~/auth/middleware", "currentEventOrigin"),
  requireCurrentUser: tsNamed("~/auth/middleware", "requireCurrentUser"),
  EventOrigin: tsNamed("~/auth/middleware", "EventOrigin"),
  runAsEventOrigin: tsNamed("~/auth/middleware", "runAsEventOrigin"),
  registerOrgPathResolver: tsNamed("~/auth/middleware", "registerOrgPathResolver"),
  registerOidcVerifier: tsNamed("~/auth/oidc", "registerOidcVerifier"),
  registerDevStubVerifier: tsNamed("~/auth/dev-stub", "registerDevStubVerifier"),
  devStubClaims: tsNamed("~/auth/dev-stub", "devStubClaims"),
  runAsUser: tsNamed("~/auth/middleware", "runAsUser"),
  actAsUser: tsNamed("~/auth/middleware", "actAsUser"),
  migrate: tsNamed("~/db/migrate", "migrate"),
  runSeeds: tsNamed("~/db/seed", "runSeeds"),
  foreignKeyDdl: tsNamed("~/db/entities", "foreignKeyDdl"),
  eq: tsNamed("drizzle-orm", "eq"),
  and: tsNamed("drizzle-orm", "and"),
  AsyncLocalStorage: tsNamed("node:async_hooks", "AsyncLocalStorage"),
  NoopDomainEventDispatcher: tsNamed("~/domain/events", "NoopDomainEventDispatcher"),
  createInProcessDispatcher: tsNamed("~/http/workflows", "createInProcessDispatcher"),
  createOutboxDispatcher: tsNamed("~/http/workflows", "createOutboxDispatcher"),
  startOutboxRelay: tsNamed("~/http/workflows", "startOutboxRelay"),
  realtimeTee: tsNamed("~/http/realtime", "realtimeTee"),
  startTimerScheduler: tsNamed("~/scheduler", "startTimerScheduler"),
  channelPublishTee: tsNamed("~/http/channels", "channelPublishTee"),
  createChannelTransports: tsNamed("~/http/channels", "createChannelTransports"),
  startChannelConsumers: tsNamed("~/http/channels", "startChannelConsumers"),
  closeChannelTransports: tsNamed("~/http/channels", "closeChannelTransports"),
  createInProcessTransport: tsNamed("~/http/channels", "createInProcessTransport"),
  baseLogger: tsNamed("~/obs/log", "baseLogger"),
  ChannelTransport: tsNamed("~/http/channels", "ChannelTransport"),
  ChannelBinding: tsNamed("~/http/channels", "ChannelBinding"),
  DomainEventDispatcher: tsNamed("~/domain/events", "DomainEventDispatcher"),
  workflowsRoutes: tsNamed("~/http/workflows", "workflowsRoutes"),
  realtimeRoutes: tsNamed("~/http/realtime", "realtimeRoutes"),
  projectionsRoutes: tsNamed("~/http/projections", "projectionsRoutes"),
  projectionTee: tsNamed("~/http/projections", "projectionTee"),
  queryProjectionsRoutes: tsNamed("~/http/query-projections", "queryProjectionsRoutes"),
  authMiddleware: tsNamed("~/auth/middleware", "authMiddleware"),
  registerRouteProbe: tsNamed("~/auth/middleware", "registerRouteProbe"),
  assertUserVerifierRegistered: tsNamed("~/auth/verifier", "assertUserVerifierRegistered"),
  authRoutes: tsNamed("~/auth/handshake", "authRoutes"),
  randomUUID: tsNamed("node:crypto", "randomUUID"),
  sql: tsNamed("drizzle-orm", "sql"),
  schema: tsNamespace("~/db/schema", "schema"),
  NodePgDatabase: tsNamed("drizzle-orm/node-postgres", "NodePgDatabase"),
  EntityManager: tsNamed("@mikro-orm/postgresql", "EntityManager"),
} as const;

type Name = keyof typeof TS_SYM;

const map = <R>(f: (s: (typeof TS_SYM)[Name]) => R): Record<Name, R> =>
  Object.fromEntries(Object.entries(TS_SYM).map(([k, s]) => [k, f(s)])) as Record<Name, R>;

/** Value-position references. */
export const T: Readonly<Record<Name, string>> = map(ref);
/** Type-position references. */
export const TT: Readonly<Record<Name, string>> = map(refType);
