// Auto-generated.  Do not edit by hand.
import type { OrganizationRepositoryPort } from "../../domain/repository-ports";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import * as schema from "../schema";
import { requireCurrentUser } from "../../auth/middleware";
import { Organization } from "../../domain/organization";
import * as Ids from "../../domain/ids";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors";
import type { DomainEventDispatcher } from "../../domain/events";
import { requestLog } from "../../obs/als";

type Db = NodePgDatabase<typeof schema>;

export class OrganizationRepository implements OrganizationRepositoryPort {
  private readonly db: Db;
  private readonly events: DomainEventDispatcher;
  constructor(
    db: Db,
    events: DomainEventDispatcher,
  ) {
    this.db = db;
    this.events = events;
  }

  async findById(id: Ids.OrganizationId): Promise<Organization | null> {
    return await this.db.transaction(async (tx) => {
      const rootRows = await tx.select().from(schema.organizations).where(and(eq(schema.organizations.id, id), (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requireCurrentUser().tenantId) ? eq(schema.organizations.id, requireCurrentUser().tenantId) : and(isNull(schema.organizations.id), isNotNull(schema.organizations.id)))));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "Organization", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const loaded = Organization._rehydrate({ id: Ids.OrganizationId(root.id), name: root.name, version: root.version });
      requestLog().debug({ event: "aggregate_loaded", aggregate: "Organization", id: id as string, found: true });
      return loaded;
    });
  }

  async getById(id: Ids.OrganizationId): Promise<Organization> {
    const found = await this.findById(id);
    if (!found) throw new AggregateNotFoundError(`Organization ${id} not found`);
    return found;
  }

  async findManyByIds(ids: Ids.OrganizationId[]): Promise<Organization[]> {
    if (ids.length === 0) return [];
    const rootRows = await this.db.select().from(schema.organizations).where(and(inArray(schema.organizations.id, ids), (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requireCurrentUser().tenantId) ? eq(schema.organizations.id, requireCurrentUser().tenantId) : and(isNull(schema.organizations.id), isNotNull(schema.organizations.id)))));
    if (rootRows.length === 0) return [];
    return rootRows.map((root) => Organization._rehydrate({ id: Ids.OrganizationId(root.id), name: root.name, version: root.version }));
  }

  async save(aggregate: Organization, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.organizations).values({ id: aggregate.id as string, name: aggregate.name, version: 1 });
      } else {
        const updated = await tx.update(schema.organizations).set({ id: aggregate.id as string, name: aggregate.name, version: expected + 1 }).where(and(eq(schema.organizations.id, aggregate.id), eq(schema.organizations.version, expected))).returning({ id: schema.organizations.id });
        if (updated.length === 0) throw new ConcurrencyError("Organization", aggregate.id as string);
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "Organization", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "Organization", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async delete(id: Ids.OrganizationId): Promise<void> {
    await this.db.delete(schema.organizations).where(eq(schema.organizations.id, id));
  }

  async all(page: number, pageSize: number, sort: string, dir: string): Promise<{ items: Organization[]; page: number; pageSize: number; total: number; totalPages: number }> {
    const offset = (page - 1) * pageSize;
    const sortColumns: Record<string, AnyPgColumn> = { "id": schema.organizations.id, "name": schema.organizations.name };
    const sortColumn = Object.hasOwn(sortColumns, sort) ? sortColumns[sort]! : schema.organizations.id;
    const orderBy = dir === "desc" ? desc(sortColumn) : asc(sortColumn);
    const countRows = await this.db.select({ value: count() }).from(schema.organizations).where((/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requireCurrentUser().tenantId) ? eq(schema.organizations.id, requireCurrentUser().tenantId) : and(isNull(schema.organizations.id), isNotNull(schema.organizations.id))));
    const total = Number(countRows[0]?.value ?? 0);
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
    const rootRows = await this.db.select().from(schema.organizations).where((/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requireCurrentUser().tenantId) ? eq(schema.organizations.id, requireCurrentUser().tenantId) : and(isNull(schema.organizations.id), isNotNull(schema.organizations.id)))).orderBy(orderBy).limit(pageSize).offset(offset);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Organization", find: "all", rows: 0 });
      return { items: [], page, pageSize, total, totalPages };
    }
    const items = rootRows.map((root) => Organization._rehydrate({ id: Ids.OrganizationId(root.id), name: root.name, version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "Organization", find: "all", rows: items.length });
    return { items, page, pageSize, total, totalPages };
  }

  toWire(root: Organization): unknown {
    return { id: root.id as string, name: root.name, version: root.version, display: root.display };
  }

}
