// Auto-generated.
import * as Ids from "./ids";
import { Status } from "./value-objects";
import type * as Events from "./events";

export class Task {
  private _id: Ids.TaskId;
  private _events: Events.DomainEvent[] = [];
  private _title: string;
  private _status: Status;
  private _version: number;
  private constructor(state: { id: Ids.TaskId; title: string; status: Status; version: number }, trustStore = false) {
    this._id = state.id;
    this._title = state.title;
    this._status = state.status;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.TaskId { return this._id; }
  get title(): string { return this._title; }
  get status(): Status { return this._status; }
  get version(): number { return this._version; }
  get inspect(): string { return "Task(" + "id: " + String(this._id) + ", " + "title: " + "'" + this._title + "'" + ", " + "status: " + String(this._status) + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public complete(): void {
    this._status = Status.Done;
    this._assertInvariants();
  }

  public update(title: string, status: Status): void {
    this._title = title;
    this._status = status;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
  }

  static _create(state: { id: Ids.TaskId; title: string; status: Status; version: number }): Task {
    return new Task(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.TaskId; title: string; status: Status; version: number }): Task {
    return new Task(state, true);
  }
  static create(input: { title: string; status: Status }): Task {
    return new Task({
      id: Ids.newTaskId(),
      title: input.title,
      status: input.status,
      version: 1,
    });
  }
}

