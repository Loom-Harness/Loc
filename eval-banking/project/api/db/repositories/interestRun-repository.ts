// Auto-generated.  Do not edit by hand.
import type { InterestRunRepositoryPort } from "../../domain/repository-ports";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import { InterestRun } from "../../domain/interestRun";
import * as Ids from "../../domain/ids";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors";
import type { DomainEventDispatcher } from "../../domain/events";
import { requestLog } from "../../obs/als";

type Db = NodePgDatabase<typeof schema>;

export class InterestRunRepository implements InterestRunRepositoryPort {
  private readonly db: Db;
  private readonly events: DomainEventDispatcher;
  constructor(
    db: Db,
    events: DomainEventDispatcher,
  ) {
    this.db = db;
    this.events = events;
  }

  async findById(id: Ids.InterestRunId): Promise<InterestRun | null> {
    return await this.db.transaction(async (tx) => {
      const rootRows = await tx.select().from(schema.interestRuns).where(eq(schema.interestRuns.id, id));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "InterestRun", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const loaded = InterestRun._rehydrate({ id: Ids.InterestRunId(root.id), startedAt: root.startedAt, version: root.version });
      requestLog().debug({ event: "aggregate_loaded", aggregate: "InterestRun", id: id as string, found: true });
      return loaded;
    });
  }

  async getById(id: Ids.InterestRunId): Promise<InterestRun> {
    const found = await this.findById(id);
    if (!found) throw new AggregateNotFoundError(`InterestRun ${id} not found`);
    return found;
  }

  async findManyByIds(ids: Ids.InterestRunId[]): Promise<InterestRun[]> {
    if (ids.length === 0) return [];
    const rootRows = await this.db.select().from(schema.interestRuns).where(inArray(schema.interestRuns.id, ids));
    if (rootRows.length === 0) return [];
    return rootRows.map((root) => InterestRun._rehydrate({ id: Ids.InterestRunId(root.id), startedAt: root.startedAt, version: root.version }));
  }

  async save(aggregate: InterestRun, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.interestRuns.id }).from(schema.interestRuns).where(eq(schema.interestRuns.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.interestRuns).values({ id: aggregate.id as string, startedAt: aggregate.startedAt, version: 1 });
      } else {
        const updated = await tx.update(schema.interestRuns).set({ id: aggregate.id as string, startedAt: aggregate.startedAt, version: expected + 1 }).where(and(eq(schema.interestRuns.id, aggregate.id), eq(schema.interestRuns.version, expected))).returning({ id: schema.interestRuns.id });
        if (updated.length === 0) throw new ConcurrencyError("InterestRun", aggregate.id as string);
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "InterestRun", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "InterestRun", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async all(): Promise<InterestRun[]> {
    const rootRows = await this.db.select().from(schema.interestRuns);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "InterestRun", find: "all", rows: 0 });
      return [];
    }
    const result = rootRows.map((root) => InterestRun._rehydrate({ id: Ids.InterestRunId(root.id), startedAt: root.startedAt, version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "InterestRun", find: "all", rows: result.length });
    return result;
  }

  toWire(root: InterestRun): unknown {
    return { id: root.id as string, startedAt: (root.startedAt as Date).toISOString().replace(/\.000Z$/, "Z"), version: root.version };
  }

}
