// Auto-generated.
import Decimal from "decimal.js";
import * as Ids from "./ids";
import { TransferStatus } from "./value-objects";
import type * as Events from "./events";
import { DomainError } from "./errors";
import type { User } from "../auth/user-types";

export class Transfer {
  private _id: Ids.TransferId;
  private _events: Events.DomainEvent[] = [];
  private _reference: string;
  private _source: Ids.AccountId;
  private _target: Ids.AccountId;
  private _amount: Decimal;
  private _status: TransferStatus;
  private _requestedBy: string;
  private _requestedAt: Date;
  private _decidedBy: string | null;
  private _version: number;
  private constructor(state: { id: Ids.TransferId; reference: string; source: Ids.AccountId; target: Ids.AccountId; amount: Decimal; status: TransferStatus; requestedBy: string; requestedAt: Date; decidedBy: string | null; version: number }, trustStore = false) {
    this._id = state.id;
    this._reference = state.reference;
    this._source = state.source;
    this._target = state.target;
    this._amount = state.amount;
    this._status = state.status;
    this._requestedBy = state.requestedBy;
    this._requestedAt = state.requestedAt;
    this._decidedBy = state.decidedBy;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.TransferId { return this._id; }
  get reference(): string { return this._reference; }
  get source(): Ids.AccountId { return this._source; }
  get target(): Ids.AccountId { return this._target; }
  get amount(): Decimal { return this._amount; }
  get status(): TransferStatus { return this._status; }
  get requestedBy(): string { return this._requestedBy; }
  get requestedAt(): Date { return this._requestedAt; }
  get decidedBy(): string | null { return this._decidedBy; }
  get version(): number { return this._version; }
  get display(): string { return this._reference; }
  get inspect(): string { return "Transfer(" + "id: " + String(this._id) + ", " + "reference: " + "'" + this._reference + "'" + ", " + "source: " + String(this._source) + ", " + "target: " + String(this._target) + ", " + "amount: " + this._amount.toString() + ", " + "status: " + String(this._status) + ", " + "requestedBy: " + "'" + this._requestedBy + "'" + ", " + "requestedAt: " + this._requestedAt.toISOString() + ", " + "decidedBy: " + (this._decidedBy === null ? "null" : "'" + this._decidedBy + "'") + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public markCompleted(): void {
    if (!(this._status === TransferStatus.Pending)) throw new DomainError("Precondition failed: status == Pending");
    this._status = TransferStatus.Completed;
    this._assertInvariants();
  }

  public reject(reason: string, currentUser: User): void {
    if (!(this._status === TransferStatus.Pending)) throw new DomainError("Precondition failed: status == Pending");
    this._status = TransferStatus.Rejected;
    this._decidedBy = currentUser.id;
    this._events.push({ type: "TransferRejected", transfer: this._id, reason: reason, at: new Date() });
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
  }

  static _create(state: { id: Ids.TransferId; reference: string; source: Ids.AccountId; target: Ids.AccountId; amount: Decimal; status: TransferStatus; requestedBy: string; requestedAt: Date; decidedBy?: string | null; version: number }): Transfer {
    return new Transfer({ ...state, decidedBy: state.decidedBy ?? null });
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.TransferId; reference: string; source: Ids.AccountId; target: Ids.AccountId; amount: Decimal; status: TransferStatus; requestedBy: string; requestedAt: Date; decidedBy: string | null; version: number }): Transfer {
    return new Transfer(state, true);
  }
  static create(input: { reference: string; source: Ids.AccountId; target: Ids.AccountId; amount: Decimal; status: TransferStatus; requestedBy: string; requestedAt: Date; decidedBy?: string | null }): Transfer {
    return new Transfer({
      id: Ids.newTransferId(),
      reference: input.reference,
      source: input.source,
      target: input.target,
      amount: input.amount,
      status: input.status,
      requestedBy: input.requestedBy,
      requestedAt: input.requestedAt,
      decidedBy: input.decidedBy ?? null,
      version: 1,
    });
  }
}

