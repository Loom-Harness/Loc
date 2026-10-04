// Auto-generated.
import Decimal from "decimal.js";
import * as Ids from "./ids";
import { AccountStatus, AccountType, EntryKind } from "./value-objects";
import type * as Events from "./events";
import { DomainError } from "./errors";

export class LedgerEntry {
  private _id: Ids.LedgerEntryId;
  private _parentId: Ids.AccountId;
  private _kind: EntryKind;
  private _amount: Decimal;
  private _balanceAfter: Decimal;
  private _at: Date;
  private _memo: string;
  private constructor(state: { id: Ids.LedgerEntryId; parentId: Ids.AccountId; kind: EntryKind; amount: Decimal; balanceAfter: Decimal; at: Date; memo: string }, trustStore = false) {
    this._id = state.id;
    this._parentId = state.parentId;
    this._kind = state.kind;
    this._amount = state.amount;
    this._balanceAfter = state.balanceAfter;
    this._at = state.at;
    this._memo = state.memo;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.LedgerEntryId { return this._id; }
  get parentId(): Ids.AccountId { return this._parentId; }
  get kind(): EntryKind { return this._kind; }
  get amount(): Decimal { return this._amount; }
  get balanceAfter(): Decimal { return this._balanceAfter; }
  get at(): Date { return this._at; }
  get memo(): string { return this._memo; }
  private _assertInvariants(): void {
  }

  static _create(state: { id: Ids.LedgerEntryId; parentId: Ids.AccountId; kind: EntryKind; amount: Decimal; balanceAfter: Decimal; at: Date; memo: string }): LedgerEntry {
    return new LedgerEntry(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.LedgerEntryId; parentId: Ids.AccountId; kind: EntryKind; amount: Decimal; balanceAfter: Decimal; at: Date; memo: string }): LedgerEntry {
    return new LedgerEntry(state, true);
  }
}
export class Account {
  private _id: Ids.AccountId;
  private _events: Events.DomainEvent[] = [];
  private _number: string;
  private _owner: Ids.CustomerId;
  private _accountType: AccountType;
  private _currency: string;
  private _status: AccountStatus;
  private _balance: Decimal;
  private _interestRate: number;
  private _dailyLimit: Decimal;
  private _withdrawnToday: Decimal;
  private _limitDay: Date;
  private _openedAt: Date;
  private _version: number;
  private _entries: LedgerEntry[];
  private constructor(state: { id: Ids.AccountId; number: string; owner: Ids.CustomerId; accountType: AccountType; currency: string; status: AccountStatus; balance: Decimal; interestRate: number; dailyLimit: Decimal; withdrawnToday: Decimal; limitDay: Date; openedAt: Date; version: number; entries: LedgerEntry[] }, trustStore = false) {
    this._id = state.id;
    this._number = state.number;
    this._owner = state.owner;
    this._accountType = state.accountType;
    this._currency = state.currency;
    this._status = state.status;
    this._balance = state.balance;
    this._interestRate = state.interestRate;
    this._dailyLimit = state.dailyLimit;
    this._withdrawnToday = state.withdrawnToday;
    this._limitDay = state.limitDay;
    this._openedAt = state.openedAt;
    this._version = state.version;
    this._entries = state.entries;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.AccountId { return this._id; }
  get number(): string { return this._number; }
  get owner(): Ids.CustomerId { return this._owner; }
  get accountType(): AccountType { return this._accountType; }
  get currency(): string { return this._currency; }
  get status(): AccountStatus { return this._status; }
  get balance(): Decimal { return this._balance; }
  get interestRate(): number { return this._interestRate; }
  get dailyLimit(): Decimal { return this._dailyLimit; }
  get withdrawnToday(): Decimal { return this._withdrawnToday; }
  get limitDay(): Date { return this._limitDay; }
  get openedAt(): Date { return this._openedAt; }
  get version(): number { return this._version; }
  get entries(): readonly LedgerEntry[] { return this._entries; }
  get display(): string { return this._number; }
  get inspect(): string { return "Account(" + "id: " + String(this._id) + ", " + "number: " + "'" + this._number + "'" + ", " + "owner: " + String(this._owner) + ", " + "accountType: " + String(this._accountType) + ", " + "currency: " + "'" + this._currency + "'" + ", " + "status: " + String(this._status) + ", " + "balance: " + this._balance.toString() + ", " + "interestRate: " + String(this._interestRate) + ", " + "dailyLimit: " + this._dailyLimit.toString() + ", " + "withdrawnToday: " + this._withdrawnToday.toString() + ", " + "limitDay: " + this._limitDay.toISOString() + ", " + "openedAt: " + this._openedAt.toISOString() + ", " + "version: " + String(this._version) + ", " + "entries: " + "[LedgerEntry[]]" + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public sameDay(a: Date, b: Date): boolean { return new Date(Date.UTC((a).getUTCFullYear(), (a).getUTCMonth(), (a).getUTCDate())) >= new Date(Date.UTC((b).getUTCFullYear(), (b).getUTCMonth(), (b).getUTCDate())); }
  public deposit(amount: Decimal, memo: string): void {
    if (!(this._status === AccountStatus.Active)) throw new DomainError("Account is not active", "msg.mrfg0x", "");
    if (!(amount.gt(new Decimal("0")))) throw new DomainError("Amount must be positive", "msg.lmijhy", "/amount");
    this._balance = this._balance.plus(amount);
    this._entries.push(LedgerEntry._create({ id: Ids.newLedgerEntryId(), parentId: this._id, kind: EntryKind.Deposit, amount: amount, balanceAfter: this._balance, at: new Date(), memo: memo }));
    this._events.push({ type: "MoneyDeposited", account: this._id, amount: amount, at: new Date() });
    this._assertInvariants();
  }

  public withdraw(amount: Decimal, memo: string): void {
    if (!(this._status === AccountStatus.Active)) throw new DomainError("Account is not active", "msg.mrfg0x", "");
    if (!(amount.gt(new Decimal("0")))) throw new DomainError("Amount must be positive", "msg.lmijhy", "/amount");
    if (!(this._balance.gte(amount))) throw new DomainError("Insufficient funds", "msg.p55wf6", "");
    const used = this.sameDay(this._limitDay, new Date()) ? this._withdrawnToday : new Decimal("0");
    if (!(used.plus(amount).lte(this._dailyLimit))) throw new DomainError("Daily withdrawal limit exceeded", "msg.38janj", "");
    this._withdrawnToday = used.plus(amount);
    this._limitDay = new Date();
    this._balance = this._balance.minus(amount);
    this._entries.push(LedgerEntry._create({ id: Ids.newLedgerEntryId(), parentId: this._id, kind: EntryKind.Withdrawal, amount: amount, balanceAfter: this._balance, at: new Date(), memo: memo }));
    this._events.push({ type: "MoneyWithdrawn", account: this._id, amount: amount, at: new Date() });
    this._assertInvariants();
  }

  public debitForTransfer(amount: Decimal, ref: string): void {
    if (!(this._status === AccountStatus.Active)) throw new DomainError("Source account is not active", "msg.felbiy", "");
    if (!(this._balance.gte(amount))) throw new DomainError("Insufficient funds", "msg.p55wf6", "");
    this._balance = this._balance.minus(amount);
    this._entries.push(LedgerEntry._create({ id: Ids.newLedgerEntryId(), parentId: this._id, kind: EntryKind.TransferOut, amount: amount, balanceAfter: this._balance, at: new Date(), memo: ref }));
    this._assertInvariants();
  }

  public creditForTransfer(amount: Decimal, ref: string): void {
    if (!(this._status === AccountStatus.Active)) throw new DomainError("Target account is not active", "msg.3nv9hm", "");
    this._balance = this._balance.plus(amount);
    this._entries.push(LedgerEntry._create({ id: Ids.newLedgerEntryId(), parentId: this._id, kind: EntryKind.TransferIn, amount: amount, balanceAfter: this._balance, at: new Date(), memo: ref }));
    this._assertInvariants();
  }

  public accrueInterest(asOf: Date): void {
    if (!(this._accountType === AccountType.Savings)) throw new DomainError("Precondition failed: accountType == Savings");
    const interest = this._balance.times(this._interestRate).div(12);
    this._balance = this._balance.plus(interest);
    this._entries.push(LedgerEntry._create({ id: Ids.newLedgerEntryId(), parentId: this._id, kind: EntryKind.Deposit, amount: interest, balanceAfter: this._balance, at: asOf, memo: "Monthly interest" }));
    this._assertInvariants();
  }

  public freeze(): void {
    if (!(this._status === AccountStatus.Active)) throw new DomainError("Precondition failed: status == Active");
    this._status = AccountStatus.Frozen;
    this._assertInvariants();
  }

  public unfreeze(): void {
    if (!(this._status === AccountStatus.Frozen)) throw new DomainError("Precondition failed: status == Frozen");
    this._status = AccountStatus.Active;
    this._assertInvariants();
  }

  public close(): void {
    if (!(this._balance.eq(new Decimal("0")))) throw new DomainError("Balance must be zero to close", "msg.ga83c6", "");
    this._status = AccountStatus.Closed;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
    if (!(this._balance.gte(new Decimal("0")))) throw new DomainError("Invariant violated: balance >= money(\"0\")");
    if (!([...this._number].length === 10)) throw new DomainError("Invariant violated: number.length == 10");
    if (!([...this._currency].length === 3)) throw new DomainError("Invariant violated: currency.length == 3");
    if (!(this._dailyLimit.gte(new Decimal("0")))) throw new DomainError("Invariant violated: dailyLimit >= money(\"0\")");
  }

  static _create(state: { id: Ids.AccountId; number: string; owner: Ids.CustomerId; accountType: AccountType; currency: string; status: AccountStatus; balance: Decimal; interestRate: number; dailyLimit: Decimal; withdrawnToday: Decimal; limitDay: Date; openedAt: Date; version: number; entries?: LedgerEntry[] }): Account {
    return new Account({ ...state, entries: state.entries ?? [] });
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.AccountId; number: string; owner: Ids.CustomerId; accountType: AccountType; currency: string; status: AccountStatus; balance: Decimal; interestRate: number; dailyLimit: Decimal; withdrawnToday: Decimal; limitDay: Date; openedAt: Date; version: number; entries: LedgerEntry[] }): Account {
    return new Account(state, true);
  }
  static create(input: { number: string; owner: Ids.CustomerId; accountType: AccountType; currency: string; status: AccountStatus; balance: Decimal; interestRate: number; dailyLimit: Decimal; withdrawnToday: Decimal; limitDay: Date; openedAt: Date }): Account {
    return new Account({
      id: Ids.newAccountId(),
      number: input.number,
      owner: input.owner,
      accountType: input.accountType,
      currency: input.currency,
      status: input.status,
      balance: input.balance,
      interestRate: input.interestRate,
      dailyLimit: input.dailyLimit,
      withdrawnToday: input.withdrawnToday,
      limitDay: input.limitDay,
      openedAt: input.openedAt,
      version: 1,
      entries: [],
    });
  }
}

