// Auto-generated.  Do not edit by hand.
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { Account } from "./account";
import { AccountStatus, AccountType } from "./value-objects";
import * as Ids from "./ids";

describe("Account", () => {
  it("deposit increases balance", () => {
    const a = Account.create({ number: "1234567890", owner: Ids.CustomerId("c1"), accountType: AccountType.Checking, currency: "EUR", interestRate: 0.0, status: AccountStatus.Active, balance: new Decimal("10"), dailyLimit: new Decimal("1000"), withdrawnToday: new Decimal("0"), limitDay: new Date(), openedAt: new Date() });
    expect(a.balance.gt(new Decimal("5"))).toBe(true);
  });

});
