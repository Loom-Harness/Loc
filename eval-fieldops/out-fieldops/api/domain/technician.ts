// Auto-generated.
import Decimal from "decimal.js";
import * as Ids from "./ids.ts";
import type { Skill } from "./value-objects.ts";
import type * as Events from "./events.ts";

export class Technician {
  private _id: Ids.TechnicianId;
  private _events: Events.DomainEvent[] = [];
  private _userId: string;
  private _fullName: string;
  private _skills: Skill[];
  private _costRate: Decimal;
  private _tenantId: string;
  private _dataKey: string | null;
  private _version: number;
  private constructor(state: { id: Ids.TechnicianId; userId: string; fullName: string; skills: Skill[]; costRate: Decimal; tenantId: string; dataKey: string | null; version: number }, trustStore = false) {
    this._id = state.id;
    this._userId = state.userId;
    this._fullName = state.fullName;
    this._skills = state.skills;
    this._costRate = state.costRate;
    this._tenantId = state.tenantId;
    this._dataKey = state.dataKey;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.TechnicianId { return this._id; }
  get userId(): string { return this._userId; }
  get fullName(): string { return this._fullName; }
  get skills(): Skill[] { return this._skills; }
  get costRate(): Decimal { return this._costRate; }
  get tenantId(): string { return this._tenantId; }
  get dataKey(): string | null { return this._dataKey; }
  get version(): number { return this._version; }
  get display(): string { return this._fullName; }
  get inspect(): string { return "Technician(" + "id: " + String(this._id) + ", " + "userId: " + String(this._userId) + ", " + "fullName: " + "'" + this._fullName + "'" + ", " + "skills: " + "[Skill[]]" + ", " + "costRate: " + this._costRate.toString() + ", " + "tenantId: " + "'" + this._tenantId + "'" + ", " + "dataKey: " + "[string?]" + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  private hasSkill(s: Skill): boolean { return (this._skills).includes(s); }
  public update(userId: string, fullName: string, skills: Skill[], costRate: Decimal): void {
    this._userId = userId;
    this._fullName = fullName;
    this._skills = skills;
    this._costRate = costRate;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
  }

  static _create(state: { id: Ids.TechnicianId; userId: string; fullName: string; skills: Skill[]; costRate: Decimal; tenantId: string; dataKey: string | null; version: number }): Technician {
    return new Technician(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.TechnicianId; userId: string; fullName: string; skills: Skill[]; costRate: Decimal; tenantId: string; dataKey: string | null; version: number }): Technician {
    return new Technician(state, true);
  }
  static create(input: { userId: string; fullName: string; skills: Skill[]; costRate: Decimal }): Technician {
    return new Technician({
      id: Ids.newTechnicianId(),
      userId: input.userId,
      fullName: input.fullName,
      skills: input.skills,
      costRate: input.costRate,
      tenantId: "",
      dataKey: null,
      version: 1,
    });
  }
}

//# sourceMappingURL=technician.ts.map
