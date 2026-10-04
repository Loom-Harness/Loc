"""Branded id types — one NewType per aggregate / part.  Auto-generated."""

from typing import NewType
from uuid6 import uuid7

NotificationId = NewType("NotificationId", str)
TransferId = NewType("TransferId", str)


def new_notification_id() -> NotificationId:
    return NotificationId(str(uuid7()))


def new_transfer_id() -> TransferId:
    return TransferId(str(uuid7()))
