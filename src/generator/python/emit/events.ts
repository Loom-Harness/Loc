import { eventsKeepOriginFrame } from "../../../ir/enrich/stream-tenancy.js";
import type { BoundedContextIR, EventIR } from "../../../ir/types/loom-ir.js";
import { lines } from "../../../util/code-builder.js";
import { PY_IMPORTS, pyRef } from "../../_imports/python.js";
import { DOMAIN_NAMES } from "../../_symbols/plan.js";
import { PY } from "../py-symbols.js";
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
    "",
    ...POST_COMMIT_LINES,
    ...(hasEvents ? ["", "", ...postCommitDispatcherLines(eventsKeepOriginFrame(ctx))] : []),
    "",
  );
}

/** The request's post-commit work list.  `TransactionMiddleware` sets a fresh
 *  list per HTTP request, runs it after `session.commit()` and drops it on a
 *  rollback; off the request path (seeds, the outbox relay, the scheduler, a
 *  broker consumer) it is `None`, and dispatch stays immediate. */
const CONTEXT_VAR = pyRef("contextvars", "ContextVar");
const CALLABLE = pyRef("collections.abc", "Callable");
const AWAITABLE = pyRef("collections.abc", "Awaitable");

const POST_COMMIT_LINES: readonly string[] = [
  "# Work owed once the current request's transaction COMMITS (D-WRITE-TX).",
  "# TransactionMiddleware (app/db/transaction.py) opens one list per request,",
  "# runs it after the commit and drops it on a rollback.  None off the request",
  "# path (seeds, relay, scheduler, consumers): dispatch there stays immediate.",
  `post_commit: ${CONTEXT_VAR}[list[${CALLABLE}[[], ${AWAITABLE}[None]]] | None] = ${CONTEXT_VAR}(`,
  '    "loom_post_commit", default=None',
  ")",
];

const COPY_CONTEXT = pyRef("contextvars", "copy_context");
const CREATE_TASK = pyRef("asyncio", "create_task");

/** The outermost link `make_dispatcher` returns (app/dispatch.py).
 *
 *  `keepFrame`: some aggregate may dispatch inside an event-origin frame of
 *  its own (`eventsKeepOriginFrame`: a tenant-scoped stream's, or a
 *  tenantOwned row's), which has closed again by the
 *  time the post-commit list runs.  The queued delivery then runs in a copy of
 *  the RAISING context, so the outbox capture, the channel envelope and a
 *  projection fold read the event's own origin. */
function postCommitDispatcherLines(keepFrame: boolean): readonly string[] {
  if (!keepFrame) return POST_COMMIT_DISPATCHER_LINES;
  return [
    ...POST_COMMIT_DISPATCHER_LINES.slice(0, -6),
    "        inner = self._inner",
    "        # The raising frame rides along (its event origin is the event's).",
    `        frame = ${COPY_CONTEXT}()`,
    "",
    "        async def deliver() -> None:",
    "            # Closed in the copy too: work it dispatches in turn runs inline.",
    "            frame.run(post_commit.set, None)",
    `            await ${CREATE_TASK}(inner.dispatch(event), context=frame)`,
    "",
    "        pending.append(deliver)",
  ];
}

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
    `@${PY.dataclass}(frozen=True)`,
    `class ${ev.name}:`,
    `    type: ${PY.ClassVar}[str] = "${ev.name}"`,
    ...ev.fields.map((f) => `    ${DOMAIN_NAMES.python.binding(f.name)}: ${renderPyType(f.type)}`),
  ];
}
