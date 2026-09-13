// Auto-generated.  Do not edit by hand.
import type { WorkOrderRepositoryPort } from "../../domain/repository-ports";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import type { User } from "../../auth/user-types";
import { requireCurrentUser } from "../../auth/middleware";
import { stampInsert, stampUpdate } from "../audit-stamp";
import { WorkOrder, Photo, WorkOrderLine } from "../../domain/workOrder";
import { Money, type WorkOrderStatus, type Priority, type LineKind } from "../../domain/value-objects";
import * as Ids from "../../domain/ids";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors";
import type { DomainEventDispatcher } from "../../domain/events";
import { requestLog } from "../../obs/als";

type Db = NodePgDatabase<typeof schema>;

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
      const rootRows = await tx.select().from(schema.workOrders).where(and(eq(schema.workOrders.id, id), eq(schema.workOrders.tenantId, requireCurrentUser().tenantId)));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "WorkOrder", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const linesRows = await tx.select().from(schema.workOrderLines).where(eq(schema.workOrderLines.parentId, id));
      const lines = linesRows.map((r) => WorkOrderLine._rehydrate({ id: Ids.WorkOrderLineId(r.id), parentId: Ids.WorkOrderId(r.parentId), kind: r.kind as LineKind, description: r.description, partId: (r.partId == null ? null : Ids.PartId(r.partId)), quantity: r.quantity, unitPrice: new Money(Number(r.unitPrice_amount), r.unitPrice_currency) }));
      const photosRows = await tx.select().from(schema.photos).where(eq(schema.photos.parentId, id));
      const photos = photosRows.map((r) => Photo._rehydrate({ id: Ids.PhotoId(r.id), parentId: Ids.WorkOrderId(r.parentId), file: (r.file as { url: string; key: string; contentType: string; size: number }), caption: r.caption }));
      const loaded = WorkOrder._rehydrate({ id: Ids.WorkOrderId(root.id), customerId: Ids.CustomerId(root.customerId), siteId: Ids.SiteId(root.siteId), assetId: (root.assetId == null ? null : Ids.AssetId(root.assetId)), technicianId: (root.technicianId == null ? null : Ids.TechnicianId(root.technicianId)), technicianUserId: (root.technicianUserId == null ? null : root.technicianUserId), status: root.status as WorkOrderStatus, priority: root.priority as Priority, currency: root.currency, scheduledAt: (root.scheduledAt == null ? null : root.scheduledAt), startedAt: (root.startedAt == null ? null : root.startedAt), completedAt: (root.completedAt == null ? null : root.completedAt), resolutionNote: (root.resolutionNote == null ? null : root.resolutionNote), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version, lines, photos });
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
    const rootRows = await this.db.select().from(schema.workOrders).where(and(inArray(schema.workOrders.id, ids), eq(schema.workOrders.tenantId, requireCurrentUser().tenantId)));
    if (rootRows.length === 0) return [];
    const rootIds = rootRows.map((r) => r.id);
    const linesRows = await this.db.select().from(schema.workOrderLines).where(inArray(schema.workOrderLines.parentId, rootIds));
    const linesByParent = new Map<string, WorkOrderLine[]>();
    for (const r of linesRows) {
      const list = linesByParent.get(r.parentId) ?? [];
      list.push(WorkOrderLine._rehydrate({ id: Ids.WorkOrderLineId(r.id), parentId: Ids.WorkOrderId(r.parentId), kind: r.kind as LineKind, description: r.description, partId: (r.partId == null ? null : Ids.PartId(r.partId)), quantity: r.quantity, unitPrice: new Money(Number(r.unitPrice_amount), r.unitPrice_currency) }));
      linesByParent.set(r.parentId, list);
    }
    const photosRows = await this.db.select().from(schema.photos).where(inArray(schema.photos.parentId, rootIds));
    const photosByParent = new Map<string, Photo[]>();
    for (const r of photosRows) {
      const list = photosByParent.get(r.parentId) ?? [];
      list.push(Photo._rehydrate({ id: Ids.PhotoId(r.id), parentId: Ids.WorkOrderId(r.parentId), file: (r.file as { url: string; key: string; contentType: string; size: number }), caption: r.caption }));
      photosByParent.set(r.parentId, list);
    }
    return rootRows.map((root) => WorkOrder._rehydrate({ id: Ids.WorkOrderId(root.id), customerId: Ids.CustomerId(root.customerId), siteId: Ids.SiteId(root.siteId), assetId: (root.assetId == null ? null : Ids.AssetId(root.assetId)), technicianId: (root.technicianId == null ? null : Ids.TechnicianId(root.technicianId)), technicianUserId: (root.technicianUserId == null ? null : root.technicianUserId), status: root.status as WorkOrderStatus, priority: root.priority as Priority, currency: root.currency, scheduledAt: (root.scheduledAt == null ? null : root.scheduledAt), startedAt: (root.startedAt == null ? null : root.startedAt), completedAt: (root.completedAt == null ? null : root.completedAt), resolutionNote: (root.resolutionNote == null ? null : root.resolutionNote), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version, lines: linesByParent.get(root.id) ?? [], photos: photosByParent.get(root.id) ?? [] }));
  }

  async save(aggregate: WorkOrder, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.workOrders.id }).from(schema.workOrders).where(eq(schema.workOrders.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.workOrders).values(stampInsert({ id: aggregate.id as string, customerId: aggregate.customerId as string, siteId: aggregate.siteId as string, assetId: aggregate.assetId as string, technicianId: aggregate.technicianId as string, technicianUserId: aggregate.technicianUserId, status: aggregate.status, priority: aggregate.priority, currency: aggregate.currency, scheduledAt: aggregate.scheduledAt, startedAt: aggregate.startedAt, completedAt: aggregate.completedAt, resolutionNote: aggregate.resolutionNote, tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, version: 1 }));
      } else {
        const updated = await tx.update(schema.workOrders).set(stampUpdate({ id: aggregate.id as string, customerId: aggregate.customerId as string, siteId: aggregate.siteId as string, assetId: aggregate.assetId as string, technicianId: aggregate.technicianId as string, technicianUserId: aggregate.technicianUserId, status: aggregate.status, priority: aggregate.priority, currency: aggregate.currency, scheduledAt: aggregate.scheduledAt, startedAt: aggregate.startedAt, completedAt: aggregate.completedAt, resolutionNote: aggregate.resolutionNote, tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, version: expected + 1 })).where(and(eq(schema.workOrders.id, aggregate.id), eq(schema.workOrders.version, expected))).returning({ id: schema.workOrders.id });
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
        const childRow = { id: child.id as string, parentId: child.parentId as string, kind: child.kind, description: child.description, partId: child.partId as string, quantity: child.quantity, unitPrice_amount: String(child.unitPrice.amount), unitPrice_currency: child.unitPrice.currency };
        await tx.insert(schema.workOrderLines).values(childRow).onConflictDoUpdate({ target: schema.workOrderLines.id, set: childRow });
      }

      const existingPhotos = await tx.select({ id: schema.photos.id }).from(schema.photos).where(eq(schema.photos.parentId, aggregate.id));
      const existingIdsPhotos = new Set(existingPhotos.map((r) => r.id));
      const currentIdsPhotos = new Set(aggregate.photos.map((e) => e.id as string));
      const toDeletePhotos = [...existingIdsPhotos].filter((id) => !currentIdsPhotos.has(id));
      if (toDeletePhotos.length > 0) {
        await tx.delete(schema.photos).where(and(eq(schema.photos.parentId, aggregate.id), inArray(schema.photos.id, toDeletePhotos)));
      }
      for (const child of aggregate.photos) {
        const childRow = { id: child.id as string, parentId: child.parentId as string, file: child.file, caption: child.caption };
        await tx.insert(schema.photos).values(childRow).onConflictDoUpdate({ target: schema.photos.id, set: childRow });
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "WorkOrder", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "WorkOrder", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async delete(id: Ids.WorkOrderId): Promise<void> {
    await this.db.delete(schema.workOrders).where(eq(schema.workOrders.id, id));
  }

  async all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: WorkOrder[]; page: number; pageSize: number; total: number; totalPages: number }> {
    const offset = (page - 1) * pageSize;
    const sortColumns: Record<string, AnyPgColumn> = { "id": schema.workOrders.id, "status": schema.workOrders.status, "priority": schema.workOrders.priority, "currency": schema.workOrders.currency };
    const sortColumn = Object.hasOwn(sortColumns, sort) ? sortColumns[sort]! : schema.workOrders.id;
    const orderBy = dir === "desc" ? desc(sortColumn) : asc(sortColumn);
    const countRows = await this.db.select({ value: count() }).from(schema.workOrders).where(eq(schema.workOrders.tenantId, requireCurrentUser().tenantId));
    const total = Number(countRows[0]?.value ?? 0);
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    const rootRows = await this.db.select().from(schema.workOrders).where(eq(schema.workOrders.tenantId, requireCurrentUser().tenantId)).orderBy(orderBy).limit(pageSize).offset(offset);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "WorkOrder", find: "all", rows: 0 });
      return { items: [], page, pageSize, total, totalPages };
    }
    const rootIds = rootRows.map((r) => r.id);
    const linesRows = await this.db.select().from(schema.workOrderLines).where(inArray(schema.workOrderLines.parentId, rootIds));
    const linesByParent = new Map<string, WorkOrderLine[]>();
    for (const r of linesRows) {
      const list = linesByParent.get(r.parentId) ?? [];
      list.push(WorkOrderLine._rehydrate({ id: Ids.WorkOrderLineId(r.id), parentId: Ids.WorkOrderId(r.parentId), kind: r.kind as LineKind, description: r.description, partId: (r.partId == null ? null : Ids.PartId(r.partId)), quantity: r.quantity, unitPrice: new Money(Number(r.unitPrice_amount), r.unitPrice_currency) }));
      linesByParent.set(r.parentId, list);
    }
    const photosRows = await this.db.select().from(schema.photos).where(inArray(schema.photos.parentId, rootIds));
    const photosByParent = new Map<string, Photo[]>();
    for (const r of photosRows) {
      const list = photosByParent.get(r.parentId) ?? [];
      list.push(Photo._rehydrate({ id: Ids.PhotoId(r.id), parentId: Ids.WorkOrderId(r.parentId), file: (r.file as { url: string; key: string; contentType: string; size: number }), caption: r.caption }));
      photosByParent.set(r.parentId, list);
    }
    const items = rootRows.map((root) => WorkOrder._rehydrate({ id: Ids.WorkOrderId(root.id), customerId: Ids.CustomerId(root.customerId), siteId: Ids.SiteId(root.siteId), assetId: (root.assetId == null ? null : Ids.AssetId(root.assetId)), technicianId: (root.technicianId == null ? null : Ids.TechnicianId(root.technicianId)), technicianUserId: (root.technicianUserId == null ? null : root.technicianUserId), status: root.status as WorkOrderStatus, priority: root.priority as Priority, currency: root.currency, scheduledAt: (root.scheduledAt == null ? null : root.scheduledAt), startedAt: (root.startedAt == null ? null : root.startedAt), completedAt: (root.completedAt == null ? null : root.completedAt), resolutionNote: (root.resolutionNote == null ? null : root.resolutionNote), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version, lines: linesByParent.get(root.id) ?? [], photos: photosByParent.get(root.id) ?? [] }));
    requestLog().debug({ event: "find_executed", aggregate: "WorkOrder", find: "all", rows: items.length });
    return { items, page, pageSize, total, totalPages };
  }

  async mine(currentUser: User): Promise<WorkOrder[]> {
    const rootRows = await this.db.select().from(schema.workOrders).where(and(eq(schema.workOrders.technicianUserId, currentUser.id), eq(schema.workOrders.tenantId, requireCurrentUser().tenantId)));
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "WorkOrder", find: "mine", rows: 0 });
      return [];
    }
    const rootIds = rootRows.map((r) => r.id);
    const linesRows = await this.db.select().from(schema.workOrderLines).where(inArray(schema.workOrderLines.parentId, rootIds));
    const linesByParent = new Map<string, WorkOrderLine[]>();
    for (const r of linesRows) {
      const list = linesByParent.get(r.parentId) ?? [];
      list.push(WorkOrderLine._rehydrate({ id: Ids.WorkOrderLineId(r.id), parentId: Ids.WorkOrderId(r.parentId), kind: r.kind as LineKind, description: r.description, partId: (r.partId == null ? null : Ids.PartId(r.partId)), quantity: r.quantity, unitPrice: new Money(Number(r.unitPrice_amount), r.unitPrice_currency) }));
      linesByParent.set(r.parentId, list);
    }
    const photosRows = await this.db.select().from(schema.photos).where(inArray(schema.photos.parentId, rootIds));
    const photosByParent = new Map<string, Photo[]>();
    for (const r of photosRows) {
      const list = photosByParent.get(r.parentId) ?? [];
      list.push(Photo._rehydrate({ id: Ids.PhotoId(r.id), parentId: Ids.WorkOrderId(r.parentId), file: (r.file as { url: string; key: string; contentType: string; size: number }), caption: r.caption }));
      photosByParent.set(r.parentId, list);
    }
    const result = rootRows.map((root) => WorkOrder._rehydrate({ id: Ids.WorkOrderId(root.id), customerId: Ids.CustomerId(root.customerId), siteId: Ids.SiteId(root.siteId), assetId: (root.assetId == null ? null : Ids.AssetId(root.assetId)), technicianId: (root.technicianId == null ? null : Ids.TechnicianId(root.technicianId)), technicianUserId: (root.technicianUserId == null ? null : root.technicianUserId), status: root.status as WorkOrderStatus, priority: root.priority as Priority, currency: root.currency, scheduledAt: (root.scheduledAt == null ? null : root.scheduledAt), startedAt: (root.startedAt == null ? null : root.startedAt), completedAt: (root.completedAt == null ? null : root.completedAt), resolutionNote: (root.resolutionNote == null ? null : root.resolutionNote), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version, lines: linesByParent.get(root.id) ?? [], photos: photosByParent.get(root.id) ?? [] }));
    requestLog().debug({ event: "find_executed", aggregate: "WorkOrder", find: "mine", rows: result.length });
    return result;
  }

  async acrossAllTenants(): Promise<WorkOrder[]> {
    const rootRows = await this.db.select().from(schema.workOrders);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "WorkOrder", find: "acrossAllTenants", rows: 0 });
      return [];
    }
    const rootIds = rootRows.map((r) => r.id);
    const linesRows = await this.db.select().from(schema.workOrderLines).where(inArray(schema.workOrderLines.parentId, rootIds));
    const linesByParent = new Map<string, WorkOrderLine[]>();
    for (const r of linesRows) {
      const list = linesByParent.get(r.parentId) ?? [];
      list.push(WorkOrderLine._rehydrate({ id: Ids.WorkOrderLineId(r.id), parentId: Ids.WorkOrderId(r.parentId), kind: r.kind as LineKind, description: r.description, partId: (r.partId == null ? null : Ids.PartId(r.partId)), quantity: r.quantity, unitPrice: new Money(Number(r.unitPrice_amount), r.unitPrice_currency) }));
      linesByParent.set(r.parentId, list);
    }
    const photosRows = await this.db.select().from(schema.photos).where(inArray(schema.photos.parentId, rootIds));
    const photosByParent = new Map<string, Photo[]>();
    for (const r of photosRows) {
      const list = photosByParent.get(r.parentId) ?? [];
      list.push(Photo._rehydrate({ id: Ids.PhotoId(r.id), parentId: Ids.WorkOrderId(r.parentId), file: (r.file as { url: string; key: string; contentType: string; size: number }), caption: r.caption }));
      photosByParent.set(r.parentId, list);
    }
    const result = rootRows.map((root) => WorkOrder._rehydrate({ id: Ids.WorkOrderId(root.id), customerId: Ids.CustomerId(root.customerId), siteId: Ids.SiteId(root.siteId), assetId: (root.assetId == null ? null : Ids.AssetId(root.assetId)), technicianId: (root.technicianId == null ? null : Ids.TechnicianId(root.technicianId)), technicianUserId: (root.technicianUserId == null ? null : root.technicianUserId), status: root.status as WorkOrderStatus, priority: root.priority as Priority, currency: root.currency, scheduledAt: (root.scheduledAt == null ? null : root.scheduledAt), startedAt: (root.startedAt == null ? null : root.startedAt), completedAt: (root.completedAt == null ? null : root.completedAt), resolutionNote: (root.resolutionNote == null ? null : root.resolutionNote), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version, lines: linesByParent.get(root.id) ?? [], photos: photosByParent.get(root.id) ?? [] }));
    requestLog().debug({ event: "find_executed", aggregate: "WorkOrder", find: "acrossAllTenants", rows: result.length });
    return result;
  }

  toWire(root: WorkOrder): unknown {
    return { id: root.id as string, customerId: root.customerId as string, siteId: root.siteId as string, assetId: (root.assetId == null ? null : root.assetId as string), technicianId: (root.technicianId == null ? null : root.technicianId as string), technicianUserId: (root.technicianUserId == null ? null : root.technicianUserId), status: root.status as string, priority: root.priority as string, currency: root.currency, scheduledAt: (root.scheduledAt == null ? null : (root.scheduledAt == null ? null : (root.scheduledAt as Date).toISOString().replace(/\.?0+Z$/, "Z"))), startedAt: (root.startedAt == null ? null : (root.startedAt == null ? null : (root.startedAt as Date).toISOString().replace(/\.?0+Z$/, "Z"))), completedAt: (root.completedAt == null ? null : (root.completedAt == null ? null : (root.completedAt as Date).toISOString().replace(/\.?0+Z$/, "Z"))), resolutionNote: (root.resolutionNote == null ? null : root.resolutionNote), version: root.version, lines: root.lines.map((e: WorkOrderLine) => ({ id: e.id as string, kind: e.kind as string, description: e.description, partId: (e.partId == null ? null : e.partId as string), quantity: e.quantity, unitPrice: { amount: e.unitPrice.amount, currency: e.unitPrice.currency }, subtotal: { amount: e.subtotal.amount, currency: e.subtotal.currency } })), photos: root.photos.map((e: Photo) => ({ id: e.id as string, file: e.file, caption: e.caption })), display: root.display, total: { amount: root.total.amount, currency: root.total.currency } };
  }

}
