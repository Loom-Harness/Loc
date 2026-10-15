"""Broker channel transport (channels.md).  Auto-generated.

Redis/Valkey pub/sub carries CloudEvents 1.0
envelopes between deployables; the consumer side feeds received events
into the same in-process dispatcher local reactors use.  The publish
half of the delivery-uniformity tee lives here (`publish_event`); the
tee itself wraps `make_dispatcher` in app.dispatch.
"""

import asyncio
import json
import os
from datetime import UTC, datetime
from typing import cast

import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from app.db.engine import engine
from app.domain.events import DomainEvent, TransferCompleted
from app.domain.ids import TransferId
from app.obs.log import log

# The deployable's wired bindings: broker address per channelSource, with
# the connection URL injected by compose/k8s as LOOM_CHANNEL_<NAME>_URL.
# `group` is the durable queue the deployable's replicas COMPETE on for
# `queue` channels (design §4: one queue per consuming deployable).
CHANNEL_BINDINGS: list[dict[str, str]] = [
    {"cs_name": "transferBus", "address": "loom.Banking.TransferEvents", "env_var": "LOOM_CHANNEL_TRANSFER_BUS_URL", "context": "Banking", "transport": "redis", "group": "loom.Banking.TransferEvents.notify"},
]

# event type -> broker address (first carrying broker-bound channel,
# mirroring the in-process dispatcher's first-by-declaration rule).
# Ephemeral events publish inline in the tee; durable (`work`) events
# pass through to the outbox and publish on relay drain (design §5).
CHANNEL_ROUTING: dict[str, str] = {
    "TransferCompleted": "loom.Banking.TransferEvents",
}

DURABLE_CHANNEL_ROUTING: dict[str, str] = {
}


def _event_to_data(event: DomainEvent) -> dict[str, object]:
    if isinstance(event, TransferCompleted):
        return {"transfer": event.transfer, "at": event.at.isoformat()}
    raise ValueError(f"event not carried by a wired channel: {type(event).__name__}")


def _event_from_data(event_type: str, payload: dict[str, object]) -> DomainEvent:
    if event_type == "TransferCompleted":
        return TransferCompleted(transfer=TransferId(cast(str, payload["transfer"])), at=datetime.fromisoformat(cast(str, payload["at"])))
    raise ValueError(f"unknown carried event type: {event_type}")


class RedisChannelTransport:
    """Redis (Valkey) driver — pub/sub over redis.asyncio.  A dedicated
    connection is required for subscribe mode by the redis protocol.
    """

    def __init__(self, url: str) -> None:
        self._pub = aioredis.Redis.from_url(url)
        self._sub = self._pub.pubsub()

    async def publish(self, address: str, envelope: dict[str, object]) -> None:
        await self._pub.publish(address, json.dumps(envelope))

    async def subscribe(self, *addresses: str) -> None:
        await self._sub.subscribe(*addresses)

    async def get_message(self, timeout: float) -> "dict[str, object] | None":
        # redis-py's pubsub surface is Any-typed; narrow at the boundary.
        message = await self._sub.get_message(ignore_subscribe_messages=True, timeout=timeout)
        return cast("dict[str, object] | None", message)

    async def close(self) -> None:
        await self._sub.aclose()
        await self._pub.aclose()


# One shared transport per broker URL for the process (publisher tee and
# consumer side reuse the same connections), keyed by channelSource name.
_transports: dict[str, RedisChannelTransport] = {}


def init_channel_transports() -> None:
    by_url: dict[str, RedisChannelTransport] = {}
    for binding in CHANNEL_BINDINGS:
        url = os.environ.get(binding["env_var"])
        if not url:
            raise RuntimeError(
                f"channel binding '{binding['cs_name']}' needs {binding['env_var']} "
                "(the broker URL compose/k8s injects)"
            )
        transport = by_url.get(url)
        if transport is None:
            transport = RedisChannelTransport(url)
            by_url[url] = transport
        _transports[binding["cs_name"]] = transport


async def close_channel_transports() -> None:
    for transport in {id(t): t for t in _transports.values()}.values():
        await transport.close()
    _transports.clear()


