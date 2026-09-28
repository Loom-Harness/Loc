// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import type { WorkOrderRepositoryPort } from "../../domain/repository-ports.ts";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../schema.ts";
import { requireCurrentUser } from "../../auth/middleware.ts";
import { stampInsert, stampUpdate } from "../audit-stamp.ts";
import { WorkOrder, WorkOrderLine } from "../../domain/workOrder.ts";
import type { WorkOrderStatus, Priority } from "../../domain/value-objects.ts";
import * as Ids from "../../domain/ids.ts";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors.ts";
import type { DomainEventDispatcher } from "../../domain/events.ts";
import { requestLog } from "../../obs/als.ts";

type Db = NodePgDatabase<typeof schema>;

const mineAsTechnicianCriterion = () => eq(schema.workOrders.technicianUserId, requireCurrentUser().id);

export class WorkOrderRepository implements WorkOrderRepositoryPort {
  private readonly db: Db;
  private readonly events: DomainEventDispatcher;
  constructor(
    db: Db,
    events: DomainEventDispatcher,
  ) {
    this.db = db;
    this.events = events;
  }

  async findById(id: Ids.WorkOrderId): Promise<WorkOrder | null> {
    return await this.db.transaction(async (tx) => {
      const rootRows = await tx.select().from(schema.workOrders).where(and(eq(schema.workOrders.id, id), eq(schema.workOrders.tenantId, requireCurrentUser().orgId)));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "WorkOrder", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const linesRows = await tx.select().from(schema.workOrderLines).where(eq(schema.workOrderLines.parentId, id));
      const lines = linesRows.map((r) => WorkOrderLine._rehydrate({ id: Ids.WorkOrderLineId(r.id), parentId: Ids.WorkOrderId(r.parentId), description: r.description, quantity: Number(r.quantity), unitPrice: new Decimal(r.unitPrice), currency: r.currency }));
      const loaded = WorkOrder._rehydrate({ id: Ids.WorkOrderId(root.id), customerId: Ids.CustomerId(root.customerId), siteId: Ids.SiteId(root.siteId), assetId: (root.assetId == null ? null : Ids.AssetId(root.assetId)), technicianId: (root.technicianId == null ? null : Ids.TechnicianId(root.technicianId)), technicianUserId: (root.technicianUserId == null ? null : root.technicianUserId), status: root.status as WorkOrderStatus, priority: root.priority as Priority, currency: root.currency, scheduledAt: (root.scheduledAt == null ? null : root.scheduledAt), startedAt: (root.startedAt == null ? null : root.startedAt), completedAt: (root.completedAt == null ? null : root.completedAt), resolutionNote: (root.resolutionNote == null ? null : root.resolutionNote), photo: (root.photo == null ? null : (root.photo as { url: string; key: string; contentType: string; size: number })), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), createdAt: root.createdAt, updatedAt: root.updatedAt, createdBy: root.createdBy, updatedBy: root.updatedBy, version: root.version, lines });
      requestLog().debug({ event: "aggregate_loaded", aggregate: "WorkOrder", id: id as string, found: true });
      return loaded;
    });
  }

  async getById(id: Ids.WorkOrderId): Promise<WorkOrder> {
    const found = await this.findById(id);
    if (!found) throw new AggregateNotFoundError(`WorkOrder ${id} not found`);
    return found;
  }

  async findManyByIds(ids: Ids.WorkOrderId[]): Promise<WorkOrder[]> {
    if (ids.length === 0) return [];
    const rootRows = await this.db.select().from(schema.workOrders).where(and(inArray(schema.workOrders.id, ids), eq(schema.workOrders.tenantId, requireCurrentUser().orgId)));
    if (rootRows.length === 0) return [];
    const rootIds = rootRows.map((r) => r.id);
    const linesRows = await this.db.select().from(schema.workOrderLines).where(inArray(schema.workOrderLines.parentId, rootIds));
    const linesByParent = new Map<string, WorkOrderLine[]>();
    for (const r of linesRows) {
      const list = linesByParent.get(r.parentId) ?? [];
      list.push(WorkOrderLine._rehydrate({ id: Ids.WorkOrderLineId(r.id), parentId: Ids.WorkOrderId(r.parentId), description: r.description, quantity: Number(r.quantity), unitPrice: new Decimal(r.unitPrice), currency: r.currency }));
      linesByParent.set(r.parentId, list);
    }
    return rootRows.map((root) => WorkOrder._rehydrate({ id: Ids.WorkOrderId(root.id), customerId: Ids.CustomerId(root.customerId), siteId: Ids.SiteId(root.siteId), assetId: (root.assetId == null ? null : Ids.AssetId(root.assetId)), technicianId: (root.technicianId == null ? null : Ids.TechnicianId(root.technicianId)), technicianUserId: (root.technicianUserId == null ? null : root.technicianUserId), status: root.status as WorkOrderStatus, priority: root.priority as Priority, currency: root.currency, scheduledAt: (root.scheduledAt == null ? null : root.scheduledAt), startedAt: (root.startedAt == null ? null : root.startedAt), completedAt: (root.completedAt == null ? null : root.completedAt), resolutionNote: (root.resolutionNote == null ? null : root.resolutionNote), photo: (root.photo == null ? null : (root.photo as { url: string; key: string; contentType: string; size: number })), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), createdAt: root.createdAt, updatedAt: root.updatedAt, createdBy: root.createdBy, updatedBy: root.updatedBy, version: root.version, lines: linesByParent.get(root.id) ?? [] }));
  }

  async save(aggregate: WorkOrder, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.workOrders.id }).from(schema.workOrders).where(eq(schema.workOrders.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.workOrders).values(stampInsert({ id: aggregate.id as string, customerId: aggregate.customerId as string, siteId: aggregate.siteId as string, assetId: aggregate.assetId as string, technicianId: aggregate.technicianId as string, technicianUserId: aggregate.technicianUserId, status: aggregate.status, priority: aggregate.priority, currency: aggregate.currency, scheduledAt: aggregate.scheduledAt, startedAt: aggregate.startedAt, completedAt: aggregate.completedAt, resolutionNote: aggregate.resolutionNote, photo: aggregate.photo, tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, createdAt: aggregate.createdAt, updatedAt: aggregate.updatedAt, createdBy: aggregate.createdBy, updatedBy: aggregate.updatedBy, version: 1 }));
      } else {
        const updated = await tx.update(schema.workOrders).set(stampUpdate({ id: aggregate.id as string, customerId: aggregate.customerId as string, siteId: aggregate.siteId as string, assetId: aggregate.assetId as string, technicianId: aggregate.technicianId as string, technicianUserId: aggregate.technicianUserId, status: aggregate.status, priority: aggregate.priority, currency: aggregate.currency, scheduledAt: aggregate.scheduledAt, startedAt: aggregate.startedAt, completedAt: aggregate.completedAt, resolutionNote: aggregate.resolutionNote, photo: aggregate.photo, tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, createdAt: aggregate.createdAt, updatedAt: aggregate.updatedAt, createdBy: aggregate.createdBy, updatedBy: aggregate.updatedBy, version: expected + 1 })).where(and(eq(schema.workOrders.id, aggregate.id), eq(schema.workOrders.version, expected))).returning({ id: schema.workOrders.id });
        if (updated.length === 0) throw new ConcurrencyError("WorkOrder", aggregate.id as string);
      }

      const existingLines = await tx.select({ id: schema.workOrderLines.id }).from(schema.workOrderLines).where(eq(schema.workOrderLines.parentId, aggregate.id));
      const existingIdsLines = new Set(existingLines.map((r) => r.id));
      const currentIdsLines = new Set(aggregate.lines.map((e) => e.id as string));
      const toDeleteLines = [...existingIdsLines].filter((id) => !currentIdsLines.has(id));
      if (toDeleteLines.length > 0) {
        await tx.delete(schema.workOrderLines).where(and(eq(schema.workOrderLines.parentId, aggregate.id), inArray(schema.workOrderLines.id, toDeleteLines)));
      }
      for (const child of aggregate.lines) {
        const childRow = { id: child.id as string, parentId: child.parentId as string, description: child.description, quantity: String(child.quantity), unitPrice: child.unitPrice.toString(), currency: child.currency };
        await tx.insert(schema.workOrderLines).values(childRow).onConflictDoUpdate({ target: schema.workOrderLines.id, set: childRow });
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "WorkOrder", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "WorkOrder", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: WorkOrder[]; page: number; pageSize: number; total: number; totalPages: number }> {
    const offset = (page - 1) * pageSize;
    const sortColumns: Record<string, AnyPgColumn> = { "id": schema.workOrders.id, "status": schema.workOrders.status, "priority": schema.workOrders.priority, "currency": schema.workOrders.currency, "createdAt": schema.workOrders.createdAt, "updatedAt": schema.workOrders.updatedAt, "createdBy": schema.workOrders.createdBy, "updatedBy": schema.workOrders.updatedBy };
    const sortColumn = Object.hasOwn(sortColumns, sort) ? sortColumns[sort]! : schema.workOrders.id;
    const orderBy = dir === "desc" ? desc(sortColumn) : asc(sortColumn);
    const countRows = await this.db.select({ value: count() }).from(schema.workOrders).where(eq(schema.workOrders.tenantId, requireCurrentUser().orgId));
    const total = Number(countRows[0]?.value ?? 0);
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    const rootRows = await this.db.select().from(schema.workOrders).where(eq(schema.workOrders.tenantId, requireCurrentUser().orgId)).orderBy(orderBy).limit(pageSize).offset(offset);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "WorkOrder", find: "all", rows: 0 });
      return { items: [], page, pageSize, total, totalPages };
    }
    const rootIds = rootRows.map((r) => r.id);
    const linesRows = await this.db.select().from(schema.workOrderLines).where(inArray(schema.workOrderLines.parentId, rootIds));
    const linesByParent = new Map<string, WorkOrderLine[]>();
    for (const r of linesRows) {
      const list = linesByParent.get(r.parentId) ?? [];
      list.push(WorkOrderLine._rehydrate({ id: Ids.WorkOrderLineId(r.id), parentId: Ids.WorkOrderId(r.parentId), description: r.description, quantity: Number(r.quantity), unitPrice: new Decimal(r.unitPrice), currency: r.currency }));
      linesByParent.set(r.parentId, list);
    }
    const items = rootRows.map((root) => WorkOrder._rehydrate({ id: Ids.WorkOrderId(root.id), customerId: Ids.CustomerId(root.customerId), siteId: Ids.SiteId(root.siteId), assetId: (root.assetId == null ? null : Ids.AssetId(root.assetId)), technicianId: (root.technicianId == null ? null : Ids.TechnicianId(root.technicianId)), technicianUserId: (root.technicianUserId == null ? null : root.technicianUserId), status: root.status as WorkOrderStatus, priority: root.priority as Priority, currency: root.currency, scheduledAt: (root.scheduledAt == null ? null : root.scheduledAt), startedAt: (root.startedAt == null ? null : root.startedAt), completedAt: (root.completedAt == null ? null : root.completedAt), resolutionNote: (root.resolutionNote == null ? null : root.resolutionNote), photo: (root.photo == null ? null : (root.photo as { url: string; key: string; contentType: string; size: number })), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), createdAt: root.createdAt, updatedAt: root.updatedAt, createdBy: root.createdBy, updatedBy: root.updatedBy, version: root.version, lines: linesByParent.get(root.id) ?? [] }));
    requestLog().debug({ event: "find_executed", aggregate: "WorkOrder", find: "all", rows: items.length });
    return { items, page, pageSize, total, totalPages };
  }

  async openByStatus(): Promise<WorkOrder[]> {
    const rootRows = await this.db.select().from(schema.workOrders).where(eq(schema.workOrders.tenantId, requireCurrentUser().orgId));
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "WorkOrder", find: "openByStatus", rows: 0 });
      return [];
    }
    const rootIds = rootRows.map((r) => r.id);
    const linesRows = await this.db.select().from(schema.workOrderLines).where(inArray(schema.workOrderLines.parentId, rootIds));
    const linesByParent = new Map<string, WorkOrderLine[]>();
    for (const r of linesRows) {
      const list = linesByParent.get(r.parentId) ?? [];
      list.push(WorkOrderLine._rehydrate({ id: Ids.WorkOrderLineId(r.id), parentId: Ids.WorkOrderId(r.parentId), description: r.description, quantity: Number(r.quantity), unitPrice: new Decimal(r.unitPrice), currency: r.currency }));
      linesByParent.set(r.parentId, list);
    }
    const result = rootRows.map((root) => WorkOrder._rehydrate({ id: Ids.WorkOrderId(root.id), customerId: Ids.CustomerId(root.customerId), siteId: Ids.SiteId(root.siteId), assetId: (root.assetId == null ? null : Ids.AssetId(root.assetId)), technicianId: (root.technicianId == null ? null : Ids.TechnicianId(root.technicianId)), technicianUserId: (root.technicianUserId == null ? null : root.technicianUserId), status: root.status as WorkOrderStatus, priority: root.priority as Priority, currency: root.currency, scheduledAt: (root.scheduledAt == null ? null : root.scheduledAt), startedAt: (root.startedAt == null ? null : root.startedAt), completedAt: (root.completedAt == null ? null : root.completedAt), resolutionNote: (root.resolutionNote == null ? null : root.resolutionNote), photo: (root.photo == null ? null : (root.photo as { url: string; key: string; contentType: string; size: number })), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), createdAt: root.createdAt, updatedAt: root.updatedAt, createdBy: root.createdBy, updatedBy: root.updatedBy, version: root.version, lines: linesByParent.get(root.id) ?? [] }));
    requestLog().debug({ event: "find_executed", aggregate: "WorkOrder", find: "openByStatus", rows: result.length });
    return result;
  }

  async runMyWorkOrders(page?: { offset?: number; limit?: number }): Promise<WorkOrder[]> {
    let query = this.db.select().from(schema.workOrders).where(and(mineAsTechnicianCriterion(), eq(schema.workOrders.tenantId, requireCurrentUser().orgId))).orderBy(desc(schema.workOrders.priority)).$dynamic();
    if (page?.limit !== undefined) query = query.limit(page.limit);
    if (page?.offset !== undefined) query = query.offset(page.offset);
    const rootRows = await query;
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "WorkOrder", find: "runMyWorkOrders", rows: 0 });
      return [];
    }
    const rootIds = rootRows.map((r) => r.id);
    const linesRows = await this.db.select().from(schema.workOrderLines).where(inArray(schema.workOrderLines.parentId, rootIds));
    const linesByParent = new Map<string, WorkOrderLine[]>();
    for (const r of linesRows) {
      const list = linesByParent.get(r.parentId) ?? [];
      list.push(WorkOrderLine._rehydrate({ id: Ids.WorkOrderLineId(r.id), parentId: Ids.WorkOrderId(r.parentId), description: r.description, quantity: Number(r.quantity), unitPrice: new Decimal(r.unitPrice), currency: r.currency }));
      linesByParent.set(r.parentId, list);
    }
    const result = rootRows.map((root) => WorkOrder._rehydrate({ id: Ids.WorkOrderId(root.id), customerId: Ids.CustomerId(root.customerId), siteId: Ids.SiteId(root.siteId), assetId: (root.assetId == null ? null : Ids.AssetId(root.assetId)), technicianId: (root.technicianId == null ? null : Ids.TechnicianId(root.technicianId)), technicianUserId: (root.technicianUserId == null ? null : root.technicianUserId), status: root.status as WorkOrderStatus, priority: root.priority as Priority, currency: root.currency, scheduledAt: (root.scheduledAt == null ? null : root.scheduledAt), startedAt: (root.startedAt == null ? null : root.startedAt), completedAt: (root.completedAt == null ? null : root.completedAt), resolutionNote: (root.resolutionNote == null ? null : root.resolutionNote), photo: (root.photo == null ? null : (root.photo as { url: string; key: string; contentType: string; size: number })), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), createdAt: root.createdAt, updatedAt: root.updatedAt, createdBy: root.createdBy, updatedBy: root.updatedBy, version: root.version, lines: linesByParent.get(root.id) ?? [] }));
    requestLog().debug({ event: "find_executed", aggregate: "WorkOrder", find: "runMyWorkOrders", rows: result.length });
    return result;
  }

  toWire(root: WorkOrder): unknown {
    return { id: root.id as string, customerId: root.customerId as string, siteId: root.siteId as string, assetId: (root.assetId == null ? null : root.assetId as string), technicianId: (root.technicianId == null ? null : root.technicianId as string), technicianUserId: (root.technicianUserId == null ? null : root.technicianUserId), status: root.status as string, priority: root.priority as string, currency: root.currency, scheduledAt: (root.scheduledAt == null ? null : (root.scheduledAt == null ? null : (root.scheduledAt as Date).toISOString().replace(/\.?0+Z$/, "Z"))), startedAt: (root.startedAt == null ? null : (root.startedAt == null ? null : (root.startedAt as Date).toISOString().replace(/\.?0+Z$/, "Z"))), completedAt: (root.completedAt == null ? null : (root.completedAt == null ? null : (root.completedAt as Date).toISOString().replace(/\.?0+Z$/, "Z"))), resolutionNote: (root.resolutionNote == null ? null : root.resolutionNote), photo: (root.photo == null ? null : root.photo), createdAt: (root.createdAt as Date).toISOString().replace(/\.?0+Z$/, "Z"), updatedAt: (root.updatedAt as Date).toISOString().replace(/\.?0+Z$/, "Z"), createdBy: root.createdBy, updatedBy: root.updatedBy, version: root.version, lines: root.lines.map((e: WorkOrderLine) => ({ id: e.id as string, description: e.description, quantity: e.quantity, unitPrice: e.unitPrice.toFixed(4), currency: e.currency, amount: e.amount.toFixed(4) })), total: root.total.toFixed(4), display: root.display, timeToComplete: root.timeToComplete };
  }

}
//# sourceMappingURL=workOrder-repository.ts.map
