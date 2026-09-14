// Auto-generated.
import * as Ids from "./ids.ts";
import type * as Events from "./events.ts";
import { DomainError } from "./errors.ts";

export class Customer {
  private _id: Ids.CustomerId;
  private _events: Events.DomainEvent[] = [];
  private _name: string;
  private _contactEmail: string;
  private _tenantId: string;
  private _dataKey: string | null;
  private _createdAt: Date;
  private _updatedAt: Date;
  private _createdBy: string;
  private _updatedBy: string;
  private _version: number;
  private constructor(state: { id: Ids.CustomerId; name: string; contactEmail: string; tenantId: string; dataKey: string | null; createdAt: Date; updatedAt: Date; createdBy: string; updatedBy: string; version: number }, trustStore = false) {
    this._id = state.id;
    this._name = state.name;
    this._contactEmail = state.contactEmail;
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

  get id(): Ids.CustomerId { return this._id; }
  get name(): string { return this._name; }
  get contactEmail(): string { return this._contactEmail; }
  get tenantId(): string { return this._tenantId; }
  get dataKey(): string | null { return this._dataKey; }
  get createdAt(): Date { return this._createdAt; }
  get updatedAt(): Date { return this._updatedAt; }
  get createdBy(): string { return this._createdBy; }
  get updatedBy(): string { return this._updatedBy; }
  get version(): number { return this._version; }
  get display(): string { return this._name; }
  get inspect(): string { return "Customer(" + "id: " + String(this._id) + ", " + "name: " + "'" + this._name + "'" + ", " + "contactEmail: " + "<redacted>" + ", " + "tenantId: " + "'" + this._tenantId + "'" + ", " + "dataKey: " + "[string?]" + ", " + "createdAt: " + String(this._createdAt) + ", " + "updatedAt: " + String(this._updatedAt) + ", " + "createdBy: " + String(this._createdBy) + ", " + "updatedBy: " + String(this._updatedBy) + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public update(name: string, contactEmail: string): void {
    this._name = name;
    this._contactEmail = contactEmail;
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

  static _create(state: { id: Ids.CustomerId; name: string; contactEmail: string; tenantId: string; dataKey: string | null; createdAt: Date; updatedAt: Date; createdBy: string; updatedBy: string; version: number }): Customer {
    return new Customer(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.CustomerId; name: string; contactEmail: string; tenantId: string; dataKey: string | null; createdAt: Date; updatedAt: Date; createdBy: string; updatedBy: string; version: number }): Customer {
    return new Customer(state, true);
  }
  static create(input: { name: string; contactEmail: string }): Customer {
    return new Customer({
      id: Ids.newCustomerId(),
      name: input.name,
      contactEmail: input.contactEmail,
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

//# sourceMappingURL=customer.ts.map
