// Auto-generated.  Do not edit by hand.
import type { AssetRepositoryPort } from "../../domain/repository-ports";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import { requireCurrentUser } from "../../auth/middleware";
import { stampInsert, stampUpdate } from "../audit-stamp";
import { Asset } from "../../domain/asset";
import * as Ids from "../../domain/ids";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors";
import type { DomainEventDispatcher } from "../../domain/events";
import { requestLog } from "../../obs/als";

type Db = NodePgDatabase<typeof schema>;

export class AssetRepository implements AssetRepositoryPort {
  private readonly db: Db;
  private readonly events: DomainEventDispatcher;
  constructor(
    db: Db,
    events: DomainEventDispatcher,
  ) {
    this.db = db;
    this.events = events;
  }

  async findById(id: Ids.AssetId): Promise<Asset | null> {
    return await this.db.transaction(async (tx) => {
      const rootRows = await tx.select().from(schema.assets).where(and(eq(schema.assets.id, id), eq(schema.assets.tenantId, requireCurrentUser().tenantId)));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "Asset", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const loaded = Asset._rehydrate({ id: Ids.AssetId(root.id), siteId: Ids.SiteId(root.siteId), requiredSkill: root.requiredSkill, serialNumber: root.serialNumber, model: root.model, warrantyExpiry: root.warrantyExpiry, tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version });
      requestLog().debug({ event: "aggregate_loaded", aggregate: "Asset", id: id as string, found: true });
      return loaded;
    });
  }

  async getById(id: Ids.AssetId): Promise<Asset> {
    const found = await this.findById(id);
    if (!found) throw new AggregateNotFoundError(`Asset ${id} not found`);
    return found;
  }

  async findManyByIds(ids: Ids.AssetId[]): Promise<Asset[]> {
    if (ids.length === 0) return [];
    const rootRows = await this.db.select().from(schema.assets).where(and(inArray(schema.assets.id, ids), eq(schema.assets.tenantId, requireCurrentUser().tenantId)));
    if (rootRows.length === 0) return [];
    return rootRows.map((root) => Asset._rehydrate({ id: Ids.AssetId(root.id), siteId: Ids.SiteId(root.siteId), requiredSkill: root.requiredSkill, serialNumber: root.serialNumber, model: root.model, warrantyExpiry: root.warrantyExpiry, tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version }));
  }

  async save(aggregate: Asset, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.assets.id }).from(schema.assets).where(eq(schema.assets.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.assets).values(stampInsert({ id: aggregate.id as string, siteId: aggregate.siteId as string, requiredSkill: aggregate.requiredSkill, serialNumber: aggregate.serialNumber, model: aggregate.model, warrantyExpiry: aggregate.warrantyExpiry, tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, version: 1 }));
      } else {
        const updated = await tx.update(schema.assets).set(stampUpdate({ id: aggregate.id as string, siteId: aggregate.siteId as string, requiredSkill: aggregate.requiredSkill, serialNumber: aggregate.serialNumber, model: aggregate.model, warrantyExpiry: aggregate.warrantyExpiry, tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, version: expected + 1 })).where(and(eq(schema.assets.id, aggregate.id), eq(schema.assets.version, expected))).returning({ id: schema.assets.id });
        if (updated.length === 0) throw new ConcurrencyError("Asset", aggregate.id as string);
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "Asset", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "Asset", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async delete(id: Ids.AssetId): Promise<void> {
    await this.db.delete(schema.assets).where(eq(schema.assets.id, id));
  }

  async all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Asset[]; page: number; pageSize: number; total: number; totalPages: number }> {
    const offset = (page - 1) * pageSize;
    const sortColumns: Record<string, AnyPgColumn> = { "id": schema.assets.id, "requiredSkill": schema.assets.requiredSkill, "serialNumber": schema.assets.serialNumber, "model": schema.assets.model, "warrantyExpiry": schema.assets.warrantyExpiry };
    const sortColumn = Object.hasOwn(sortColumns, sort) ? sortColumns[sort]! : schema.assets.id;
    const orderBy = dir === "desc" ? desc(sortColumn) : asc(sortColumn);
    const countRows = await this.db.select({ value: count() }).from(schema.assets).where(eq(schema.assets.tenantId, requireCurrentUser().tenantId));
    const total = Number(countRows[0]?.value ?? 0);
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    const rootRows = await this.db.select().from(schema.assets).where(eq(schema.assets.tenantId, requireCurrentUser().tenantId)).orderBy(orderBy).limit(pageSize).offset(offset);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Asset", find: "all", rows: 0 });
      return { items: [], page, pageSize, total, totalPages };
    }
    const items = rootRows.map((root) => Asset._rehydrate({ id: Ids.AssetId(root.id), siteId: Ids.SiteId(root.siteId), requiredSkill: root.requiredSkill, serialNumber: root.serialNumber, model: root.model, warrantyExpiry: root.warrantyExpiry, tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "Asset", find: "all", rows: items.length });
    return { items, page, pageSize, total, totalPages };
  }

  toWire(root: Asset): unknown {
    return { id: root.id as string, siteId: root.siteId as string, requiredSkill: root.requiredSkill, serialNumber: root.serialNumber, model: root.model, warrantyExpiry: (root.warrantyExpiry as Date).toISOString().replace(/\.?0+Z$/, "Z"), version: root.version, display: root.display };
  }

}
