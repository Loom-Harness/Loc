// Auto-generated.
import Decimal from "decimal.js";
import * as Ids from "./ids.ts";
import type * as Events from "./events.ts";
import { DomainError } from "./errors.ts";

export class Part {
  private _id: Ids.PartId;
  private _events: Events.DomainEvent[] = [];
  private _sku: string;
  private _binCode: string;
  private _onHand: number;
  private _unitPrice: Decimal;
  private _currency: string;
  private _tenantId: string;
  private _dataKey: string | null;
  private _version: number;
  private constructor(state: { id: Ids.PartId; sku: string; binCode: string; onHand: number; unitPrice: Decimal; currency: string; tenantId: string; dataKey: string | null; version: number }, trustStore = false) {
    this._id = state.id;
    this._sku = state.sku;
    this._binCode = state.binCode;
    this._onHand = state.onHand;
    this._unitPrice = state.unitPrice;
    this._currency = state.currency;
    this._tenantId = state.tenantId;
    this._dataKey = state.dataKey;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.PartId { return this._id; }
  get sku(): string { return this._sku; }
  get binCode(): string { return this._binCode; }
  get onHand(): number { return this._onHand; }
  get unitPrice(): Decimal { return this._unitPrice; }
  get currency(): string { return this._currency; }
  get tenantId(): string { return this._tenantId; }
  get dataKey(): string | null { return this._dataKey; }
  get version(): number { return this._version; }
  get display(): string { return this._sku; }
  get inspect(): string { return "Part(" + "id: " + String(this._id) + ", " + "sku: " + "'" + this._sku + "'" + ", " + "binCode: " + "'" + this._binCode + "'" + ", " + "onHand: " + String(this._onHand) + ", " + "unitPrice: " + this._unitPrice.toString() + ", " + "currency: " + "'" + this._currency + "'" + ", " + "tenantId: " + "'" + this._tenantId + "'" + ", " + "dataKey: " + "[string?]" + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public consume(qty: number): void {
    if (!(qty > 0)) throw new DomainError("Precondition failed: qty > 0");
    if (!(this._onHand >= qty)) throw new DomainError("Precondition failed: onHand >= qty");
    this._onHand = this._onHand - qty;
    this._assertInvariants();
  }

  public update(sku: string, binCode: string, onHand: number, unitPrice: Decimal, currency: string): void {
    this._sku = sku;
    this._binCode = binCode;
    this._onHand = onHand;
    this._unitPrice = unitPrice;
    this._currency = currency;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
    if (!(this._onHand >= 0)) throw new DomainError("Invariant violated: onHand >= 0");
  }

  static _create(state: { id: Ids.PartId; sku: string; binCode: string; onHand: number; unitPrice: Decimal; currency: string; tenantId: string; dataKey: string | null; version: number }): Part {
    return new Part(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.PartId; sku: string; binCode: string; onHand: number; unitPrice: Decimal; currency: string; tenantId: string; dataKey: string | null; version: number }): Part {
    return new Part(state, true);
  }
  static create(input: { sku: string; binCode: string; onHand: number; unitPrice: Decimal; currency: string }): Part {
    return new Part({
      id: Ids.newPartId(),
      sku: input.sku,
      binCode: input.binCode,
      onHand: input.onHand,
      unitPrice: input.unitPrice,
      currency: input.currency,
      tenantId: "",
      dataKey: null,
      version: 1,
    });
  }
}

//# sourceMappingURL=part.ts.map
