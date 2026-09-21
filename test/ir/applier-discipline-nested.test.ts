// The applier-discipline gates reach INSIDE an `if` branch, and the Elixir
// `if` gate covers applier bodies at all — wave CR1 packet CR1-f, audit row
// P0-2b, found while checking the depth of a gate CR1-f had cited as making
// `fold-stmt-emit.ts#renderFoldStatement`'s throw unreachable.
//
// TWO DEFECTS, ONE SHAPE.
//
// 1. `structural-checks.ts` rule 4 ("applier bodies are pure folds") iterated
//    `ap.statements` directly, so it only ever saw TOP-LEVEL statements:
//
//      apply(e: Deposited) { emit Withdrawn { … } }              → refused
//      apply(e: Deposited) { if c { emit Withdrawn { … } } }      → 0 error(s)
//
//    The second is the failure mode that is worse than a crash: the gate does
//    not fire, so four of five backends go on to emit exactly the shape the
//    rule exists to refuse. (CR1-e found this same shape five times over in
//    the `CLOSED_PREDICATE` bucket; this is its twin in the throwing one.)
//
// 2. `if-stmt-checks.ts`'s Elixir gate listed `agg.operations`, `agg.functions`
//    and `svc.operations` — NOT `agg.appliers`. `elixir/vanilla/fold-stmt-emit.ts`
//    renders an applier and has arms for `assign` / `add` / `remove` / `let` /
//    `expression` only. Measured on the pre-fix HEAD:
//
//      $ node bin/cli.js parse  applier-if.ddd
//      0 error(s), 0 warning(s).
//      $ node bin/cli.js generate system applier-if.ddd -o out
//      Error: elixir vanilla fold: unsupported applier statement 'if' — an
//      applier folds pure assignments / collection mutations / let bindings
//      only; the event-sourcing discipline validator should have rejected this.
//
//    — the emitter naming the gate that did not exist. `node`, `java`,
//    `python` and `dotnet` all emit the same model, which is exactly the
//    contract `loom.elixir-if-stmt-unsupported` is for: the statement ships on
//    the other four, so refusing it on the fifth is the honest half.
//
// MUTATION PROOF (CLAUDE.md — a green first run proves nothing): revert either
// fix and the matching case below fails.
//   - restore `for (const stmt of ap.statements)` in structural-checks.ts →
//       AssertionError: expected [] to include 'loom.applier-emits'
//   - delete the `for (const ap of agg.appliers ?? [])` loop in
//     if-stmt-checks.ts →
//       AssertionError: expected [ … ] to include 'loom.elixir-if-stmt-unsupported'
// Both reverted by file copy, never `git checkout --` (experience_gathered.md §84).
//
// THE TOP-LEVEL TWIN IS THE CONTROL. A gate that fires on the nested case but
// not the top-level one would be a different bug; asserting both is what makes
// "the gate reaches this depth" a measurement rather than a hope.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

function sys(applierBody: string, platform: string): string {
  return `
system Ledger {
  subdomain Accounts { context Accounts {
    aggregate Account persistedAs eventLog {
      owner: string
      balance: int
      create open(owner: string) { emit Opened { account: id, owner: owner } }
      operation deposit(amount: int) {
        precondition amount > 0
        emit Deposited { account: id, amount: amount }
      }
      apply(e: Opened) { owner := e.owner  balance := 0 }
      apply(e: Deposited) { ${applierBody} }
    }
    repository Accounts for Account { }
    event Opened { account: Account id, owner: string }
    event Deposited { account: Account id, amount: int }
  } }
  api LedgerApi from Accounts
  storage pg { type: postgres }
  resource accountsLog { for: Accounts, kind: eventLog, use: pg }
  deployable d {
    platform: ${platform}
    contexts: [Accounts]
    dataSources: [accountsLog]
    serves: LedgerApi
    port: 4000
  }
}`;
}

async function errorCodes(source: string): Promise<string[]> {
  const { model, errors } = await parseString(source, { validate: false });
  if (errors.length > 0) throw new Error(`fixture has parse errors:\n${errors.join("\n")}`);
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "<no code>");
}

const EMIT = "emit Opened { account: id, owner: e.account }";
const CALL = "deposit(1)";

describe("applier discipline reaches inside an `if` branch", () => {
  // `emit` — rule 4's first arm. The top-level twin is the control.
  it("top-level `emit` in an applier is refused (control)", async () => {
    expect(await errorCodes(sys(EMIT, "node"))).toContain("loom.applier-emits");
  });

  it("NESTED `emit` in an applier is refused too", async () => {
    expect(await errorCodes(sys(`if e.amount > 0 { ${EMIT} }`, "node"))).toContain(
      "loom.applier-emits",
    );
  });

  // `call` — rule 4's second arm, through the same walk.
  it("top-level impure call in an applier is refused (control)", async () => {
    expect(await errorCodes(sys(CALL, "node"))).toContain("loom.applier-impure-call");
  });

  it("NESTED impure call in an applier is refused too", async () => {
    expect(await errorCodes(sys(`if e.amount > 0 { ${CALL} }`, "node"))).toContain(
      "loom.applier-impure-call",
    );
  });

  // A pure fold stays legal at both depths, or the gate would have closed a
  // crash by deleting a working feature.
  it("control: a pure nested assignment is still accepted", async () => {
    const codes = await errorCodes(
      sys("if e.amount > 0 { balance := balance + e.amount }", "node"),
    );
    expect(codes).not.toContain("loom.applier-emits");
    expect(codes).not.toContain("loom.applier-impure-call");
  });
});

describe("the Elixir `if` gate covers applier bodies", () => {
  const PURE_IF = "if e.amount > 0 { balance := balance + e.amount }";

  it("an `if` in an applier is refused on elixir", async () => {
    expect(await errorCodes(sys(PURE_IF, "elixir"))).toContain("loom.elixir-if-stmt-unsupported");
  });

  // The other four render it, which is the whole reason this is a per-backend
  // refusal rather than a language rule.
  for (const platform of ["node", "java", "python", "dotnet"]) {
    it(`control: the same applier is accepted on ${platform}`, async () => {
      expect(await errorCodes(sys(PURE_IF, platform))).not.toContain(
        "loom.elixir-if-stmt-unsupported",
      );
    });
  }

  it("control: an applier with no `if` is untouched on elixir", async () => {
    expect(await errorCodes(sys("balance := balance + e.amount", "elixir"))).not.toContain(
      "loom.elixir-if-stmt-unsupported",
    );
  });
});
