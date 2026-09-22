// Auto-generated.
import * as Ids from "./ids.ts";
import type * as Events from "./events.ts";
import { DomainError } from "./errors.ts";

export class Organization {
  private _id: Ids.OrganizationId;
  private _events: Events.DomainEvent[] = [];
  private _name: string;
  private _version: number;
  private constructor(state: { id: Ids.OrganizationId; name: string; version: number }, trustStore = false) {
    this._id = state.id;
    this._name = state.name;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.OrganizationId { return this._id; }
  get name(): string { return this._name; }
  get version(): number { return this._version; }
  get display(): string { return this._name; }
  get inspect(): string { return "Organization(" + "id: " + String(this._id) + ", " + "name: " + "'" + this._name + "'" + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public update(name: string): void {
    this._name = name;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
    if (!([...this._name].length > 0)) throw new DomainError("Invariant violated: name.length > 0");
  }

  static _create(state: { id: Ids.OrganizationId; name: string; version: number }): Organization {
    return new Organization(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.OrganizationId; name: string; version: number }): Organization {
    return new Organization(state, true);
  }
  static create(input: { name: string }): Organization {
    return new Organization({
      id: Ids.newOrganizationId(),
      name: input.name,
      version: 1,
    });
  }
}

//# sourceMappingURL=organization.ts.map
