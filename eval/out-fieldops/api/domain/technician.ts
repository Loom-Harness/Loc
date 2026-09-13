// Auto-generated.
import * as Ids from "./ids";
import type * as Events from "./events";

export class Technician {
  private _id: Ids.TechnicianId;
  private _events: Events.DomainEvent[] = [];
  private _userId: string;
  private _name: string;
  private _skills: string[];
  private _costRatePerHour: number;
  private _tenantId: string;
  private _dataKey: string | null;
  private _version: number;
  private constructor(state: { id: Ids.TechnicianId; userId: string; name: string; skills: string[]; costRatePerHour: number; tenantId: string; dataKey: string | null; version: number }, trustStore = false) {
    this._id = state.id;
    this._userId = state.userId;
    this._name = state.name;
    this._skills = state.skills;
    this._costRatePerHour = state.costRatePerHour;
    this._tenantId = state.tenantId;
    this._dataKey = state.dataKey;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.TechnicianId { return this._id; }
  get userId(): string { return this._userId; }
  get name(): string { return this._name; }
  get skills(): string[] { return this._skills; }
  get costRatePerHour(): number { return this._costRatePerHour; }
  get tenantId(): string { return this._tenantId; }
  get dataKey(): string | null { return this._dataKey; }
  get version(): number { return this._version; }
  get display(): string { return this._name; }
  get inspect(): string { return "Technician(" + "id: " + String(this._id) + ", " + "userId: " + "'" + this._userId + "'" + ", " + "name: " + "'" + this._name + "'" + ", " + "skills: " + "[string[]]" + ", " + "costRatePerHour: " + String(this._costRatePerHour) + ", " + "tenantId: " + "'" + this._tenantId + "'" + ", " + "dataKey: " + "[string?]" + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public update(userId: string, name: string, skills: string[], costRatePerHour: number): void {
    this._userId = userId;
    this._name = name;
    this._skills = skills;
    this._costRatePerHour = costRatePerHour;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
  }

  static _create(state: { id: Ids.TechnicianId; userId: string; name: string; skills: string[]; costRatePerHour: number; tenantId: string; dataKey: string | null; version: number }): Technician {
    return new Technician(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.TechnicianId; userId: string; name: string; skills: string[]; costRatePerHour: number; tenantId: string; dataKey: string | null; version: number }): Technician {
    return new Technician(state, true);
  }
  static create(input: { userId: string; name: string; skills: string[]; costRatePerHour: number }): Technician {
    return new Technician({
      id: Ids.newTechnicianId(),
      userId: input.userId,
      name: input.name,
      skills: input.skills,
      costRatePerHour: input.costRatePerHour,
      tenantId: "",
      dataKey: null,
      version: 1,
    });
  }
}

