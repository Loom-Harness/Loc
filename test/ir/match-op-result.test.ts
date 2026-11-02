// A mutating call bound with `let` in a workflow / handler body.
//
// `let r = a.withdraw(x)` lowers to the `op-call` it is, carrying a `result`;
// `let r = Transfer.run(…)` over a `mutating` service to a
// `domain-service-call` with one.  A result with no `error` variant is saved at
// the body's exit like the bare statement.  One WITH an error variant is
// tentative (D-FAILURE-MODEL): no exit save covers the mutated aggregate; the
// non-error arms of the `match` over `r` save it and the error arms drop it.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts, type WorkflowStmtIR } from "../../src/ir/types/loom-ir.js";
import { discardedAggregates } from "../../src/ir/util/discards.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const SYS = (members: string, platform = "node") => `
  system Bank {
    subdomain D {
      context Ledger {
        error Insufficient { needed: int }
        aggregate Account {
          balance: int
          operation withdraw(amt: int): int or Insufficient {
            balance := balance - amt
            return balance
          }
          operation deposit(amt: int): int { balance := balance + amt  return balance }
        }
        repository Accounts for Account { }
        domainService Transfer {
          operation run(src: Account, dst: Account, amount: int): int {
            src.deposit(0 - amount)
            dst.deposit(amount)
            return amount
          }
          operation tryRun(src: Account, dst: Account, amount: int): int or Insufficient {
            src.deposit(0 - amount)
            dst.deposit(amount)
            return amount
          }
        }
        ${members}
      }
    }
    storage pg { type: postgres }
    resource st { for: Ledger, kind: state, use: pg }
    deployable d { platform: ${platform}, contexts: [Ledger], dataSources: [st], port: 4000 }
  }
