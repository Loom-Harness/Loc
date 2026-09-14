// HAND-EDIT #2 — pinned via .loomignore
// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import type { PartRepositoryPort } from "../../domain/repository-ports";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import { requireCurrentUser } from "../../auth/middleware";
import { stampInsert, stampUpdate } from "../audit-stamp";
import { Part } from "../../domain/part";
import * as Ids from "../../domain/ids";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors";
import type { DomainEventDispatcher } from "../../domain/events";
import { requestLog } from "../../obs/als";

type Db = NodePgDatabase<typeof schema>;

export class PartRepository implements PartRepositoryPort {
  private readonly db: Db;
  private readonly events: DomainEventDispatcher;
  constructor(
    db: Db,
    events: DomainEventDispatcher,
  ) {
    this.db = db;
    this.events = events;
  }

  async findById(id: Ids.PartId): Promise<Part | null> {
    return await this.db.transaction(async (tx) => {
      const rootRows = await tx.select().from(schema.parts).where(and(eq(schema.parts.id, id), eq(schema.parts.tenantId, requireCurrentUser().orgId)));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "Part", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const loaded = Part._rehydrate({ id: Ids.PartId(root.id), sku: root.sku, onHand: root.onHand, unitPrice: new Decimal(root.unitPrice), currency: root.currency, tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version });
      requestLog().debug({ event: "aggregate_loaded", aggregate: "Part", id: id as string, found: true });
      return loaded;
    });
  }

  async getById(id: Ids.PartId): Promise<Part> {
    const found = await this.findById(id);
    if (!found) throw new AggregateNotFoundError(`Part ${id} not found`);
    return found;
  }

  async findManyByIds(ids: Ids.PartId[]): Promise<Part[]> {
    if (ids.length === 0) return [];
    const rootRows = await this.db.select().from(schema.parts).where(and(inArray(schema.parts.id, ids), eq(schema.parts.tenantId, requireCurrentUser().orgId)));
    if (rootRows.length === 0) return [];
    return rootRows.map((root) => Part._rehydrate({ id: Ids.PartId(root.id), sku: root.sku, onHand: root.onHand, unitPrice: new Decimal(root.unitPrice), currency: root.currency, tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version }));
  }

  async save(aggregate: Part, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.parts.id }).from(schema.parts).where(eq(schema.parts.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.parts).values(stampInsert({ id: aggregate.id as string, sku: aggregate.sku, onHand: aggregate.onHand, unitPrice: aggregate.unitPrice.toString(), currency: aggregate.currency, tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, version: 1 }));
      } else {
        const updated = await tx.update(schema.parts).set(stampUpdate({ id: aggregate.id as string, sku: aggregate.sku, onHand: aggregate.onHand, unitPrice: aggregate.unitPrice.toString(), currency: aggregate.currency, tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, version: expected + 1 })).where(and(eq(schema.parts.id, aggregate.id), eq(schema.parts.version, expected))).returning({ id: schema.parts.id });
        if (updated.length === 0) throw new ConcurrencyError("Part", aggregate.id as string);
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "Part", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "Part", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async delete(id: Ids.PartId): Promise<void> {
    await this.db.delete(schema.parts).where(eq(schema.parts.id, id));
  }

  async all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Part[]; page: number; pageSize: number; total: number; totalPages: number }> {
    const offset = (page - 1) * pageSize;
    const sortColumns: Record<string, AnyPgColumn> = { "id": schema.parts.id, "sku": schema.parts.sku, "onHand": schema.parts.onHand, "unitPrice": schema.parts.unitPrice, "currency": schema.parts.currency };
    const sortColumn = Object.hasOwn(sortColumns, sort) ? sortColumns[sort]! : schema.parts.id;
    const orderBy = dir === "desc" ? desc(sortColumn) : asc(sortColumn);
    const countRows = await this.db.select({ value: count() }).from(schema.parts).where(eq(schema.parts.tenantId, requireCurrentUser().orgId));
    const total = Number(countRows[0]?.value ?? 0);
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    const rootRows = await this.db.select().from(schema.parts).where(eq(schema.parts.tenantId, requireCurrentUser().orgId)).orderBy(orderBy).limit(pageSize).offset(offset);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Part", find: "all", rows: 0 });
      return { items: [], page, pageSize, total, totalPages };
    }
    const items = rootRows.map((root) => Part._rehydrate({ id: Ids.PartId(root.id), sku: root.sku, onHand: root.onHand, unitPrice: new Decimal(root.unitPrice), currency: root.currency, tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "Part", find: "all", rows: items.length });
    return { items, page, pageSize, total, totalPages };
  }

  toWire(root: Part): unknown {
    return { id: root.id as string, sku: root.sku, onHand: root.onHand, unitPrice: root.unitPrice.toFixed(4), currency: root.currency, version: root.version, display: root.display };
  }

}
