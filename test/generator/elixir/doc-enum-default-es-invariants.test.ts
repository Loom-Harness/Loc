// Two elixir parity gaps against the other four backends:
//
//   * a `shape: document` aggregate's ENUM field default (`stage: Stage =
//     Pending`) never reached the `<Agg>.Data` embed, so a create omitting the
//     field was refused `can't be blank` where every other backend stores the
//     default;
//   * an event-sourced aggregate's `invariant`s were enforced by no command: the
//     runner folded and appended whatever the command emitted.
//
// The document default and the runners' refusal are asserted by value on the
// elixir behavioural leg (`corpus/document`'s create without `stage`,
// `corpus/event-sourcing`'s over-cap deposit).  What stays here is what those
// cases do not reach: the pure core's refusal, a guarded invariant's
// implication, the fold position with no invariant, and the reference
// collection exemption.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { generateSystemFiles, parseString } from "../../_helpers/index.js";

function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  expect(hit, `no emitted file ends with ${suffix} — the probe is stale`).toBeDefined();
  return hit![1];
}

const ES = `system Bank {
  subdomain Ledger {
    context Ledger {
      event Opened { account: Account id, owner: string, balance: int }
      event Deposited { account: Account id, amount: int }
      aggregate Account persistedAs: eventLog {
        owner: string
        balance: int
        invariant balance <= 100 message "Balance cap exceeded"
        invariant balance >= 0
        create open(owner: string, balance: int) {
          emit Opened { account: id, owner: owner, balance: balance }
        }
        operation deposit(amount: int) {
          emit Deposited { account: id, amount: amount }
        }
        apply(e: Opened) { owner := e.owner  balance := e.balance }
        apply(e: Deposited) { balance := balance + e.amount }
        test "a deposit past the cap is refused" {
          let a = Account.create(owner: "Ada", balance: 10)
          expect(a.deposit(500)).toThrow()
        }
      }
    }
  }
  api LedgerApi from Ledger
  storage primary { type: postgres }
  resource ev { for: Ledger, kind: eventLog, use: primary }
  deployable d {
    platform: elixir
    contexts: [Ledger]
    dataSources: [ev]
    serves: LedgerApi
    port: 4000
  }
}`;

describe("elixir event-sourced commands — aggregate invariants", () => {
  it("the pure core refuses the same transitions the runner refuses", async () => {
    const mod = file(await generateSystemFiles(ES), "lib/d/ledger/account.ex");
    expect(mod).toContain(
      ':ok <- if(folded.balance >= 0, do: :ok, else: {:error, {:precondition_failed, "Invariant violated: balance >= 0"}})',
    );
    expect(mod).toContain(
      'if not (folded.balance <= 100), do: raise(D.GuardError, kind: :precondition, message: "Balance cap exceeded")',
    );
  });

  it("a guarded invariant renders as the implication", async () => {
    const model = ES.replace(
      "invariant balance >= 0",
      'invariant balance >= 0 when owner != "bank"',
    );
    expect(model).toContain('when owner != "bank"');
    const ctx = file(await generateSystemFiles(model), "lib/d/ledger.ex");
    expect(ctx).toContain('ensure(not (folded.owner != "bank") or (folded.balance >= 0), ');
  });

  it("an aggregate with no invariant keeps the fold after the append", async () => {
    const model = ES.replace(/ {8}invariant [^\n]*\n/g, "");
    expect(model).not.toContain("invariant ");
    const ctx = file(await generateSystemFiles(model), "lib/d/ledger.ex");
    expect(ctx).not.toContain("folded");
    expect(ctx).toContain("{:ok, D.Ledger.AccountFold.from_events(id, events)}");
  });

  it("a reference-collection invariant is enforced on the fold, and so not reported", async () => {
    // Relationally an `X id[]` field is a join table the changeset cannot see,
    // so such a rule is reported unenforced.  The ES fold holds it as the id
    // list itself, so the runner can check it and the warning would be false.
    const model = ES.replace(
      "        balance: int\n",
      "        balance: int\n        holders: Holder id[]\n        invariant holders.count <= 3\n",
    )
      .replace(
        "      event Opened",
        "      aggregate Holder with crudish { name: string }\n      event Opened",
      )
      .replace(
        "  resource ev {",
        "  resource st { for: Ledger, kind: state, use: primary }\n  resource ev {",
      )
      .replace("dataSources: [ev]", "dataSources: [st, ev]");
    expect(model).toContain("invariant holders.count <= 3");
    const ctx = file(await generateSystemFiles(model), "lib/d/ledger.ex");
    expect(ctx).toContain("ensure(Enum.count(folded.holders) <= 3, ");
    const { model: ast } = await parseString(model, { validate: false });
    const unenforced = validateLoomModel(enrichLoomModel(lowerModel(ast))).filter(
      (d) => d.code === "loom.elixir-invariant-unenforced",
    );
    expect(unenforced).toEqual([]);
  });
});
