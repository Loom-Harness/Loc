// The entry surface of one deployable: every way work enters the code it
// generates.
//
// An entry is an HTTP route the deployable mounts, or a non-HTTP trigger it
// starts (a reactor or `on` body, an event-triggered workflow start, a
// projection fold, a timer, a broker consumer, the outbox relay, the inbox
// purge).  Each entry records how it is reached (method and path, or the event,
// timer or channel that fires it), the principal it runs as, its tenancy
// stance and the `requires` gates a caller must pass.
//
// Every promise the generated code makes (tenant isolation, authorization,
// validation) is a statement about every entry, so the probes that test a
// promise range over this list, and `test/system/entry-surface-census.test.ts`
// fails when a backend's generated tree mounts or starts an entry this list
// does not name.  An entry kind that is not here is an entry no promise can
// see; a new kind therefore lands here first, with its census row.
//
// The list states what every backend mounts and starts; a change to an entry
// (who it runs as, whether it is mounted) lands here and every reader follows.

import { API_BASE_PATH, AUTH_BASE_PATH } from "../../util/api-base.js";
import { snake } from "../../util/naming.js";
import { RUNTIME_ROUTES } from "../../util/runtime-wire-names.js";
import type {
  AggregateIR,
  ApiIR,
  BoundedContextIR,
  DeployableIR,
  ExprIR,
  SystemIR,
  TimerCadenceIR,
  WorkflowStmtIR,
} from "../types/loom-ir.js";
import { isMaterializedProjection, isQueryTimeProjection } from "../types/projection.js";
import { workflowEmitsCommandRoute } from "../types/queries.js";
import { type ApiOperationIR, aggregateSegment, servedOperations } from "../util/api-surface.js";
import { canonicalCreate, canonicalDestroy } from "../util/canonical-lifecycle.js";
import { realtimeEventTypes } from "../util/channels.js";
import { aggregateHasFileField } from "../util/file-field.js";
import { lifecycleGates, operationGates } from "../util/op-gates.js";
import { realtimeRoomPlan } from "../util/realtime-rooms.js";
import { classifyTenantStance, type TenantStance } from "../util/tenant-stance.js";
import { walkWorkflowStmtsDeep } from "../util/walk.js";
import { channelPlan } from "./channel-plan.js";
import { deployableNeedsInbox } from "./consumer-inbox.js";
import { contextOperations } from "./repo-polymorphic.js";

/** Which surface an entry belongs to.
 *
 *  - `api` — an operation an api declares or a hosted declaration derives: a
 *    call an author writes in a page may target only these.
 *  - `infrastructure` — host, health-check and platform routes: probes, the
 *    OpenAPI document, sign-in, files, the live-events stream.  Built-in ui
 *    primitives may reach these; an author's page call may not.
 *  - `internal` — a non-HTTP entry: nothing outside the deployable calls it. */
export type EntryRole = "api" | "infrastructure" | "internal";

/** Every entry kind a deployable can have, with its role and how it is
 *  reached.  `EntryKind` is this table's key set, so a kind exists only with
 *  its row, and the census checks every row is reached on every backend. */
