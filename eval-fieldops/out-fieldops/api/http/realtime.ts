// Auto-generated.  Do not edit by hand.
// Realtime SSE wire (channels.md — rooms + policy-derived routing v1).
// Events carried by a `delivery: broadcast` channel stream to connected
// browsers at GET /realtime/events.  This context hosts tenant-owned
// aggregates, so delivery is scoped by the tenant DataKey
// (`currentUser.orgId`, the equality part of the `tenantOwned` read
// policy): a tenant-scoped event reaches only subscribers in the emitter's
// tenant room — never cross-tenant.  The authorized read remains the gate;
// clients refetch through it.
import { OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import type { DomainEventDispatcher } from "../domain/events.ts";
import type * as Events from "../domain/events.ts";
import { requestContext } from "../obs/als.ts";

/** Events carried by a broadcast channel — the UI-observable set. */
export const REALTIME_EVENT_TYPES: ReadonlySet<string> = new Set(["WorkOrderCompleted"]);

/** Events this tenant-owned context routes to the emitter's tenant room only,
 *  never broadcast cross-tenant — everything it carries except the events
 *  provably about `crossTenant` (shared) data. */
const TENANT_SCOPED_EVENT_TYPES: ReadonlySet<string> = new Set(["WorkOrderCompleted"]);

/** Id-reference (`<Agg> id`) fields kept when a tenant-scoped event can't be
 *  tenant-routed (dispatched with no ambient request — outbox relay drain /
 *  timer scheduler): it degrades to a refetch ticket (type + ids, no scalar
 *  payload) and the authorized read re-gates on refetch.  An event with no id
 *  reference degrades to its `type` alone. */
const EVENT_ID_FIELDS: Record<string, readonly string[]> = {
  WorkOrderCompleted: ["workOrder"],
};

/** A full event or a refetch ticket — both discriminate on `type`. */
type RealtimeFrame = Events.DomainEvent | ({ type: string } & Record<string, unknown>);
type Subscriber = (frame: RealtimeFrame) => void;

/** Every live connection — receives tenant-agnostic (global) events and any
 *  broadcast refetch ticket. */
const subscribers = new Set<Subscriber>();
/** Per-tenant rooms — a connection joins its own tenant's room at connect
 *  (key = `currentUser.orgId`, the bound tenancy claim). */
const rooms = new Map<string, Set<Subscriber>>();

function roomFor(tenant: string): Set<Subscriber> {
  let room = rooms.get(tenant);
  if (!room) {
    room = new Set();
    rooms.set(tenant, room);
  }
  return room;
}

/** The writing request's tenant, off the ambient AsyncLocalStorage frame —
 *  present for inline-dispatched events (the write that caused them),
 *  undefined outside a request (outbox relay drain / timer scheduler). */
function ambientTenant(): string | undefined {
  const user = requestContext()?.currentUser as { orgId?: unknown } | undefined;
  return typeof user?.orgId === "string" ? user.orgId : undefined;
}

/** Strip a tenant-scoped event to a refetch ticket — its type plus the
 *  `<Agg> id` reference fields, no other payload. */
function ticketOf(event: Events.DomainEvent): { type: string } & Record<string, unknown> {
  const ticket: Record<string, unknown> = { type: event.type };
  for (const f of EVENT_ID_FIELDS[event.type] ?? []) {
    ticket[f] = (event as unknown as Record<string, unknown>)[f];
  }
  return ticket as { type: string } & Record<string, unknown>;
}

/** Fan a carried event out to the subscribers its policy admits.  A global
 *  event goes to every connection; a tenant-scoped event goes to the
 *  emitter's tenant room only (full payload — same-tenant is a subset of the
 *  authorized audience).  With no ambient tenant the subset can't be proven,
 *  so it degrades to a refetch ticket broadcast (over-delivery of a ticket is
 *  harmless — the authorized refetch re-gates). */
export function publishRealtime(event: Events.DomainEvent): void {
  if (!REALTIME_EVENT_TYPES.has(event.type)) return;
  if (!TENANT_SCOPED_EVENT_TYPES.has(event.type)) {
    for (const s of subscribers) s(event);
    return;
  }
  const tenant = ambientTenant();
  if (tenant !== undefined) {
    const room = rooms.get(tenant);
    if (room) for (const s of room) s(event);
    return;
  }
  const ticket = ticketOf(event);
  for (const s of subscribers) s(ticket);
}

/** Dispatcher decorator: every dispatched event also reaches the SSE
 *  wire (then delegates).  createApp wraps its default dispatcher with
 *  this, and the outbox relay's inner dispatcher rides through it too —
 *  so durable (relayed) and ephemeral (inline) events both stream. */
export function realtimeTee(inner: DomainEventDispatcher): DomainEventDispatcher {
  return {
    async dispatch(event: Events.DomainEvent): Promise<void> {
      publishRealtime(event);
      await inner.dispatch(event);
    },
  };
}

/** The SSE endpoint — one long-lived stream per browser connection.  The
 *  connection joins its tenant's room (derived from the verified principal on
 *  the request, never a client-supplied value); an unauthenticated connection
 *  joins no room, so it never receives another tenant's payloads.  Each frame
 *  writes `event: <Type>` + JSON; a comment-only ping every 15s keeps proxies
 *  from idling the connection out. */
export function realtimeRoutes(): OpenAPIHono {
  const app = new OpenAPIHono();
  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const principal = (
        c as unknown as { get(k: "currentUser"): { orgId?: unknown } | undefined }
      ).get("currentUser");
      const tenant = typeof principal?.orgId === "string" ? principal.orgId : undefined;
      const sub: Subscriber = (frame) => {
        void stream.writeSSE({ data: JSON.stringify(frame), event: frame.type });
      };
      subscribers.add(sub);
      const room = tenant !== undefined ? roomFor(tenant) : undefined;
      room?.add(sub);
      stream.onAbort(() => {
        subscribers.delete(sub);
        room?.delete(sub);
      });
      while (!stream.aborted) {
        await stream.writeSSE({ data: "", event: "ping" });
        await stream.sleep(15000);
      }
    }),
  );
  return app;
}
