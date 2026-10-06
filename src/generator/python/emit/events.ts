import type { BoundedContextIR, EventIR } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { snake } from "../../../util/naming.js";
import { PY_IMPORTS } from "../../_imports/python.js";
import { PY } from "../py-symbols.js";
import { renderPyType } from "../render-expr.js";

// ---------------------------------------------------------------------------
// `app/domain/events.py` — one frozen dataclass per event (class
// identity is the discriminator; the `type` ClassVar carries the wire
// tag for the event-sourcing store, S14), a `DomainEvent` union alias,
// and the pluggable dispatcher boundary with its no-op default.
// ---------------------------------------------------------------------------

export function renderPyEvents(ctx: BoundedContextIR): string {
  const hasEvents = ctx.events.length > 0;
  // Every import is derived from the body (M-T9.84).
  return lines(
    `"""Domain events + the dispatcher boundary.  Auto-generated."""`,
    "",
    PY_IMPORTS,
    ...ctx.events.flatMap(renderPyEvent),
    "",
    "",
    hasEvents
      ? `DomainEvent = ${ctx.events.map((e) => e.name).join(" | ")}`
      : `DomainEvent = ${PY.Never}`,
    "",
    "",
    `class DomainEventDispatcher(${PY.Protocol}):`,
    `    """Pluggable boundary for events drained from aggregates by the`,
    "    repository.  Replace the no-op default with an outbox writer /",
    "    message-bus publisher to wire events into your infrastructure.",
    `    """`,
    "",
    "    async def dispatch(self, event: DomainEvent) -> None: ...",
    "",
    "",
    "class NoopDomainEventDispatcher:",
    "    async def dispatch(self, event: DomainEvent) -> None:",
    "        return None",
    "",
  );
}

function renderPyEvent(ev: EventIR): string[] {
  return [
    "",
    "",
    `@${PY.dataclass}(frozen=True)`,
    `class ${ev.name}:`,
    `    type: ${PY.ClassVar}[str] = "${ev.name}"`,
    ...ev.fields.map((f) => `    ${snake(f.name)}: ${renderPyType(f.type)}`),
  ];
}
