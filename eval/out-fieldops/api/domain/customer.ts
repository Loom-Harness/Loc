// Auto-generated.
import * as Ids from "./ids";
import type * as Events from "./events";
import { DomainError } from "./errors";

export class Customer {
  private _id: Ids.CustomerId;
  private _events: Events.DomainEvent[] = [];
  private _name: string;
  private _tenantId: string;
  private _dataKey: string | null;
  private _version: number;
  private constructor(state: { id: Ids.CustomerId; name: string; tenantId: string; dataKey: string | null; version: number }, trustStore = false) {
    this._id = state.id;
    this._name = state.name;
    this._tenantId = state.tenantId;
    this._dataKey = state.dataKey;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.CustomerId { return this._id; }
  get name(): string { return this._name; }
  get tenantId(): string { return this._tenantId; }
  get dataKey(): string | null { return this._dataKey; }
  get version(): number { return this._version; }
  get display(): string { return this._name; }
  get inspect(): string { return "Customer(" + "id: " + String(this._id) + ", " + "name: " + "'" + this._name + "'" + ", " + "tenantId: " + "'" + this._tenantId + "'" + ", " + "dataKey: " + "[string?]" + ", " + "version: " + String(this._version) + ")"; }
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

  static _create(state: { id: Ids.CustomerId; name: string; tenantId: string; dataKey: string | null; version: number }): Customer {
    return new Customer(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.CustomerId; name: string; tenantId: string; dataKey: string | null; version: number }): Customer {
    return new Customer(state, true);
  }
  static create(input: { name: string }): Customer {
    return new Customer({
      id: Ids.newCustomerId(),
      name: input.name,
      tenantId: "",
      dataKey: null,
      version: 1,
    });
  }
}

