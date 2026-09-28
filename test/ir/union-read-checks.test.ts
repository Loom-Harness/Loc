// `loom.union-read-undiscriminated` (M-T5.1 A4) — an `or`-union value read
// straight through, without a variant `match`.
//
// A union find (`Order or NotFound`, `Order option`) and an `or`-returning
// operation bind ONE of their variants.  Reading `r.code` — or invoking
// `r.touch()` — without discriminating validated `0 error(s)` and emitted an
// unguarded dereference of a nullable on every backend (TS18047 on node,
// CS8602 on .NET, a 500 on java/python/elixir).  The negatives matter as much
// as the positives: a `match` arm's read of its own subject IS the
// discriminated read, and must stay legal.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

const sys = (body: string) => `
system S {
  subdomain D { context Shop {
    error NotFound { resource: string }
    aggregate Order with crudish {
      code: string
      operation touch() { code := code }
      operation locate(): Order or NotFound { return NotFound { resource: "Order" } }
    }
    aggregate Note with crudish { text: string }
    repository Orders for Order {
      find byCode(code: string): Order or NotFound where this.code == code
      find maybe(code: string): Order option where this.code == code
    }
    repository Notes for Note { }
${body}
  } }
}`;

async function flagged(body: string): Promise<string[]> {
  const { model } = await parseString(sys(body), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.code === "loom.union-read-undiscriminated")
    .map((d) => d.message);
}

describe("loom.union-read-undiscriminated", () => {
  it("refuses a member read straight through a union find in a workflow", async () => {
    const msgs = await flagged(`
    workflow label {
      create(code: string) {
        let r = Orders.byCode(code)
        let n = Note.create({ text: r.code })
      }
    }`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("'r.code'");
    expect(msgs[0]).toContain("Order | NotFound");
  });

  it("refuses the `option` spelling too — it is the same absence union", async () => {
    const msgs = await flagged(`
    workflow label {
      create(code: string) {
        let m = Orders.maybe(code)
        let n = Note.create({ text: m.code })
      }
    }`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("'m.code'");
  });

  it("refuses an operation invoked on a union-bound workflow local", async () => {
    const msgs = await flagged(`
    workflow label {
      create(code: string) {
        let r = Orders.byCode(code)
        r.touch()
      }
    }`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("'r.touch()'");
  });

  it("refuses the read in a domain-service body", async () => {
    const msgs = await flagged(`
    domainService Lookup {
      operation label(code: string): string {
        let r = Orders.byCode(code)
        return r.code
      }
    }`);
    expect(msgs).toHaveLength(1);
  });

  it("allows the discriminated read: a bound arm, and the subject read inside its own arm", async () => {
    const msgs = await flagged(`
    workflow label {
      create(code: string) {
        let r = Orders.byCode(code)
        let t = match r { Order o => o.code, NotFound => "missing" }
        let u = match r { Order => r.code, else => "missing" }
        let n = Note.create({ text: t })
      }
    }`);
    expect(msgs).toEqual([]);
  });

  it("still refuses a read of the subject OUTSIDE the arm that narrows it", async () => {
    // The guard is scoped to the arm's value: a read of `r` in the `else` of a
    // DIFFERENT match, or after the match, is not narrowed by it.
    const msgs = await flagged(`
    workflow label {
      create(code: string) {
        let r = Orders.byCode(code)
        let t = match r { Order o => o.code, NotFound => "missing" }
        let n = Note.create({ text: r.code })
      }
    }`);
    expect(msgs).toHaveLength(1);
  });

  it("allows a bare-aggregate find and getById — absence there is the 404 policy, not a value", async () => {
    const msgs = await flagged(`
    workflow label {
      create(code: string, id: Order id) {
        let o = Orders.getById(id)
        o.touch()
        let n = Note.create({ text: o.code })
      }
    }`);
    expect(msgs).toEqual([]);
  });
});
