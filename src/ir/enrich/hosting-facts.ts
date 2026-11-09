// ---------------------------------------------------------------------------
// HOSTING FACTS — which deployable hosts what a feature reaches across.
//
// A system splits its contexts over deployables, each with its own database
// and its own process.  A feature that reaches from one context into another
// (the tenancy registry's `dataKey` read, a channel's publish and drain, a
// typed `kind: api` call) is only correct when the emitter knows where the
// other end lives.  Assuming co-hosting is the defect class: a deployable that
// queries a registry table its database does not have, or a timer tick that is
// dispatched in-process while its only consumer sits behind a broker.
//
// These are pure functions of the deployables' `contextNames` and the hosted
// contexts' declarations — derived on demand, never stamped on the IR.  The
// phase-⑦ checks and every backend emitter ask the same question here, so a
// refusal and an emission cannot disagree about where a thing lives.
// ---------------------------------------------------------------------------

import { platformOwnsBackend } from "../../language/validators/data/platform-rules.js";
import {
  PRINCIPAL_ORG_CONTEXT_PATH,
  PRINCIPAL_ORG_PATH,
  PRINCIPAL_ROOT_ORG,
} from "../../util/principal.js";
import type {
  AggregateIR,
  BoundedContextIR,
  DeployableIR,
  ExprIR,
  SystemIR,
  TimerSourceIR,
} from "../types/loom-ir.js";
import { apiResourceBindings } from "../util/api-resource-binding.js";
import { forEachContextExpr } from "../util/model-exprs.js";
import { reactorBodies } from "../util/system-principal.js";
import { hasTenantOwned, hierarchyRegistry } from "../util/tenant-stance.js";
import { walkWorkflowStmtExprsDeep } from "../util/walk.js";

type HostingSys = Pick<SystemIR, "tenancy" | "subdomains" | "deployables">;

// ── Tenancy registry ────────────────────────────────────────────────────────

/** The context that declares the hierarchy registry, when the system has one. */
function registryContextName(sys: HostingSys): string | undefined {
  const reg = hierarchyRegistry(sys);
  if (!reg) return undefined;
  for (const sub of sys.subdomains) {
    for (const ctx of sub.contexts) if (ctx.aggregates.includes(reg)) return ctx.name;
  }
  return undefined;
}

/** The hierarchy registry this deployable can read `dataKey` from — the
 *  registry aggregate when the deployable hosts the registry's context, else
 *  `undefined`.  This is the single signal every backend's `currentUser.orgPath`
 *  resolver keys on: a deployable that does not host the registry has no
 *  registry table in its database, so it never emits the lookup. */
export function hostedHierarchyRegistry(
  sys: HostingSys,
  hostedContextNames: readonly string[],
): AggregateIR | undefined {
  const ctxName = registryContextName(sys);
  if (!ctxName || !hostedContextNames.includes(ctxName)) return undefined;
  return hierarchyRegistry(sys);
}

/** Is `e` a read of a principal member whose value comes from the registry's
 *  materialized path — `currentUser.orgPath` / `.rootOrg`, or the lowered
 *  `organizationContext.orgPath`? */
function isHierarchyRead(e: ExprIR): boolean {
  return (
    e.kind === "member" &&
    (e.member === PRINCIPAL_ORG_PATH ||
      e.member === PRINCIPAL_ROOT_ORG ||
      e.member === PRINCIPAL_ORG_CONTEXT_PATH) &&
    e.receiver.kind === "ref" &&
    e.receiver.refKind === "current-user"
  );
}

/** Does this context depend on the registry's materialized path?  A
 *  `tenantOwned` aggregate stamps `dataKey := currentUser.orgPath` on every
 *  write, and any expression may read `orgPath` / `rootOrg` / the operating
 *  scope directly. */
function contextReadsHierarchy(ctx: BoundedContextIR): boolean {
  if (ctx.aggregates.some((a) => hasTenantOwned(a))) return true;
  let found = false;
  forEachContextExpr(ctx, (v) => {
    if (!found && isHierarchyRead(v.expr)) found = true;
  });
  return found;
}