export const ENTRY_KINDS = {
  // HTTP — the api surface.
  create: { role: "api", via: "http" },
  getById: { role: "api", via: "http" },
  destroy: { role: "api", via: "http" },
  operation: { role: "api", via: "http" },
  gateProbe: { role: "api", via: "http" },
  find: { role: "api", via: "http" },
  history: { role: "api", via: "http" },
  workflowStart: { role: "api", via: "http" },
  workflowInstances: { role: "api", via: "http" },
  workflowInstance: { role: "api", via: "http" },
  projectionList: { role: "api", via: "http" },
  projectionGet: { role: "api", via: "http" },
  queryProjection: { role: "api", via: "http" },
  explicitRoute: { role: "api", via: "http" },
  // HTTP — infrastructure.
  health: { role: "infrastructure", via: "http" },
  ready: { role: "infrastructure", via: "http" },
  metrics: { role: "infrastructure", via: "http" },
  openapi: { role: "infrastructure", via: "http" },
  testReset: { role: "infrastructure", via: "http" },
  authMe: { role: "infrastructure", via: "http" },
  authLogin: { role: "infrastructure", via: "http" },
  authCallback: { role: "infrastructure", via: "http" },
  authRefresh: { role: "infrastructure", via: "http" },
  authLogout: { role: "infrastructure", via: "http" },
  fileUpload: { role: "infrastructure", via: "http" },
  fileDownload: { role: "infrastructure", via: "http" },
  realtimeEvents: { role: "infrastructure", via: "http" },
  uiHost: { role: "infrastructure", via: "http" },
  // Non-HTTP.
  reactor: { role: "internal", via: "event" },
  workflowEventStart: { role: "internal", via: "event" },
  projectionFold: { role: "internal", via: "event" },
  timer: { role: "internal", via: "schedule" },
  brokerConsumer: { role: "internal", via: "channel" },
  outboxRelay: { role: "internal", via: "boot" },
  inboxPurge: { role: "internal", via: "boot" },
} as const satisfies Record<string, { role: EntryRole; via: EntryTrigger["via"] }>;

export type EntryKind = keyof typeof ENTRY_KINDS;

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/** How an entry is reached. */
export type EntryTrigger =
  /** `path` is absolute (it includes `API_BASE_PATH` where the route sits
   *  under it), with `{name}` path parameters — what a caller sends. */
  | {
      readonly via: "http";
      readonly method: HttpMethod;
      readonly path: string;
      /** The entry answers every path under `path` the other entries leave
       *  (a bound ui's pages and assets), each backend spelling its own
       *  routes for them. */
      readonly subtree?: true;
    }
  | { readonly via: "event"; readonly event: string }
  | { readonly via: "schedule"; readonly timer: string; readonly cadence: TimerCadenceIR }
  | { readonly via: "channel"; readonly channel: string }
  /** Started once when the service boots and runs for its lifetime. */
  | { readonly via: "boot" };

/** Who the entry's code runs as.
 *
 *  - `caller` — the signed-in principal of the request (the deployable
 *    requires sign-in, and the route is not one of the sign-in-free ones).
 *  - `anonymous` — no principal: the deployable does not require sign-in, or
 *    the route answers before sign-in (health, the OIDC handshake).
 *  - `system` — the system principal: a non-HTTP entry. */
export type EntryPrincipal = "caller" | "anonymous" | "system";

/** The tenant frame an entry's reads and writes run in.
 *
 *  - an aggregate's own `TenantStance` — the entry reads or writes that one
 *    aggregate, scoped by its stance under the caller's tenant claim;
 *  - `callerTenant` — the entry runs in the caller's tenant frame and every
 *    aggregate it touches applies its own stance (handlers, workflows,
 *    projections, a tenant-scoped live stream);
 *  - `eventTenant` — a non-HTTP entry runs in the tenant the triggering event
 *    carries;
 *  - `none` — no tenant frame: the system declares no tenancy, or the entry
 *    reads no tenant-owned data on its own terms (probes, sign-in, timers,
 *    the relay, files). */
export type EntryTenancy = TenantStance | "callerTenant" | "eventTenant" | "none";

/** Which declarations an entry belongs to. */
export interface EntryOwner {
  readonly context?: string;
  readonly aggregate?: string;
  readonly workflow?: string;
  readonly projection?: string;
  readonly api?: string;
  readonly handler?: string;
}

export interface Entry {
  readonly kind: EntryKind;
  readonly role: EntryRole;
  readonly trigger: EntryTrigger;
  readonly principal: EntryPrincipal;
  readonly tenancy: EntryTenancy;
  /** The `requires` predicates the entry evaluates before it does its work, in
   *  source order.  Empty for an ungated entry. */
  readonly gates: readonly ExprIR[];
  readonly owner: EntryOwner;
}

