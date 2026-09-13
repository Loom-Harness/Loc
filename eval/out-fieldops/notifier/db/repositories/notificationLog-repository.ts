// Auto-generated.  Do not edit by hand.
import type { NotificationLogRepositoryPort } from "../../domain/repository-ports";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import { NotificationLog } from "../../domain/notificationLog";
import * as Ids from "../../domain/ids";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors";
import type { DomainEventDispatcher } from "../../domain/events";
import { requestLog } from "../../obs/als";

type Db = NodePgDatabase<typeof schema>;

export class NotificationLogRepository implements NotificationLogRepositoryPort {
  private readonly db: Db;
  private readonly events: DomainEventDispatcher;
  constructor(
    db: Db,
    events: DomainEventDispatcher,
  ) {
    this.db = db;
    this.events = events;
  }

  async findById(id: Ids.NotificationLogId): Promise<NotificationLog | null> {
    return await this.db.transaction(async (tx) => {
      const rootRows = await tx.select().from(schema.notificationLogs).where(eq(schema.notificationLogs.id, id));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "NotificationLog", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const loaded = NotificationLog._rehydrate({ id: Ids.NotificationLogId(root.id), workOrderId: Ids.WorkOrderId(root.workOrderId), sentAt: root.sentAt, version: root.version });
      requestLog().debug({ event: "aggregate_loaded", aggregate: "NotificationLog", id: id as string, found: true });
      return loaded;
    });
  }

  async getById(id: Ids.NotificationLogId): Promise<NotificationLog> {
    const found = await this.findById(id);
    if (!found) throw new AggregateNotFoundError(`NotificationLog ${id} not found`);
    return found;
  }

  async findManyByIds(ids: Ids.NotificationLogId[]): Promise<NotificationLog[]> {
    if (ids.length === 0) return [];
    const rootRows = await this.db.select().from(schema.notificationLogs).where(inArray(schema.notificationLogs.id, ids));
    if (rootRows.length === 0) return [];
    return rootRows.map((root) => NotificationLog._rehydrate({ id: Ids.NotificationLogId(root.id), workOrderId: Ids.WorkOrderId(root.workOrderId), sentAt: root.sentAt, version: root.version }));
  }

  async save(aggregate: NotificationLog, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.notificationLogs.id }).from(schema.notificationLogs).where(eq(schema.notificationLogs.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.notificationLogs).values({ id: aggregate.id as string, workOrderId: aggregate.workOrderId as string, sentAt: aggregate.sentAt, version: 1 });
      } else {
        const updated = await tx.update(schema.notificationLogs).set({ id: aggregate.id as string, workOrderId: aggregate.workOrderId as string, sentAt: aggregate.sentAt, version: expected + 1 }).where(and(eq(schema.notificationLogs.id, aggregate.id), eq(schema.notificationLogs.version, expected))).returning({ id: schema.notificationLogs.id });
        if (updated.length === 0) throw new ConcurrencyError("NotificationLog", aggregate.id as string);
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "NotificationLog", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "NotificationLog", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async delete(id: Ids.NotificationLogId): Promise<void> {
    await this.db.delete(schema.notificationLogs).where(eq(schema.notificationLogs.id, id));
  }

  async all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: NotificationLog[]; page: number; pageSize: number; total: number; totalPages: number }> {
    const offset = (page - 1) * pageSize;
    const sortColumns: Record<string, AnyPgColumn> = { "id": schema.notificationLogs.id, "sentAt": schema.notificationLogs.sentAt };
    const sortColumn = Object.hasOwn(sortColumns, sort) ? sortColumns[sort]! : schema.notificationLogs.id;
    const orderBy = dir === "desc" ? desc(sortColumn) : asc(sortColumn);
    const countRows = await this.db.select({ value: count() }).from(schema.notificationLogs);
    const total = Number(countRows[0]?.value ?? 0);
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    const rootRows = await this.db.select().from(schema.notificationLogs).orderBy(orderBy).limit(pageSize).offset(offset);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "NotificationLog", find: "all", rows: 0 });
      return { items: [], page, pageSize, total, totalPages };
    }
    const items = rootRows.map((root) => NotificationLog._rehydrate({ id: Ids.NotificationLogId(root.id), workOrderId: Ids.WorkOrderId(root.workOrderId), sentAt: root.sentAt, version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "NotificationLog", find: "all", rows: items.length });
    return { items, page, pageSize, total, totalPages };
  }

  toWire(root: NotificationLog): unknown {
    return { id: root.id as string, workOrderId: root.workOrderId as string, sentAt: (root.sentAt as Date).toISOString().replace(/\.?0+Z$/, "Z"), version: root.version };
  }

}
