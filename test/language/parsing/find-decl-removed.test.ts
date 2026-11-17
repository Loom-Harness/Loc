// Gate for D-FINDDECL-REMOVED (docs/decisions).
// A repository declares no reads of its own: its body is empty or absent, and a
// `find` inside it does not parse — an ordinary parse error, like any other
// input outside the grammar.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

const ctx = (repo: string) => `context A {\n  aggregate Order { code: string }\n  ${repo}\n}`;

describe("a repository body declares no reads", () => {
  it("an empty body and no body both parse", async () => {
    for (const repo of ["repository Orders for Order { }", "repository Orders for Order"]) {
      const { errors } = await parseString(ctx(repo));
      expect(errors, repo).toEqual([]);
    }
  });

  it("a `find` in the body is a parse error at the `find`", async () => {
    for (const decl of [
      "find byCode(c: string): Order? where this.code == c",
      "find all(): Order[]",
    ]) {
      const { errors } = await parseString(ctx(`repository Orders for Order {\n    ${decl}\n  }`));
      expect(errors.length, decl).toBeGreaterThan(0);
      expect(errors[0], decl).toMatch(/^4:5 /);
    }
  });
});
