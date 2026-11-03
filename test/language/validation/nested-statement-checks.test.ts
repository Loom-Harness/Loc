// The per-statement checks of an operation body (assignment types,
// `precondition` / `requires` bool, call statements) reach the statements
// nested in an `if` / `else`, `if let`, `for` and statement `match`, exactly as
// they reach a top-level statement — and the subtree-wide construction checks
// still report a nested defect once.

import { describe, expect, it } from "vitest";
import { lspCodes } from "../../_helpers/diagnostics.js";
import { parseString } from "../../_helpers/parse.js";

const sys = (body: string, params = "b: bool, xs: int[]") => `
system Demo {
  subdomain S {
    context C {
      valueobject Coin { amount: int }
      aggregate Account with crudish {
        n: int
        tags: string[]
        coin: Coin?
        operation op(${params}) {
          ${body}
        }
      }
      repository Accounts for Account
    }
  }
}`;

async function codes(body: string, params?: string): Promise<string[]> {
  const { diagnostics } = await parseString(sys(body, params), { validate: true });
  return lspCodes(diagnostics);
}

const ASSIGN = "loom.assign-type-mismatch";

describe("statement checks in nested blocks", () => {
  it("refuses a mistyped assignment in an if, its else and an else-if", async () => {
    expect(await codes('if b { n := "s" }')).toContain(ASSIGN);
    expect(await codes('if b { n := 1 } else { n := "s" }')).toContain(ASSIGN);
    expect(await codes('if b { n := 1 } else if !b { n := "s" }')).toContain(ASSIGN);
  });

  it("refuses a mistyped assignment in a for body", async () => {
    expect(await codes('for x in xs { n := "s" }')).toContain(ASSIGN);
  });

  it("refuses a non-bool precondition nested in an if", async () => {
    expect(await codes("if b { precondition n }")).toContain("loom.precondition-not-bool");
  });

  it("accepts well-typed nested statements, with narrowing and block lets", async () => {
    expect(await codes("if b { let m = n + 1\n n := m }")).not.toContain(ASSIGN);
    expect(await codes("for x in xs { n := x }")).not.toContain(ASSIGN);
    expect(await codes("if coin != null { n := coin.amount }")).not.toContain(ASSIGN);
  });

  it("reports a nested construction defect once, not once per enclosing statement", async () => {
    const all = await codes('if b { if b { coin := Coin { amount: "s" } } }');
    const construction = all.filter((c) => c !== ASSIGN);
    expect(construction.length).toBeGreaterThan(0);
    expect(new Set(construction).size).toBe(construction.length);
  });
});
