// Auto-generated.  Do not edit by hand.
import type { SiteRepositoryPort } from "../../domain/repository-ports.ts";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../schema.ts";
import { requireCurrentUser } from "../../auth/middleware.ts";
import { stampInsert, stampUpdate } from "../audit-stamp.ts";
import { Site } from "../../domain/site.ts";
import * as Ids from "../../domain/ids.ts";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors.ts";
import type { DomainEventDispatcher } from "../../domain/events.ts";
import { requestLog } from "../../obs/als.ts";

type Db = NodePgDatabase<typeof schema>;

export class SiteRepository implements SiteRepositoryPort {
  private readonly db: Db;
  private readonly events: DomainEventDispatcher;
  constructor(
    db: Db,
    events: DomainEventDispatcher,
  ) {
    this.db = db;
    this.events = events;
  }

  async findById(id: Ids.SiteId): Promise<Site | null> {
    return await this.db.transaction(async (tx) => {
      const rootRows = await tx.select().from(schema.sites).where(and(eq(schema.sites.id, id), eq(schema.sites.tenantId, requireCurrentUser().orgId)));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "Site", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const loaded = Site._rehydrate({ id: Ids.SiteId(root.id), customerId: Ids.CustomerId(root.customerId), label: root.label, addressLine: root.addressLine, tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version });
      requestLog().debug({ event: "aggregate_loaded", aggregate: "Site", id: id as string, found: true });
      return loaded;
    });
  }

  async getById(id: Ids.SiteId): Promise<Site> {
    const found = await this.findById(id);
    if (!found) throw new AggregateNotFoundError(`Site ${id} not found`);
    return found;
  }

  async findManyByIds(ids: Ids.SiteId[]): Promise<Site[]> {
    if (ids.length === 0) return [];
    const rootRows = await this.db.select().from(schema.sites).where(and(inArray(schema.sites.id, ids), eq(schema.sites.tenantId, requireCurrentUser().orgId)));
    if (rootRows.length === 0) return [];
    return rootRows.map((root) => Site._rehydrate({ id: Ids.SiteId(root.id), customerId: Ids.CustomerId(root.customerId), label: root.label, addressLine: root.addressLine, tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version }));
  }

  async save(aggregate: Site, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.sites.id }).from(schema.sites).where(eq(schema.sites.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.sites).values(stampInsert({ id: aggregate.id as string, customerId: aggregate.customerId as string, label: aggregate.label, addressLine: aggregate.addressLine, tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, version: 1 }));
      } else {
        const updated = await tx.update(schema.sites).set(stampUpdate({ id: aggregate.id as string, customerId: aggregate.customerId as string, label: aggregate.label, addressLine: aggregate.addressLine, tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, version: expected + 1 })).where(and(eq(schema.sites.id, aggregate.id), eq(schema.sites.version, expected))).returning({ id: schema.sites.id });
        if (updated.length === 0) throw new ConcurrencyError("Site", aggregate.id as string);
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "Site", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "Site", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async delete(id: Ids.SiteId): Promise<void> {
    await this.db.delete(schema.sites).where(eq(schema.sites.id, id));
  }

  async all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Site[]; page: number; pageSize: number; total: number; totalPages: number }> {
    const offset = (page - 1) * pageSize;
    const sortColumns: Record<string, AnyPgColumn> = { "id": schema.sites.id, "label": schema.sites.label, "addressLine": schema.sites.addressLine };
    const sortColumn = Object.hasOwn(sortColumns, sort) ? sortColumns[sort]! : schema.sites.id;
    const orderBy = dir === "desc" ? desc(sortColumn) : asc(sortColumn);
    const countRows = await this.db.select({ value: count() }).from(schema.sites).where(eq(schema.sites.tenantId, requireCurrentUser().orgId));
    const total = Number(countRows[0]?.value ?? 0);
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    const rootRows = await this.db.select().from(schema.sites).where(eq(schema.sites.tenantId, requireCurrentUser().orgId)).orderBy(orderBy).limit(pageSize).offset(offset);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Site", find: "all", rows: 0 });
      return { items: [], page, pageSize, total, totalPages };
    }
    const items = rootRows.map((root) => Site._rehydrate({ id: Ids.SiteId(root.id), customerId: Ids.CustomerId(root.customerId), label: root.label, addressLine: root.addressLine, tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "Site", find: "all", rows: items.length });
    return { items, page, pageSize, total, totalPages };
  }

  toWire(root: Site): unknown {
    return { id: root.id as string, customerId: root.customerId as string, label: root.label, addressLine: root.addressLine, version: root.version, display: root.display };
  }

}
//# sourceMappingURL=site-repository.ts.map
