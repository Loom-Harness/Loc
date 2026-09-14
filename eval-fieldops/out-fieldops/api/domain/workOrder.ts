// Auto-generated.
import Decimal from "decimal.js";
import * as Ids from "./ids.ts";
import { WorkOrderStatus, type Priority } from "./value-objects.ts";
import type * as Events from "./events.ts";
import { DisallowedError, DomainError } from "./errors.ts";

export class WorkOrderLine {
  private _id: Ids.WorkOrderLineId;
  private _parentId: Ids.WorkOrderId;
  private _description: string;
  private _quantity: number;
  private _unitPrice: Decimal;
  private _currency: string;
  private constructor(state: { id: Ids.WorkOrderLineId; parentId: Ids.WorkOrderId; description: string; quantity: number; unitPrice: Decimal; currency: string }, trustStore = false) {
    this._id = state.id;
    this._parentId = state.parentId;
    this._description = state.description;
    this._quantity = state.quantity;
    this._unitPrice = state.unitPrice;
    this._currency = state.currency;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.WorkOrderLineId { return this._id; }
  get parentId(): Ids.WorkOrderId { return this._parentId; }
  get description(): string { return this._description; }
  get quantity(): number { return this._quantity; }
  get unitPrice(): Decimal { return this._unitPrice; }
  get currency(): string { return this._currency; }
  get amount(): Decimal { return this._unitPrice.times(this._quantity); }
  private _assertInvariants(): void {
    if (!(this._quantity > 0)) throw new DomainError("Invariant violated: quantity > 0");
  }

  static _create(state: { id: Ids.WorkOrderLineId; parentId: Ids.WorkOrderId; description: string; quantity: number; unitPrice: Decimal; currency: string }): WorkOrderLine {
    return new WorkOrderLine(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.WorkOrderLineId; parentId: Ids.WorkOrderId; description: string; quantity: number; unitPrice: Decimal; currency: string }): WorkOrderLine {
    return new WorkOrderLine(state, true);
  }
}
export class WorkOrder {
  private _id: Ids.WorkOrderId;
  private _events: Events.DomainEvent[] = [];
  private _customerId: Ids.CustomerId;
  private _siteId: Ids.SiteId;
  private _assetId: Ids.AssetId | null;
  private _technicianId: Ids.TechnicianId | null;
  private _technicianUserId: string | null;
  private _status: WorkOrderStatus;
  private _priority: Priority;
  private _currency: string;
  private _scheduledAt: Date | null;
  private _startedAt: Date | null;
  private _completedAt: Date | null;
  private _resolutionNote: string | null;
  private _photo: { url: string; key: string; contentType: string; size: number } | null;
  private _tenantId: string;
  private _dataKey: string | null;
  private _createdAt: Date;
  private _updatedAt: Date;
  private _createdBy: string;
  private _updatedBy: string;
  private _version: number;
  private _lines: WorkOrderLine[];
  private constructor(state: { id: Ids.WorkOrderId; customerId: Ids.CustomerId; siteId: Ids.SiteId; assetId: Ids.AssetId | null; technicianId: Ids.TechnicianId | null; technicianUserId: string | null; status: WorkOrderStatus; priority: Priority; currency: string; scheduledAt: Date | null; startedAt: Date | null; completedAt: Date | null; resolutionNote: string | null; photo: { url: string; key: string; contentType: string; size: number } | null; tenantId: string; dataKey: string | null; createdAt: Date; updatedAt: Date; createdBy: string; updatedBy: string; version: number; lines: WorkOrderLine[] }, trustStore = false) {
    this._id = state.id;
    this._customerId = state.customerId;
    this._siteId = state.siteId;
    this._assetId = state.assetId;
    this._technicianId = state.technicianId;
    this._technicianUserId = state.technicianUserId;
    this._status = state.status;
    this._priority = state.priority;
    this._currency = state.currency;
    this._scheduledAt = state.scheduledAt;
    this._startedAt = state.startedAt;
    this._completedAt = state.completedAt;
    this._resolutionNote = state.resolutionNote;
    this._photo = state.photo;
    this._tenantId = state.tenantId;
    this._dataKey = state.dataKey;
    this._createdAt = state.createdAt;
    this._updatedAt = state.updatedAt;
    this._createdBy = state.createdBy;
    this._updatedBy = state.updatedBy;
    this._version = state.version;
    this._lines = state.lines;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.WorkOrderId { return this._id; }
  get customerId(): Ids.CustomerId { return this._customerId; }
  get siteId(): Ids.SiteId { return this._siteId; }
  get assetId(): Ids.AssetId | null { return this._assetId; }
  get technicianId(): Ids.TechnicianId | null { return this._technicianId; }
  get technicianUserId(): string | null { return this._technicianUserId; }
  get status(): WorkOrderStatus { return this._status; }
  get priority(): Priority { return this._priority; }
  get currency(): string { return this._currency; }
  get scheduledAt(): Date | null { return this._scheduledAt; }
  get startedAt(): Date | null { return this._startedAt; }
  get completedAt(): Date | null { return this._completedAt; }
  get resolutionNote(): string | null { return this._resolutionNote; }
  get photo(): { url: string; key: string; contentType: string; size: number } | null { return this._photo; }
  get tenantId(): string { return this._tenantId; }
  get dataKey(): string | null { return this._dataKey; }
  get createdAt(): Date { return this._createdAt; }
  get updatedAt(): Date { return this._updatedAt; }
  get createdBy(): string { return this._createdBy; }
  get updatedBy(): string { return this._updatedBy; }
  get version(): number { return this._version; }
  get lines(): readonly WorkOrderLine[] { return this._lines; }
  get total(): Decimal { return (this._lines).reduce((acc, x) => acc.plus(((l) => l.amount)(x)), new Decimal(0)); }
  get display(): string { return this.serialLabel(); }
  get timeToComplete(): number { return 0; }
  get inspect(): string { return "WorkOrder(" + "id: " + String(this._id) + ", " + "customerId: " + String(this._customerId) + ", " + "siteId: " + String(this._siteId) + ", " + "assetId: " + "[Asset id?]" + ", " + "technicianId: " + "[Technician id?]" + ", " + "technicianUserId: " + "[guid?]" + ", " + "status: " + String(this._status) + ", " + "priority: " + String(this._priority) + ", " + "currency: " + "'" + this._currency + "'" + ", " + "scheduledAt: " + "[datetime?]" + ", " + "startedAt: " + "[datetime?]" + ", " + "completedAt: " + "[datetime?]" + ", " + "resolutionNote: " + "[string?]" + ", " + "photo: " + "[File?]" + ", " + "tenantId: " + "'" + this._tenantId + "'" + ", " + "dataKey: " + "[string?]" + ", " + "createdAt: " + String(this._createdAt) + ", " + "updatedAt: " + String(this._updatedAt) + ", " + "createdBy: " + String(this._createdBy) + ", " + "updatedBy: " + String(this._updatedBy) + ", " + "version: " + String(this._version) + ", " + "lines: " + "[WorkOrderLine[]]" + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  private serialLabel(): string { return "WO"; }
  private isEditable(): boolean { return this._status === WorkOrderStatus.Draft; }
  public addLabour(description: string, hours: number, rate: Decimal, lineCurrency: string): void {
    if (!(this.isEditable())) throw new DomainError("Precondition failed: isEditable()");
    if (!(hours > 0)) throw new DomainError("Precondition failed: hours > 0");
    if (!(lineCurrency === this._currency)) throw new DomainError("Precondition failed: lineCurrency == currency");
    this._lines.push(WorkOrderLine._create({ id: Ids.newWorkOrderLineId(), parentId: this._id, description: description, quantity: hours, unitPrice: rate, currency: lineCurrency }));
    this._assertInvariants();
  }

  public schedule(tech: Ids.TechnicianId, at: Date): void {
    if (!(this._status === WorkOrderStatus.Draft)) throw new DisallowedError("operation 'schedule' is not allowed in the current state of WorkOrder.");
    this._technicianId = tech;
    this._scheduledAt = at;
    this._status = WorkOrderStatus.Scheduled;
    this._assertInvariants();
  }

  public start(): void {
    if (!(this._status === WorkOrderStatus.Scheduled)) throw new DisallowedError("operation 'start' is not allowed in the current state of WorkOrder.");
    this._status = WorkOrderStatus.InProgress;
    this._startedAt = new Date();
    this._assertInvariants();
  }

  public complete(note: string): void {
    if (!(this._status === WorkOrderStatus.InProgress)) throw new DisallowedError("operation 'complete' is not allowed in the current state of WorkOrder.");
    this._status = WorkOrderStatus.Completed;
    this._completedAt = new Date();
    this._resolutionNote = note;
    this._events.push({ type: "WorkOrderCompleted", workOrder: this._id, at: new Date(), org: "" });
    this._assertInvariants();
  }

  public cancel(reason: string): void {
    if (!(this._status !== WorkOrderStatus.Completed)) throw new DisallowedError("operation 'cancel' is not allowed in the current state of WorkOrder.");
    this._status = WorkOrderStatus.Cancelled;
    this._resolutionNote = reason;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
    if (!((this._lines).every((l) => l.currency === this._currency))) throw new DomainError("Invariant violated: lines.all(l => l.currency == currency)");
    if (!([...this._currency].length === 3)) throw new DomainError("Invariant violated: currency.length == 3");
  }

  static _create(state: { id: Ids.WorkOrderId; customerId: Ids.CustomerId; siteId: Ids.SiteId; assetId: Ids.AssetId | null; technicianId: Ids.TechnicianId | null; technicianUserId: string | null; status: WorkOrderStatus; priority: Priority; currency: string; scheduledAt: Date | null; startedAt: Date | null; completedAt: Date | null; resolutionNote: string | null; photo: { url: string; key: string; contentType: string; size: number } | null; tenantId: string; dataKey: string | null; createdAt: Date; updatedAt: Date; createdBy: string; updatedBy: string; version: number; lines?: WorkOrderLine[] }): WorkOrder {
    return new WorkOrder({ ...state, lines: state.lines ?? [] });
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.WorkOrderId; customerId: Ids.CustomerId; siteId: Ids.SiteId; assetId: Ids.AssetId | null; technicianId: Ids.TechnicianId | null; technicianUserId: string | null; status: WorkOrderStatus; priority: Priority; currency: string; scheduledAt: Date | null; startedAt: Date | null; completedAt: Date | null; resolutionNote: string | null; photo: { url: string; key: string; contentType: string; size: number } | null; tenantId: string; dataKey: string | null; createdAt: Date; updatedAt: Date; createdBy: string; updatedBy: string; version: number; lines: WorkOrderLine[] }): WorkOrder {
    return new WorkOrder(state, true);
  }
  static create(input: { customerId: Ids.CustomerId; siteId: Ids.SiteId; assetId?: Ids.AssetId | null; technicianId?: Ids.TechnicianId | null; technicianUserId?: string | null; status: WorkOrderStatus; priority: Priority; currency: string; scheduledAt?: Date | null; startedAt?: Date | null; completedAt?: Date | null; resolutionNote?: string | null; photo?: { url: string; key: string; contentType: string; size: number } | null }): WorkOrder {
    return new WorkOrder({
      id: Ids.newWorkOrderId(),
      customerId: input.customerId,
      siteId: input.siteId,
      assetId: input.assetId ?? null,
      technicianId: input.technicianId ?? null,
      technicianUserId: input.technicianUserId ?? null,
      status: input.status,
      priority: input.priority,
      currency: input.currency,
      scheduledAt: input.scheduledAt ?? null,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      resolutionNote: input.resolutionNote ?? null,
      photo: input.photo ?? null,
      tenantId: "",
      dataKey: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: "",
      updatedBy: "",
      version: 1,
      lines: [],
    });
  }
}

//# sourceMappingURL=workOrder.ts.map
