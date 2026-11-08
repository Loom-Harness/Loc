// An applier is a replayable fold of its event into state, so the VALUE of an
// admitted statement (`let`, an assignment, an `if` condition) must be pure
// too: a repository read gives a different row on every replay, and a factory
// create makes a new aggregate per replay.  `loom.applier-impure-call` refuses
// both, on aggregate and workflow appliers alike, at any depth; a pure fold
// stays clean.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseErrorsOf, parseString } from "../_helpers/parse.js";

const CODE = "loom.applier-impure-call";

const sys = (aggApplier: string, wfApplier = "count := paid.amount") => `
system Ledger {
  subdomain Accounts { context Accounts {
    aggregate Owner with crudish { name: string }
    repository Owners for Owner
    aggregate Account persistedAs: eventLog {
      owner: string
      create open(ref: Owner id) { emit Opened { account: id, ref: ref } }
      apply(e: Opened) { ${aggApplier} }
    }
    repository Accounts for Account { }
    event Opened { account: Account id, ref: Owner id }
    event Paid { ref: Owner id, amount: int }
    workflow Tally eventSourced {
      ownerId: Owner id
      count: int
      apply(paid: Paid) { ${wfApplier} }
    }
  } }
  storage pg { type: postgres }
  resource accountsLog { for: Accounts, kind: eventLog, use: pg }
  resource st { for: Accounts, kind: state, use: pg }
  deployable d { platform: node  contexts: [Accounts]  dataSources: [accountsLog, st]  port: 4000 }
}`;

async function impure(source: string): Promise<string[]> {
  const parseErrors = parseErrorsOf(source);
  if (parseErrors.length > 0)
    throw new Error(`fixture has parse errors:\n${parseErrors.join("\n")}`);
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.code === CODE)
    .map((d) => d.message);
}

describe("an applier's expressions are pure", () => {
  it("refuses a repository read bound by a `let` in an aggregate applier", async () => {
    const msgs = await impure(sys("let o = Owners.get(e.ref)  owner := o.name"));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("aggregate 'Account' apply(Opened) evaluates 'Owners.get(…)'");
  });

  it("refuses a factory create bound by a `let`", async () => {
    const msgs = await impure(sys('let n = Owner.create(name: "x")  owner := n.name'));
    expect(msgs).toEqual([expect.stringContaining("evaluates 'Owner.create(…)'")]);
  });

  it("refuses a read nested in an `if` condition and in an assignment's value", async () => {
    const msgs = await impure(
      sys('if Owners.find(e.ref) != null { owner := "x" }  owner := Owners.get(e.ref).name'),
    );
    expect(msgs).toEqual([
      expect.stringContaining("evaluates 'Owners.find(…)'"),
      expect.stringContaining("evaluates 'Owners.get(…)'"),
    ]);
  });

  it("refuses a repository read in an event-sourced workflow applier", async () => {
    const msgs = await impure(
      sys("owner := e.account.value", "let o = Owners.get(paid.ref)  count := paid.amount"),
    );
    expect(msgs).toEqual([
      expect.stringContaining("workflow 'Tally' apply(Paid) evaluates 'Owners.get(…)'"),
    ]);
  });

  it("control: a pure fold with a `let` is accepted", async () => {
    expect(await impure(sys("let n = e.account  owner := n.value"))).toEqual([]);
  });
});
