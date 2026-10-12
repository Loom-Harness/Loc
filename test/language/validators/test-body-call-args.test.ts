// Operation-call ARGUMENTS inside a unit / integration `test` body are
// type-checked (eval-closure review item #32).
//
// A `test` body is not an aggregate operation, so neither `checkStatement`
// (which threads `checkExprCallArgs`) nor `checkCallStmt` (which needs a `this`
// aggregate) ever visited it, and test-body lets typed `unknown`.  So
// `r.bump("x")` on `bump(k: int)` validated `0 error(s)` and reached the emitted
// suite verbatim (`r.bump("x");` in TypeScript and Python alike).
//
// The false-positive half matters as much: a raw string literal in an `X id` /
// `datetime` position is idiomatic in a test body — every backend's test emitter
// wraps it (`Ids.ProductId("0000…")`) — and the shipping examples write their
// tests that way, so it must stay accepted.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

const model = (testBody: string, where: "context" | "aggregate" = "context") => {
  const test = `test "t" {\n${testBody}\n}`;
  return `system Cl {
  subdomain Core {
    context Claims {
      aggregate Owner with crudish { name: string }
      aggregate Claim with crudish {
        target: string
        n: int
        owner: Owner id?
        at: datetime?
        operation retarget(t: string) { target := t }
        operation bump(k: int) { n := n + k }
        operation assign(o: Owner id, stamp: datetime) {
          owner := o
          at := stamp
        }
        ${where === "aggregate" ? test : ""}
      }
      repository Owners for Owner { }
      repository Claims for Claim { }
      ${where === "context" ? test : ""}
    }
  }
  storage primary { type: postgres }
  resource appState { for: Claims, kind: state, use: primary }
  deployable api { platform: node, contexts: [Claims], dataSources: [appState], port: 8000 }
}`;
};

const CREATE = `let r = Claim.create({ target: "a", n: 1 })`;

async function argErrors(testBody: string, where?: "context" | "aggregate"): Promise<string[]> {
  const { errors } = await parseString(model(testBody, where));
  const argErrs = errors.filter((e) => /Argument \d+ of|expects \d+ argument/.test(e));
  // Every OTHER error is a broken fixture, and would make an "accepts" case
  // vacuous (a model that does not parse reports no arg errors either).
  expect(errors.filter((e) => !argErrs.includes(e))).toEqual([]);
  return argErrs;
}

describe("test-body call args (item #32)", () => {
  it("rejects a wrong-typed arg on a bare member-call statement (context test)", async () => {
    const errs = await argErrors(`${CREATE}\n r.retarget(42)\n r.bump("x")`);
    expect(errs.join("\n")).toMatch(/Argument 1 of 'retarget' expects 'string' but got 'int'/);
    expect(errs.join("\n")).toMatch(/Argument 1 of 'bump' expects 'int' but got 'string'/);
  });

  it("rejects a wrong-typed arg on a member call in expression position", async () => {
    const errs = await argErrors(`${CREATE}\n expect(r.bump("x")).toThrow()`);
    expect(errs.join("\n")).toMatch(/Argument 1 of 'bump' expects 'int' but got 'string'/);
  });

  it("rejects a miscounted call", async () => {
    const errs = await argErrors(`${CREATE}\n r.bump(1, 2)`);
    expect(errs.join("\n")).toMatch(/'bump'.*expects 1 argument/);
  });

  it("rejects it in a test nested in the aggregate too", async () => {
    const errs = await argErrors(`${CREATE}\n r.bump("x")`, "aggregate");
    expect(errs.join("\n")).toMatch(/Argument 1 of 'bump' expects 'int' but got 'string'/);
  });

  it("accepts well-typed calls", async () => {
    expect(
      await argErrors(`${CREATE}\n r.retarget("b")\n r.bump(2)\n expect(r.n).toBe(3)`),
    ).toEqual([]);
  });

  it("accepts a raw string literal in an id / datetime position (the emitter coerces it)", async () => {
    expect(
      await argErrors(
        `${CREATE}\n r.assign("00000000-0000-0000-0000-000000000001", "2024-01-01T00:00:00Z")`,
      ),
    ).toEqual([]);
  });

  it("still rejects a NON-literal string in an id position", async () => {
    const errs = await argErrors(
      `${CREATE}\n let s = "00000000-0000-0000-0000-000000000001"\n r.assign(s, "2024-01-01T00:00:00Z")`,
    );
    expect(errs.join("\n")).toMatch(/Argument 1 of 'assign' expects 'Owner id' but got 'string'/);
  });
});
