// Auto-generated.  Do not edit by hand.
import type { TaskRepositoryPort } from "../../domain/repository-ports";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import { Task } from "../../domain/task";
import * as Ids from "../../domain/ids";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors";
import type { DomainEventDispatcher } from "../../domain/events";
import { requestLog } from "../../obs/als";

type Db = NodePgDatabase<typeof schema>;

export class TaskRepository implements TaskRepositoryPort {
  private readonly db: Db;
  private readonly events: DomainEventDispatcher;
  constructor(
    db: Db,
    events: DomainEventDispatcher,
  ) {
    this.db = db;
    this.events = events;
  }

  async findById(id: Ids.TaskId): Promise<Task | null> {
    return await this.db.transaction(async (tx) => {
      const rootRows = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, id));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "Task", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const loaded = Task._rehydrate({ id: Ids.TaskId(root.id), title: root.title, done: root.done, project: Ids.ProjectId(root.project), version: root.version });
      requestLog().debug({ event: "aggregate_loaded", aggregate: "Task", id: id as string, found: true });
      return loaded;
    });
  }

  async getById(id: Ids.TaskId): Promise<Task> {
    const found = await this.findById(id);
    if (!found) throw new AggregateNotFoundError(`Task ${id} not found`);
    return found;
  }

  async findManyByIds(ids: Ids.TaskId[]): Promise<Task[]> {
    if (ids.length === 0) return [];
    const rootRows = await this.db.select().from(schema.tasks).where(inArray(schema.tasks.id, ids));
    if (rootRows.length === 0) return [];
    return rootRows.map((root) => Task._rehydrate({ id: Ids.TaskId(root.id), title: root.title, done: root.done, project: Ids.ProjectId(root.project), version: root.version }));
  }

  async save(aggregate: Task, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.tasks).values({ id: aggregate.id as string, title: aggregate.title, done: aggregate.done, project: aggregate.project as string, version: 1 });
      } else {
        const updated = await tx.update(schema.tasks).set({ id: aggregate.id as string, title: aggregate.title, done: aggregate.done, project: aggregate.project as string, version: expected + 1 }).where(and(eq(schema.tasks.id, aggregate.id), eq(schema.tasks.version, expected))).returning({ id: schema.tasks.id });
        if (updated.length === 0) throw new ConcurrencyError("Task", aggregate.id as string);
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "Task", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "Task", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async delete(id: Ids.TaskId): Promise<void> {
    await this.db.delete(schema.tasks).where(eq(schema.tasks.id, id));
  }

  async all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Task[]; page: number; pageSize: number; total: number; totalPages: number }> {
    const offset = (page - 1) * pageSize;
    const sortColumns: Record<string, AnyPgColumn> = { "id": schema.tasks.id, "title": schema.tasks.title, "done": schema.tasks.done };
    const sortColumn = Object.hasOwn(sortColumns, sort) ? sortColumns[sort]! : schema.tasks.id;
    const orderBy = dir === "desc" ? desc(sortColumn) : asc(sortColumn);
    const countRows = await this.db.select({ value: count() }).from(schema.tasks);
    const total = Number(countRows[0]?.value ?? 0);
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    const rootRows = await this.db.select().from(schema.tasks).orderBy(orderBy).limit(pageSize).offset(offset);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Task", find: "all", rows: 0 });
      return { items: [], page, pageSize, total, totalPages };
    }
    const items = rootRows.map((root) => Task._rehydrate({ id: Ids.TaskId(root.id), title: root.title, done: root.done, project: Ids.ProjectId(root.project), version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "Task", find: "all", rows: items.length });
    return { items, page, pageSize, total, totalPages };
  }

  async byProject(projectId: Ids.ProjectId): Promise<Task[]> {
    const rootRows = await this.db.select().from(schema.tasks).where(eq(schema.tasks.project, projectId));
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Task", find: "byProject", rows: 0 });
      return [];
    }
    const result = rootRows.map((root) => Task._rehydrate({ id: Ids.TaskId(root.id), title: root.title, done: root.done, project: Ids.ProjectId(root.project), version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "Task", find: "byProject", rows: result.length });
    return result;
  }

  toWire(root: Task): unknown {
    return { id: root.id as string, title: root.title, done: root.done, project: root.project as string, version: root.version };
  }

}
