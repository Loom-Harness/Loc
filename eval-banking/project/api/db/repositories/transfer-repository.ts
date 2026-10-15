// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import type { TransferRepositoryPort } from "../../domain/repository-ports";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import { Transfer } from "../../domain/transfer";
import type { TransferStatus } from "../../domain/value-objects";
import * as Ids from "../../domain/ids";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors";
import type { DomainEventDispatcher } from "../../domain/events";
import { requestLog } from "../../obs/als";

type Db = NodePgDatabase<typeof schema>;

export class TransferRepository implements TransferRepositoryPort {
  private readonly db: Db;
  private readonly events: DomainEventDispatcher;
  constructor(
    db: Db,
    events: DomainEventDispatcher,
  ) {
    this.db = db;
    this.events = events;
  }

  async findById(id: Ids.TransferId): Promise<Transfer | null> {
    return await this.db.transaction(async (tx) => {
      const rootRows = await tx.select().from(schema.transfers).where(eq(schema.transfers.id, id));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "Transfer", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const loaded = Transfer._rehydrate({ id: Ids.TransferId(root.id), reference: root.reference, source: Ids.AccountId(root.source), target: Ids.AccountId(root.target), amount: new Decimal(root.amount), status: root.status as TransferStatus, requestedBy: root.requestedBy, requestedAt: root.requestedAt, decidedBy: (root.decidedBy == null ? null : root.decidedBy), version: root.version });
      requestLog().debug({ event: "aggregate_loaded", aggregate: "Transfer", id: id as string, found: true });
      return loaded;
    });
  }

  async getById(id: Ids.TransferId): Promise<Transfer> {
    const found = await this.findById(id);
    if (!found) throw new AggregateNotFoundError(`Transfer ${id} not found`);
    return found;
  }

  async findManyByIds(ids: Ids.TransferId[]): Promise<Transfer[]> {
    if (ids.length === 0) return [];
    const rootRows = await this.db.select().from(schema.transfers).where(inArray(schema.transfers.id, ids));
    if (rootRows.length === 0) return [];
    return rootRows.map((root) => Transfer._rehydrate({ id: Ids.TransferId(root.id), reference: root.reference, source: Ids.AccountId(root.source), target: Ids.AccountId(root.target), amount: new Decimal(root.amount), status: root.status as TransferStatus, requestedBy: root.requestedBy, requestedAt: root.requestedAt, decidedBy: (root.decidedBy == null ? null : root.decidedBy), version: root.version }));
  }

  async save(aggregate: Transfer, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.transfers.id }).from(schema.transfers).where(eq(schema.transfers.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.transfers).values({ id: aggregate.id as string, reference: aggregate.reference, source: aggregate.source as string, target: aggregate.target as string, amount: aggregate.amount.toString(), status: aggregate.status, requestedBy: aggregate.requestedBy, requestedAt: aggregate.requestedAt, decidedBy: aggregate.decidedBy, version: 1 });
      } else {
        const updated = await tx.update(schema.transfers).set({ id: aggregate.id as string, reference: aggregate.reference, source: aggregate.source as string, target: aggregate.target as string, amount: aggregate.amount.toString(), status: aggregate.status, requestedBy: aggregate.requestedBy, requestedAt: aggregate.requestedAt, decidedBy: aggregate.decidedBy, version: expected + 1 }).where(and(eq(schema.transfers.id, aggregate.id), eq(schema.transfers.version, expected))).returning({ id: schema.transfers.id });
        if (updated.length === 0) throw new ConcurrencyError("Transfer", aggregate.id as string);
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "Transfer", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "Transfer", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async all(): Promise<Transfer[]> {
    const rootRows = await this.db.select().from(schema.transfers);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Transfer", find: "all", rows: 0 });
      return [];
    }
    const result = rootRows.map((root) => Transfer._rehydrate({ id: Ids.TransferId(root.id), reference: root.reference, source: Ids.AccountId(root.source), target: Ids.AccountId(root.target), amount: new Decimal(root.amount), status: root.status as TransferStatus, requestedBy: root.requestedBy, requestedAt: root.requestedAt, decidedBy: (root.decidedBy == null ? null : root.decidedBy), version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "Transfer", find: "all", rows: result.length });
    return result;
  }

  async pending(): Promise<Transfer[]> {
    const rootRows = await this.db.select().from(schema.transfers).where(eq(schema.transfers.status, "Pending"));
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Transfer", find: "pending", rows: 0 });
      return [];
    }
    const result = rootRows.map((root) => Transfer._rehydrate({ id: Ids.TransferId(root.id), reference: root.reference, source: Ids.AccountId(root.source), target: Ids.AccountId(root.target), amount: new Decimal(root.amount), status: root.status as TransferStatus, requestedBy: root.requestedBy, requestedAt: root.requestedAt, decidedBy: (root.decidedBy == null ? null : root.decidedBy), version: root.version }));
    requestLog().debug({ event: "find_executed", aggregate: "Transfer", find: "pending", rows: result.length });
    return result;
  }

  toWire(root: Transfer): unknown {
    return { id: root.id as string, reference: root.reference, source: root.source as string, target: root.target as string, amount: root.amount.toFixed(4), status: root.status as string, requestedBy: root.requestedBy, requestedAt: (root.requestedAt as Date).toISOString().replace(/\.000Z$/, "Z"), decidedBy: (root.decidedBy == null ? null : root.decidedBy), version: root.version, display: root.display };
  }

}
