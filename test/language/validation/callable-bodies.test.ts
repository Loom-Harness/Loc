// Every callable with a declared result type has its `return`s checked and
// must return on every path; domain-service operations and handlers get the
// same expression checks as an aggregate operation's body.

import { describe, expect, it } from "vitest";
import { lspCodes } from "../../_helpers/diagnostics.js";
import { parseString } from "../../_helpers/parse.js";

const sys = (members: string, contextMembers = "") => `
system Demo {
  subdomain S {
    context C {
      valueobject Amount { value: int }
      error Declined { reason: string }
      command Bump { n: int }
      response Snap { n: int }
      aggregate Account with crudish {
        balance: int
        ${members}
      }
      repository Accounts for Account { }
      ${contextMembers}
    }
  }
}`;

async function codes(members: string, contextMembers = ""): Promise<string[]> {
  const { diagnostics } = await parseString(sys(members, contextMembers), { validate: true });
  return lspCodes(diagnostics);
}

const MISMATCH = "loom.return-type-mismatch";
const MISSING = "loom.return-missing";
const NOT_LAST = "loom.handler-return-not-last";

describe("callable returns", () => {
  it("checks an operation's returns against its declared type", async () => {
    expect(await codes('operation q(): int { return "s" }')).toContain(MISMATCH);
    expect(await codes("operation q(): int { return balance }")).not.toContain(MISMATCH);
  });

  it("checks returns nested in branches", async () => {
    const op = 'operation q(b: bool): int { if b { return "s" } else { return 1 } }';
    expect(await codes(op)).toContain(MISMATCH);
  });

  it("admits each variant of a declared union, and a narrower union", async () => {
    const ops = `
      operation w(n: int): Account or Declined {
        if n > balance { return Declined { reason: "no" } }
        return this
      }
      operation w2(n: int): Account or Declined { return w(n) }`;
    const c = await codes(ops);
    expect(c).not.toContain(MISMATCH);
    expect(c).not.toContain(MISSING);
  });

  it("refuses a body that does not return on every path", async () => {
    expect(await codes("operation q(b: bool): int { if b { return 1 } }")).toContain(MISSING);
    expect(
      await codes("operation q(b: bool): int { if b { return 1 } else { return 2 } }"),
    ).not.toContain(MISSING);
    expect(await codes("operation q(): int { balance := 1 }")).toContain(MISSING);
  });

  it("checks domain-service operations and handlers too", async () => {
    const c = await codes(
      "",
      `domainService Calc { operation f(x: int): int { return "s" } }
       queryHandler q(): int { return "s" }`,
    );
    expect(c.filter((x) => x === MISMATCH)).toHaveLength(2);
  });

  it("counts a handler's trailing `if let … { return x } else { notFound }` as returning", async () => {
    const guard = `
       criterion Rich(n: int) of Account = this.balance > n
       queryHandler q(n: int): Account {
         if let a = Accounts.find(Rich(n)) {
           return a
         } else {
           notFound
         }
       }`;
    const c = await codes("", guard);
    expect(c).not.toContain(MISSING);
    expect(c).not.toContain(NOT_LAST);
    // Without the `notFound` the else falls through: a missing return.
    expect(await codes("", guard.replace("notFound", ""))).toContain(MISSING);
  });

  it("refuses a handler `return` anywhere but last or in the trailing guard", async () => {
    expect(
      await codes("", "queryHandler q(b: bool): int { if b { return 1 } else { return 2 } }"),
    ).toContain(NOT_LAST);
    expect(await codes("", "queryHandler q(): int { return 1 }")).not.toContain(NOT_LAST);
    // A guard whose then-branch holds more than the return is not the guard.
    const busy = `
       criterion Rich(n: int) of Account = this.balance > n
       queryHandler q(n: int): Account {
         if let a = Accounts.find(Rich(n)) {
           let m = n
           return a
         } else {
           notFound
         }
       }`;
    expect(await codes("", busy)).toContain(NOT_LAST);
  });

  it("lets an operation whose result includes its aggregate fall through to `this`", async () => {
    const c = await codes(`operation adj(n: int): Account or Declined { balance := balance + n }`);
    expect(c).not.toContain(MISSING);
    expect(await codes("operation q(): int { balance := 1 }")).toContain(MISSING);
  });

  it("accepts a read handler returning the aggregate as its `<Agg>Response` record", async () => {
    const c = await codes(
      "",
      `response AccountResponse { balance: int }
       queryHandler get(accountId: Account id): AccountResponse {
         let a = Accounts.getById(accountId)
         return a
       }
       queryHandler all(): AccountResponse[] { let r = Accounts.findAll()  return r }`,
    );
    expect(c).not.toContain(MISMATCH);
    // The model must reach validation for that to mean anything.
    const wrong = await codes(
      "",
      `queryHandler get(accountId: Account id): Snap {
         let a = Accounts.getById(accountId)
         return a
       }`,
    );
    expect(wrong).toContain(MISMATCH);
  });

  it("leaves an operation without a declared result alone", async () => {
    expect(await codes("operation q() { balance := 1 }")).not.toContain(MISSING);
  });
});

describe("expression checks in domain-service and handler bodies", () => {
  it("checks record-construction field types in a handler", async () => {
    const c = await codes(
      "",
      `commandHandler bump(c: Bump) { let a = Amount { value: "x" } }
       queryHandler peek(): Snap { return Snap { n: "x" } }`,
    );
    expect(c.filter((x) => x === "loom.construction-field-type")).toHaveLength(2);
  });

  it("checks record-construction field types in a domain-service operation", async () => {
    const c = await codes(
      "",
      `domainService Calc { operation f(x: int): int { let a = Amount { value: "x" } return x } }`,
    );
    expect(c).toContain("loom.construction-field-type");
  });
});