export interface EntrySurface {
  readonly deployable: string;
  readonly entries: readonly Entry[];
}

/** What `entrySurface` is asked about: the arguments a backend's
 *  `emitProject` receives. */
export interface EntrySurfaceArgs {
  readonly deployable: DeployableIR;
  /** The contexts the deployable hosts. */
  readonly contexts: readonly BoundedContextIR[];
  readonly sys: SystemIR;
}

/** The deployable requires sign-in: every backend installs its authentication
 *  middleware exactly when it is `auth: required` and the system declares a
 *  `user`. */
function requiresSignIn(d: DeployableIR, sys: Pick<SystemIR, "user">): boolean {
  return !!(d.auth?.required && sys.user);
}

/** Every entry `args.deployable` mounts or starts. */
export function entrySurface(args: EntrySurfaceArgs): EntrySurface {
  const { deployable: d, contexts, sys } = args;
  const signIn = requiresSignIn(d, sys);
  const caller: EntryPrincipal = signIn ? "caller" : "anonymous";
  const tenancyOn = !!sys.tenancy;
  const callerTenant: EntryTenancy = tenancyOn ? "callerTenant" : "none";
  const entries: Entry[] = [];
  const http = (
    kind: EntryKind,
    method: HttpMethod,
    path: string,
    rest: Partial<Pick<Entry, "principal" | "tenancy" | "gates" | "owner">> = {},
  ): void => {
    entries.push({
      kind,
      role: ENTRY_KINDS[kind].role,
      trigger: { via: "http", method, path },
      principal: rest.principal ?? caller,
      tenancy: rest.tenancy ?? "none",
      gates: rest.gates ?? [],
      owner: rest.owner ?? {},
    });
  };

  // Infrastructure: the probes, metrics, the OpenAPI document and the test
  // reset answer before sign-in on every backend.
  http("health", "get", "/health", { principal: "anonymous" });
  http("ready", "get", "/ready", { principal: "anonymous" });
  http("metrics", "get", "/metrics", { principal: "anonymous" });
  http("openapi", "get", "/openapi.json", { principal: "anonymous" });
  http("testReset", "post", RUNTIME_ROUTES.testReset, { principal: "anonymous" });

  if (signIn) {
    http("authMe", "get", `${AUTH_BASE_PATH}/me`);
    if (sys.auth?.oidc) {
      http("authLogin", "get", `${AUTH_BASE_PATH}/login`, { principal: "anonymous" });
      http("authCallback", "get", `${AUTH_BASE_PATH}/callback`, { principal: "anonymous" });
      http("authRefresh", "post", `${AUTH_BASE_PATH}/refresh`, { principal: "anonymous" });
      http("authLogout", "get", `${AUTH_BASE_PATH}/logout`, { principal: "anonymous" });
    }
  }

  // The bound ui: an embedded bundle or server-rendered pages, served under
  // the deployable's root and reading data only through the entries above.
  if (d.uiName || d.hostedUiNames.length > 0) {
    entries.push({
      kind: "uiHost",
      role: ENTRY_KINDS.uiHost.role,
      trigger: { via: "http", method: "get", path: "/", subtree: true },
      principal: caller,
      tenancy: "none",
      gates: [],
      owner: {},
    });
  }

  // File routes: a hosted File-bearing aggregate over an objectStore the
  // deployable binds.  They sit at the root, outside the api base.
  if (servesFiles(d, contexts, sys)) {
    http("fileUpload", "post", "/files");
    http("fileDownload", "get", "/files/{key}");
  }

  for (const ctx of contexts) {
    const context = ctx.name;
    // Aggregate routes: every hosted context mounts its derived operations.
    for (const op of servedOperations(contextOperations(ctx))) {
      const agg = ctx.aggregates.find((a) => a.name === op.aggregate);
      http(op.kind, op.method, op.path, {
        tenancy: agg && tenancyOn ? classifyTenantStance(agg, sys) : "none",
        gates: operationEntryGates(op, agg),
        owner: { context, aggregate: op.aggregate },
      });
    }
    for (const agg of ctx.aggregates) {
      if (agg.isAbstract) continue;
      const repo = ctx.repositories.find((r) => r.aggregateName === agg.name);
      if (!repo?.historyFind) continue;
      http("history", "get", `${API_BASE_PATH}/${aggregateSegment(agg.name)}/{id}/history`, {
        tenancy: tenancyOn ? classifyTenantStance(agg, sys) : "none",
        gates: repo.historyFind.requires ? [repo.historyFind.requires] : [],
        owner: { context, aggregate: agg.name },
      });
    }

    for (const wf of ctx.workflows) {
      const base = `${API_BASE_PATH}/workflows/${snake(wf.name)}`;
      const owner = { context, workflow: wf.name };
      if (workflowEmitsCommandRoute(wf)) {
        http("workflowStart", "post", base, {
          tenancy: callerTenant,
          gates: workflowGates(wf.statements),
          owner,
        });
      }
      if (wf.instanceWireShape) {
        const gates = wf.instanceReadGate ? [wf.instanceReadGate] : [];
        http("workflowInstances", "get", `${base}/instances`, {
          tenancy: callerTenant,
          gates,
          owner,
        });
        http("workflowInstance", "get", `${base}/instances/{id}`, {
          tenancy: callerTenant,
          gates,
          owner,
        });
      }
    }

    for (const p of ctx.projections ?? []) {
      const base = `${API_BASE_PATH}/projections/${snake(p.name)}`;
      const owner = { context, projection: p.name };
      const gates = p.query?.requires ? [p.query.requires] : [];
      if (isMaterializedProjection(p)) {
        http("projectionList", "get", base, { tenancy: callerTenant, gates, owner });
        http("projectionGet", "get", `${base}/{key}`, { tenancy: callerTenant, gates, owner });
      } else if (isQueryTimeProjection(p)) {
        http("queryProjection", "get", base, { tenancy: callerTenant, gates, owner });
      }
    }

    if (realtimeEventTypes(ctx).size > 0) {
      http("realtimeEvents", "get", `${API_BASE_PATH}/realtime/events`, {
        tenancy: tenancyOn && realtimeRoomPlan(ctx, sys).tenantScoped ? "callerTenant" : "none",
        owner: { context },
      });
    }
  }

  // Explicit routes: every api the deployable serves, routed to a handler a
  // hosted context declares.
  for (const api of servedApis(d, sys.apis ?? [])) {
    for (const route of api.routes) {
      const ctx = contexts.find((c) => c.name === route.target.context);
      const handler =
        ctx?.commandHandlers?.find((h) => h.name === route.target.handler) ??
        ctx?.queryHandlers?.find((h) => h.name === route.target.handler);
      if (!ctx || !handler) continue;
      http(
        "explicitRoute",
        route.method.toLowerCase() as HttpMethod,
        `${API_BASE_PATH}${route.path}`,
        {
          tenancy: callerTenant,
          gates: workflowGates(handler.statements),
          owner: { context: ctx.name, api: api.name, handler: handler.name },
        },
      );
    }
  }

  // Non-HTTP entries: the system principal, in the triggering event's tenant.
  const plan = channelPlan(contexts, { deployable: d, sys });
  const eventTenant: EntryTenancy = tenancyOn ? "eventTenant" : "none";
  const internal = (
    kind: EntryKind,
    trigger: EntryTrigger,
    owner: EntryOwner,
    tenancy = eventTenant,
  ) =>
    entries.push({
      kind,
      role: ENTRY_KINDS[kind].role,
      trigger,
      principal: "system",
      tenancy,
      gates: [],
      owner,
    });
  for (const sub of plan.subscriptions) {
    const ctx = contexts.find(
      (c) =>
        c.workflows.some((w) => w.name === sub.workflow) ||
        (c.projections ?? []).some((p) => p.name === sub.workflow),
    );
    const trigger: EntryTrigger = { via: "event", event: sub.event };
    if (sub.projection) {
      internal("projectionFold", trigger, { context: ctx?.name, projection: sub.projection });
    } else {
      internal(sub.trigger === "on" ? "reactor" : "workflowEventStart", trigger, {
        context: ctx?.name,
        workflow: sub.workflow,
      });
    }
  }
  for (const timer of ownedTimers(d, sys)) {
    internal(
      "timer",
      { via: "schedule", timer: timer.name, cadence: timer.cadence },
      { context: timer.context },
      "none",
    );
  }
  if (plan.consumesFromBroker) {
    for (const b of plan.uniqueBindings) {
      if (!b.events.some((e) => plan.brokerConsumedEvents.has(e))) continue;
      internal("brokerConsumer", { via: "channel", channel: b.channelName }, {});
    }
  }
  if (plan.hasOutbox) internal("outboxRelay", { via: "boot" }, {}, "none");
  if (deployableNeedsInbox(contexts, plan)) internal("inboxPurge", { via: "boot" }, {}, "none");

  return { deployable: d.name, entries };
}

