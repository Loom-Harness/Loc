"""Domain events + the dispatcher boundary.  Auto-generated."""

from dataclasses import dataclass
from datetime import datetime
from typing import ClassVar, Protocol

from app.domain.ids import TransferId


@dataclass(frozen=True)
class TransferCompleted:
    type: ClassVar[str] = "TransferCompleted"
    transfer: TransferId
    at: datetime


DomainEvent = TransferCompleted


class DomainEventDispatcher(Protocol):
    """Pluggable boundary for events drained from aggregates by the
    repository.  Replace the no-op default with an outbox writer /
    message-bus publisher to wire events into your infrastructure.
    """

    async def dispatch(self, event: DomainEvent) -> None: ...


class NoopDomainEventDispatcher:
    async def dispatch(self, event: DomainEvent) -> None:
        return None
