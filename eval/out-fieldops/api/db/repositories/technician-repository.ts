// Auto-generated.  Do not edit by hand.
import type { TechnicianRepositoryPort } from "../../domain/repository-ports";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import type { User } from "../../auth/user-types";
import { requireCurrentUser } from "../../auth/middleware";
import { stampInsert, stampUpdate } from "../audit-stamp";
import { Technician } from "../../domain/technician";
import * as Ids from "../../domain/ids";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors";
import type { DomainEventDispatcher } from "../../domain/events";
import { requestLog } from "../../obs/als";

type Db = NodePgDatabase<typeof schema>;

export class TechnicianRepository implements TechnicianRepositoryPort {
  private readonly db: Db;
  private readonly events: DomainEventDispatcher;
  constructor(
    db: Db,
    events: DomainEventDispatcher,
  ) {
    this.db = db;
    this.events = events;
  }

  async findById(id: Ids.TechnicianId): Promise<Technician | null> {
    return await this.db.transaction(async (tx) => {
      const rootRows = await tx.select().from(schema.technicians).where(and(eq(schema.technicians.id, id), eq(schema.technicians.tenantId, requireCurrentUser().tenantId)));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "Technician", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const loaded = Technician._rehydrate({ id: Ids.TechnicianId(root.id), userId: root.userId, name: root.name, skills: root.skills, costRatePerHour: Number(root.costRatePerHour), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version });
      requestLog().debug({ event: "aggregate_loaded", aggregate: "Technician", id: id as string, found: true });
      return loaded;
    });
  }

  async getById(id: Ids.TechnicianId): Promise<Technician> {
    const found = await this.findById(id);
    if (!found) throw new AggregateNotFoundError(`Technician ${id} not found`);
    return found;
  }

  async findManyByIds(ids: Ids.TechnicianId[]): Promise<Technician[]> {
    if (ids.length === 0) return [];
    const rootRows = await this.db.select().from(schema.technicians).where(and(inArray(schema.technicians.id, ids), eq(schema.technicians.tenantId, requireCurrentUser().tenantId)));
    if (rootRows.length === 0) return [];
    return rootRows.map((root) => Technician._rehydrate({ id: Ids.TechnicianId(root.id), userId: root.userId, name: root.name, skills: root.skills, costRatePerHour: Number(root.costRatePerHour), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version }));
  }

  async save(aggregate: Technician, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.technicians.id }).from(schema.technicians).where(eq(schema.technicians.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.technicians).values(stampInsert({ id: aggregate.id as string, userId: aggregate.userId, name: aggregate.name, skills: aggregate.skills, costRatePerHour: String(aggregate.costRatePerHour), tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, version: 1 }));
      } else {
        const updated = await tx.update(schema.technicians).set(stampUpdate({ id: aggregate.id as string, userId: aggregate.userId, name: aggregate.name, skills: aggregate.skills, costRatePerHour: String(aggregate.costRatePerHour), tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, version: expected + 1 })).where(and(eq(schema.technicians.id, aggregate.id), eq(schema.technicians.version, expected))).returning({ id: schema.technicians.id });
        if (updated.length === 0) throw new ConcurrencyError("Technician", aggregate.id as string);
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "Technician", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "Technician", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async delete(id: Ids.TechnicianId): Promise<void> {
    await this.db.delete(schema.technicians).where(eq(schema.technicians.id, id));
  }

  async all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Technician[]; page: number; pageSize: number; total: number; totalPages: number }> {
    const offset = (page - 1) * pageSize;
    const sortColumns: Record<string, AnyPgColumn> = { "id": schema.technicians.id, "userId": schema.technicians.userId, "name": schema.technicians.name };
    const sortColumn = Object.hasOwn(sortColumns, sort) ? sortColumns[sort]! : schema.technicians.id;
    const orderBy = dir === "desc" ? desc(sortColumn) : asc(sortColumn);
    const countRows = await this.db.select({ value: count() }).from(schema.technicians).where(eq(schema.technicians.tenantId, requireCurrentUser().tenantId));
    const total = Number(countRows[0]?.value ?? 0);
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    const rootRows = await this.db.select().from(schema.technicians).where(eq(schema.technicians.tenantId, requireCurrentUser().tenantId)).orderBy(orderBy).limit(pageSize).offset(offset);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Technician", find: "all", rows: 0 });
      return { items: [], page, pageSize, total, totalPages };
    }
    const items = rootRows.map((root) => Technician._rehydrate({ id: Ids.TechnicianId(root.id), userId: root.userId, name: root.name, skills: root.skills, costRatePerHour: Number(root.costRatePerHour), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "Technician", find: "all", rows: items.length });
    return { items, page, pageSize, total, totalPages };
  }

  toWire(root: Technician): unknown {
    return { id: root.id as string, userId: root.userId, name: root.name, skills: root.skills.map((a) => (a)), costRatePerHour: root.costRatePerHour, version: root.version, display: root.display };
  }

  toWireMasked(root: Technician, currentUser: User | null): unknown {
    const wire = this.toWire(root) as Record<string, unknown>;
    if (!(currentUser !== null && (currentUser.role === "admin"))) wire.costRatePerHour = null;
    return wire;
  }

}