/** The entries reached over HTTP, with their method and path. */
export function httpEntries(
  surface: EntrySurface,
): (Entry & { readonly trigger: Extract<EntryTrigger, { via: "http" }> })[] {
  return surface.entries.filter(
    (e): e is Entry & { readonly trigger: Extract<EntryTrigger, { via: "http" }> } =>
      e.trigger.via === "http",
  );
}

/** The deployable mounts the file routes: it hosts an aggregate with a `File`
 *  field and binds an objectStore for its bytes. */
function servesFiles(
  d: DeployableIR,
  contexts: readonly BoundedContextIR[],
  sys: SystemIR,
): boolean {
  if (!contexts.some((c) => c.aggregates.some(aggregateHasFileField))) return false;
  const wired = new Set(d.dataSourceNames);
  const store = sys.dataSources.find((r) => wired.has(r.name) && r.kind === "objectStore");
  return !!store && sys.storages.some((s) => s.name === store.storageName);
}

/** The apis a backend deployable serves, in declaration order. */
function servedApis(d: DeployableIR, apis: readonly ApiIR[]): ApiIR[] {
  const want = new Set(d.serves ?? []);
  return apis.filter((a) => want.has(a.name));
}

/** The timers whose context's subdomain this deployable owns the database of:
 *  the single place a timer fires, so two replicas never both tick it. */
