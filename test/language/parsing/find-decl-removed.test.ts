import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

// ---------------------------------------------------------------------------
// D-FINDDECL-REMOVED — a `find` left in a repository body is a parse error
// that names the replacements, not chevrotain's "Expecting '}' but found
// `find`".  There is no warning window: the declaration does not parse, so no
// later phase sees it.  The rewrite is `findDeclRemoved` in
// `src/language/parse-errors.ts`.
// ---------------------------------------------------------------------------

async function onlyError(src: string): Promise<string> {
  const { errors } = await parseString(src);
  expect(errors, "exactly one parse diagnostic").toHaveLength(1);
  return errors[0]!;
}

const ctx = (repo: string) => `context A {\n  aggregate Order { code: string }\n  ${repo}\n}`;

describe("a leftover `find` names the repository contract", () => {
  it("a single-row find, at the `find`", async () => {
    const err = await onlyError(
      ctx(
        "repository Orders for Order {\n    find byCode(c: string): Order? where this.code == c\n  }",
      ),
    );
    expect(err).toMatch(/^4:5 A repository declares no `find`s any more: read 'Order'/);
    expect(err).toContain("`Orders.find(id)` / `get(id)`");
    expect(err).toContain(
      "`Orders.findBy(<column>: v)` / `getBy(…)` over a declared `unique (…)` key",
    );
    expect(err).toContain("`Orders.find(C)` (the first match) or `all(C)`");
    expect(err).toContain("`queryHandler` or `scaffoldGet`");
  });

  it("`find all` and a list find too, after a comment", async () => {
    for (const decl of ["find all(): Order[]", 'find big(): Order paged where this.code != ""']) {
      const err = await onlyError(
        ctx(`repository Orders for Order {\n    // was the list read\n    ${decl}\n  }`),
      );
      expect(err, decl).toMatch(/^5:5 A repository declares no `find`s any more/);
    }
  });

  it("an empty body and no body both parse", async () => {
    for (const repo of ["repository Orders for Order { }", "repository Orders for Order"]) {
      const { errors } = await parseString(ctx(repo));
      expect(errors, repo).toEqual([]);
    }
  });

  it("a `find` outside a repository body keeps chevrotain's message", async () => {
    const err = await onlyError(
      "context A {\n  aggregate Order { code: string  find byCode(c: string): Order? }\n}",
    );
    expect(err).not.toContain("repository contract");
  });
});
