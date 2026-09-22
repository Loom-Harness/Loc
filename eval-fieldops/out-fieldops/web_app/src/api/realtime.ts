// Auto-generated.  Do not edit by hand.
// Realtime SSE client (channels.md Part I) — subscribes to the backend's
// GET /realtime/events stream.  Events carried by a `delivery: broadcast`
// channel arrive as `{ type, ...fields }`; the connection auto-reconnects
// (EventSource semantics).  The authorized read remains the gate — refetch
// through the API for anything privileged.
import { API_BASE_URL } from "./config";

export type RealtimeEvent = { type: string } & Record<string, unknown>;

/** Event types the backend's broadcast channels carry. */
export const REALTIME_EVENT_TYPES = ["WorkOrderCompleted"] as const;

/** Subscribe to the realtime stream.  Returns an unsubscribe fn that
 *  closes the EventSource.  `onEvent` fires once per carried event. */
export function subscribeRealtime(onEvent: (event: RealtimeEvent) => void): () => void {
  const source = new EventSource(`${API_BASE_URL}/realtime/events`);
  const handler = (m: MessageEvent) => {
    try {
      onEvent(JSON.parse(m.data as string) as RealtimeEvent);
    } catch {
      // Malformed frame — skip (keep the stream alive).
    }
  };
  for (const t of REALTIME_EVENT_TYPES) source.addEventListener(t, handler);
  return () => source.close();
}