/** A backend deployable that hosts a hierarchy-reading context but not the
 *  registry: its `orgPath` would have to come from another deployable's
 *  database.  Each entry names the deployable and the first reading context. */
export function remoteRegistryReaders(
  sys: HostingSys,
): { deployable: DeployableIR; context: string; registryContext: string }[] {
  const registryContext = registryContextName(sys);
  if (!registryContext) return [];
  const ctxByName = new Map<string, BoundedContextIR>();
  for (const sub of sys.subdomains) for (const c of sub.contexts) ctxByName.set(c.name, c);
  const out: { deployable: DeployableIR; context: string; registryContext: string }[] = [];
  for (const dep of sys.deployables) {
    if (!platformOwnsBackend(dep.platform)) continue;
    if (dep.contextNames.includes(registryContext)) continue;
    const reader = dep.contextNames.find((n) => {
      const ctx = ctxByName.get(n);
      return ctx !== undefined && contextReadsHierarchy(ctx);
    });
    if (reader) out.push({ deployable: dep, context: reader, registryContext });
  }
  return out;
}

// ── Channels and timers ─────────────────────────────────────────────────────

/** Event names a context reacts to — reactor `on(e)` and event-triggered
 *  `create(e) by …`. */
export function reactedEventNames(ctx: BoundedContextIR): Set<string> {
  const out = new Set<string>();
  for (const wf of ctx.workflows ?? []) {
    for (const on of wf.subscriptions ?? []) out.add(on.event);
    for (const c of wf.creates ?? [])
      if (c.triggerKind === "event" && c.eventRef) out.add(c.eventRef);
  }
  return out;
}

/** The deployable that runs a timer — the DB owner of the tick event's
 *  context (the single-fire lock owner and the DB owner coincide). */
export function timerOwner(
  sys: Pick<SystemIR, "subdomains">,
  ts: Pick<TimerSourceIR, "context">,
): string | undefined {
  return sys.subdomains.find((s) => s.contexts.some((c) => c.name === ts.context))?.migrationsOwner;
}

/** The channel names that carry `event` and that this deployable binds to a
 *  broker (`channels: [...]` naming a `channelSource` for the channel). */
export function brokerBoundChannelsCarrying(
  sys: Pick<SystemIR, "subdomains" | "channelSources">,
  dep: Pick<DeployableIR, "channelSourceNames">,
  event: string,
): string[] {
  const carrying = new Set<string>();
  for (const sub of sys.subdomains)
    for (const ctx of sub.contexts)
      for (const ch of ctx.channels ?? []) if (ch.carries.includes(event)) carrying.add(ch.name);
  const listed = new Set(dep.channelSourceNames ?? []);
  const out: string[] = [];
  for (const cs of sys.channelSources ?? []) {
    if (listed.has(cs.name) && carrying.has(cs.channelName) && !out.includes(cs.channelName))
      out.push(cs.channelName);
  }
  return out;
}

/** Is `event` carried by any channel of the system? */
function eventIsChannelCarried(sys: Pick<SystemIR, "subdomains">, event: string): boolean {
  return sys.subdomains.some((s) =>
    s.contexts.some((c) => (c.channels ?? []).some((ch) => ch.carries.includes(event))),
  );
}

/** Where a timer's tick goes.  `consumers` are the backend deployables hosting
 *  a context that reacts to the tick; `reachable` the subset that can receive
 *  it — the producer itself (in-process dispatch) or a deployable on the far
 *  side of a channel carrying the tick (whose binding the channel-wiring checks
 *  enforce). */