function ownedTimers(d: DeployableIR, sys: SystemIR) {
  return (sys.timerSources ?? []).filter((ts) => {
    const sub = sys.subdomains.find((s) => s.contexts.some((c) => c.name === ts.context));
    return sub?.migrationsOwner === d.name;
  });
}

/** The gates a derived aggregate operation evaluates: the operation's own
 *  `requires`, the canonical lifecycle action's on create / destroy, the read
 *  gate on a read. */
function operationEntryGates(op: ApiOperationIR, agg: AggregateIR | undefined): ExprIR[] {
  if (op.operation) return operationGates(op.operation).map((g) => g.expr);
  if (op.kind === "create" && agg) return lifecycleGates(canonicalCreate(agg)).map((g) => g.expr);
  if (op.kind === "destroy" && agg) return lifecycleGates(canonicalDestroy(agg)).map((g) => g.expr);
  if (op.find?.requires) return [op.find.requires];
  return [];
}

/** Every `requires` a handler or workflow body evaluates, in source order. */
function workflowGates(statements: readonly WorkflowStmtIR[]): ExprIR[] {
  const out: ExprIR[] = [];
  for (const top of statements) {
    walkWorkflowStmtsDeep(top, (s) => {
      if (s.kind === "requires") out.push(s.expr);
    });
  }
  return out;
}
