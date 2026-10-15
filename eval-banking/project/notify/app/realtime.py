"""Realtime SSE wire (channels.md Part I).  Auto-generated.

Events carried by a `delivery: broadcast` channel stream to connected
browsers at GET /realtime/events.  v1 is broadcast-to-all (no rooms, no
auth beyond the ordinary session); the authorized read remains the gate —
clients refetch through the API rather than trust payloads.
"""

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.domain.events import DomainEvent, DomainEventDispatcher, TransferCompleted

# Events carried by a broadcast channel — the UI-observable set.
REALTIME_EVENT_TYPES: frozenset[str] = frozenset({"TransferCompleted"})

_subscribers: set[asyncio.Queue[str]] = set()


def _event_to_frame(event: DomainEvent) -> str | None:
    """One SSE frame (`event: <Type>` + JSON data) for a carried event,
    or None when the event isn't UI-observable."""
    if isinstance(event, TransferCompleted):
        data = json.dumps({"type": "TransferCompleted", "transfer": event.transfer, "at": event.at.isoformat()})
        return f"event: TransferCompleted\ndata: {data}\n\n"
    return None


def publish_realtime(event: DomainEvent) -> None:
    """Fan a carried event out to every connected SSE subscriber."""
    frame = _event_to_frame(event)
    if frame is None:
        return
    for queue in _subscribers:
        queue.put_nowait(frame)


class RealtimeDispatcher:
    """Dispatcher decorator: every dispatched event also reaches the SSE
    wire, then delegates (mirrors Hono's realtimeTee) — so durable (relayed)
    and ephemeral (inline) events both stream."""

    def __init__(self, inner: DomainEventDispatcher) -> None:
        self._inner = inner

    async def dispatch(self, event: DomainEvent) -> None:
        publish_realtime(event)
        await self._inner.dispatch(event)


realtime_router = APIRouter()


@realtime_router.get("/realtime/events", include_in_schema=False)
async def realtime_events() -> StreamingResponse:
    """One long-lived SSE stream per browser connection, with a 15s
    keep-alive ping so proxies don't idle the connection out."""
    queue: asyncio.Queue[str] = asyncio.Queue()
    _subscribers.add(queue)

    async def _stream() -> AsyncIterator[str]:
        try:
            while True:
                try:
                    yield await asyncio.wait_for(queue.get(), timeout=15.0)
                except TimeoutError:
                    yield "event: ping\ndata: \n\n"
        finally:
            _subscribers.discard(queue)

    return StreamingResponse(_stream(), media_type="text/event-stream")
