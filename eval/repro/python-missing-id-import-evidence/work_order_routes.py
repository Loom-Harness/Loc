"""WorkOrder HTTP routes + wire DTOs.  Auto-generated."""

from datetime import datetime

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from pydantic import BaseModel, Field, RootModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated

from app.auth.user import User
from app.db.engine import get_session
from app.db.repositories.work_order_repository import WorkOrderRepository
from app.dispatch import make_dispatcher
from app.domain.errors import ForbiddenError
from app.domain.work_order import WorkOrder
from app.domain.ids import PartId, TechnicianId, WorkOrderId
from app.domain.file_ref import FileRef
from app.domain.value_objects import LineKind, Money, Priority, WorkOrderStatus
from app.http.problem import ProblemDetails, problem
from app.http.wire_models import Money as MoneyModel, UuidStr, Int32, WireStr
from app.obs.log import log
from app.obs.metrics import record_domain_operation

SessionDep = Annotated[AsyncSession, Depends(get_session)]


class PhotoResponse(BaseModel):
    id: str
    file: FileRef
    caption: str


class WorkOrderLineResponse(BaseModel):
    id: str
    kind: LineKind
    description: str
    partId: str | None = None
    quantity: Int32
    unitPrice: MoneyModel
    subtotal: MoneyModel


class WorkOrderResponse(BaseModel):
    id: str
    customerId: str
    siteId: str
    assetId: str | None = None
    technicianId: str | None = None
    technicianUserId: str | None = None
    status: WorkOrderStatus
    priority: Priority
    currency: str
    scheduledAt: str | None = None
    startedAt: str | None = None
    completedAt: str | None = None
    internalReferenceCode: str | None = None
    dispatcherNotes: str | None = None
    version: Int32
    lines: list[WorkOrderLineResponse]
    photos: list[PhotoResponse]
    display: str
    total: MoneyModel


class WorkOrderListResponse(RootModel[list[WorkOrderResponse]]):
    pass


class WorkOrderPaged(BaseModel):
    items: list[WorkOrderResponse]
    page: int
    pageSize: int
    total: int
    totalPages: int


class CreateWorkOrderRequest(BaseModel):
    customerId: UuidStr
    siteId: UuidStr
    assetId: UuidStr | None = None
    technicianId: UuidStr | None = None
    technicianUserId: WireStr | None = None
    status: WorkOrderStatus
    priority: Priority
    currency: WireStr
    scheduledAt: datetime | None = None
    startedAt: datetime | None = None
    completedAt: datetime | None = None
    internalReferenceCode: WireStr | None = None
    dispatcherNotes: WireStr | None = None


class CreateWorkOrderResponse(BaseModel):
    id: str


class AssignTechnicianWorkOrderRequest(BaseModel):
    assignTo: UuidStr
    assignedUserId: WireStr
    at: datetime


class StartWorkOrderRequest(BaseModel):
    pass


class AddLineWorkOrderRequest(BaseModel):
    kind: LineKind
    description: WireStr
    partId: UuidStr | None = None
    quantity: Int32 = Field(ge=1)
    unitPrice: MoneyModel


class CompleteWorkOrderRequest(BaseModel):
    note: WireStr


class CancelWorkOrderRequest(BaseModel):
    pass


class NotifyCustomerWorkOrderRequest(BaseModel):
    pass


class AttachPhotoWorkOrderRequest(BaseModel):
    file: FileRef
    caption: WireStr


class UpdateWorkOrderRequest(BaseModel):
    customerId: UuidStr
    siteId: UuidStr
    assetId: UuidStr | None = None
    technicianId: UuidStr | None = None
    technicianUserId: WireStr | None = None
    status: WorkOrderStatus
    priority: Priority
    currency: WireStr
    scheduledAt: datetime | None = None
    startedAt: datetime | None = None
    completedAt: datetime | None = None
    internalReferenceCode: WireStr | None = None
    dispatcherNotes: WireStr | None = None




router = APIRouter(prefix="/work_orders", tags=["work_orders"])


