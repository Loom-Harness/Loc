// Auto-generated.  Do not edit by hand.
// Realtime SSE wire (channels.md, Part I): events carried by a
// `delivery: broadcast` channel stream to connected browsers at
// GET /realtime/events.  v1 is broadcast-to-all (no rooms); the
// authorized read remains the gate — clients refetch through it.
import { OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import type { DomainEventDispatcher } from "../domain/events";
import type * as Events from "../domain/events";

/** Events carried by a broadcast channel — the UI-observable set. */
export const REALTIME_EVENT_TYPES: ReadonlySet<string> = new Set(["MonthEnd", "TransferCompleted"]);

type Subscriber = (event: Events.DomainEvent) => void;
const subscribers = new Set<Subscriber>();

/** Fan a carried event out to every connected SSE subscriber. */
export function publishRealtime(event: Events.DomainEvent): void {
  if (!REALTIME_EVENT_TYPES.has(event.type)) return;
  for (const s of subscribers) s(event);
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

/** The SSE endpoint — one long-lived stream per browser connection.
 *  Each event writes `event: <Type>` + the JSON payload; a comment-only
 *  ping every 15s keeps proxies from idling the connection out. */
export function realtimeRoutes(): OpenAPIHono {
  const app = new OpenAPIHono();
  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const sub: Subscriber = (event) => {
        void stream.writeSSE({ data: JSON.stringify(event), event: event.type });
      };
      subscribers.add(sub);
      stream.onAbort(() => {
        subscribers.delete(sub);
      });
      while (!stream.aborted) {
        await stream.writeSSE({ data: "", event: "ping" });
        await stream.sleep(15000);
      }
    }),
  );
  return app;
}
