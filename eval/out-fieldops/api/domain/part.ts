// Auto-generated.
import * as Ids from "./ids";
import type * as Events from "./events";
import { DomainError } from "./errors";

export class Part {
  private _id: Ids.PartId;
  private _events: Events.DomainEvent[] = [];
  private _sku: string;
  private _name: string;
  private _stockLevel: number;
  private _tenantId: string;
  private _dataKey: string | null;
  private _version: number;
  private constructor(state: { id: Ids.PartId; sku: string; name: string; stockLevel: number; tenantId: string; dataKey: string | null; version: number }, trustStore = false) {
    this._id = state.id;
    this._sku = state.sku;
    this._name = state.name;
    this._stockLevel = state.stockLevel;
    this._tenantId = state.tenantId;
    this._dataKey = state.dataKey;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.PartId { return this._id; }
  get sku(): string { return this._sku; }
  get name(): string { return this._name; }
  get stockLevel(): number { return this._stockLevel; }
  get tenantId(): string { return this._tenantId; }
  get dataKey(): string | null { return this._dataKey; }
  get version(): number { return this._version; }
  get display(): string { return this._sku; }
  get inspect(): string { return "Part(" + "id: " + String(this._id) + ", " + "sku: " + "'" + this._sku + "'" + ", " + "name: " + "'" + this._name + "'" + ", " + "stockLevel: " + String(this._stockLevel) + ", " + "tenantId: " + "'" + this._tenantId + "'" + ", " + "dataKey: " + "[string?]" + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public decrement(qty: number): void {
    if (!(qty > 0)) throw new DomainError("Precondition failed: qty > 0");
    if (!(this._stockLevel >= qty)) throw new DomainError("Precondition failed: stockLevel >= qty");
    this._stockLevel = this._stockLevel - qty;
    this._assertInvariants();
  }

  public update(sku: string, name: string, stockLevel: number): void {
    this._sku = sku;
    this._name = name;
    this._stockLevel = stockLevel;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
    if (!(this._stockLevel >= 0)) throw new DomainError("Invariant violated: stockLevel >= 0");
  }

  static _create(state: { id: Ids.PartId; sku: string; name: string; stockLevel: number; tenantId: string; dataKey: string | null; version: number }): Part {
    return new Part(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.PartId; sku: string; name: string; stockLevel: number; tenantId: string; dataKey: string | null; version: number }): Part {
    return new Part(state, true);
  }
  static create(input: { sku: string; name: string; stockLevel: number }): Part {
    return new Part({
      id: Ids.newPartId(),
      sku: input.sku,
      name: input.name,
      stockLevel: input.stockLevel,
      tenantId: "",
      dataKey: null,
      version: 1,
    });
  }
}

