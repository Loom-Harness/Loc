// An expected-failure result (`T or E`) on a routed command entry point — a
// workflow `create`, a `commandHandler`, a `queryHandler`.
//
// The body answers from the arms of its terminal statement `match`: lowering
// keeps the statement `match` (arms keep their statements) and answers a value
// `match` over the same subject whose arms are the arms' returned values,
// each tagged with the declared variant it produces (`returnTags`).

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import { entryResult } from "../../src/ir/util/entry-result.js";
import { commandCreateEntryResult } from "../../src/ir/util/workflow-command-route.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const SYS = (members: string, platform = "node") => `
  system Bank {
    subdomain D {
      context Ledger {
        error Insufficient { needed: int }
        error Declined { available: int }
        payload Receipt { left: int }
        valueobject Amount { value: int }
        aggregate Account with crudish {
          balance: int
          operation withdraw(amt: int): int or Insufficient {
            balance := balance - amt
            return balance
          }
        }
        repository Accounts for Account
        ${members}
      }
    }
    storage pg { type: postgres }
    resource st { for: Ledger, kind: state, use: pg }
    deployable d { platform: ${platform}, contexts: [Ledger], dataSources: [st], port: 4000 }
  }
`;

async function enriched(src: string) {
  const { model } = await parseString(src, { validate: false });
  return allContexts(enrichLoomModel(lowerModel(model)))[0]!;
}

async function errorCodes(src: string): Promise<string[]> {
  const { model, diagnostics } = await parseString(src, { validate: true });
  const ast = diagnostics
    .filter((d) => d.severity === 1)
    .map((d) => String(d.code ?? (d.data as { code?: string } | undefined)?.code ?? ""));
  const ir = validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "");
  return [...ast, ...ir];
}

const PAY = (ret: string, arms: string, before = "") => `
  workflow Pay {
    create(account: Account id, amt: int): ${ret} {
      let a = Accounts.get(account)
      ${before}
      let r = a.withdraw(amt)
      match r { ${arms} }
    }
  }`;

const OK_ARMS = `int left => { return Receipt { left: left } }
  Insufficient e => { return Declined { available: e.needed } }`;

describe("expected-failure result — lowering", () => {
  it("desugars a terminal match whose arms return into the statement match plus a value match", async () => {
    const ctx = await enriched(SYS(PAY("Receipt or Declined", OK_ARMS)));
    const c = ctx.workflows[0]!.creates[0]!;
    const stmt = c.statements.at(-1)!;
    expect(stmt.kind).toBe("variant-match");
    // The arms' returns are not statements of the arms.
    if (stmt.kind === "variant-match") {
      for (const arm of stmt.arms) expect(arm.body.map((s) => s.kind)).not.toContain("expr-let");
    }
    expect(c.returnValue).toMatchObject({
      kind: "match",
      subject: { kind: "ref", name: "r" },
      variantArms: [
        { binding: "left", value: { kind: "object" }, isError: false },
        { binding: "e", value: { kind: "object" }, isError: true },
      ],
    });
    expect(c.returnTags).toEqual(["Receipt", "Declined"]);
  });

  it("classifies the leaves through entryResult", async () => {
    const ctx = await enriched(SYS(PAY("Receipt or Declined", OK_ARMS)));
    const er = commandCreateEntryResult(ctx.workflows[0]!, ctx)!;
    expect(er.arms.map((a) => [a.kind, a.tag])).toEqual([
      ["payload", "Receipt"],
      ["error", "Declined"],
    ]);
    expect(er.leaves.map((l) => l.arm.tag)).toEqual(["Receipt", "Declined"]);
  });

  it("an arm ending in notFound answers no value", async () => {
    const ctx = await enriched(
      SYS(
        PAY(
          "Receipt or Declined",
          `int left => { return Receipt { left: left } } Insufficient e => { notFound }`,
        ),
      ),
    );
    const c = ctx.workflows[0]!.creates[0]!;
    expect(c.returnTags).toEqual(["Receipt"]);
    expect(commandCreateEntryResult(ctx.workflows[0]!, ctx)!.leaves).toHaveLength(1);
  });

  it("tags a tail return with its variant", async () => {
    const ctx = await enriched(
      SYS(`workflow W {
        create(n: int): int or Declined {
          return Declined { available: n }
        }
      }`),
    );
    expect(ctx.workflows[0]!.creates[0]!.returnTags).toEqual(["Declined"]);
  });

  it("a commandHandler answers an aggregate arm", async () => {
    const ctx = await enriched(
      SYS(`commandHandler Charge(account: Account id, amt: int): Account or Declined {
        let a = Accounts.get(account)
        let r = a.withdraw(amt)
        match r {
          int left => { return a }
          Insufficient e => { return Declined { available: e.needed } }
        }
      }`),
    );
    const h = ctx.commandHandlers![0]!;
    expect(h.returnTags).toEqual(["Account", "Declined"]);
    expect(entryResult(h, ctx)!.arms.map((a) => a.kind)).toEqual(["aggregate", "error"]);
  });
});

describe("expected-failure result — validation", () => {
  it("accepts a terminal match whose arms return, on a create and on both handlers", async () => {
    expect(await errorCodes(SYS(PAY("Receipt or Declined", OK_ARMS)))).toEqual([]);
    expect(
      await errorCodes(
        SYS(`queryHandler Peek(account: Account id): int or Declined {
          let found = Accounts.find(account)
          match found {
            Account x => { return x.balance }
            else => { return Declined { available: 0 } }
          }
        }`),
      ),
    ).toEqual([]);
  });

  it("refuses an arm's return that reads an arm-local let", async () => {
    const codes = await errorCodes(
      SYS(
        PAY(
          "Receipt or Declined",
          `int left => { let k = left + 1  return Receipt { left: k } }
           Insufficient e => { return Declined { available: e.needed } }`,
        ),
      ),
    );
    expect(codes).toContain("loom.workflow-return-not-last");
  });

  it("keeps refusing an arm return when the result declares no error", async () => {
    const codes = await errorCodes(
      SYS(PAY("int", `int left => { return left } Insufficient e => { return 0 }`)),
    );
    expect(codes).toContain("loom.workflow-return-not-last");
  });

  it("keeps refusing a union with no error variant", async () => {
    const codes = await errorCodes(
      SYS(`workflow W { create(n: int): int or string { return n } }`),
    );
    expect(codes).toContain("loom.union-position");
  });

  it("refuses a value-object success variant", async () => {
    const codes = await errorCodes(
      SYS(`workflow W { create(n: int): Amount or Declined { return Declined { available: n } } }`),
    );
    expect(codes).toContain("loom.workflow-return-type-unsupported");
  });

  it("refuses the result on an event-triggered create", async () => {
    const codes = await errorCodes(
      SYS(`event Paid { account: Account id }
        workflow W {
          payer: Account id
          create(p: Paid): int or Declined by p.account { return 1 }
        }`),
    );
    expect(codes).toContain("loom.workflow-return-no-caller");
  });

  it("refuses `return this` on an uncorrelated workflow", async () => {
    const codes = await errorCodes(
      SYS(`workflow W { create(n: int): W or Declined { return this } }`),
    );
    expect(codes).toContain("loom.workflow-return-this-uncorrelated");
  });

  it("accepts `return this` on a correlated workflow", async () => {
    const codes = await errorCodes(
      SYS(`workflow Hold {
        holdOf: Account id
        create(account: Account id): Hold or Declined {
          holdOf := account
          return this
        }
      }`),
    );
    expect(codes).toEqual([]);
  });

  it("refuses the result on an elixir-hosted context", async () => {
    const codes = await errorCodes(
      SYS(`workflow W { create(n: int): int or Declined { return n } }`, "elixir"),
    );
    expect(codes).toContain("loom.elixir-entry-result-unsupported");
  });
});
