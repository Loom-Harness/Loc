"""Invoice HTTP routes + wire DTOs.  Auto-generated."""

from fastapi import APIRouter, Depends, Path, Query, Request, Response
from pydantic import BaseModel, Field, RootModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Annotated

from app.auth.user import User
from app.db.engine import get_session
from app.db.repositories.invoice_repository import InvoiceRepository
from app.dispatch import make_dispatcher
from app.domain.invoice import Invoice
from app.domain.ids import InvoiceId
from app.http.problem import ProblemDetails, problem
from app.http.wire_models import UuidStr, Int32, WireStr, WireNum
from app.obs.log import log
from app.obs.metrics import record_domain_operation

SessionDep = Annotated[AsyncSession, Depends(get_session)]


class InvoiceResponse(BaseModel):
    id: str
    workOrderId: str
    customerId: str
    currency: str
    amount: WireNum
    issued: bool
    createdAt: str
    updatedAt: str
    createdBy: str
    updatedBy: str
    version: Int32


class InvoiceListResponse(RootModel[list[InvoiceResponse]]):
    pass


class InvoicePaged(BaseModel):
    items: list[InvoiceResponse]
    page: int
    pageSize: int
    total: int
    totalPages: int


class CreateInvoiceRequest(BaseModel):
    workOrderId: UuidStr
    customerId: UuidStr
    currency: WireStr
    amount: WireNum = Field(ge=0)
    issued: bool = False


class CreateInvoiceResponse(BaseModel):
    id: str


class IssueInvoiceRequest(BaseModel):
    pass


class UpdateInvoiceRequest(BaseModel):
    workOrderId: UuidStr
    customerId: UuidStr
    currency: WireStr
    amount: WireNum = Field(ge=0)
    issued: bool




router = APIRouter(prefix="/invoices", tags=["invoices"])


def _repo(session: AsyncSession) -> InvoiceRepository:
    return InvoiceRepository(session, make_dispatcher(session))


@router.post("", status_code=201, response_model=CreateInvoiceResponse, operation_id="createInvoice", responses={400: {"model": ProblemDetails, "description": "Bad Request"}, 415: {"model": ProblemDetails, "description": "Unsupported Media Type"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def create_invoice(body: CreateInvoiceRequest, request: Request, session: SessionDep) -> dict[str, object]:
    current_user: User = request.state.current_user
    created = Invoice.create(work_order_id=WorkOrderId(body.workOrderId), customer_id=CustomerId(body.customerId), currency=body.currency, amount=body.amount, issued=body.issued)
    created._stamp_on_create(current_user)
    await _repo(session).save(created)
    log("info", "aggregate_created", aggregate="Invoice", id=created.id)
    record_domain_operation("Invoice", "create")
    return {"id": created.id}


@router.get("", response_model=InvoicePaged, operation_id="allInvoice", responses={422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def all_invoices(session: SessionDep, page: Annotated[int, Query(ge=1, le=1000000)] = 1, pageSize: Annotated[int, Query(ge=1, le=500)] = 20, sort: str = "id", dir: str = "asc") -> dict[str, object]:
    repo = _repo(session)
    result = await repo.all(page, pageSize, sort, dir)
    return {
        "items": [repo.to_wire(r) for r in result.items],
        "page": result.page,
        "pageSize": result.page_size,
        "total": result.total,
        "totalPages": result.total_pages,
    }


@router.get("/{id}", response_model=InvoiceResponse, operation_id="getInvoiceById", responses={404: {"model": ProblemDetails, "description": "Not Found"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def get_invoice_by_id(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], session: SessionDep) -> dict[str, object]:
    repo = _repo(session)
    return repo.to_wire(await repo.get_by_id(InvoiceId(id)))


@router.delete("/{id}", status_code=204, operation_id="destroyInvoice", responses={404: {"model": ProblemDetails, "description": "Not Found"}, 409: {"model": ProblemDetails, "description": "Conflict"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def destroy_invoice(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], request: Request, session: SessionDep) -> Response:
    repo = _repo(session)
    await repo.get_by_id(InvoiceId(id))
    try:
        await repo.delete(InvoiceId(id))
    except IntegrityError:
        await session.rollback()
        return problem(
            request,
            409,
            "Conflict",
            "Invoice is still referenced and cannot be deleted.",
        )
    return Response(status_code=204)


@router.post("/{id}/issue", status_code=204, operation_id="issueInvoice", responses={400: {"model": ProblemDetails, "description": "Bad Request"}, 404: {"model": ProblemDetails, "description": "Not Found"}, 415: {"model": ProblemDetails, "description": "Unsupported Media Type"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def issue_invoice(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], body: IssueInvoiceRequest, request: Request, session: SessionDep) -> Response:
    current_user: User = request.state.current_user
    repo = _repo(session)
    found = await repo.get_by_id(InvoiceId(id))
    log("info", "operation_invoked", aggregate="Invoice", op="issue", id=id)
    record_domain_operation("Invoice", "issue")
    found.issue()
    found._stamp_on_update(current_user)
    _if_match = request.headers.get("if-match", "").strip(chr(34))
    _expected = int(_if_match) if _if_match.isdigit() else None
    await repo.save(found, expected_version=_expected)
    return Response(status_code=204)


@router.post("/{id}/update", status_code=204, operation_id="updateInvoice", responses={400: {"model": ProblemDetails, "description": "Bad Request"}, 404: {"model": ProblemDetails, "description": "Not Found"}, 409: {"model": ProblemDetails, "description": "Conflict"}, 415: {"model": ProblemDetails, "description": "Unsupported Media Type"}, 422: {"model": ProblemDetails, "description": "Unprocessable Entity"}})
async def update_invoice(id: Annotated[str, Path(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", json_schema_extra={"format": "uuid"})], body: UpdateInvoiceRequest, request: Request, session: SessionDep) -> Response:
    current_user: User = request.state.current_user
    repo = _repo(session)
    found = await repo.get_by_id(InvoiceId(id))
    log("info", "operation_invoked", aggregate="Invoice", op="update", id=id)
    record_domain_operation("Invoice", "update")
    found.update(WorkOrderId(body.workOrderId), CustomerId(body.customerId), body.currency, body.amount, body.issued)
    found._stamp_on_update(current_user)
    _if_match = request.headers.get("if-match", "").strip(chr(34))
    _expected = int(_if_match) if _if_match.isdigit() else None
    await repo.save(found, expected_version=_expected)
    return Response(status_code=204)
