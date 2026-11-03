import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import {
  isInvariant,
  isPreconditionStmt,
  isProperty,
  type Model,
} from "../../../src/language/generated/ast.js";
import { buildLoomModel } from "../../_helpers/index.js";
import { parseString } from "../../_helpers/parse.js";

// Named rules (#4450): `invariant name: expr`, field `check name: expr`,
// `precondition name: expr`.  An expression never starts with `ID ':'`, so the
// name is told apart from the predicate by lookahead alone — the parse half of
// this file proves it on every position, including the predicates that DO
// start with a bare identifier.

const wrap = (body: string) => `
system S {
  subdomain Sales {
    context Cat {
      aggregate Product {
        ${body}
      }
      repository Products for Product { }
    }
  }
}
`;

const codes = async (src: string, code: string): Promise<number> =>
  (await parseString(src)).diagnostics.filter((d) => d.code === code).length;

describe("rule names — parsing", () => {
  it("parses a name before the predicate on all three rule kinds", async () => {
    const { model, errors, diagnostics } = await parseString(
      wrap(`name: string check nameRequired: name.length > 0
        stock: int
        flag: bool
        invariant stockNonNegative: stock >= 0
        invariant flag
        invariant flagged: flag
        operation sell(qty: int) {
          precondition inStock: qty <= stock
          precondition qty > 0
          stock := stock - qty
        }`),
    );
    expect(diagnostics.filter((d) => d.severity === 1)).toEqual([]);
    expect(errors).toEqual([]);
    const all = [...AstUtils.streamAllContents(model as Model)];
    const prop = all.find((n) => isProperty(n) && n.name === "name");
    expect(prop && isProperty(prop) ? prop.checkName : "?").toBe("nameRequired");
    const invs = all.filter(isInvariant).map((i) => [i.name, i.expr.$cstNode?.text]);
    // `invariant flag` is a bare-identifier predicate with NO name; the
    // following member (`invariant flagged: flag`) is not swallowed into it.
    expect(invs).toEqual([
      ["stockNonNegative", "stock >= 0"],
      [undefined, "flag"],
      ["flagged", "flag"],
    ]);
    const pres = all.filter(isPreconditionStmt).map((p) => [p.name, p.expr.$cstNode?.text]);
    expect(pres).toEqual([
      ["inStock", "qty <= stock"],
      [undefined, "qty > 0"],
    ]);
  });

  it("a bare-identifier check followed by the next field stays unnamed", async () => {
    const { model, errors } = await parseString(
      wrap(`active: bool check active
        count: int`),
    );
    expect(errors).toEqual([]);
    const props = [...AstUtils.streamAllContents(model as Model)]
      .filter(isProperty)
      .filter((p) => p.name === "active" || p.name === "count");
    expect(props.map((p) => [p.name, p.checkName])).toEqual([
      ["active", undefined],
      ["count", undefined],
    ]);
  });
});

describe("loom.rule-name-duplicate", () => {
  it("fires when an invariant and a field check share a name", async () => {
    expect(
      await codes(
        wrap(`sku: string check skuOk: sku.length > 0
        invariant skuOk: sku.length < 64`),
        "loom.rule-name-duplicate",
      ),
    ).toBe(1);
  });

  it("fires when a precondition reuses an invariant's name (one namespace per aggregate)", async () => {
    expect(
      await codes(
        wrap(`qty: int
        invariant positive: qty >= 0
        operation take(n: int) {
          precondition positive: n > 0
          qty := qty - n
        }`),
        "loom.rule-name-duplicate",
      ),
    ).toBe(1);
  });

  it("does not fire across owners", async () => {
    const src = `
system S {
  subdomain Sales {
    context Cat {
      valueobject Sku { code: string  invariant ok: code.length > 0 }
      aggregate Product { qty: int  invariant ok: qty >= 0 }
      repository Products for Product { }
    }
  }
}`;
    expect(await codes(src, "loom.rule-name-duplicate")).toBe(0);
  });
});

describe("loom.rule-message-removed", () => {
  it("errors on each removed clause, naming the rule and its locales line", async () => {
    const { diagnostics } = await parseString(
      wrap(`qty: int
        invariant qty >= 0 message "Quantity cannot be negative"`),
    );
    const hit = diagnostics.filter((d) => d.code === "loom.rule-message-removed");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.severity).toBe(1);
    expect(hit[0]!.message).toContain("invariant quantityCannotNegative: …");
    expect(hit[0]!.message).toContain(
      'locales/en/Cat.json as "Product.rule.quantityCannotNegative": "Quantity cannot be negative"',
    );
  });
});

describe("loom.rule-message-removed — suggested name for a blank message", () => {
  const hint = async (body: string): Promise<string> => {
    const { diagnostics } = await parseString(wrap(body));
    return diagnostics.find((d) => d.code === "loom.rule-message-removed")!.message;
  };

  it("derives an invariant's name from the first field it reads", async () => {
    const msg = await hint(`qty: int
        invariant qty >= 0 message ""`);
    expect(msg).toContain("invariant qtyValid: …");
    expect(msg).not.toContain("ruleRule");
  });

  it("derives a field check's name from the field", async () => {
    const msg = await hint(`qty: int check qty >= 0 message "  "`);
    expect(msg).toContain("qtyValid");
    expect(msg).not.toContain("ruleRule");
  });

  it("falls back to the rule's position when the expression names no field", async () => {
    const msg = await hint(`qty: int
        invariant true message ""`);
    expect(msg).toContain("invariant invariant1: …");
  });

  it("does not collide with a name the owner already declares", async () => {
    const msg = await hint(`qty: int
        invariant qtyValid: qty < 1000
        invariant qty >= 0 message ""`);
    expect(msg).toContain("invariant qtyValid2: …");
  });
});

describe("rule keys — lowering", () => {
  it("keys a named rule by identity and leaves an unnamed one keyless", async () => {
    const ir = await buildLoomModel(
      wrap(`qty: int
        invariant positive: qty >= 0
        invariant qty < 1000
        operation take(n: int) {
          precondition enoughStock: n <= qty
          qty := qty - n
        }`),
    );
    const agg = ir.systems[0]!.subdomains[0]!.contexts[0]!.aggregates[0]!;
    expect(agg.invariants.map((i) => i.message)).toEqual([
      { key: "Cat.Product.rule.positive", text: "Positive" },
      undefined,
    ]);
    const pre = agg.operations[0]!.statements[0]!;
    expect(pre.kind === "precondition" ? pre.message : "?").toEqual({
      key: "Cat.Product.rule.enoughStock",
      text: "Enough stock",
    });
  });
});
