// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import type { TechnicianRepositoryPort } from "../../domain/repository-ports.ts";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../schema.ts";
import type { User } from "../../auth/user-types.ts";
import { requireCurrentUser } from "../../auth/middleware.ts";
import { stampInsert, stampUpdate } from "../audit-stamp.ts";
import { Technician } from "../../domain/technician.ts";
import * as Ids from "../../domain/ids.ts";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors.ts";
import type { DomainEventDispatcher } from "../../domain/events.ts";
import { requestLog } from "../../obs/als.ts";

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
      const rootRows = await tx.select().from(schema.technicians).where(and(eq(schema.technicians.id, id), eq(schema.technicians.tenantId, requireCurrentUser().orgId)));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "Technician", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const loaded = Technician._rehydrate({ id: Ids.TechnicianId(root.id), userId: root.userId, fullName: root.fullName, skills: root.skills, costRate: new Decimal(root.costRate), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version });
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
    const rootRows = await this.db.select().from(schema.technicians).where(and(inArray(schema.technicians.id, ids), eq(schema.technicians.tenantId, requireCurrentUser().orgId)));
    if (rootRows.length === 0) return [];
    return rootRows.map((root) => Technician._rehydrate({ id: Ids.TechnicianId(root.id), userId: root.userId, fullName: root.fullName, skills: root.skills, costRate: new Decimal(root.costRate), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version }));
  }

  async save(aggregate: Technician, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.technicians.id }).from(schema.technicians).where(eq(schema.technicians.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.technicians).values(stampInsert({ id: aggregate.id as string, userId: aggregate.userId, fullName: aggregate.fullName, skills: aggregate.skills, costRate: aggregate.costRate.toString(), tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, version: 1 }));
      } else {
        const updated = await tx.update(schema.technicians).set(stampUpdate({ id: aggregate.id as string, userId: aggregate.userId, fullName: aggregate.fullName, skills: aggregate.skills, costRate: aggregate.costRate.toString(), tenantId: aggregate.tenantId, dataKey: aggregate.dataKey, version: expected + 1 })).where(and(eq(schema.technicians.id, aggregate.id), eq(schema.technicians.version, expected))).returning({ id: schema.technicians.id });
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
    const sortColumns: Record<string, AnyPgColumn> = { "id": schema.technicians.id, "userId": schema.technicians.userId, "fullName": schema.technicians.fullName };
    const sortColumn = Object.hasOwn(sortColumns, sort) ? sortColumns[sort]! : schema.technicians.id;
    const orderBy = dir === "desc" ? desc(sortColumn) : asc(sortColumn);
    const countRows = await this.db.select({ value: count() }).from(schema.technicians).where(eq(schema.technicians.tenantId, requireCurrentUser().orgId));
    const total = Number(countRows[0]?.value ?? 0);
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    const rootRows = await this.db.select().from(schema.technicians).where(eq(schema.technicians.tenantId, requireCurrentUser().orgId)).orderBy(orderBy).limit(pageSize).offset(offset);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Technician", find: "all", rows: 0 });
      return { items: [], page, pageSize, total, totalPages };
    }
    const items = rootRows.map((root) => Technician._rehydrate({ id: Ids.TechnicianId(root.id), userId: root.userId, fullName: root.fullName, skills: root.skills, costRate: new Decimal(root.costRate), tenantId: root.tenantId, dataKey: (root.dataKey == null ? null : root.dataKey), version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "Technician", find: "all", rows: items.length });
    return { items, page, pageSize, total, totalPages };
  }

  toWire(root: Technician): unknown {
    return { id: root.id as string, userId: root.userId, fullName: root.fullName, skills: root.skills.map((a) => (a as string)), costRate: root.costRate.toFixed(4), version: root.version, display: root.display };
  }

  toWireMasked(root: Technician, currentUser: User | null): unknown {
    const wire = this.toWire(root) as Record<string, unknown>;
    if (!(currentUser !== null && (currentUser.role === "admin"))) wire.costRate = null;
    return wire;
  }

}
//# sourceMappingURL=technician-repository.ts.map
