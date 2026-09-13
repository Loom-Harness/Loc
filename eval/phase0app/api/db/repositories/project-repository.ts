// Auto-generated.  Do not edit by hand.
import type { ProjectRepositoryPort } from "../../domain/repository-ports";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import { Project } from "../../domain/project";
import * as Ids from "../../domain/ids";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors";
import type { DomainEventDispatcher } from "../../domain/events";
import { requestLog } from "../../obs/als";

type Db = NodePgDatabase<typeof schema>;

export class ProjectRepository implements ProjectRepositoryPort {
  private readonly db: Db;
  private readonly events: DomainEventDispatcher;
  constructor(
    db: Db,
    events: DomainEventDispatcher,
  ) {
    this.db = db;
    this.events = events;
  }

  async findById(id: Ids.ProjectId): Promise<Project | null> {
    return await this.db.transaction(async (tx) => {
      const rootRows = await tx.select().from(schema.projects).where(eq(schema.projects.id, id));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "Project", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const loaded = Project._rehydrate({ id: Ids.ProjectId(root.id), name: root.name, version: root.version });
      requestLog().debug({ event: "aggregate_loaded", aggregate: "Project", id: id as string, found: true });
      return loaded;
    });
  }

  async getById(id: Ids.ProjectId): Promise<Project> {
    const found = await this.findById(id);
    if (!found) throw new AggregateNotFoundError(`Project ${id} not found`);
    return found;
  }

  async findManyByIds(ids: Ids.ProjectId[]): Promise<Project[]> {
    if (ids.length === 0) return [];
    const rootRows = await this.db.select().from(schema.projects).where(inArray(schema.projects.id, ids));
    if (rootRows.length === 0) return [];
    return rootRows.map((root) => Project._rehydrate({ id: Ids.ProjectId(root.id), name: root.name, version: root.version }));
  }

  async save(aggregate: Project, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.projects).values({ id: aggregate.id as string, name: aggregate.name, version: 1 });
      } else {
        const updated = await tx.update(schema.projects).set({ id: aggregate.id as string, name: aggregate.name, version: expected + 1 }).where(and(eq(schema.projects.id, aggregate.id), eq(schema.projects.version, expected))).returning({ id: schema.projects.id });
        if (updated.length === 0) throw new ConcurrencyError("Project", aggregate.id as string);
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "Project", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "Project", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async delete(id: Ids.ProjectId): Promise<void> {
    await this.db.delete(schema.projects).where(eq(schema.projects.id, id));
  }

  async all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Project[]; page: number; pageSize: number; total: number; totalPages: number }> {
    const offset = (page - 1) * pageSize;
    const sortColumns: Record<string, AnyPgColumn> = { "id": schema.projects.id, "name": schema.projects.name };
    const sortColumn = Object.hasOwn(sortColumns, sort) ? sortColumns[sort]! : schema.projects.id;
    const orderBy = dir === "desc" ? desc(sortColumn) : asc(sortColumn);
    const countRows = await this.db.select({ value: count() }).from(schema.projects);
    const total = Number(countRows[0]?.value ?? 0);
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    const rootRows = await this.db.select().from(schema.projects).orderBy(orderBy).limit(pageSize).offset(offset);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Project", find: "all", rows: 0 });
      return { items: [], page, pageSize, total, totalPages };
    }
    const items = rootRows.map((root) => Project._rehydrate({ id: Ids.ProjectId(root.id), name: root.name, version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "Project", find: "all", rows: items.length });
    return { items, page, pageSize, total, totalPages };
  }

  toWire(root: Project): unknown {
    return { id: root.id as string, name: root.name, version: root.version, display: root.display };
  }

}
