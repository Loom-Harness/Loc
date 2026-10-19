// A parse error's "Expected one of: …" list names the alternatives the author
// was choosing between.  Where a NAME was legal, `<ID>` already stands for
// every word a name rule admits — including each name rule's own extras
// (`NameRefIdent`'s `create`/`contains`/…, `LooseName`'s `from`/`await`/…),
// which are not in the shared soft-keyword set.  Listing those extras put
// five spellings of "a name" ahead of the real alternatives:
//
//     for channel in [1, 2] {
//     Unexpected '['. Expected one of: 'contains', 'create', 'destroy', 'ignoring', 'page' (+1 more).
//
// A keyword that ALSO heads real syntax in the failing rule must stay listed.

import { describe, expect, it } from "vitest";
import { isNameOnlyKeywordIn } from "../../../src/language/soft-keywords.js";
import { parseRawResult } from "../../_helpers/index.js";

const handler = (stmts: string) => `context C {
  aggregate A { n: int  operation bump(k: int) { n := n + k } }
  commandHandler H(q: int) {
    ${stmts}
  }
}`;

function firstError(src: string): string {
  const errs = parseRawResult(src).parserErrors.map((e) => e.message);
  expect(errs.length, src).toBeGreaterThan(0);
  return errs[0]!;
}

describe("parse-error candidates omit name-only keywords", () => {
  it("`for … in [` lists only <ID>, not NameRefIdent's extras", () => {
    const msg = firstError(handler("for channel in [1, 2] {\n    }"));
    expect(msg).toBe("Unexpected '['. Expected one of: <ID>.");
  });

  it("a stray token in an expression leads with real expression starts", () => {
    // `contains`/`destroy`/`page` (only ever a NameRef here) no longer count
    // toward the hidden tail.  `id` still does — `IdRef` makes it an expression
    // atom of its own — and so do `create`/`ignoring`, which a rule calling
    // Expression uses as syntax right after one.
    expect(firstError(handler("let x = ?"))).toBe(
      "Unexpected '?'. Expected one of: 'match', '!', '-', '{', '(' (+19 more).",
    );
  });

  it("a bad call argument leads with the throw-kind slot, not LooseName's labels", () => {
    const msg = firstError(handler("let x = q.max(, 1)"));
    expect(msg).toContain(
      "Expected one of: 'precondition', 'invariant', 'id', 'ignoring', 'match'",
    );
    for (const w of ["await", "from", "contains"]) expect(msg).not.toContain(`'${w}'`);
  });
});

describe("isNameOnlyKeywordIn — read off the grammar per rule", () => {
  it("a name rule's own extras are names inside it", () => {
    for (const w of ["contains", "create", "destroy", "ignoring", "page"]) {
      expect(isNameOnlyKeywordIn("NameRefIdent", w), w).toBe(true);
    }
    for (const w of ["await", "from", "id"])
      expect(isNameOnlyKeywordIn("LooseName", w), w).toBe(true);
  });

  it("a keyword that also heads syntax in the rule is NOT name-only", () => {
    // `contains X` is an aggregate member of its own; `ignoring` is only ever a field name there.
    expect(isNameOnlyKeywordIn("AggregateMember", "contains")).toBe(false);
    expect(isNameOnlyKeywordIn("AggregateMember", "ignoring")).toBe(true);
    // `id` is an expression atom (`IdRef`), not just a name.
    expect(isNameOnlyKeywordIn("Expression", "id")).toBe(false);
    // An alternation can expect what a CALLER puts after the rule: a rule
    // calling Expression uses `create` as syntax, so it is not hidden there.
    expect(isNameOnlyKeywordIn("Expression", "create")).toBe(false);
    expect(isNameOnlyKeywordIn("Expression", "contains")).toBe(true);
    // `this.` heads an lvalue; `let`/`emit` head statements.
    for (const w of ["this", "let", "emit", "match"]) {
      expect(isNameOnlyKeywordIn("Statement", w), w).toBe(false);
    }
  });

  it("a rule with no name position hides nothing", () => {
    expect(isNameOnlyKeywordIn("PrimitiveType", "int")).toBe(false);
    expect(isNameOnlyKeywordIn("NoSuchRule", "create")).toBe(false);
  });
});
