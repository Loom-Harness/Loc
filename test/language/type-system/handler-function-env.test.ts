// The typing environment inside `commandHandler` / `queryHandler` bodies and
// block-bodied `function`s — found by the IR-vs-language type census (#3125).
//
// The same shape as the `DomainServiceOperation` gap #3040 closed: none of these
// is an `Operation`, so `envForNode` had no case for them. A handler bound no
// params and typed no lets; a block `function` bound its params but never typed
// the lets in its `block`. Every such receiver came back `unknown`, and because
// every type-based validator suppresses on `unknown`, every type gate failed open
// there. This pins the ENVIRONMENT (what each name resolves to) rather than a
// rendered string, and every gate case is two-position with an aggregate
// `operation` — where `envForNode` always worked — as the control, so a gate
// that fires nowhere cannot read as a pass.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import type { Model } from "../../../src/language/generated/ast.js";
import {
  isCommandHandler,
  isFunctionDecl,
  isLetStmt,
  isQueryHandler,
} from "../../../src/language/generated/ast.js";
import type { DddType } from "../../../src/language/type-system.js";
import { envForNode } from "../../../src/language/type-system.js";
import { parseString } from "../../_helpers/index.js";

function show(t: DddType | undefined): string {
  if (!t) return "(unbound)";
  switch (t.kind) {
    case "primitive":
      return `primitive:${t.name}`;
    case "id":
      return `id<${t.target.name}>`;
    case "aggregate":
      return `aggregate:${t.ref.name}`;
    case "optional":
      return `optional<${show(t.inner)}>`;
    case "array":
      return `array<${show(t.element)}>`;
    default:
      return t.kind;
  }
}

const SRC = `
  context Shop {
    aggregate Order with crudish {
      name: string
      qty: int
      function doubled(n: int): int {
        let d = n * 2
        return d
      }
    }
    repository Orders for Order {
      find byName(name: string): Order[] where this.name == name
    }
    commandHandler Archive(oid: Order id, label: string): int {
      let o = Orders.getById(oid)
      let all = Orders.byName(label)
      return all.count
    }
    queryHandler Lookup(oid: Order id): int {
      let o = Orders.getById(oid)
      return o.qty
    }
  }
`;

/** The env as seen from the first `let` inside the named callable. */
function envIn(model: Model, name: string) {
  for (const node of AstUtils.streamAllContents(model)) {
    const callable = isCommandHandler(node) || isQueryHandler(node) || isFunctionDecl(node);
    if (!callable || node.name !== name) continue;
    for (const inner of AstUtils.streamAllContents(node)) {
      if (isLetStmt(inner)) return envForNode(inner);
    }
    throw new Error(`'${name}' has no let`);
  }
  throw new Error(`'${name}' not found`);
}

describe("handler and function-block bodies: the typing environment", () => {
  it("the fixture is clean (the hole is that it validates with every receiver untyped)", async () => {
    expect((await parseString(SRC)).errors).toEqual([]);
  });

  it.each([
    // callable    name     expected
    ["Archive", "oid", "id<Order>"],
    ["Archive", "label", "primitive:string"],
    ["Archive", "o", "aggregate:Order"],
    ["Archive", "all", "array<aggregate:Order>"],
    ["Lookup", "oid", "id<Order>"],
    ["Lookup", "o", "aggregate:Order"],
    ["doubled", "n", "primitive:int"],
    ["doubled", "d", "primitive:int"],
  ])("%s binds '%s' to %s", async (callable, name, expected) => {
    const { model } = await parseString(SRC);
    expect(show(envIn(model, callable).resolve(name)?.type)).toBe(expected);
  });

  it("never leaves a handler or function-block binding unbound or unknown (regression guard)", async () => {
    const { model } = await parseString(SRC);
    const names: Record<string, string[]> = {
      Archive: ["oid", "label", "o", "all"],
      Lookup: ["oid", "o"],
      doubled: ["n", "d"],
    };
    for (const [callable, ns] of Object.entries(names)) {
      const env = envIn(model, callable);
      for (const n of ns) {
        const s = show(env.resolve(n)?.type);
        expect(s, `${callable}.${n}`).not.toBe("(unbound)");
        expect(s, `${callable}.${n}`).not.toBe("unknown");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The consequence: gates that failed open now reach these bodies.
// ---------------------------------------------------------------------------

const withMember = (where: "agg" | "cmd" | "qry", member: string) => `
  context Shop {
    aggregate Order with crudish {
      name: string
      qty: int
      operation probe(oid: Order id) {
        ${where === "agg" ? `let o = Orders.getById(oid)  if (o.${member} != null) { name := "x" }` : `name := "y"`}
      }
    }
    repository Orders for Order {
      find byName(name: string): Order[] where this.name == name
    }
    ${where === "cmd" ? `commandHandler Probe(oid: Order id): bool { let o = Orders.getById(oid)  return o.${member} != null }` : ""}
    ${where === "qry" ? `queryHandler Probe(oid: Order id): bool { let o = Orders.getById(oid)  return o.${member} != null }` : ""}
  }
`;

describe("handler bodies: the suppressed type gates now reach them", () => {
  it.each([
    "agg",
    "cmd",
    "qry",
  ] as const)("an invented member on a let-bound aggregate is rejected (%s)", async (where) => {
    const errors = (await parseString(withMember(where, "notAField"))).errors.join("\n");
    expect(errors).toMatch(/'notAField' is not a member of 'Order'/);
  });

  it.each([
    "agg",
    "cmd",
    "qry",
  ] as const)("a REAL member on the same binding stays clean (%s) — false-positive guard", async (where) => {
    expect((await parseString(withMember(where, "qty"))).errors).toEqual([]);
  });

  it("an invented member directly on a handler's own `Order id` PARAM is rejected", async () => {
    const src = `
      context Shop {
        aggregate Order with crudish { name: string  qty: int }
        repository Orders for Order { }
        commandHandler Probe(oid: Order id): bool { return oid.notAField != null }
      }`;
    expect((await parseString(src)).errors.join("\n")).toMatch(
      /'notAField' is not a member of 'Order'/,
    );
  });
});
