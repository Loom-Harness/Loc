// Auto-generated.
import Decimal from "decimal.js";
import * as Ids from "./ids.ts";
import type * as Events from "./events.ts";
import { DisallowedError } from "./errors.ts";

export class Invoice {
  private _id: Ids.InvoiceId;
  private _events: Events.DomainEvent[] = [];
  private _workOrderId: Ids.WorkOrderId;
  private _issuedAt: Date | null;
  private _amount: Decimal;
  private _currency: string;
  private _tenantId: string;
  private _dataKey: string | null;
  private _createdAt: Date;
  private _updatedAt: Date;
  private _createdBy: string;
  private _updatedBy: string;
  private _version: number;
  private constructor(state: { id: Ids.InvoiceId; workOrderId: Ids.WorkOrderId; issuedAt: Date | null; amount: Decimal; currency: string; tenantId: string; dataKey: string | null; createdAt: Date; updatedAt: Date; createdBy: string; updatedBy: string; version: number }, trustStore = false) {
    this._id = state.id;
    this._workOrderId = state.workOrderId;
    this._issuedAt = state.issuedAt;
    this._amount = state.amount;
    this._currency = state.currency;
    this._tenantId = state.tenantId;
    this._dataKey = state.dataKey;
    this._createdAt = state.createdAt;
    this._updatedAt = state.updatedAt;
    this._createdBy = state.createdBy;
    this._updatedBy = state.updatedBy;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.InvoiceId { return this._id; }
  get workOrderId(): Ids.WorkOrderId { return this._workOrderId; }
  get issuedAt(): Date | null { return this._issuedAt; }
  get amount(): Decimal { return this._amount; }
  get currency(): string { return this._currency; }
  get tenantId(): string { return this._tenantId; }
  get dataKey(): string | null { return this._dataKey; }
  get createdAt(): Date { return this._createdAt; }
  get updatedAt(): Date { return this._updatedAt; }
  get createdBy(): string { return this._createdBy; }
  get updatedBy(): string { return this._updatedBy; }
  get version(): number { return this._version; }
  get issued(): boolean { return this._issuedAt !== null; }
  get display(): string { return this._currency; }
  get inspect(): string { return "Invoice(" + "id: " + String(this._id) + ", " + "workOrderId: " + String(this._workOrderId) + ", " + "issuedAt: " + "[datetime?]" + ", " + "amount: " + this._amount.toString() + ", " + "currency: " + "'" + this._currency + "'" + ", " + "tenantId: " + "'" + this._tenantId + "'" + ", " + "dataKey: " + "[string?]" + ", " + "createdAt: " + String(this._createdAt) + ", " + "updatedAt: " + String(this._updatedAt) + ", " + "createdBy: " + String(this._createdBy) + ", " + "updatedBy: " + String(this._updatedBy) + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public issue(): void {
    if (!(this._issuedAt === null)) throw new DisallowedError("operation 'issue' is not allowed in the current state of Invoice.");
    this._issuedAt = new Date();
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
  }

  static _create(state: { id: Ids.InvoiceId; workOrderId: Ids.WorkOrderId; issuedAt: Date | null; amount: Decimal; currency: string; tenantId: string; dataKey: string | null; createdAt: Date; updatedAt: Date; createdBy: string; updatedBy: string; version: number }): Invoice {
    return new Invoice(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.InvoiceId; workOrderId: Ids.WorkOrderId; issuedAt: Date | null; amount: Decimal; currency: string; tenantId: string; dataKey: string | null; createdAt: Date; updatedAt: Date; createdBy: string; updatedBy: string; version: number }): Invoice {
    return new Invoice(state, true);
  }
  static create(input: { workOrderId: Ids.WorkOrderId; issuedAt?: Date | null; amount: Decimal; currency: string }): Invoice {
    return new Invoice({
      id: Ids.newInvoiceId(),
      workOrderId: input.workOrderId,
      issuedAt: input.issuedAt ?? null,
      amount: input.amount,
      currency: input.currency,
      tenantId: "",
      dataKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "",
      updatedBy: "",
      version: 1,
    });
  }
}

//# sourceMappingURL=invoice.ts.map
