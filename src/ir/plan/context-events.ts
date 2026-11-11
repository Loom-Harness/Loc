// Whether a context routes any event through the transactional outbox: some
// channel it publishes on asks for durability (`retention: log | work`).  The
// outbox table, its relay, the reactor's `last_event_id` dedupe column and the
// migration that creates them all hang on this one answer, so a backend that
// asked it differently would emit a reactor that dedupes against a column the
// migrations never created.

import type { BoundedContextIR } from "../types/loom-ir.js";
import { durableEventTypes } from "../util/channels.js";

/** True when `ctx` carries at least one durable event type. */
export function hasDurableEvents(ctx: BoundedContextIR): boolean {
  return durableEventTypes(ctx).size > 0;
}
