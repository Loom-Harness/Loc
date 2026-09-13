// Auto-generated.
import * as Ids from "./ids";
import type * as Events from "./events";

export class Task {
  private _id: Ids.TaskId;
  private _events: Events.DomainEvent[] = [];
  private _title: string;
  private _done: boolean;
  private _project: Ids.ProjectId;
  private _version: number;
  private constructor(state: { id: Ids.TaskId; title: string; done: boolean; project: Ids.ProjectId; version: number }, trustStore = false) {
    this._id = state.id;
    this._title = state.title;
    this._done = state.done;
    this._project = state.project;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.TaskId { return this._id; }
  get title(): string { return this._title; }
  get done(): boolean { return this._done; }
  get project(): Ids.ProjectId { return this._project; }
  get version(): number { return this._version; }
  get inspect(): string { return "Task(" + "id: " + String(this._id) + ", " + "title: " + "'" + this._title + "'" + ", " + "done: " + String(this._done) + ", " + "project: " + String(this._project) + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public update(title: string, done: boolean, project: Ids.ProjectId): void {
    this._title = title;
    this._done = done;
    this._project = project;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
  }

  static _create(state: { id: Ids.TaskId; title: string; done: boolean; project: Ids.ProjectId; version: number }): Task {
    return new Task(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.TaskId; title: string; done: boolean; project: Ids.ProjectId; version: number }): Task {
    return new Task(state, true);
  }
  static create(input: { title: string; done?: boolean; project: Ids.ProjectId }): Task {
    return new Task({
      id: Ids.newTaskId(),
      title: input.title,
      done: input.done ?? false,
      project: input.project,
      version: 1,
    });
  }
}

