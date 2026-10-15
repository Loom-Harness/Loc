// Auto-generated.  Do not edit by hand.
import type { CustomerRepositoryPort } from "../../domain/repository-ports";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import { Customer } from "../../domain/customer";
import * as Ids from "../../domain/ids";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors";
import type { DomainEventDispatcher } from "../../domain/events";
import { requestLog } from "../../obs/als";

type Db = NodePgDatabase<typeof schema>;

export class CustomerRepository implements CustomerRepositoryPort {
  private readonly db: Db;
  private readonly events: DomainEventDispatcher;
  constructor(
    db: Db,
    events: DomainEventDispatcher,
  ) {
    this.db = db;
    this.events = events;
  }

  async findById(id: Ids.CustomerId): Promise<Customer | null> {
    return await this.db.transaction(async (tx) => {
      const rootRows = await tx.select().from(schema.customers).where(eq(schema.customers.id, id));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "Customer", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const loaded = Customer._rehydrate({ id: Ids.CustomerId(root.id), firstName: root.firstName, lastName: root.lastName, email: root.email, version: root.version });
      requestLog().debug({ event: "aggregate_loaded", aggregate: "Customer", id: id as string, found: true });
      return loaded;
    });
  }

  async getById(id: Ids.CustomerId): Promise<Customer> {
    const found = await this.findById(id);
    if (!found) throw new AggregateNotFoundError(`Customer ${id} not found`);
    return found;
  }

  async findManyByIds(ids: Ids.CustomerId[]): Promise<Customer[]> {
    if (ids.length === 0) return [];
    const rootRows = await this.db.select().from(schema.customers).where(inArray(schema.customers.id, ids));
    if (rootRows.length === 0) return [];
    return rootRows.map((root) => Customer._rehydrate({ id: Ids.CustomerId(root.id), firstName: root.firstName, lastName: root.lastName, email: root.email, version: root.version }));
  }

  async save(aggregate: Customer, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.customers).values({ id: aggregate.id as string, firstName: aggregate.firstName, lastName: aggregate.lastName, email: aggregate.email, version: 1 });
      } else {
        const updated = await tx.update(schema.customers).set({ id: aggregate.id as string, firstName: aggregate.firstName, lastName: aggregate.lastName, email: aggregate.email, version: expected + 1 }).where(and(eq(schema.customers.id, aggregate.id), eq(schema.customers.version, expected))).returning({ id: schema.customers.id });
        if (updated.length === 0) throw new ConcurrencyError("Customer", aggregate.id as string);
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "Customer", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "Customer", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async all(): Promise<Customer[]> {
    const rootRows = await this.db.select().from(schema.customers);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Customer", find: "all", rows: 0 });
      return [];
    }
    const result = rootRows.map((root) => Customer._rehydrate({ id: Ids.CustomerId(root.id), firstName: root.firstName, lastName: root.lastName, email: root.email, version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "Customer", find: "all", rows: result.length });
    return result;
  }

  toWire(root: Customer): unknown {
    return { id: root.id as string, firstName: root.firstName, lastName: root.lastName, email: root.email, version: root.version, display: root.display };
  }

}