`;

async function lowered(src: string) {
  const { model } = await parseString(src, { validate: false });
  return allContexts(lowerModel(model))[0]!;
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

const PAY = (arms: string) => `
  workflow Pay {
    create(id: Account id, amt: int) {
      let a = Accounts.get(id)
      let r = a.withdraw(amt)
      match r { ${arms} }
    }
  }`;

type Match = Extract<WorkflowStmtIR, { kind: "variant-match" }>;
const saves = (xs: readonly { name: string }[] | undefined) => (xs ?? []).map((s) => s.name);

describe("let-bound mutating call — lowering", () => {
  it("lowers `let r = a.withdraw(x)` to an op-call carrying its result", async () => {
    const ctx = await lowered(SYS(PAY(`int n => { } Insufficient e => { }`)));
    const create = ctx.workflows[0]!.creates[0]!;
    expect(create.statements[1]).toMatchObject({
      kind: "op-call",
      target: "a",
      aggName: "Account",
      op: "withdraw",
      result: { name: "r", errorVariants: ["Insufficient"], type: { kind: "union" } },
    });
  });

  it("saves the aggregate in the non-error arm only, and drops it in the error arm", async () => {
    const ctx = await lowered(SYS(PAY(`int n => { } Insufficient e => { }`)));
    const create = ctx.workflows[0]!.creates[0]!;
    expect(saves(create.savesAtExit)).toStrictEqual([]);
    const m = create.statements[2] as Match;
    expect(m.arms.map((a) => [a.isError, saves(a.savesInArm), saves(a.discardsInArm)])).toEqual([
      [false, ["a"], []],
      [true, [], ["a"]],
    ]);
  });

  it("an `else` covering only success variants saves; one covering errors drops", async () => {
    const okElse = (await lowered(SYS(PAY(`Insufficient e => { } else => { }`)))).workflows[0]!
      .creates[0]!.statements[2] as Match;
    expect(saves(okElse.savesInElse)).toStrictEqual(["a"]);
    expect(okElse.discardsInElse).toBeUndefined();
    const errElse = (await lowered(SYS(PAY(`int n => { } else => { }`)))).workflows[0]!.creates[0]!
      .statements[2] as Match;
    expect(saves(errElse.savesInElse)).toStrictEqual([]);
    expect(saves(errElse.discardsInElse)).toStrictEqual(["a"]);
  });

  it("a result with no error variant is saved at exit, like the bare statement", async () => {
    const ctx = await lowered(
      SYS(`workflow Top { create(id: Account id) {
        let a = Accounts.get(id)
        let n = a.deposit(1)
        precondition n > 0
      } }`),
    );
    const create = ctx.workflows[0]!.creates[0]!;
    expect(create.statements[1]).toMatchObject({
      kind: "op-call",
      result: { name: "n", errorVariants: [] },
    });
    expect(saves(create.savesAtExit)).toStrictEqual(["a"]);
  });

  it("a let-bound mutating service call saves its mutated args at exit", async () => {
    const ctx = await lowered(
      SYS(`workflow Move transactional { create(s: Account id, d: Account id, amt: int) {
        let src = Accounts.get(s)
        let dst = Accounts.get(d)
        let moved = Transfer.run(src, dst, amt)
      } }`),
    );
    const create = ctx.workflows[0]!.creates[0]!;
    expect(create.statements[2]).toMatchObject({
      kind: "domain-service-call",
      service: "Transfer",
      op: "run",
      result: { name: "moved", errorVariants: [] },
    });
    expect(saves(create.savesAtExit)).toStrictEqual(["src", "dst"]);
  });

  it("a guarded service call saves its mutated args in the success arm", async () => {
    const ctx = await lowered(
      SYS(`workflow Move { create(s: Account id, d: Account id, amt: int) {
        let src = Accounts.get(s)
        let dst = Accounts.get(d)
        let r = Transfer.tryRun(src, dst, amt)
        match r { int n => { } Insufficient e => { } }
      } }`),
    );
    const create = ctx.workflows[0]!.creates[0]!;
    expect(saves(create.savesAtExit)).toStrictEqual([]);
    const m = create.statements[3] as Match;
    expect(m.arms.map((a) => [saves(a.savesInArm), saves(a.discardsInArm)])).toEqual([
      [["src", "dst"], []],
      [[], ["src", "dst"]],
    ]);
    expect([...discardedAggregates(ctx)]).toStrictEqual(["Account"]);
  });

  it("a command handler lowers the same way", async () => {
    const ctx = await lowered(
      SYS(`commandHandler Pay(id: Account id, amt: int) {
        let a = Accounts.get(id)
        let r = a.withdraw(amt)
        match r { int n => { } Insufficient e => { notFound } }
      }`),
    );
    const h = ctx.commandHandlers![0]!;
    expect(saves(h.savesAtExit)).toStrictEqual([]);
    const m = h.statements[2] as Match;
    expect(saves(m.arms[0]!.savesInArm)).toStrictEqual(["a"]);
  });
});

describe("let-bound mutating call — validation", () => {
  it("admits a matched guarded call, a plain bound call, and a bound service call", async () => {
    expect(await errorCodes(SYS(PAY(`int n => { } Insufficient e => { }`)))).toStrictEqual([]);
    expect(
      await errorCodes(
        SYS(`workflow Move transactional { create(s: Account id, d: Account id, amt: int) {
          let src = Accounts.get(s)
          let dst = Accounts.get(d)
          let moved = Transfer.run(src, dst, amt)
          precondition moved > 0
        } }`),
      ),
    ).toStrictEqual([]);
  });

  it("refuses a guarded result that no `match` reads", async () => {
    expect(
      await errorCodes(
        SYS(`workflow Pay { create(id: Account id, amt: int) {
          let a = Accounts.get(id)
          let r = a.withdraw(amt)
          let s = r
          match s { int n => { } Insufficient e => { } }
        } }`),
      ),
    ).toStrictEqual(["loom.workflow-mutation-result-unmatched"]);
  });

  it("refuses an `else` that covers a success and an error variant", async () => {
    const { model } = await parseString(SYS(PAY(`else => { }`)), { validate: false });
    const hit = validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
      (d) => d.code === "loom.workflow-mutation-result-unmatched",
    );
    expect(hit.map((d) => d.message).join("\n")).toContain(
      "the 'else' arm of 'match r' covers the success 'int' and the error 'Insufficient'",
    );
  });

  it("refuses another change to the guarded aggregate in the same body", async () => {
    const { model } = await parseString(
      SYS(`workflow Pay { create(id: Account id, amt: int) {
        let a = Accounts.get(id)
        a.deposit(1)
        let r = a.withdraw(amt)
        match r { int n => { } Insufficient e => { } }
      } }`),
      { validate: false },
    );
    const hit = validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
      (d) => d.code === "loom.workflow-mutation-result-unmatched",
    );
    expect(hit.map((d) => d.message).join("\n")).toContain(
      "this body also creates or changes 'a' elsewhere",
    );
  });

  it("still refuses a mutating call nested inside a larger expression", async () => {
    expect(
      await errorCodes(
        SYS(`workflow Top { create(id: Account id) {
          let a = Accounts.get(id)
          let n = a.deposit(1) + 1
          precondition n > 0
        } }`),
      ),
    ).toStrictEqual(["loom.workflow-mutation-unsaved"]);
  });

  it("refuses the bound form on an elixir deployable", async () => {
    expect(await errorCodes(SYS(PAY(`int n => { } Insufficient e => { }`), "elixir"))).toContain(
      "loom.elixir-bound-mutating-call-unsupported",
    );
  });
});
