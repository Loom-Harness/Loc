"""Notification HTTP routes + wire DTOs.  Auto-generated."""

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, RootModel
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated

from app.db.engine import get_session
from app.db.repositories.notification_repository import NotificationRepository
from app.dispatch import make_dispatcher
from app.domain.errors import ForbiddenError
from app.domain.ids import NotificationId
from app.domain.value_objects import Channel
from app.http.problem import ProblemDetails
from app.http.wire_models import Int32

SessionDep = Annotated[AsyncSession, Depends(get_session)]


class NotificationResponse(BaseModel):
    id: str
    recipient: str
    text: str
    sentAt: str
    via: Channel
    version: Int32


class NotificationListResponse(RootModel[list[NotificationResponse]]):
    pass




router = APIRouter(prefix="/notifications", tags=["notifications"])


def _repo(session: AsyncSession) -> NotificationRepository:
    return NotificationRepository(session, make_dispatcher(session))


@router.get("", response_model=NotificationListResponse, operation_id="allNotification", responses={403: {"model": ProblemDetails, "description": "Forbidden"}})
async def all_notifications(session: SessionDep) -> list[dict[str, object]]:
    if not (True):
        raise ForbiddenError("Forbidden: find all")
    repo = _repo(session)
    return [repo.to_wire(root) for root in await repo.all()]


@router.get("/{id}", response_model=NotificationResponse, operation_id="getNotificationById", responses={404: {"model": ProblemDetails, "description": "Not Found"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def get_notification_by_id(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], session: SessionDep) -> dict[str, object]:
    repo = _repo(session)
    return repo.to_wire(await repo.get_by_id(NotificationId(id)))
