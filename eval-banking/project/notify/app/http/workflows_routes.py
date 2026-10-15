"""Workflow routes.  Auto-generated."""

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, RootModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated

from app.db.engine import get_session
from app.db.schema import notifyTransferRow
from app.domain.errors import AggregateNotFoundError, ForbiddenError
from app.http.problem import ProblemDetails

SessionDep = Annotated[AsyncSession, Depends(get_session)]


class NotifyTransferInstanceResponse(BaseModel):
    transferRef: str


class NotifyTransferInstanceListResponse(RootModel[list[NotifyTransferInstanceResponse]]):
    pass

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.get("/notify_transfer/instances", response_model=NotifyTransferInstanceListResponse, operation_id="allNotifyTransferInstances", responses={403: {"model": ProblemDetails, "description": "Forbidden"}})
async def notify_transfer_instances(session: SessionDep) -> list[dict[str, object]]:
    if not (True):
        raise ForbiddenError("Forbidden: workflow notifyTransfer instances")
    rows = (await session.execute(select(notifyTransferRow))).scalars().all()
    return [{"transferRef": row.transfer_ref} for row in rows]


@router.get("/notify_transfer/instances/{id}", response_model=NotifyTransferInstanceResponse, operation_id="getNotifyTransferInstanceById", responses={403: {"model": ProblemDetails, "description": "Forbidden"}, 404: {"model": ProblemDetails, "description": "Not Found"}})
async def notify_transfer_instance(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], session: SessionDep) -> dict[str, object]:
    if not (True):
        raise ForbiddenError("Forbidden: workflow notifyTransfer instances")
    row = await session.get(notifyTransferRow, id)
    if row is None:
        raise AggregateNotFoundError(f"NotifyTransfer {id} not found")
    return {"transferRef": row.transfer_ref}
