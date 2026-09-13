// Auto-generated.
import * as Ids from "./ids";
import type * as Events from "./events";

export class NotificationLog {
  private _id: Ids.NotificationLogId;
  private _events: Events.DomainEvent[] = [];
  private _workOrderId: Ids.WorkOrderId;
  private _sentAt: Date;
  private _version: number;
  private constructor(state: { id: Ids.NotificationLogId; workOrderId: Ids.WorkOrderId; sentAt: Date; version: number }, trustStore = false) {
    this._id = state.id;
    this._workOrderId = state.workOrderId;
    this._sentAt = state.sentAt;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.NotificationLogId { return this._id; }
  get workOrderId(): Ids.WorkOrderId { return this._workOrderId; }
  get sentAt(): Date { return this._sentAt; }
  get version(): number { return this._version; }
  get inspect(): string { return "NotificationLog(" + "id: " + String(this._id) + ", " + "workOrderId: " + String(this._workOrderId) + ", " + "sentAt: " + String(this._sentAt) + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public update(workOrderId: Ids.WorkOrderId, sentAt: Date): void {
    this._workOrderId = workOrderId;
    this._sentAt = sentAt;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
  }

  static _create(state: { id: Ids.NotificationLogId; workOrderId: Ids.WorkOrderId; sentAt: Date; version: number }): NotificationLog {
    return new NotificationLog(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.NotificationLogId; workOrderId: Ids.WorkOrderId; sentAt: Date; version: number }): NotificationLog {
    return new NotificationLog(state, true);
  }
  static create(input: { workOrderId: Ids.WorkOrderId; sentAt: Date }): NotificationLog {
    return new NotificationLog({
      id: Ids.newNotificationLogId(),
      workOrderId: input.workOrderId,
      sentAt: input.sentAt,
      version: 1,
    });
  }
}

