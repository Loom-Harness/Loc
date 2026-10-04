"""In-process event dispatch (channels.md).  Auto-generated."""


from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels import publish_event
from app.db.repositories.notification_repository import NotificationRepository
from app.db.schema import notifyTransferRow
from app.domain.events import DomainEvent, DomainEventDispatcher, TransferCompleted
from app.domain.notification import Notification
from app.realtime import RealtimeDispatcher
from app.obs.log import in_child_context
from app.domain.value_objects import Channel

async def _load_notify_transfer(session: AsyncSession, key: str) -> notifyTransferRow | None:
    return (
        await session.execute(select(notifyTransferRow).where(notifyTransferRow.transfer_ref == key).limit(1))
    ).scalars().first()

@in_child_context
async def _notify_transfer_create_transfer_completed(
    session: AsyncSession, events: "InProcessDispatcher", e: TransferCompleted
) -> None:
    __key = str(e.transfer)
    state = await _load_notify_transfer(session, __key)
    if state is None:
        state = notifyTransferRow(transfer_ref=__key)
        session.add(state)
    notifications = NotificationRepository(session, events)
    n = Notification.create(recipient=e.transfer, text="Your transfer completed", sent_at=e.at, via=Channel.Email)
    await notifications.save(n)
    await session.flush()

class InProcessDispatcher:
    """Routes each emitted event to its subscribed workflow handlers;
    a handler's own emits re-enter, so choreography chains run.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def dispatch(self, event: DomainEvent) -> None:
        if isinstance(event, TransferCompleted):
            await _notify_transfer_create_transfer_completed(self._session, self, event)


class ChannelTeeDispatcher:
    """Delivery-uniformity tee (channels.md, design §4): an event carried
    by a broker-bound channel is PUBLISHED and not fanned out locally —
    co-located consumers receive it through their subscription exactly
    like remote ones.  Everything else passes to the inner dispatcher.
    """

    def __init__(self, inner: DomainEventDispatcher) -> None:
        self._inner = inner

    async def dispatch(self, event: DomainEvent) -> None:
        if await publish_event(event):
            return
        await self._inner.dispatch(event)


def make_dispatcher(session: AsyncSession) -> "ChannelTeeDispatcher":
    return ChannelTeeDispatcher(RealtimeDispatcher(InProcessDispatcher(session)))
