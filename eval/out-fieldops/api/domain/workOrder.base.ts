// Auto-generated.
import * as Ids from "./ids";
import { Money, WorkOrderStatus, type Priority, type LineKind } from "./value-objects";
import type * as Events from "./events";
import { DomainError } from "./errors";

export class Photo {
  private _id: Ids.PhotoId;
  private _parentId: Ids.WorkOrderId;
  private _file: { url: string; key: string; contentType: string; size: number };
  private _caption: string;
  private constructor(state: { id: Ids.PhotoId; parentId: Ids.WorkOrderId; file: { url: string; key: string; contentType: string; size: number }; caption: string }, trustStore = false) {
    this._id = state.id;
    this._parentId = state.parentId;
    this._file = state.file;
    this._caption = state.caption;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.PhotoId { return this._id; }
  get parentId(): Ids.WorkOrderId { return this._parentId; }
  get file(): { url: string; key: string; contentType: string; size: number } { return this._file; }
  get caption(): string { return this._caption; }
  private _assertInvariants(): void {
  }

  static _create(state: { id: Ids.PhotoId; parentId: Ids.WorkOrderId; file: { url: string; key: string; contentType: string; size: number }; caption: string }): Photo {
    return new Photo(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.PhotoId; parentId: Ids.WorkOrderId; file: { url: string; key: string; contentType: string; size: number }; caption: string }): Photo {
    return new Photo(state, true);
  }
}

export class WorkOrderLine {
  private _id: Ids.WorkOrderLineId;
  private _parentId: Ids.WorkOrderId;
  private _kind: LineKind;
  private _description: string;
  private _partId: Ids.PartId | null;
  private _quantity: number;
  private _unitPrice: Money;
  private constructor(state: { id: Ids.WorkOrderLineId; parentId: Ids.WorkOrderId; kind: LineKind; description: string; partId: Ids.PartId | null; quantity: number; unitPrice: Money }, trustStore = false) {
    this._id = state.id;
    this._parentId = state.parentId;
    this._kind = state.kind;
    this._description = state.description;
    this._partId = state.partId;
    this._quantity = state.quantity;
    this._unitPrice = state.unitPrice;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.WorkOrderLineId { return this._id; }
  get parentId(): Ids.WorkOrderId { return this._parentId; }
  get kind(): LineKind { return this._kind; }
  get description(): string { return this._description; }
  get partId(): Ids.PartId | null { return this._partId; }
  get quantity(): number { return this._quantity; }
  get unitPrice(): Money { return this._unitPrice; }
  get subtotal(): Money { return new Money(this._unitPrice.amount * this._quantity, this._unitPrice.currency); }
  private _assertInvariants(): void {
    if (!(this._quantity > 0)) throw new DomainError("Invariant violated: quantity > 0");
  }

  static _create(state: { id: Ids.WorkOrderLineId; parentId: Ids.WorkOrderId; kind: LineKind; description: string; partId: Ids.PartId | null; quantity: number; unitPrice: Money }): WorkOrderLine {
    return new WorkOrderLine(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.WorkOrderLineId; parentId: Ids.WorkOrderId; kind: LineKind; description: string; partId: Ids.PartId | null; quantity: number; unitPrice: Money }): WorkOrderLine {
    return new WorkOrderLine(state, true);
  }
}
export abstract class WorkOrderBase {
  protected _id: Ids.WorkOrderId;
  protected _events: Events.DomainEvent[] = [];
  protected _customerId: Ids.CustomerId;
  protected _siteId: Ids.SiteId;
  protected _assetId: Ids.AssetId | null;
  protected _technicianId: Ids.TechnicianId | null;
  protected _technicianUserId: string | null;
  protected _status: WorkOrderStatus;
  protected _priority: Priority;
  protected _currency: string;
  protected _scheduledAt: Date | null;
  protected _startedAt: Date | null;
  protected _completedAt: Date | null;
  protected _resolutionNote: string | null;
  protected _tenantId: string;
  protected _dataKey: string | null;
  protected _version: number;
  protected _lines: WorkOrderLine[];
  protected _photos: Photo[];
  public constructor(state: { id: Ids.WorkOrderId; customerId: Ids.CustomerId; siteId: Ids.SiteId; assetId: Ids.AssetId | null; technicianId: Ids.TechnicianId | null; technicianUserId: string | null; status: WorkOrderStatus; priority: Priority; currency: string; scheduledAt: Date | null; startedAt: Date | null; completedAt: Date | null; resolutionNote: string | null; tenantId: string; dataKey: string | null; version: number; lines: WorkOrderLine[]; photos: Photo[] }, trustStore = false) {
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
    this._tenantId = state.tenantId;
    this._dataKey = state.dataKey;
    this._version = state.version;
    this._lines = state.lines;
    this._photos = state.photos;
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
  get tenantId(): string { return this._tenantId; }
  get dataKey(): string | null { return this._dataKey; }
  get version(): number { return this._version; }
  get lines(): readonly WorkOrderLine[] { return this._lines; }
  get photos(): readonly Photo[] { return this._photos; }
  get display(): string { return this._resolutionNote === null ? "Work order" : this._resolutionNote; }
  get total(): Money { return new Money((this._lines).reduce((acc, x) => acc + ((l) => l.subtotal.amount)(x), 0), this._currency); }
  get inspect(): string { return "WorkOrder(" + "id: " + String(this._id) + ", " + "customerId: " + String(this._customerId) + ", " + "siteId: " + String(this._siteId) + ", " + "assetId: " + "[Asset id?]" + ", " + "technicianId: " + "[Technician id?]" + ", " + "technicianUserId: " + "[string?]" + ", " + "status: " + String(this._status) + ", " + "priority: " + String(this._priority) + ", " + "currency: " + "'" + this._currency + "'" + ", " + "scheduledAt: " + "[datetime?]" + ", " + "startedAt: " + "[datetime?]" + ", " + "completedAt: " + "[datetime?]" + ", " + "resolutionNote: " + "[string?]" + ", " + "tenantId: " + "'" + this._tenantId + "'" + ", " + "dataKey: " + "[string?]" + ", " + "version: " + String(this._version) + ", " + "lines: " + "[WorkOrderLine[]]" + ", " + "photos: " + "[Photo[]]" + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  /** Raise a domain event from within an `extern` operation hook.  Buffered
   *  like any other emitted event; drained by `pullEvents()`. */
  protected _raiseEvent(ev: Events.DomainEvent): void { this._events.push(ev); }
  private isDraft(): boolean { return this._status === WorkOrderStatus.Draft; }
  public assignTechnician(assignTo: Ids.TechnicianId, assignedUserId: string, at: Date): void {
    if (!(this._status === WorkOrderStatus.Draft)) throw new DomainError("Precondition failed: status == Draft");
    this._technicianId = assignTo;
    this._technicianUserId = assignedUserId;
    this._scheduledAt = at;
    this._status = WorkOrderStatus.Scheduled;
    this._assertInvariants();
  }

  public start(): void {
    if (!(this._status === WorkOrderStatus.Scheduled)) throw new DomainError("Precondition failed: status == Scheduled");
    this._status = WorkOrderStatus.InProgress;
    this._startedAt = new Date();
    this._assertInvariants();
  }

  public addLine(kind: LineKind, description: string, partId: Ids.PartId | null, quantity: number, unitPrice: Money): void {
    if (!(this._status === WorkOrderStatus.Draft || this._status === WorkOrderStatus.Scheduled || this._status === WorkOrderStatus.InProgress)) throw new DomainError("Precondition failed: status == Draft || status == Scheduled || status == InProgress");
    if (!(quantity > 0)) throw new DomainError("Precondition failed: quantity > 0");
    if (!(unitPrice.currency === this._currency)) throw new DomainError("Precondition failed: unitPrice.currency == currency");
    this._lines.push(WorkOrderLine._create({ id: Ids.newWorkOrderLineId(), parentId: this._id, kind: kind, description: description, partId: partId, quantity: quantity, unitPrice: unitPrice }));
    this._assertInvariants();
  }

  public complete(note: string): void {
    if (!(this._status === WorkOrderStatus.InProgress)) throw new DomainError("Precondition failed: status == InProgress");
    if (!(this._lines.length > 0)) throw new DomainError("Precondition failed: lines.count > 0");
    this._status = WorkOrderStatus.Completed;
    this._completedAt = new Date();
    this._resolutionNote = note;
    this._events.push({ type: "WorkOrderCompleted", workOrder: this._id, at: new Date() });
    this._assertInvariants();
  }

  public cancel(): void {
    if (!(this._status !== WorkOrderStatus.Completed && this._status !== WorkOrderStatus.Cancelled)) throw new DomainError("Precondition failed: status != Completed && status != Cancelled");
    this._status = WorkOrderStatus.Cancelled;
    this._assertInvariants();
  }

  checkNotifyCustomer(): void {
    if (!(this._status === WorkOrderStatus.Completed)) throw new DomainError("Precondition failed: status == Completed");
  }

  public notifyCustomer(): void {
    this.checkNotifyCustomer();
    this.notifyCustomerExtern();
    this._assertInvariants();
  }

  /** Extension point for `extern` operation `notifyCustomer` — hand-written
   *  domain logic.  Implement in the co-located `WorkOrder` subclass
   *  (`domain/workOrder.ts`): mutate this aggregate's fields and
   *  `_raiseEvent(...)` as needed; the framework re-asserts invariants after. */
  protected abstract notifyCustomerExtern(): void;

  public attachPhoto(file: { url: string; key: string; contentType: string; size: number }, caption: string): void {
    if (!(this._status !== WorkOrderStatus.Cancelled)) throw new DomainError("Precondition failed: status != Cancelled");
    this._photos.push(Photo._create({ id: Ids.newPhotoId(), parentId: this._id, file: file, caption: caption }));
    this._assertInvariants();
  }

  public update(customerId: Ids.CustomerId, siteId: Ids.SiteId, assetId: Ids.AssetId | null, technicianId: Ids.TechnicianId | null, technicianUserId: string | null, status: WorkOrderStatus, priority: Priority, currency: string, scheduledAt: Date | null, startedAt: Date | null, completedAt: Date | null, resolutionNote: string | null): void {
    this._customerId = customerId;
    this._siteId = siteId;
    this._assetId = assetId;
    this._technicianId = technicianId;
    this._technicianUserId = technicianUserId;
    this._status = status;
    this._priority = priority;
    this._currency = currency;
    this._scheduledAt = scheduledAt;
    this._startedAt = startedAt;
    this._completedAt = completedAt;
    this._resolutionNote = resolutionNote;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
    if (!((this._lines).every((l) => l.unitPrice.currency === this._currency))) throw new DomainError("Invariant violated: lines.all(l => l.unitPrice.currency == currency)");
  }

  static _create<T extends WorkOrderBase>(this: new (state: { id: Ids.WorkOrderId; customerId: Ids.CustomerId; siteId: Ids.SiteId; assetId: Ids.AssetId | null; technicianId: Ids.TechnicianId | null; technicianUserId: string | null; status: WorkOrderStatus; priority: Priority; currency: string; scheduledAt: Date | null; startedAt: Date | null; completedAt: Date | null; resolutionNote: string | null; tenantId: string; dataKey: string | null; version: number; lines: WorkOrderLine[]; photos: Photo[] }, trustStore?: boolean) => T, state: { id: Ids.WorkOrderId; customerId: Ids.CustomerId; siteId: Ids.SiteId; assetId: Ids.AssetId | null; technicianId: Ids.TechnicianId | null; technicianUserId: string | null; status: WorkOrderStatus; priority: Priority; currency: string; scheduledAt: Date | null; startedAt: Date | null; completedAt: Date | null; resolutionNote: string | null; tenantId: string; dataKey: string | null; version: number; lines?: WorkOrderLine[]; photos?: Photo[] }): T {
    return new this({ ...state, lines: state.lines ?? [], photos: state.photos ?? [] });
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate<T extends WorkOrderBase>(this: new (state: { id: Ids.WorkOrderId; customerId: Ids.CustomerId; siteId: Ids.SiteId; assetId: Ids.AssetId | null; technicianId: Ids.TechnicianId | null; technicianUserId: string | null; status: WorkOrderStatus; priority: Priority; currency: string; scheduledAt: Date | null; startedAt: Date | null; completedAt: Date | null; resolutionNote: string | null; tenantId: string; dataKey: string | null; version: number; lines: WorkOrderLine[]; photos: Photo[] }, trustStore?: boolean) => T, state: { id: Ids.WorkOrderId; customerId: Ids.CustomerId; siteId: Ids.SiteId; assetId: Ids.AssetId | null; technicianId: Ids.TechnicianId | null; technicianUserId: string | null; status: WorkOrderStatus; priority: Priority; currency: string; scheduledAt: Date | null; startedAt: Date | null; completedAt: Date | null; resolutionNote: string | null; tenantId: string; dataKey: string | null; version: number; lines: WorkOrderLine[]; photos: Photo[] }): T {
    return new this(state, true);
  }
  static create<T extends WorkOrderBase>(this: new (state: { id: Ids.WorkOrderId; customerId: Ids.CustomerId; siteId: Ids.SiteId; assetId: Ids.AssetId | null; technicianId: Ids.TechnicianId | null; technicianUserId: string | null; status: WorkOrderStatus; priority: Priority; currency: string; scheduledAt: Date | null; startedAt: Date | null; completedAt: Date | null; resolutionNote: string | null; tenantId: string; dataKey: string | null; version: number; lines: WorkOrderLine[]; photos: Photo[] }, trustStore?: boolean) => T, input: { customerId: Ids.CustomerId; siteId: Ids.SiteId; assetId?: Ids.AssetId | null; technicianId?: Ids.TechnicianId | null; technicianUserId?: string | null; status: WorkOrderStatus; priority: Priority; currency: string; scheduledAt?: Date | null; startedAt?: Date | null; completedAt?: Date | null; resolutionNote?: string | null }): T {
    return new this({
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
      tenantId: "",
      dataKey: null,
      version: 1,
      lines: [],
      photos: [],
    });
  }
}

