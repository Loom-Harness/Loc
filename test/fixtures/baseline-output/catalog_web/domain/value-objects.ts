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
    if (!(this.amount >= 0)) throw new ValueObjectInvariantError("Money", "Amount cannot be negative", "Products.Money.rule.amountCannotBeNegative", { "amount": this.amount });
    if (!(/^[A-Z]{3}$/.test(this.currency))) throw new ValueObjectInvariantError("Money", "Currency must be three uppercase letters", "Products.Money.rule.currencyMustBeThreeUppercaseLetters", { "currency": this.currency });
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }

}