def _envelope_for(
    event: DomainEvent, address: str, event_id: "str | None" = None
) -> dict[str, object]:
    context = next((b["context"] for b in CHANNEL_BINDINGS if b["address"] == address), "")
    return {
        "specversion": "1.0",
        # Relay-published (durable) events reuse their outbox row id — the
        # stable consumer-side idempotency key across broker redeliveries.
        "id": event_id if event_id is not None else str(uuid7()),
        "type": f"{context}.{event.type}",
        "source": f"/loom/{context}",
        "time": datetime.now(UTC).isoformat(),
        "datacontenttype": "application/json",
        "loomchannel": address,
        "data": _event_to_data(event),
    }


async def _publish_to(address: str, envelope: dict[str, object], event_type: str) -> None:
    binding = next((b for b in CHANNEL_BINDINGS if b["address"] == address), None)
    transport = _transports.get(binding["cs_name"]) if binding else None
    if transport is None:
        raise RuntimeError(f"no transport wired for channel address {address}")
    await transport.publish(address, envelope)
    log("info", "channel_published", address=address, type=event_type, id=envelope["id"])


async def publish_event(event: DomainEvent) -> bool:
    """The publish half of the delivery-uniformity rule (design §4): an
    EPHEMERAL broker-routed event is published — co-located consumers
    receive it through their subscription, never a local shortcut.
    Returns False for everything else: unrouted events fall through to the
    in-process dispatch, and durable (`work`) events fall through to the
    outbox dispatcher, publishing on relay drain instead (design §5).
    """
    address = CHANNEL_ROUTING.get(event.type)
    if address is None:
        return False
    await _publish_to(address, _envelope_for(event, address), event.type)
    return True


async def _consume_one(envelope: dict[str, object]) -> None:
    # Deferred import: app.dispatch imports this module for the tee, so
    # the reverse edge must not exist at module-load time.
    from app.dispatch import InProcessDispatcher

    full_type = cast(str, envelope["type"])
    bare = full_type.split(".", 1)[-1]
    event = _event_from_data(bare, cast("dict[str, object]", envelope["data"]))
    async with AsyncSession(engine) as session:
        await InProcessDispatcher(session).dispatch(event)
        await session.commit()
    log(
        "info",
        "channel_consumed",
        address=cast(str, envelope["loomchannel"]),
        type=full_type,
        id=cast(str, envelope["id"]),
    )


async def _consume_redis_raw(raw: object) -> None:
    await _consume_one(cast("dict[str, object]", json.loads(cast(bytes, raw))))


async def _run_channel_consumers() -> None:
    """Consumer side: subscribes every wired address (competing-consumer
    group on `queue` channels, broadcast otherwise) and dispatches
    received envelopes into the in-process dispatcher, so reactors and
    event-triggered creates run identically for local and remote events.
    """
    subscribed: set[int] = set()
    transports: list[RedisChannelTransport] = []
    for binding in CHANNEL_BINDINGS:
        transport = _transports[binding["cs_name"]]
        if id(transport) not in subscribed:
            subscribed.add(id(transport))
            transports.append(transport)
        await transport.subscribe(binding["address"])
    _subscribed.set()
    while True:
        for transport in transports:
            message = await transport.get_message(timeout=0.25)
            if message is None:
                continue
            try:
                await _consume_redis_raw(message["data"])
            except Exception as exc:  # noqa: BLE001 — keep the subscription alive
                raw_addr = message.get("channel")
                addr = raw_addr.decode() if isinstance(raw_addr, bytes) else str(raw_addr)
                log(
                    "warn",
                    "channel_consume_failed",
                    address=addr,
                    error=str(exc),
                )


_subscribed = asyncio.Event()


async def start_channel_consumers() -> "asyncio.Task[None]":
    task = asyncio.create_task(_run_channel_consumers())
    waiter = asyncio.create_task(_subscribed.wait())
    done, _pending = await asyncio.wait(
        {task, waiter}, return_when=asyncio.FIRST_COMPLETED
    )
    if task in done:
        # Subscribing failed (or returned early); surface it at boot
        # rather than waiting on an event that will never be set.
        waiter.cancel()
        task.result()
    return task
