// Lowering puts every domain body in branch-total form for `return`: the
// statements after an `if` that returns move into the branch that does not, so
// every backend receives each `return` as the last statement of its block.

import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { OperationIR, StmtIR } from "../../src/ir/types/loom-ir.js";
import { toBranchTotal } from "../../src/ir/util/if-normal-form.js";
import { parseString } from "../_helpers/parse.js";

async function opOf(body: string, returns = "int"): Promise<OperationIR> {
  const { model, errors } = await parseString(`system S {
  subdomain M { context C {
    aggregate Task {
      count: int
      operation run(n: int)${returns ? `: ${returns}` : ""} {
${body}
      }
    }
    repository Tasks for Task {}
  } }
}`);
  if (errors.length) throw new Error(errors.join("\n"));
  const loom = lowerModel(model);
  return loom.systems[0]!.subdomains[0]!.contexts[0]!.aggregates[0]!.operations[0]!;
}

/** The statement kinds of a body as a nested outline. */
function shape(stmts: readonly StmtIR[]): unknown[] {
  return stmts.map((s) =>
    s.kind === "if"
      ? { if: shape(s.thenBody), ...(s.elseBody ? { else: shape(s.elseBody) } : {}) }
      : s.kind,
  );
}

describe("normalizeEarlyReturns (lowering)", () => {
  it("moves the statements after a returning `if` into its other branch", async () => {
    const op = await opOf(`        if n > 0 {
          return 1
        }
        count := n
        return count`);
    expect(shape(op.statements)).toEqual([{ if: ["return"], else: ["assign", "return"] }]);
  });

  it("appends the continuation to an existing `else` that does not return", async () => {
    const op = await opOf(`        if n > 0 {
          return 1
        } else {
          count := 2
        }
        return count`);
    expect(shape(op.statements)).toEqual([{ if: ["return"], else: ["assign", "return"] }]);
  });

  it("leaves an `if`/`else` that returns from both branches, with nothing after it, as written", async () => {
    const op = await opOf(`        if n > 0 {
          return 1
        } else {
          return 2
        }`);
    expect(shape(op.statements)).toEqual([{ if: ["return"], else: ["return"] }]);
  });

  it("threads the continuation through a nested partial return", async () => {
    const op = await opOf(`        if n > 0 {
          if n > 5 {
            return 5
          }
          count := 1
        }
        return count`);
    // The outer `then` can complete normally, so it takes the trailing `return`
    // too, and the inner `if` then takes everything after it.
    expect(shape(op.statements)).toEqual([
      { if: [{ if: ["return"], else: ["assign", "return"] }], else: ["return"] },
    ]);
  });

  it("does not touch an `if` that holds no `return`", async () => {
    const op = await opOf(
      `        if n > 0 {
          count := 1
        }
        count := count + 1`,
      "",
    );
    expect(shape(op.statements)).toEqual([{ if: ["assign"] }, "assign"]);
  });
});

describe("toBranchTotal", () => {
  it("returns the same array when nothing changes", async () => {
    const op = await opOf(`        count := n
        return count`);
    expect(toBranchTotal(op.statements, (s) => s.kind === "return")).toBe(op.statements);
  });

  it("widens to any predicate — the `if` it matches takes the rest of the body", async () => {
    const op = await opOf(`        if n > 0 {
          count := 1
        }
        count := count + 1
        return count`);
    const total = toBranchTotal(
      op.statements,
      (s) => s.kind === "assign" && s.target.segments[0] === "count",
    );
    expect(shape(total)).toEqual([
      { if: ["assign", "assign", "return"], else: ["assign", "return"] },
    ]);
  });
});
