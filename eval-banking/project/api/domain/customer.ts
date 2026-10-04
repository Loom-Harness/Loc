// Auto-generated.
import * as Ids from "./ids";
import type * as Events from "./events";
import { DomainError } from "./errors";

export class Customer {
  private _id: Ids.CustomerId;
  private _events: Events.DomainEvent[] = [];
  private _firstName: string;
  private _lastName: string;
  private _email: string;
  private _version: number;
  private constructor(state: { id: Ids.CustomerId; firstName: string; lastName: string; email: string; version: number }, trustStore = false) {
    this._id = state.id;
    this._firstName = state.firstName;
    this._lastName = state.lastName;
    this._email = state.email;
    this._version = state.version;
    if (!trustStore) {
      this._assertInvariants();
    }
  }

  get id(): Ids.CustomerId { return this._id; }
  get firstName(): string { return this._firstName; }
  get lastName(): string { return this._lastName; }
  get email(): string { return this._email; }
  get version(): number { return this._version; }
  get display(): string { return "${firstName} ${lastName}"; }
  get inspect(): string { return "Customer(" + "id: " + String(this._id) + ", " + "firstName: " + "'" + this._firstName + "'" + ", " + "lastName: " + "'" + this._lastName + "'" + ", " + "email: " + "'" + this._email + "'" + ", " + "version: " + String(this._version) + ")"; }
  toString(): string { return this.inspect; }
  [Symbol.for("nodejs.util.inspect.custom")](): string { return this.inspect; }
  public changeEmail(newEmail: string): void {
    if (!(newEmail.includes("@"))) throw new DomainError("Precondition failed: newEmail.contains(\"@\")");
    this._email = newEmail;
    this._assertInvariants();
  }

  pullEvents(): Events.DomainEvent[] {
    const out = this._events;
    this._events = [];
    return out;
  }

  private _assertInvariants(): void {
    if (!(this._email.includes("@"))) throw new DomainError("Invariant violated: email.contains(\"@\")");
  }

  static _create(state: { id: Ids.CustomerId; firstName: string; lastName: string; email: string; version: number }): Customer {
    return new Customer(state);
  }

  /** Reconstitution from the store — trusts persisted state, so no
   *  invariant run: invariants guard transitions (create + operations),
   *  not loads.  Repository hydration only; domain code constructs via
   *  `create`/`_create`, which assert. */
  static _rehydrate(state: { id: Ids.CustomerId; firstName: string; lastName: string; email: string; version: number }): Customer {
    return new Customer(state, true);
  }
  static create(input: { firstName: string; lastName: string; email: string }): Customer {
    return new Customer({
      id: Ids.newCustomerId(),
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      version: 1,
    });
  }
}

