"""SQLAlchemy persistence model.  Auto-generated."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, Text, Uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class NotificationRow(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        {"schema": "notifications"},
    )

    id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
    recipient: Mapped[str] = mapped_column(Uuid(as_uuid=False))
    text: Mapped[str] = mapped_column(Text)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    via: Mapped[str] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer)


class notifyTransferRow(Base):
    __tablename__ = "notify_transfers"
    __table_args__ = ({"schema": "notifications"},)

    transfer_ref: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True)