export function timerTickEndpoints(
  sys: Pick<SystemIR, "subdomains" | "deployables">,
  ts: Pick<TimerSourceIR, "context" | "event">,
): { producer: string | undefined; consumers: DeployableIR[]; reachable: DeployableIR[] } {
  const producer = timerOwner(sys, ts);
  const reacting = new Set<string>();
  for (const sub of sys.subdomains)
    for (const ctx of sub.contexts)
      if (reactedEventNames(ctx).has(ts.event)) reacting.add(ctx.name);
  const consumers = sys.deployables.filter(
    (d) => platformOwnsBackend(d.platform) && d.contextNames.some((n) => reacting.has(n)),
  );
  const carried = eventIsChannelCarried(sys, ts.event);
  const reachable = consumers.filter((d) => d.name === producer || carried);
  return { producer, consumers, reachable };
}

// ── Cross-deployable typed api calls ────────────────────────────────────────

/** Whose credential a typed `kind: api` call carries to the deployable that
 *  serves the api.  An `auth: required` callee gets the CALLER's own
 *  credential, forwarded unchanged (`docs/auth.md` § "Calls between
 *  deployables"); an open callee gets none, so its client stays as it was.  A
 *  service credential for callers with no request principal is #4804. */
export type ApiCallPrincipal = "none" | "forward-caller";

export function apiCallPrincipal(server: Pick<DeployableIR, "auth">): ApiCallPrincipal {
  return server.auth?.required ? "forward-caller" : "none";
}

/** Does this deployable forward its caller's credential on any typed api call?
 *  The per-backend emitters key the inbound-credential capture on this, so a
 *  deployable whose callees are all open emits nothing new. */
export function forwardsCallerCredential(
  dep: DeployableIR,
  sys: Parameters<typeof apiResourceBindings>[1],
): boolean {
  return apiResourceBindings(dep, sys).some((b) => apiCallPrincipal(b.server) === "forward-caller");
}

/** Typed calls to an `auth: required` callee that have no caller credential to
 *  forward: a call from an event reactor (an event-triggered `create … by`, an
 *  `on(e)`, including one a timer tick or a broker consumer drives), and any
 *  binding on a deployable that authenticates no one. */
export function principalLessApiCalls(sys: Parameters<typeof apiResourceBindings>[1]): {
  deployable: DeployableIR;
  resource: string;
  server: string;
  site: string;
  why: "reactor" | "anonymous-caller";
}[] {
  const out: {
    deployable: DeployableIR;
    resource: string;
    server: string;
    site: string;
    why: "reactor" | "anonymous-caller";
  }[] = [];
  const ctxByName = new Map<string, BoundedContextIR>();
  for (const sub of sys.subdomains) for (const c of sub.contexts) ctxByName.set(c.name, c);
  for (const dep of sys.deployables) {
    if (!platformOwnsBackend(dep.platform)) continue;
    const guarded = new Map<string, string>();
    for (const b of apiResourceBindings(dep, sys)) {
      if (apiCallPrincipal(b.server) !== "forward-caller") continue;
      guarded.set(b.resource.name, b.server.name);
      if (!dep.auth?.required) {
        out.push({
          deployable: dep,
          resource: b.resource.name,
          server: b.server.name,
          site: dep.name,
          why: "anonymous-caller",
        });
      }
    }
    if (guarded.size === 0 || !dep.auth?.required) continue;
    for (const name of dep.contextNames) {
      const ctx = ctxByName.get(name);
      for (const wf of ctx?.workflows ?? []) {
        for (const body of reactorBodies(wf)) {
          const seen = new Set<string>();
          for (const st of body.statements) {
            walkWorkflowStmtExprsDeep(st, (e) => {
              if (e.kind !== "call" || e.callKind !== "remote-api-op" || !e.remoteApiOp) return;
              const server = guarded.get(e.remoteApiOp.resourceName);
              if (!server || seen.has(e.remoteApiOp.resourceName)) return;
              seen.add(e.remoteApiOp.resourceName);
              out.push({
                deployable: dep,
                resource: e.remoteApiOp.resourceName,
                server,
                site: body.label,
                why: "reactor",
              });
            });
          }
        }
      }
    }
  }
  return out;
}
