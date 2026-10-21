import { describe, expect, it } from "vitest";
import { fieldAccessKeywords } from "../../../src/language/parse-errors.js";
import { parseString } from "../../_helpers/parse.js";

// ---------------------------------------------------------------------------
// Claims eval D11 — an access modifier written AFTER the field's default.
//
// `status: S = Draft managed` used to report
//
//     Expecting token of type ':' but found `n`.
//
// on the NEXT field: the property ends at the default and `managed` (a soft
// keyword) is read as the next field's name.  The rewrite
// (`accessModifierAfterDefault` in `src/language/parse-errors.ts`) points at
// the modifier and spells the right order.
// ---------------------------------------------------------------------------

async function onlyError(src: string): Promise<string> {
  const { errors } = await parseString(src);
  expect(errors, "exactly one parse diagnostic").toHaveLength(1);
  return errors[0]!;
}

describe("an access modifier after the default says it goes before it", () => {
  it("the repro: `s: S = D managed` followed by another field", async () => {
    expect(
      await onlyError(
        "context A { enum S { D, E } aggregate X { s: S = D managed\n n: string } repository Xs for X { } }",
      ),
    ).toBe("1:52 The access modifier 'managed' goes before the default: `s: S managed = D`.");
  });

  it("the last field before the closing brace", async () => {
    expect(
      await onlyError(
        'context A { aggregate X {\n  n: string\n  approved: money = money("0") immutable\n} }',
      ),
    ).toBe(
      "3:32 The access modifier 'immutable' goes before the default: " +
        '`approved: money immutable = money("0")`.',
    );
  });

  it("the right order still parses", async () => {
    const { errors } = await parseString(
      "context A { enum S { D, E } aggregate X { s: S managed = D\n n: string } }",
    );
    expect(errors).toEqual([]);
  });

  it("a non-modifier word after the default keeps chevrotain's text", async () => {
    const err = await onlyError(
      "context A { enum S { D, E } aggregate X { s: S = D bogus\n n: string } }",
    );
    expect(err).not.toContain("access modifier");
  });

  it("the modifier set is read off the grammar's FieldAccess rule", () => {
    expect([...fieldAccessKeywords()].sort()).toEqual([
      "immutable",
      "internal",
      "managed",
      "secret",
      "token",
    ]);
  });
});