def _repo(session: AsyncSession) -> WorkOrderRepository:
    return WorkOrderRepository(session, make_dispatcher(session))


@router.post("", status_code=201, response_model=CreateWorkOrderResponse, operation_id="createWorkOrder", responses={400: {"model": ProblemDetails, "description": "Bad Request"}, 415: {"model": ProblemDetails, "description": "Unsupported Media Type"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def create_work_order(body: CreateWorkOrderRequest, request: Request, session: SessionDep) -> dict[str, object]:
    current_user: User = request.state.current_user
    created = WorkOrder.create(customer_id=CustomerId(body.customerId), site_id=SiteId(body.siteId), asset_id=(AssetId(body.assetId) if body.assetId is not None else None), technician_id=(TechnicianId(body.technicianId) if body.technicianId is not None else None), technician_user_id=body.technicianUserId, status=body.status, priority=body.priority, currency=body.currency, scheduled_at=body.scheduledAt, started_at=body.startedAt, completed_at=body.completedAt, internal_reference_code=body.internalReferenceCode, dispatcher_notes=body.dispatcherNotes)
    created._stamp_on_create(current_user)
    await _repo(session).save(created)
    log("info", "aggregate_created", aggregate="WorkOrder", id=created.id)
    record_domain_operation("WorkOrder", "create")
    return {"id": created.id}


@router.get("", response_model=WorkOrderPaged, operation_id="allWorkOrder", responses={422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def all_work_orders(session: SessionDep, page: Annotated[int, Query(ge=1, le=1000000)] = 1, pageSize: Annotated[int, Query(ge=1, le=500)] = 20, sort: str = "id", dir: str = "asc") -> dict[str, object]:
    repo = _repo(session)
    result = await repo.all(page, pageSize, sort, dir)
    return {
        "items": [repo.to_wire(r) for r in result.items],
        "page": result.page,
        "pageSize": result.page_size,
        "total": result.total,
        "totalPages": result.total_pages,
    }


@router.get("/mine", response_model=WorkOrderListResponse, operation_id="mineWorkOrder")
async def mine_work_orders(request: Request, session: SessionDep) -> list[dict[str, object]]:
    current_user: User = request.state.current_user
    repo = _repo(session)
    return [repo.to_wire(r) for r in await repo.mine(current_user)]


@router.get("/across_all_tenants", response_model=WorkOrderListResponse, operation_id="acrossAllTenantsWorkOrder", responses={403: {"model": ProblemDetails, "description": "Forbidden"}})
async def across_all_tenants_work_orders(request: Request, session: SessionDep) -> list[dict[str, object]]:
    current_user: User = request.state.current_user
    if not (current_user.role == "platformAdmin"):
        raise ForbiddenError("Forbidden: find acrossAllTenants")
    repo = _repo(session)
    return [repo.to_wire(r) for r in await repo.across_all_tenants()]


@router.get("/{id}", response_model=WorkOrderResponse, operation_id="getWorkOrderById", responses={404: {"model": ProblemDetails, "description": "Not Found"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def get_work_order_by_id(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], session: SessionDep) -> dict[str, object]:
    repo = _repo(session)
    return repo.to_wire(await repo.get_by_id(WorkOrderId(id)))


@router.delete("/{id}", status_code=204, operation_id="destroyWorkOrder", responses={404: {"model": ProblemDetails, "description": "Not Found"}, 409: {"model": ProblemDetails, "description": "Conflict"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def destroy_work_order(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], request: Request, session: SessionDep) -> Response:
    repo = _repo(session)
    await repo.get_by_id(WorkOrderId(id))
    try:
        await repo.delete(WorkOrderId(id))
    except IntegrityError:
        await session.rollback()
        return problem(
            request,
            409,
            "Conflict",
            "WorkOrder is still referenced and cannot be deleted.",
        )
    return Response(status_code=204)


@router.post("/{id}/assign_technician", status_code=204, operation_id="assignTechnicianWorkOrder", responses={400: {"model": ProblemDetails, "description": "Bad Request"}, 403: {"model": ProblemDetails, "description": "Forbidden"}, 404: {"model": ProblemDetails, "description": "Not Found"}, 415: {"model": ProblemDetails, "description": "Unsupported Media Type"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def assign_technician_work_order(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], body: AssignTechnicianWorkOrderRequest, request: Request, session: SessionDep) -> Response:
    current_user: User = request.state.current_user
    repo = _repo(session)
    found = await repo.get_by_id(WorkOrderId(id))
    log("info", "operation_invoked", aggregate="WorkOrder", op="assignTechnician", id=id)
    record_domain_operation("WorkOrder", "assignTechnician")
    if not (current_user.role == "admin" or current_user.role == "dispatcher"):
        raise ForbiddenError("Forbidden: currentUser.role == \"admin\" || currentUser.role == \"dispatcher\"")
    found.assign_technician(TechnicianId(body.assignTo), body.assignedUserId, body.at)
    _if_match = request.headers.get("if-match", "").strip(chr(34))
    _expected = int(_if_match) if _if_match.isdigit() else None
    await repo.save(found, expected_version=_expected)
    return Response(status_code=204)


@router.post("/{id}/start", status_code=204, operation_id="startWorkOrder", responses={400: {"model": ProblemDetails, "description": "Bad Request"}, 404: {"model": ProblemDetails, "description": "Not Found"}, 415: {"model": ProblemDetails, "description": "Unsupported Media Type"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def start_work_order(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], body: StartWorkOrderRequest, request: Request, session: SessionDep) -> Response:
    repo = _repo(session)
    found = await repo.get_by_id(WorkOrderId(id))
    log("info", "operation_invoked", aggregate="WorkOrder", op="start", id=id)
    record_domain_operation("WorkOrder", "start")
    found.start()
    _if_match = request.headers.get("if-match", "").strip(chr(34))
    _expected = int(_if_match) if _if_match.isdigit() else None
    await repo.save(found, expected_version=_expected)
    return Response(status_code=204)


@router.post("/{id}/add_line", status_code=204, operation_id="addLineWorkOrder", responses={400: {"model": ProblemDetails, "description": "Bad Request"}, 404: {"model": ProblemDetails, "description": "Not Found"}, 415: {"model": ProblemDetails, "description": "Unsupported Media Type"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def add_line_work_order(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], body: AddLineWorkOrderRequest, request: Request, session: SessionDep) -> Response:
    repo = _repo(session)
    found = await repo.get_by_id(WorkOrderId(id))
    log("info", "operation_invoked", aggregate="WorkOrder", op="addLine", id=id)
    record_domain_operation("WorkOrder", "addLine")
    found.add_line(body.kind, body.description, (PartId(body.partId) if body.partId is not None else None), body.quantity, Money(body.unitPrice.amount, body.unitPrice.currency))
    _if_match = request.headers.get("if-match", "").strip(chr(34))
    _expected = int(_if_match) if _if_match.isdigit() else None
    await repo.save(found, expected_version=_expected)
    return Response(status_code=204)


@router.post("/{id}/complete", status_code=204, operation_id="completeWorkOrder", responses={400: {"model": ProblemDetails, "description": "Bad Request"}, 404: {"model": ProblemDetails, "description": "Not Found"}, 415: {"model": ProblemDetails, "description": "Unsupported Media Type"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def complete_work_order(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], body: CompleteWorkOrderRequest, request: Request, session: SessionDep) -> Response:
    repo = _repo(session)
    found = await repo.get_by_id(WorkOrderId(id))
    log("info", "operation_invoked", aggregate="WorkOrder", op="complete", id=id)
    record_domain_operation("WorkOrder", "complete")
    found.complete(body.note)
    _if_match = request.headers.get("if-match", "").strip(chr(34))
    _expected = int(_if_match) if _if_match.isdigit() else None
    await repo.save(found, expected_version=_expected)
    return Response(status_code=204)


@router.post("/{id}/cancel", status_code=204, operation_id="cancelWorkOrder", responses={400: {"model": ProblemDetails, "description": "Bad Request"}, 404: {"model": ProblemDetails, "description": "Not Found"}, 415: {"model": ProblemDetails, "description": "Unsupported Media Type"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def cancel_work_order(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], body: CancelWorkOrderRequest, request: Request, session: SessionDep) -> Response:
    repo = _repo(session)
    found = await repo.get_by_id(WorkOrderId(id))
    log("info", "operation_invoked", aggregate="WorkOrder", op="cancel", id=id)
    record_domain_operation("WorkOrder", "cancel")
    found.cancel()
    _if_match = request.headers.get("if-match", "").strip(chr(34))
    _expected = int(_if_match) if _if_match.isdigit() else None
    await repo.save(found, expected_version=_expected)
    return Response(status_code=204)


@router.post("/{id}/notify_customer", status_code=204, operation_id="notifyCustomerWorkOrder", responses={400: {"model": ProblemDetails, "description": "Bad Request"}, 404: {"model": ProblemDetails, "description": "Not Found"}, 415: {"model": ProblemDetails, "description": "Unsupported Media Type"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def notify_customer_work_order(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], body: NotifyCustomerWorkOrderRequest, request: Request, session: SessionDep) -> Response:
    repo = _repo(session)
    found = await repo.get_by_id(WorkOrderId(id))
    log("info", "operation_invoked", aggregate="WorkOrder", op="notifyCustomer", id=id)
    record_domain_operation("WorkOrder", "notifyCustomer")
    found.notify_customer()
    _if_match = request.headers.get("if-match", "").strip(chr(34))
    _expected = int(_if_match) if _if_match.isdigit() else None
    await repo.save(found, expected_version=_expected)
    return Response(status_code=204)


@router.post("/{id}/attach_photo", status_code=204, operation_id="attachPhotoWorkOrder", responses={400: {"model": ProblemDetails, "description": "Bad Request"}, 404: {"model": ProblemDetails, "description": "Not Found"}, 415: {"model": ProblemDetails, "description": "Unsupported Media Type"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def attach_photo_work_order(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], body: AttachPhotoWorkOrderRequest, request: Request, session: SessionDep) -> Response:
    repo = _repo(session)
    found = await repo.get_by_id(WorkOrderId(id))
    log("info", "operation_invoked", aggregate="WorkOrder", op="attachPhoto", id=id)
    record_domain_operation("WorkOrder", "attachPhoto")
    found.attach_photo(body.file, body.caption)
    _if_match = request.headers.get("if-match", "").strip(chr(34))
    _expected = int(_if_match) if _if_match.isdigit() else None
    await repo.save(found, expected_version=_expected)
    return Response(status_code=204)


@router.post("/{id}/update", status_code=204, operation_id="updateWorkOrder", responses={400: {"model": ProblemDetails, "description": "Bad Request"}, 404: {"model": ProblemDetails, "description": "Not Found"}, 409: {"model": ProblemDetails, "description": "Conflict"}, 415: {"model": ProblemDetails, "description": "Unsupported Media Type"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def update_work_order(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], body: UpdateWorkOrderRequest, request: Request, session: SessionDep) -> Response:
    repo = _repo(session)
    found = await repo.get_by_id(WorkOrderId(id))
    log("info", "operation_invoked", aggregate="WorkOrder", op="update", id=id)
    record_domain_operation("WorkOrder", "update")
    found.update(CustomerId(body.customerId), SiteId(body.siteId), (AssetId(body.assetId) if body.assetId is not None else None), (TechnicianId(body.technicianId) if body.technicianId is not None else None), body.technicianUserId, body.status, body.priority, body.currency, body.scheduledAt, body.startedAt, body.completedAt, body.internalReferenceCode, body.dispatcherNotes)
    _if_match = request.headers.get("if-match", "").strip(chr(34))
    _expected = int(_if_match) if _if_match.isdigit() else None
    await repo.save(found, expected_version=_expected)
    return Response(status_code=204)
