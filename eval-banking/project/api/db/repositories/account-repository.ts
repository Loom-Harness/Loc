// Auto-generated.  Do not edit by hand.
import Decimal from "decimal.js";
import type { AccountRepositoryPort } from "../../domain/repository-ports";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../schema";
import type { User } from "../../auth/user-types";
import { Account, LedgerEntry } from "../../domain/account";
import type { AccountStatus, AccountType, EntryKind } from "../../domain/value-objects";
import * as Ids from "../../domain/ids";
import { AggregateNotFoundError, ConcurrencyError } from "../../domain/errors";
import type { DomainEventDispatcher } from "../../domain/events";
import { requestLog } from "../../obs/als";

type Db = NodePgDatabase<typeof schema>;

const savingsAccountCriterion = () => and(eq(schema.accounts.accountType, "Savings"), eq(schema.accounts.status, "Active"));

export class AccountRepository implements AccountRepositoryPort {
  private readonly db: Db;
  private readonly events: DomainEventDispatcher;
  constructor(
    db: Db,
    events: DomainEventDispatcher,
  ) {
    this.db = db;
    this.events = events;
  }

  async findById(id: Ids.AccountId): Promise<Account | null> {
    return await this.db.transaction(async (tx) => {
      const rootRows = await tx.select().from(schema.accounts).where(eq(schema.accounts.id, id));
      if (rootRows.length === 0) {
        requestLog().debug({ event: "aggregate_loaded", aggregate: "Account", id: id as string, found: false });
        return null;
      }
      const root = rootRows[0]!;
      const entriesRows = await tx.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.parentId, id));
      const entries = entriesRows.map((r) => LedgerEntry._rehydrate({ id: Ids.LedgerEntryId(r.id), parentId: Ids.AccountId(r.parentId), kind: r.kind as EntryKind, amount: new Decimal(r.amount), balanceAfter: new Decimal(r.balanceAfter), at: r.at, memo: r.memo }));
      const loaded = Account._rehydrate({ id: Ids.AccountId(root.id), number: root.number, owner: Ids.CustomerId(root.owner), accountType: root.accountType as AccountType, currency: root.currency, status: root.status as AccountStatus, balance: new Decimal(root.balance), interestRate: Number(root.interestRate), dailyLimit: new Decimal(root.dailyLimit), withdrawnToday: new Decimal(root.withdrawnToday), limitDay: root.limitDay, openedAt: root.openedAt, version: root.version, entries });
      requestLog().debug({ event: "aggregate_loaded", aggregate: "Account", id: id as string, found: true });
      return loaded;
    });
  }

  async getById(id: Ids.AccountId): Promise<Account> {
    const found = await this.findById(id);
    if (!found) throw new AggregateNotFoundError(`Account ${id} not found`);
    return found;
  }

  async findManyByIds(ids: Ids.AccountId[]): Promise<Account[]> {
    if (ids.length === 0) return [];
    const rootRows = await this.db.select().from(schema.accounts).where(inArray(schema.accounts.id, ids));
    if (rootRows.length === 0) return [];
    const rootIds = rootRows.map((r) => r.id);
    const entriesRows = await this.db.select().from(schema.ledgerEntries).where(inArray(schema.ledgerEntries.parentId, rootIds));
    const entriesByParent = new Map<string, LedgerEntry[]>();
    for (const r of entriesRows) {
      const list = entriesByParent.get(r.parentId) ?? [];
      list.push(LedgerEntry._rehydrate({ id: Ids.LedgerEntryId(r.id), parentId: Ids.AccountId(r.parentId), kind: r.kind as EntryKind, amount: new Decimal(r.amount), balanceAfter: new Decimal(r.balanceAfter), at: r.at, memo: r.memo }));
      entriesByParent.set(r.parentId, list);
    }
    return rootRows.map((root) => Account._rehydrate({ id: Ids.AccountId(root.id), number: root.number, owner: Ids.CustomerId(root.owner), accountType: root.accountType as AccountType, currency: root.currency, status: root.status as AccountStatus, balance: new Decimal(root.balance), interestRate: Number(root.interestRate), dailyLimit: new Decimal(root.dailyLimit), withdrawnToday: new Decimal(root.withdrawnToday), limitDay: root.limitDay, openedAt: root.openedAt, version: root.version, entries: entriesByParent.get(root.id) ?? [] }));
  }

  async save(aggregate: Account, expectedVersion?: number): Promise<void> {
    const pendingEvents = aggregate.pullEvents();
    let dispatchAfterCommit = pendingEvents;
    await this.db.transaction(async (tx) => {
      const expected = expectedVersion ?? aggregate.version;
      const existingRow = await tx.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.id, aggregate.id));
      if (existingRow.length === 0) {
        await tx.insert(schema.accounts).values({ id: aggregate.id as string, number: aggregate.number, owner: aggregate.owner as string, accountType: aggregate.accountType, currency: aggregate.currency, status: aggregate.status, balance: aggregate.balance.toString(), interestRate: String(aggregate.interestRate), dailyLimit: aggregate.dailyLimit.toString(), withdrawnToday: aggregate.withdrawnToday.toString(), limitDay: aggregate.limitDay, openedAt: aggregate.openedAt, version: 1 });
      } else {
        const updated = await tx.update(schema.accounts).set({ id: aggregate.id as string, number: aggregate.number, owner: aggregate.owner as string, accountType: aggregate.accountType, currency: aggregate.currency, status: aggregate.status, balance: aggregate.balance.toString(), interestRate: String(aggregate.interestRate), dailyLimit: aggregate.dailyLimit.toString(), withdrawnToday: aggregate.withdrawnToday.toString(), limitDay: aggregate.limitDay, openedAt: aggregate.openedAt, version: expected + 1 }).where(and(eq(schema.accounts.id, aggregate.id), eq(schema.accounts.version, expected))).returning({ id: schema.accounts.id });
        if (updated.length === 0) throw new ConcurrencyError("Account", aggregate.id as string);
      }

      const existingEntries = await tx.select({ id: schema.ledgerEntries.id }).from(schema.ledgerEntries).where(eq(schema.ledgerEntries.parentId, aggregate.id));
      const existingIdsEntries = new Set(existingEntries.map((r) => r.id));
      const currentIdsEntries = new Set(aggregate.entries.map((e) => e.id as string));
      const toDeleteEntries = [...existingIdsEntries].filter((id) => !currentIdsEntries.has(id));
      if (toDeleteEntries.length > 0) {
        await tx.delete(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.parentId, aggregate.id), inArray(schema.ledgerEntries.id, toDeleteEntries)));
      }
      for (const child of aggregate.entries) {
        const childRow = { id: child.id as string, parentId: child.parentId as string, kind: child.kind, amount: child.amount.toString(), balanceAfter: child.balanceAfter.toString(), at: child.at, memo: child.memo };
        await tx.insert(schema.ledgerEntries).values(childRow).onConflictDoUpdate({ target: schema.ledgerEntries.id, set: childRow });
      }
      dispatchAfterCommit = (await this.events.recordDurable?.(pendingEvents, tx)) ?? pendingEvents;
    });
    requestLog().debug({ event: "repository_save", aggregate: "Account", id: aggregate.id as string });

    for (const event of dispatchAfterCommit) {
      requestLog().info({ event: "event_dispatched", event_type: (event as { type: string }).type, aggregate: "Account", id: aggregate.id as string });
      await this.events.dispatch(event);
    }
  }

  async all(): Promise<Account[]> {
    const rootRows = await this.db.select().from(schema.accounts);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Account", find: "all", rows: 0 });
      return [];
    }
    const rootIds = rootRows.map((r) => r.id);
    const entriesRows = await this.db.select().from(schema.ledgerEntries).where(inArray(schema.ledgerEntries.parentId, rootIds));
    const entriesByParent = new Map<string, LedgerEntry[]>();
    for (const r of entriesRows) {
      const list = entriesByParent.get(r.parentId) ?? [];
      list.push(LedgerEntry._rehydrate({ id: Ids.LedgerEntryId(r.id), parentId: Ids.AccountId(r.parentId), kind: r.kind as EntryKind, amount: new Decimal(r.amount), balanceAfter: new Decimal(r.balanceAfter), at: r.at, memo: r.memo }));
      entriesByParent.set(r.parentId, list);
    }
    const result = rootRows.map((root) => Account._rehydrate({ id: Ids.AccountId(root.id), number: root.number, owner: Ids.CustomerId(root.owner), accountType: root.accountType as AccountType, currency: root.currency, status: root.status as AccountStatus, balance: new Decimal(root.balance), interestRate: Number(root.interestRate), dailyLimit: new Decimal(root.dailyLimit), withdrawnToday: new Decimal(root.withdrawnToday), limitDay: root.limitDay, openedAt: root.openedAt, version: root.version, entries: entriesByParent.get(root.id) ?? [] }));
    requestLog().debug({ event: "find_executed", aggregate: "Account", find: "all", rows: result.length });
    return result;
  }

  async byNumber(number: string): Promise<Account | null> {
    const rootRows = await this.db.select().from(schema.accounts).where(eq(schema.accounts.number, number)).limit(1);
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Account", find: "byNumber", rows: 0 });
      return null;
    }
    const rootIds = rootRows.map((r) => r.id);
    const entriesRows = await this.db.select().from(schema.ledgerEntries).where(inArray(schema.ledgerEntries.parentId, rootIds));
    const entriesByParent = new Map<string, LedgerEntry[]>();
    for (const r of entriesRows) {
      const list = entriesByParent.get(r.parentId) ?? [];
      list.push(LedgerEntry._rehydrate({ id: Ids.LedgerEntryId(r.id), parentId: Ids.AccountId(r.parentId), kind: r.kind as EntryKind, amount: new Decimal(r.amount), balanceAfter: new Decimal(r.balanceAfter), at: r.at, memo: r.memo }));
      entriesByParent.set(r.parentId, list);
    }
    const result = Account._rehydrate({ id: Ids.AccountId(rootRows[0]!.id), number: rootRows[0]!.number, owner: Ids.CustomerId(rootRows[0]!.owner), accountType: rootRows[0]!.accountType as AccountType, currency: rootRows[0]!.currency, status: rootRows[0]!.status as AccountStatus, balance: new Decimal(rootRows[0]!.balance), interestRate: Number(rootRows[0]!.interestRate), dailyLimit: new Decimal(rootRows[0]!.dailyLimit), withdrawnToday: new Decimal(rootRows[0]!.withdrawnToday), limitDay: rootRows[0]!.limitDay, openedAt: rootRows[0]!.openedAt, version: rootRows[0]!.version, entries: entriesByParent.get(rootRows[0]!.id) ?? [] });
    requestLog().debug({ event: "find_executed", aggregate: "Account", find: "byNumber", rows: 1 });
    return result;
  }

  async mine(currentUser: User): Promise<Account[]> {
    const rootRows = await this.db.select().from(schema.accounts).where(eq(schema.accounts.owner, currentUser.customerId));
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Account", find: "mine", rows: 0 });
      return [];
    }
    const rootIds = rootRows.map((r) => r.id);
    const entriesRows = await this.db.select().from(schema.ledgerEntries).where(inArray(schema.ledgerEntries.parentId, rootIds));
    const entriesByParent = new Map<string, LedgerEntry[]>();
    for (const r of entriesRows) {
      const list = entriesByParent.get(r.parentId) ?? [];
      list.push(LedgerEntry._rehydrate({ id: Ids.LedgerEntryId(r.id), parentId: Ids.AccountId(r.parentId), kind: r.kind as EntryKind, amount: new Decimal(r.amount), balanceAfter: new Decimal(r.balanceAfter), at: r.at, memo: r.memo }));
      entriesByParent.set(r.parentId, list);
    }
    const result = rootRows.map((root) => Account._rehydrate({ id: Ids.AccountId(root.id), number: root.number, owner: Ids.CustomerId(root.owner), accountType: root.accountType as AccountType, currency: root.currency, status: root.status as AccountStatus, balance: new Decimal(root.balance), interestRate: Number(root.interestRate), dailyLimit: new Decimal(root.dailyLimit), withdrawnToday: new Decimal(root.withdrawnToday), limitDay: root.limitDay, openedAt: root.openedAt, version: root.version, entries: entriesByParent.get(root.id) ?? [] }));
    requestLog().debug({ event: "find_executed", aggregate: "Account", find: "mine", rows: result.length });
    return result;
  }

  async runActiveSavings(page?: { offset?: number; limit?: number }): Promise<Account[]> {
    let query = this.db.select().from(schema.accounts).where(savingsAccountCriterion()).$dynamic();
    if (page?.limit !== undefined) query = query.limit(page.limit);
    if (page?.offset !== undefined) query = query.offset(page.offset);
    const rootRows = await query;
    if (rootRows.length === 0) {
      requestLog().debug({ event: "find_executed", aggregate: "Account", find: "runActiveSavings", rows: 0 });
      return [];
    }
    const rootIds = rootRows.map((r) => r.id);
    const entriesRows = await this.db.select().from(schema.ledgerEntries).where(inArray(schema.ledgerEntries.parentId, rootIds));
    const entriesByParent = new Map<string, LedgerEntry[]>();
    for (const r of entriesRows) {
      const list = entriesByParent.get(r.parentId) ?? [];
      list.push(LedgerEntry._rehydrate({ id: Ids.LedgerEntryId(r.id), parentId: Ids.AccountId(r.parentId), kind: r.kind as EntryKind, amount: new Decimal(r.amount), balanceAfter: new Decimal(r.balanceAfter), at: r.at, memo: r.memo }));
      entriesByParent.set(r.parentId, list);
    }
    const result = rootRows.map((root) => Account._rehydrate({ id: Ids.AccountId(root.id), number: root.number, owner: Ids.CustomerId(root.owner), accountType: root.accountType as AccountType, currency: root.currency, status: root.status as AccountStatus, balance: new Decimal(root.balance), interestRate: Number(root.interestRate), dailyLimit: new Decimal(root.dailyLimit), withdrawnToday: new Decimal(root.withdrawnToday), limitDay: root.limitDay, openedAt: root.openedAt, version: root.version, entries: entriesByParent.get(root.id) ?? [] }));
    requestLog().debug({ event: "find_executed", aggregate: "Account", find: "runActiveSavings", rows: result.length });
    return result;
  }

  toWire(root: Account): unknown {
    return { id: root.id as string, number: root.number, owner: root.owner as string, accountType: root.accountType as string, currency: root.currency, status: root.status as string, balance: root.balance.toFixed(4), interestRate: root.interestRate, dailyLimit: root.dailyLimit.toFixed(4), withdrawnToday: root.withdrawnToday.toFixed(4), limitDay: (root.limitDay as Date).toISOString().replace(/\.000Z$/, "Z"), openedAt: (root.openedAt as Date).toISOString().replace(/\.000Z$/, "Z"), version: root.version, entries: root.entries.map((e: LedgerEntry) => ({ id: e.id as string, kind: e.kind as string, amount: e.amount.toFixed(4), balanceAfter: e.balanceAfter.toFixed(4), at: (e.at as Date).toISOString().replace(/\.000Z$/, "Z"), memo: e.memo })), display: root.display };
  }

}
