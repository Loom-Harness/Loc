// `xs.sortBy(sort: [a, b desc])` — a multi-key in-memory sort reuses the
// query's `sort:` items (ruling 173) and unfolds, in the macro layer, into
// chained single-key sorts, last key first.  Its behaviour on every backend is
// the `sort-order` corpus fixture; this pins the unfolding and that `sort:`
// stays refused anywhere else.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { isMemberSuffix } from "../../src/language/generated/ast.js";
import { parseString } from "../_helpers/parse.js";

const wrap = (derived: string): string => `
  context C {
    enum Status { Open, Closed }
    aggregate Rack {
      contains items: Item[]
      entity Item { name: string  rank: int?  status: Status }
      ${derived}
    }
    repository Racks for Rack { }
  }
`;

describe("multi-key sortBy(sort: [...])", () => {
  it("is accepted and unfolds into chained single-key sorts, last key first", async () => {
    const { model, errors } = await parseString(
      wrap(
        `derived names: string = items.sortBy(sort: [status, rank desc]).map(i => i.name).join("|")`,
      ),
    );
    expect(errors).toEqual([]);
    const suffixes = [...AstUtils.streamAllContents(model!)].filter(isMemberSuffix);
    const members = suffixes.map((s) => s.member);
    // rank (desc) is applied first, then status.
    expect(members.indexOf("rank")).toBeLessThan(members.indexOf("status"));
    expect(members.filter((m) => m === "sortBy")).toHaveLength(2);
    expect(suffixes.some((s) => s.sorted)).toBe(false);
  });

  it("keeps refusing a sort: slot on any other member call", async () => {
    const { diagnostics } = await parseString(
      wrap(`derived names: string = items.map(sort: [name]).join("|")`),
    );
    expect(diagnostics.some((d) => d.code === "loom.repo-sort-placement")).toBe(true);
  });
});
