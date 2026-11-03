// Auto-generated.
import { ValueObjectInvariantError } from "./errors";

export class Money {
  readonly amount: number;
  readonly currency: string;
  constructor(
    amount: number,
    currency: string
  ) {
    this.amount = amount;
    this.currency = currency;
    if (!(this.amount >= 0)) throw new ValueObjectInvariantError("Money", "Invalid value");
    if (!([...this.currency].length === 3)) throw new ValueObjectInvariantError("Money", "Invalid value");
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }

}

