// Auto-generated.
import * as Ids from "./ids";
import type * as Events from "./events";

export class InterestRun {
  private _id: Ids.InterestRunId;
  private _events: Events.DomainEvent[] = [];
  private _startedAt: Date;
  private _version: number;
  private constructor(state: { id: Ids.InterestRunId; startedAt: Date; version: number }, trustStore = false) {
    this._id = state.id;
    this._startedAt = state.startedAt;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.InterestRunId { return this._id; }
  get startedAt(): Date { return this._startedAt; }
  get version(): number { return this._version; }
  get inspect(): string { return "InterestRun(" + "id: " + String(this._id) + ", " + "startedAt: " + this._startedAt.toISOString() + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
  }

  static _create(state: { id: Ids.InterestRunId; startedAt: Date; version: number }): InterestRun {
    return new InterestRun(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.InterestRunId; startedAt: Date; version: number }): InterestRun {
    return new InterestRun(state, true);
  }
  static create(input: { startedAt: Date }): InterestRun {
    return new InterestRun({
      id: Ids.newInterestRunId(),
      startedAt: input.startedAt,
      version: 1,
    });
  }
}

