// Auto-generated.
import * as Ids from "./ids.ts";
import type * as Events from "./events.ts";

export class Site {
  private _id: Ids.SiteId;
  private _events: Events.DomainEvent[] = [];
  private _customerId: Ids.CustomerId;
  private _label: string;
  private _addressLine: string;
  private _tenantId: string;
  private _dataKey: string | null;
  private _version: number;
  private constructor(state: { id: Ids.SiteId; customerId: Ids.CustomerId; label: string; addressLine: string; tenantId: string; dataKey: string | null; version: number }, trustStore = false) {
    this._id = state.id;
    this._customerId = state.customerId;
    this._label = state.label;
    this._addressLine = state.addressLine;
    this._tenantId = state.tenantId;
    this._dataKey = state.dataKey;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.SiteId { return this._id; }
  get customerId(): Ids.CustomerId { return this._customerId; }
  get label(): string { return this._label; }
  get addressLine(): string { return this._addressLine; }
  get tenantId(): string { return this._tenantId; }
  get dataKey(): string | null { return this._dataKey; }
  get version(): number { return this._version; }
  get display(): string { return this._label; }
  get inspect(): string { return "Site(" + "id: " + String(this._id) + ", " + "customerId: " + String(this._customerId) + ", " + "label: " + "'" + this._label + "'" + ", " + "addressLine: " + "<redacted>" + ", " + "tenantId: " + "'" + this._tenantId + "'" + ", " + "dataKey: " + "[string?]" + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public update(customerId: Ids.CustomerId, label: string, addressLine: string): void {
    this._customerId = customerId;
    this._label = label;
    this._addressLine = addressLine;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
  }

  static _create(state: { id: Ids.SiteId; customerId: Ids.CustomerId; label: string; addressLine: string; tenantId: string; dataKey: string | null; version: number }): Site {
    return new Site(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.SiteId; customerId: Ids.CustomerId; label: string; addressLine: string; tenantId: string; dataKey: string | null; version: number }): Site {
    return new Site(state, true);
  }
  static create(input: { customerId: Ids.CustomerId; label: string; addressLine: string }): Site {
    return new Site({
      id: Ids.newSiteId(),
      customerId: input.customerId,
      label: input.label,
      addressLine: input.addressLine,
      tenantId: "",
      dataKey: null,
      version: 1,
    });
  }
}

//# sourceMappingURL=site.ts.map
