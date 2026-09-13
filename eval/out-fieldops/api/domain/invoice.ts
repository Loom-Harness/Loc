// Auto-generated.
import * as Ids from "./ids";
import type * as Events from "./events";
import { DomainError } from "./errors";

export class Invoice {
  private _id: Ids.InvoiceId;
  private _events: Events.DomainEvent[] = [];
  private _workOrderId: Ids.WorkOrderId;
  private _customerId: Ids.CustomerId;
  private _currency: string;
  private _amount: number;
  private _issued: boolean;
  private _tenantId: string;
  private _dataKey: string | null;
  private _createdAt: Date;
  private _updatedAt: Date;
  private _createdBy: string;
  private _updatedBy: string;
  private _version: number;
  private constructor(state: { id: Ids.InvoiceId; workOrderId: Ids.WorkOrderId; customerId: Ids.CustomerId; currency: string; amount: number; issued: boolean; tenantId: string; dataKey: string | null; createdAt: Date; updatedAt: Date; createdBy: string; updatedBy: string; version: number }, trustStore = false) {
    this._id = state.id;
    this._workOrderId = state.workOrderId;
    this._customerId = state.customerId;
    this._currency = state.currency;
    this._amount = state.amount;
    this._issued = state.issued;
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
  get customerId(): Ids.CustomerId { return this._customerId; }
  get currency(): string { return this._currency; }
  get amount(): number { return this._amount; }
  get issued(): boolean { return this._issued; }
  get tenantId(): string { return this._tenantId; }
  get dataKey(): string | null { return this._dataKey; }
  get createdAt(): Date { return this._createdAt; }
  get updatedAt(): Date { return this._updatedAt; }
  get createdBy(): string { return this._createdBy; }
  get updatedBy(): string { return this._updatedBy; }
  get version(): number { return this._version; }
  get inspect(): string { return "Invoice(" + "id: " + String(this._id) + ", " + "workOrderId: " + String(this._workOrderId) + ", " + "customerId: " + String(this._customerId) + ", " + "currency: " + "'" + this._currency + "'" + ", " + "amount: " + String(this._amount) + ", " + "issued: " + String(this._issued) + ", " + "tenantId: " + "'" + this._tenantId + "'" + ", " + "dataKey: " + "[string?]" + ", " + "createdAt: " + String(this._createdAt) + ", " + "updatedAt: " + String(this._updatedAt) + ", " + "createdBy: " + String(this._createdBy) + ", " + "updatedBy: " + String(this._updatedBy) + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public issue(): void {
    if (!(this._issued === false)) throw new DomainError("Precondition failed: issued == false");
    this._issued = true;
    this._assertInvariants();
  }

  public update(workOrderId: Ids.WorkOrderId, customerId: Ids.CustomerId, currency: string, amount: number, issued: boolean): void {
    this._workOrderId = workOrderId;
    this._customerId = customerId;
    this._currency = currency;
    this._amount = amount;
    this._issued = issued;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
    if (!(this._amount >= 0)) throw new DomainError("Invariant violated: amount >= 0");
  }

  static _create(state: { id: Ids.InvoiceId; workOrderId: Ids.WorkOrderId; customerId: Ids.CustomerId; currency: string; amount: number; issued: boolean; tenantId: string; dataKey: string | null; createdAt: Date; updatedAt: Date; createdBy: string; updatedBy: string; version: number }): Invoice {
    return new Invoice(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.InvoiceId; workOrderId: Ids.WorkOrderId; customerId: Ids.CustomerId; currency: string; amount: number; issued: boolean; tenantId: string; dataKey: string | null; createdAt: Date; updatedAt: Date; createdBy: string; updatedBy: string; version: number }): Invoice {
    return new Invoice(state, true);
  }
  static create(input: { workOrderId: Ids.WorkOrderId; customerId: Ids.CustomerId; currency: string; amount: number; issued?: boolean }): Invoice {
    return new Invoice({
      id: Ids.newInvoiceId(),
      workOrderId: input.workOrderId,
      customerId: input.customerId,
      currency: input.currency,
      amount: input.amount,
      issued: input.issued ?? false,
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

