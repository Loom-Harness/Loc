// `ignoring` filter-bypass clause (named-filter-bypass.md §11) parses on an
// inline read: `Repo.find(C)`, `Repo.findAll(...)`, `Repo.run(...)`.  Both the `*` wildcard and a
// comma-separated capability list are admitted.  `ignoring` is a soft keyword,
// so a field / parameter named `ignoring` keeps parsing.

import { describe, expect, it } from "vitest";
import {
  type BoundedContext,
  isPostfixChain,
  type PostfixChain,
  isSubdomain,
  isSystem,
  type Model,
} from "../../../src/language/generated/ast.js";
import { parseErrorsOf, parseString } from "../../_helpers/parse.js";

/** Every bounded context in a parsed Model. */
function contexts(model: Model): BoundedContext[] {
  const out: BoundedContext[] = [];
  for (const sys of model.members) {
    if (!isSystem(sys)) continue;
    for (const sm of sys.members) {
      if (isSubdomain(sm)) out.push(...sm.contexts);
    }
  }
  return out;
}

const wrap = (body: string) => `
  system S {
    capability softDeletable { isDeleted: bool  filter this.isDeleted == false }
    subdomain D { context C {
      criterion BigOrders() of Order = this.total > 0
      aggregate Order with softDeletable { total: int }
      ${body}
    }}
  }
`;

/** The `let`-bound read of a `Sweep` workflow's create body. */
async function letRead(source: string): Promise<PostfixChain> {
  const { model } = await parseString(source, { validate: false });
  for (const c of contexts(model))
    for (const member of c.members)
      if (member.$type === "Workflow")
        for (const wm of member.members)
          if (wm.$type === "WorkflowCreateDecl")
            for (const stmt of wm.body)
              if (stmt.$type === "LetStmt" && isPostfixChain(stmt.expr)) return stmt.expr;
  throw new Error("no let-bound read");
}

const sweep = (read: string) =>
  wrap(`repository R for Order { }
      workflow Sweep {
        create(x: int) {
          let o = ${read}
        }
      }`);

describe("ignoring filter-bypass clause parses", () => {
  it("single-row read: `Repo.find(C) ignoring <Cap>` populates bypass and parses cleanly", async () => {
    const source = sweep("R.find(BigOrders()) ignoring softDeletable");
    expect(parseErrorsOf(source)).toEqual([]);
    const read = await letRead(source);
    expect(read.bypass).toEqual(["softDeletable"]);
    expect(read.bypassAll).toBe(false);
  });

  it("single-row read: `ignoring *` sets bypassAll", async () => {
    const read = await letRead(sweep("R.findById(x) ignoring *"));
    expect(read.bypassAll).toBe(true);
    expect(read.bypass).toEqual([]);
  });

  it("single-row read: comma-separated capability list", async () => {
    const read = await letRead(sweep("R.find(BigOrders()) ignoring softDeletable, auditable"));
    expect(read.bypass).toEqual(["softDeletable", "auditable"]);
  });

  it("inline read: `Repo.findAll(...) ignoring <Cap>` is a PostfixChain bypass", async () => {
    const source = wrap(`repository R for Order { }
      workflow Sweep {
        create(x: int) {
          let xs = R.findAll(BigOrders()) ignoring softDeletable
          for o in xs { }
        }
      }`);
    expect(parseErrorsOf(source)).toEqual([]);
    const { model } = await parseString(source, { validate: false });
    // Locate the let-bound PostfixChain.
    let found = false;
    for (const c of contexts(model))
      for (const member of c.members)
        if (member.$type === "Workflow")
          for (const wm of member.members)
            if (wm.$type === "WorkflowCreateDecl")
              for (const stmt of wm.body)
                if (stmt.$type === "LetStmt" && isPostfixChain(stmt.expr)) {
                  expect(stmt.expr.bypass).toEqual(["softDeletable"]);
                  found = true;
                }
    expect(found).toBe(true);
  });

  it("inline read: `Repo.findAll(...) ignoring *` sets bypassAll on the chain", async () => {
    const source = wrap(`repository R for Order { }
      workflow Sweep {
        create(x: int) {
          let ys = R.findAll(BigOrders()) ignoring *
          for o in ys { }
        }
      }`);
    const { model } = await parseString(source, { validate: false });
    let bypassAll = false;
    for (const c of contexts(model))
      for (const member of c.members)
        if (member.$type === "Workflow")
          for (const wm of member.members)
            if (wm.$type === "WorkflowCreateDecl")
              for (const stmt of wm.body)
                if (stmt.$type === "LetStmt" && isPostfixChain(stmt.expr))
                  bypassAll = stmt.expr.bypassAll;
    expect(bypassAll).toBe(true);
  });

  it("`ignoring` stays a soft keyword — a field named `ignoring` still parses", async () => {
    expect(
      parseErrorsOf(`system S { subdomain D { context C {
        aggregate Order { ignoring: bool }
      }}}`),
    ).toEqual([]);
  });
});
