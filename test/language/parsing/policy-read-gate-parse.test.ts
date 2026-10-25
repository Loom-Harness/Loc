// Parsing: `policy { read <Aggregate> requires <expr> }` — who may read an
// aggregate — and the removal of the `requires` clause from repository finds.
// `read` is NOT a keyword: it heads a rule inside `policy { }` as an identifier
// (pinned by `loom.policy-unknown-rule`) and stays an ordinary name everywhere
// else — a permission, an operation, a field, a `let`.

import { describe, expect, it } from "vitest";
import type { Model, PolicyDecl } from "../../../src/language/generated/ast.js";
import { isPolicyDecl, isSubdomain, isSystem } from "../../../src/language/generated/ast.js";
import { printStructural } from "../../../src/language/print/index.js";
import { parseErrorsOf, parseString } from "../../_helpers/index.js";

/** The first `policy { … }` block declared anywhere in the parsed model. */
function firstPolicy(model: Model): PolicyDecl {
  for (const sys of model.members) {
    if (!isSystem(sys)) continue;
    for (const sm of sys.members) {
      if (!isSubdomain(sm)) continue;
      for (const c of sm.contexts) {
        for (const member of c.members) if (isPolicyDecl(member)) return member;
      }
    }
  }
  throw new Error("no policy block in model");
}

const wrap = (members: string) => `system Sys {
  user { id: string  role: string }
  subdomain S {
    context Tickets {
      aggregate Ticket { subject: string  open: bool }
      aggregate Product { name: string }
      repository Tickets for Ticket {
        find openOnes(): Ticket[] where open == true
      }
      ${members}
    }
  }
}`;

describe("policy read gate parsing", () => {
  it("parses `read X requires <expr>` beside the allow/deny ladder", async () => {
    const src = wrap(`policy {
        deny write on Product
        read Ticket requires currentUser.role == "agent"
        read Product requires true
      }`);
    expect(parseErrorsOf(src)).toEqual([]);
    const { model } = await parseString(src, { validate: false });
    const rules = firstPolicy(model).rules;
    expect(rules.map((r) => [r.effect, r.target])).toEqual([
      ["deny", "Product"],
      ["read", "Ticket"],
      ["read", "Product"],
    ]);
    expect(rules[1]!.gate).toBeDefined();
    expect(rules[1]!.level).toBeUndefined();
  });

  it("prints the rule back to the same source", async () => {
    const { model } = await parseString(
      wrap('policy { read Ticket requires currentUser.role == "agent" }'),
      { validate: false },
    );
    expect(printStructural(firstPolicy(model))).toContain(
      'read Ticket requires currentUser.role == "agent"',
    );
  });

  it("refuses any other rule head word (loom.policy-unknown-rule)", async () => {
    const { diagnostics } = await parseString(wrap("policy { view Ticket requires true }"));
    expect(diagnostics.some((d) => d.code === "loom.policy-unknown-rule")).toBe(true);
  });

  it("keeps `read` an ordinary identifier outside the policy block", () => {
    const src = `system Sys {
  user { id: string  role: string  permissions: string[] }
  subdomain S {
    permissions { read, edit }
    context Tickets {
      aggregate Ticket {
        read: bool
        operation touch(read: bool) { let read2 = read  read := read2 }
        operation read() requires currentUser.permissions.contains(permissions.read) { }
      }
    }
  }
}`;
    expect(parseErrorsOf(src)).toEqual([]);
  });

  it("a repository find no longer takes a `requires` clause — the error names the policy line", async () => {
    const src = wrap("").replace(
      "find openOnes(): Ticket[] where open == true",
      'find openOnes(): Ticket[] requires currentUser.role == "agent" where open == true',
    );
    expect(parseErrorsOf(src).length).toBeGreaterThan(0);
    const { errors } = await parseString(src);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("policy { read Ticket requires <expr> }");
    expect(errors[0]).toContain("codemod-find-gate-to-policy");
  });
});
