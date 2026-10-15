"""Notification aggregate.  Auto-generated."""

from datetime import datetime

from app.domain.events import DomainEvent
from app.domain.ids import NotificationId, TransferId, new_notification_id
from app.domain.value_objects import Channel


class Notification:
    def __init__(self, *, id: NotificationId, recipient: TransferId, text: str, sent_at: datetime, via: Channel, version: int, _trust_store: bool = False) -> None:
        self._id = id
        self._recipient = recipient
        self._text = text
        self._sent_at = sent_at
        self._via = via
        self._version = version
        self._events: list[DomainEvent] = []
        if not _trust_store:
            self._assert_invariants()

    @property
    def id(self) -> NotificationId:
        return self._id

    @property
    def recipient(self) -> TransferId:
        return self._recipient

    @property
    def text(self) -> str:
        return self._text

    @property
    def sent_at(self) -> datetime:
        return self._sent_at

    @property
    def via(self) -> Channel:
        return self._via

    @property
    def version(self) -> int:
        return self._version

    @property
    def inspect(self) -> str:
        return "Notification(" + "id: " + str(self._id) + ", " + "recipient: " + str(self._recipient) + ", " + "text: " + "'" + self._text + "'" + ", " + "sentAt: " + self._sent_at.isoformat() + ", " + "via: " + str(self._via) + ", " + "version: " + str(self._version) + ")"

    def __repr__(self) -> str:
        return self.inspect

    def pull_events(self) -> list[DomainEvent]:
        out = self._events
        self._events = []
        return out

    def _assert_invariants(self) -> None:
        pass

    @classmethod
    def _create(cls, *, id: NotificationId, recipient: TransferId, text: str, sent_at: datetime, via: Channel, version: int) -> "Notification":
        return cls(id=id, recipient=recipient, text=text, sent_at=sent_at, via=via, version=version)

    # Reconstitution from the store — trusts persisted state, so no
    # invariant run: invariants guard transitions (create + operations),
    # not loads.  Repository hydration only; domain code constructs via
    # `create`/`_create`, which assert.
    @classmethod
    def _rehydrate(cls, *, id: NotificationId, recipient: TransferId, text: str, sent_at: datetime, via: Channel, version: int) -> "Notification":
        return cls(id=id, recipient=recipient, text=text, sent_at=sent_at, via=via, version=version, _trust_store=True)

    @classmethod
    def create(cls, *, recipient: TransferId, text: str, sent_at: datetime, via: Channel) -> "Notification":
        return cls(
            id=new_notification_id(),
            recipient=recipient,
            text=text,
            sent_at=sent_at,
            via=via,
            version=1,
        )
