"""Notification repository.  Auto-generated."""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.schema import NotificationRow
from app.db.wire import iso
from app.domain.errors import AggregateNotFoundError, ConcurrencyError
from app.domain.events import DomainEventDispatcher
from app.domain.ids import NotificationId, TransferId
from app.domain.notification import Notification
from app.domain.value_objects import Channel
from app.obs.log import log


class NotificationRepository:
    def __init__(self, session: AsyncSession, events: DomainEventDispatcher) -> None:
        self._session = session
        self._events = events

    async def find_by_id(self, id: NotificationId) -> Notification | None:
        row = await self._session.get(NotificationRow, id)
        if row is None:
            return None
        return await self._hydrate(row)

    async def get_by_id(self, id: NotificationId) -> Notification:
        found = await self.find_by_id(id)
        log("debug", "aggregate_loaded", aggregate="Notification", id=str(id), found=found is not None)
        if found is None:
            raise AggregateNotFoundError(f"Notification {id} not found")
        return found

    async def all(self) -> list[Notification]:
        rows = (await self._session.execute(select(NotificationRow))).scalars().all()
        return [await self._hydrate(row) for row in rows]

    async def find_many_by_ids(self, ids: list[NotificationId]) -> list[Notification]:
        rows = (await self._session.execute(select(NotificationRow).where(NotificationRow.id.in_(list(ids))))).scalars().all()
        return [await self._hydrate(row) for row in rows]

    async def save(self, aggregate: Notification, expected_version: int | None = None) -> None:
        root = {
            "id": aggregate.id,
            "recipient": aggregate.recipient,
            "text": aggregate.text,
            "sent_at": aggregate.sent_at,
            "via": aggregate.via,
            "version": aggregate.version,
        }
        _expected = aggregate.version if expected_version is None else expected_version
        _guarded = await self._session.execute(
            insert(NotificationRow)
            .values(**root)
            .on_conflict_do_update(
                index_elements=["id"],
                set_={"recipient": root["recipient"], "text": root["text"], "sent_at": root["sent_at"], "via": root["via"], "version": NotificationRow.version + 1},
                where=NotificationRow.version == _expected,
            )
            .returning(NotificationRow.id)
        )
        if _guarded.first() is None:
            raise ConcurrencyError(f"Notification {aggregate.id} was modified concurrently")
        await self._session.flush()
        log("debug", "repository_save", aggregate="Notification", id=str(aggregate.id))

    async def _hydrate(self, row: NotificationRow) -> Notification:
        return Notification._rehydrate(
            id=NotificationId(row.id),
            recipient=TransferId(row.recipient),
            text=row.text,
            sent_at=row.sent_at,
            via=Channel(row.via),
            version=row.version,
        )

    def to_wire(self, root: Notification) -> dict[str, object]:
        return {
            "id": root.id,
            "recipient": root.recipient,
            "text": root.text,
            "sentAt": iso(root.sent_at),
            "via": root.via,
            "version": root.version,
        }
