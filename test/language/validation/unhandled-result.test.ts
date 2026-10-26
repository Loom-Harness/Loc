// `loom.unhandled-result`: an `A or E` result whose `E` is an `error` must be
// matched, returned, or bound and read.

import { describe, expect, it } from "vitest";
import { lspCodes } from "../../_helpers/diagnostics.js";
import { parseString } from "../../_helpers/parse.js";

const ctx = (members: string, extra = "") => `
context C {
  error InsufficientCredit { available: money }
  payload Receipt { amount: money }
  aggregate Account with crudish {
    balance: money
    operation withdraw(amt: money): Account or InsufficientCredit {
      if amt > balance { return InsufficientCredit { available: balance } }
      balance := balance - amt
      return this
    }
    operation receipt(amt: money): Account or Receipt { return this }
    ${members}
  }
  repository Accounts for Account { }
  ${extra}
}`;

async function codes(members: string, extra = ""): Promise<string[]> {
  const { diagnostics } = await parseString(ctx(members, extra), { validate: true });
  return lspCodes(diagnostics);
}

const CODE = "loom.unhandled-result";

describe("loom.unhandled-result", () => {
  it.each([
    ["a call statement in an operation", "operation drain(amt: money) { withdraw(amt) }"],
    ["a `this.` call statement", "operation drain(amt: money) { this.withdraw(amt) }"],
    ["an unread `let`", "operation drop(amt: money) { let r = withdraw(amt) }"],
  ])("refuses %s", async (_what, op) => {
    expect(await codes(op)).toEqual([CODE]);
  });

  it("refuses a call statement in a workflow body", async () => {
    const wf = `workflow Pay { create(id: Account id, amt: money) {
      let a = Accounts.getById(id)
      a.withdraw(amt)
    } }`;
    expect(await codes("", wf)).toEqual([CODE]);
  });

  it.each([
    [
      "a returned result",
      "operation pass(amt: money): Account or InsufficientCredit { return withdraw(amt) }",
    ],
    [
      "a `let` that is read",
      "operation keep(amt: money): Account or InsufficientCredit { let r = withdraw(amt)  return r }",
    ],
    ["a union with no `error` variant", "operation note(amt: money) { receipt(amt) }"],
  ])("admits %s", async (_what, op) => {
    expect(await codes(op)).toEqual([]);
  });
});
