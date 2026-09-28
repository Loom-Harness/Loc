// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import type { InvoiceRepositoryPort } from "../../domain/repository-ports.ts";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../schema.ts";
import { requireCurrentUser } from "../../auth/middleware.ts";
import { stampInsert, stampUpdate } from "../audit-stamp.ts";
import { Invoice } from "../../domain/invoice.ts";
import * as Ids from "../../domain/ids.ts";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors.ts";
import type { DomainEventDispatcher } from "../../domain/events.ts";
import { requestLog } from "../../obs/als.ts";

type Db = NodePgDatabase<typeof schema>;

export class InvoiceRepository implements InvoiceRepositoryPort {
  private readonly db: Db;
  private readonly events: DomainEventDispatcher;
  constructor(
    db: Db,
    events: DomainEventDispatcher,
  ) {
    this.db = db;
    this.events = events;
  }

  async findById(id: Ids.InvoiceId): Promise<Invoice | null> {
    return await this.db.transaction(async (tx) => {
      const rootRows = await tx.select().from(schema.invoices).where(and(eq(schema.invoices.id, id), eq(schema.invoices.tenantId, requireCurrentUser().orgId)));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "Invoice", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const loaded = Invoice._rehydrate({ id: Ids.InvoiceId(root.id), workOrderId: Ids.WorkOrderId(root.workOrderId), issuedAt: (root.issuedAt == null ? null : root.issuedAt), amount: new Decimal(root.amount), currency: root.currency, tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), createdAt: root.createdAt, updatedAt: root.updatedAt, createdBy: root.createdBy, updatedBy: root.updatedBy, version: root.version });
      requestLog().debug({ event: "aggregate_loaded", aggregate: "Invoice", id: id as string, found: true });
      return loaded;
    });
  }

  async getById(id: Ids.InvoiceId): Promise<Invoice> {
    const found = await this.findById(id);
    if (!found) throw new AggregateNotFoundError(`Invoice ${id} not found`);
    return found;
  }

  async findManyByIds(ids: Ids.InvoiceId[]): Promise<Invoice[]> {
    if (ids.length === 0) return [];
    const rootRows = await this.db.select().from(schema.invoices).where(and(inArray(schema.invoices.id, ids), eq(schema.invoices.tenantId, requireCurrentUser().orgId)));
    if (rootRows.length === 0) return [];
    return rootRows.map((root) => Invoice._rehydrate({ id: Ids.InvoiceId(root.id), workOrderId: Ids.WorkOrderId(root.workOrderId), issuedAt: (root.issuedAt == null ? null : root.issuedAt), amount: new Decimal(root.amount), currency: root.currency, tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), createdAt: root.createdAt, updatedAt: root.updatedAt, createdBy: root.createdBy, updatedBy: root.updatedBy, version: root.version }));
  }

  async save(aggregate: Invoice, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.invoices).values(stampInsert({ id: aggregate.id as string, workOrderId: aggregate.workOrderId as string, issuedAt: aggregate.issuedAt, amount: aggregate.amount.toString(), currency: aggregate.currency, tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, createdAt: aggregate.createdAt, updatedAt: aggregate.updatedAt, createdBy: aggregate.createdBy, updatedBy: aggregate.updatedBy, version: 1 }));
      } else {
        const updated = await tx.update(schema.invoices).set(stampUpdate({ id: aggregate.id as string, workOrderId: aggregate.workOrderId as string, issuedAt: aggregate.issuedAt, amount: aggregate.amount.toString(), currency: aggregate.currency, tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, createdAt: aggregate.createdAt, updatedAt: aggregate.updatedAt, createdBy: aggregate.createdBy, updatedBy: aggregate.updatedBy, version: expected + 1 })).where(and(eq(schema.invoices.id, aggregate.id), eq(schema.invoices.version, expected))).returning({ id: schema.invoices.id });
        if (updated.length === 0) throw new ConcurrencyError("Invoice", aggregate.id as string);
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "Invoice", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "Invoice", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Invoice[]; page: number; pageSize: number; total: number; totalPages: number }> {
    const offset = (page - 1) * pageSize;
    const sortColumns: Record<string, AnyPgColumn> = { "id": schema.invoices.id, "amount": schema.invoices.amount, "currency": schema.invoices.currency, "createdAt": schema.invoices.createdAt, "updatedAt": schema.invoices.updatedAt, "createdBy": schema.invoices.createdBy, "updatedBy": schema.invoices.updatedBy };
    const sortColumn = Object.hasOwn(sortColumns, sort) ? sortColumns[sort]! : schema.invoices.id;
    const orderBy = dir === "desc" ? desc(sortColumn) : asc(sortColumn);
    const countRows = await this.db.select({ value: count() }).from(schema.invoices).where(eq(schema.invoices.tenantId, requireCurrentUser().orgId));
    const total = Number(countRows[0]?.value ?? 0);
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    const rootRows = await this.db.select().from(schema.invoices).where(eq(schema.invoices.tenantId, requireCurrentUser().orgId)).orderBy(orderBy).limit(pageSize).offset(offset);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Invoice", find: "all", rows: 0 });
      return { items: [], page, pageSize, total, totalPages };
    }
    const items = rootRows.map((root) => Invoice._rehydrate({ id: Ids.InvoiceId(root.id), workOrderId: Ids.WorkOrderId(root.workOrderId), issuedAt: (root.issuedAt == null ? null : root.issuedAt), amount: new Decimal(root.amount), currency: root.currency, tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), createdAt: root.createdAt, updatedAt: root.updatedAt, createdBy: root.createdBy, updatedBy: root.updatedBy, version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "Invoice", find: "all", rows: items.length });
    return { items, page, pageSize, total, totalPages };
  }

  async revenueThisMonth(): Promise<Invoice[]> {
    const rootRows = await this.db.select().from(schema.invoices).where(eq(schema.invoices.tenantId, requireCurrentUser().orgId));
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Invoice", find: "revenueThisMonth", rows: 0 });
      return [];
    }
    const result = rootRows.map((root) => Invoice._rehydrate({ id: Ids.InvoiceId(root.id), workOrderId: Ids.WorkOrderId(root.workOrderId), issuedAt: (root.issuedAt == null ? null : root.issuedAt), amount: new Decimal(root.amount), currency: root.currency, tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), createdAt: root.createdAt, updatedAt: root.updatedAt, createdBy: root.createdBy, updatedBy: root.updatedBy, version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "Invoice", find: "revenueThisMonth", rows: result.length });
    return result;
  }

  toWire(root: Invoice): unknown {
    return { id: root.id as string, workOrderId: root.workOrderId as string, issuedAt: (root.issuedAt == null ? null : (root.issuedAt == null ? null : (root.issuedAt as Date).toISOString().replace(/\.?0+Z$/, "Z"))), amount: root.amount.toFixed(4), currency: root.currency, createdAt: (root.createdAt as Date).toISOString().replace(/\.?0+Z$/, "Z"), updatedAt: (root.updatedAt as Date).toISOString().replace(/\.?0+Z$/, "Z"), createdBy: root.createdBy, updatedBy: root.updatedBy, version: root.version, issued: root.issued, display: root.display };
  }

}
//# sourceMappingURL=invoice-repository.ts.map
