"""Branded id types — one NewType per aggregate / part.  Auto-generated."""

from typing import NewType
from uuid6 import uuid7

OrganizationId = NewType("OrganizationId", str)
CustomerId = NewType("CustomerId", str)
SiteId = NewType("SiteId", str)
AssetId = NewType("AssetId", str)
TechnicianId = NewType("TechnicianId", str)
PartId = NewType("PartId", str)
WorkOrderId = NewType("WorkOrderId", str)
PhotoId = NewType("PhotoId", str)
WorkOrderLineId = NewType("WorkOrderLineId", str)
InvoiceId = NewType("InvoiceId", str)


def new_organization_id() -> OrganizationId:
    return OrganizationId(str(uuid7()))


def new_customer_id() -> CustomerId:
    return CustomerId(str(uuid7()))


def new_site_id() -> SiteId:
    return SiteId(str(uuid7()))


def new_asset_id() -> AssetId:
    return AssetId(str(uuid7()))


def new_technician_id() -> TechnicianId:
    return TechnicianId(str(uuid7()))


def new_part_id() -> PartId:
    return PartId(str(uuid7()))


def new_work_order_id() -> WorkOrderId:
    return WorkOrderId(str(uuid7()))


def new_photo_id() -> PhotoId:
    return PhotoId(str(uuid7()))


def new_work_order_line_id() -> WorkOrderLineId:
    return WorkOrderLineId(str(uuid7()))


def new_invoice_id() -> InvoiceId:
    return InvoiceId(str(uuid7()))
