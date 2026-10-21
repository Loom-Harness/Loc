import type { BoundedContextIR, EventIR } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { pythonIdent } from "../../../util/naming.js";
import { emptyPyTypeImports, visitPyTypeImports } from "../py-type-imports.js";
import { renderPyType } from "../render-expr.js";

// ---------------------------------------------------------------------------
// `app/domain/events.py` — one frozen dataclass per event (class
// identity is the discriminator; the `type` ClassVar carries the wire
// tag for the event-sourcing store, S14), a `DomainEvent` union alias,
// and the pluggable dispatcher boundary with its no-op default.
//
// Also the request-wide post-commit seam (D-WRITE-TX, M-T4.3 item 6): the
// `post_commit` ContextVar `TransactionMiddleware` opens per request, and the
// `PostCommitDispatcher` `make_dispatcher` wraps the in-process chain in, so an
// event drained mid-request reaches its reactors / the realtime wire / a broker
// only once the request's single transaction has committed — and never on a
// rollback.  A durable event (outbox) passes straight through: its
// `__loom_outbox` row must commit WITH the write, not after it.
// ---------------------------------------------------------------------------

export function renderPyEvents(ctx: BoundedContextIR): string {
  const types = emptyPyTypeImports();
  for (const ev of ctx.events) for (const f of ev.fields) visitPyTypeImports(f.type, types);
  const idNames = [...types.idNames].sort();
  const voEnumNames = [...new Set([...types.voNames, ...types.enumNames])].sort();
  const hasEvents = ctx.events.length > 0;

  return lines(
    `"""Domain events + the dispatcher boundary.  Auto-generated."""`,
    "",
    "from collections.abc import Awaitable, Callable",
    "from contextvars import ContextVar",
    hasEvents ? "from dataclasses import dataclass" : null,
    types.usesDatetime ? "from datetime import datetime" : null,
    types.usesDecimal ? "from decimal import Decimal" : null,
    hasEvents ? "from typing import ClassVar, Protocol" : "from typing import Never, Protocol",
    idNames.length > 0 || voEnumNames.length > 0 ? "" : null,
    idNames.length > 0
      ? `from app.domain.ids import ${idNames.map((n) => `${n}Id`).join(", ")}`
      : null,
    voEnumNames.length > 0
      ? `from app.domain.value_objects import ${voEnumNames.join(", ")}`
      : null,
    ...ctx.events.flatMap(renderPyEvent),
    "",
    "",
    hasEvents
      ? `DomainEvent = ${ctx.events.map((e) => e.name).join(" | ")}`
      : "DomainEvent = Never",
    "",
    "",
    "class DomainEventDispatcher(Protocol):",
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
    "",
    ...POST_COMMIT_LINES,
    ...(hasEvents ? ["", "", ...POST_COMMIT_DISPATCHER_LINES] : []),
    "",
  );
}

/** The request's post-commit work list.  `TransactionMiddleware` sets a fresh
 *  list per HTTP request, runs it after `session.commit()` and drops it on a
 *  rollback; off the request path (seeds, the outbox relay, the scheduler, a
 *  broker consumer) it is `None`, and dispatch stays immediate. */
const POST_COMMIT_LINES: readonly string[] = [
  "# Work owed once the current request's transaction COMMITS (D-WRITE-TX).",
  "# TransactionMiddleware (app/db/transaction.py) opens one list per request,",
  "# runs it after the commit and drops it on a rollback.  None off the request",
  "# path (seeds, relay, scheduler, consumers): dispatch there stays immediate.",
  "post_commit: ContextVar[list[Callable[[], Awaitable[None]]] | None] = ContextVar(",
  '    "loom_post_commit", default=None',
  ")",
];

/** The outermost link `make_dispatcher` returns (app/dispatch.py). */
const POST_COMMIT_DISPATCHER_LINES: readonly string[] = [
  "class PostCommitDispatcher:",
  `    """Defers an event to the request's post-commit list.`,
  "",
  "    A repository drains its aggregate's events when its write is flushed —",
  "    INSIDE the request transaction, which a later statement can still roll",
  "    back.  Fanning them out there let a reactor, the realtime wire or a",
  "    broker publish observe a write that never committed.  Queued here, they",
  "    run after the commit (in raise order) and vanish on a rollback.  A",
  "    durable event is not deferred: its outbox row commits with the write.",
  `    """`,
  "",
  "    def __init__(",
  "        self, inner: DomainEventDispatcher, durable: frozenset[str] = frozenset()",
  "    ) -> None:",
  "        self._inner = inner",
  "        self._durable = durable",
  "",
  "    async def dispatch(self, event: DomainEvent) -> None:",
  "        pending = post_commit.get()",
  "        if pending is None or event.type in self._durable:",
  "            await self._inner.dispatch(event)",
  "            return",
  "        inner = self._inner",
  "",
  "        async def deliver() -> None:",
  "            await inner.dispatch(event)",
  "",
  "        pending.append(deliver)",
];

function renderPyEvent(ev: EventIR): string[] {
  return [
    "",
    "",
    "@dataclass(frozen=True)",
    `class ${ev.name}:`,
    `    type: ClassVar[str] = "${ev.name}"`,
    ...ev.fields.map((f) => `    ${pythonIdent(f.name)}: ${renderPyType(f.type)}`),
  ];
}
