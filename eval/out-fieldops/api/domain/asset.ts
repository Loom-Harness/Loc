// Auto-generated.
import * as Ids from "./ids";
import type * as Events from "./events";

export class Asset {
  private _id: Ids.AssetId;
  private _events: Events.DomainEvent[] = [];
  private _siteId: Ids.SiteId;
  private _requiredSkill: string;
  private _serialNumber: string;
  private _model: string;
  private _warrantyExpiry: Date;
  private _tenantId: string;
  private _dataKey: string | null;
  private _version: number;
  private constructor(state: { id: Ids.AssetId; siteId: Ids.SiteId; requiredSkill: string; serialNumber: string; model: string; warrantyExpiry: Date; tenantId: string; dataKey: string | null; version: number }, trustStore = false) {
    this._id = state.id;
    this._siteId = state.siteId;
    this._requiredSkill = state.requiredSkill;
    this._serialNumber = state.serialNumber;
    this._model = state.model;
    this._warrantyExpiry = state.warrantyExpiry;
    this._tenantId = state.tenantId;
    this._dataKey = state.dataKey;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.AssetId { return this._id; }
  get siteId(): Ids.SiteId { return this._siteId; }
  get requiredSkill(): string { return this._requiredSkill; }
  get serialNumber(): string { return this._serialNumber; }
  get model(): string { return this._model; }
  get warrantyExpiry(): Date { return this._warrantyExpiry; }
  get tenantId(): string { return this._tenantId; }
  get dataKey(): string | null { return this._dataKey; }
  get version(): number { return this._version; }
  get display(): string { return this._serialNumber; }
  get inspect(): string { return "Asset(" + "id: " + String(this._id) + ", " + "siteId: " + String(this._siteId) + ", " + "requiredSkill: " + "'" + this._requiredSkill + "'" + ", " + "serialNumber: " + "'" + this._serialNumber + "'" + ", " + "model: " + "'" + this._model + "'" + ", " + "warrantyExpiry: " + String(this._warrantyExpiry) + ", " + "tenantId: " + "'" + this._tenantId + "'" + ", " + "dataKey: " + "[string?]" + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public update(siteId: Ids.SiteId, requiredSkill: string, serialNumber: string, model: string, warrantyExpiry: Date): void {
    this._siteId = siteId;
    this._requiredSkill = requiredSkill;
    this._serialNumber = serialNumber;
    this._model = model;
    this._warrantyExpiry = warrantyExpiry;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
  }

  static _create(state: { id: Ids.AssetId; siteId: Ids.SiteId; requiredSkill: string; serialNumber: string; model: string; warrantyExpiry: Date; tenantId: string; dataKey: string | null; version: number }): Asset {
    return new Asset(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.AssetId; siteId: Ids.SiteId; requiredSkill: string; serialNumber: string; model: string; warrantyExpiry: Date; tenantId: string; dataKey: string | null; version: number }): Asset {
    return new Asset(state, true);
  }
  static create(input: { siteId: Ids.SiteId; requiredSkill: string; serialNumber: string; model: string; warrantyExpiry: Date }): Asset {
    return new Asset({
      id: Ids.newAssetId(),
      siteId: input.siteId,
      requiredSkill: input.requiredSkill,
      serialNumber: input.serialNumber,
      model: input.model,
      warrantyExpiry: input.warrantyExpiry,
      tenantId: "",
      dataKey: null,
      version: 1,
    });
  }
}

