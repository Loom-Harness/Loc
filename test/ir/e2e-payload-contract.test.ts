// The e2e PAYLOAD contract — F4.
//
// `e2e-route-contract.test.ts` gates the VERB: does `api.<agg>.<verb>(…)`
// resolve to a route this same compilation emits.  A verb that routes can
// still carry a body the route will refuse, and until this gate landed the
// compiler said nothing about it.  Seven deliberate defects in one `test e2e`
// body on `main @ 9e03c0ff`, and the two it caught were both about the verb:
//
//   | probe                                         | before            |
//   |-----------------------------------------------|-------------------|
//   | unknown operation `noSuchOperation(w)`        | ✅ (twice — see below) |
//   | unknown aggregate `api.gadgets.create(…)`     | ✅                |
//   | misspelled create key (`kode` for `code`)     | ❌ silent         |
//   | misspelled operation key (`amt` for `amount`) | ❌ silent         |
//   | missing required field in a create body       | ❌ silent         |
//   | wrong scalar type (`qty: "not-a-number"`)     | ❌ silent         |
//   | read of a response field that does not exist  | ❌ silent         |
//
// The cost is not the round trip to find out.  It is that a NEGATIVE test
// passes for the WRONG REASON: `expect(api.widgets.create({ kode: "A" }))
// .toThrow(422)` is green because of the typo, not because of the domain rule
// it claims to prove.  Not hypothetical — `schedule(techId: …)` called with
// `{ technicianId: … }` generated, ran, and 422'd on an unknown field, with
// `0 error(s), 0 warning(s)` at compile time.
//
// NON-VACUITY is the whole risk here.  A gate that refused every body would
// pass every negative case below and turn all 74 corpus models red, so every
// `describe` carries its positive twin, and the shapes the corpus sweep proved
// must stay legal — a value object as a nested object literal, an enum as its
// wire STRING, a `datetime` as an ISO-8601 string, a `money(...)` literal, an
// `x.id` reference, an optional field omitted, a `bool` omitted (implicit
// default), a defaulted field omitted — each has a test of its own.

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { toLoomModel } from "../_helpers/ir.js";
import { parseString } from "../_helpers/parse.js";

/** A `Widget` with one field of every shape the payload gate reasons about,
 *  plus an operation to carry an operation-body probe. */
const sys = (body: string, opts: { extra?: string; agg?: string } = {}) => `
  system S {
    subdomain D {
      context Sales {
        enum Status { Draft, Placed }
        valueobject Money2 { amount: decimal currency: string }
        aggregate ${opts.agg ?? "Widget with crudish"} {
          code: string
          qty: int
          price: money
          status: Status
          cost: Money2
          openedAt: datetime
          active: bool
          note: string?
          tier: string = "basic"
          operation applyDiscount(amount: money) { price := amount }
          operation touch() { qty := qty + 1 }
          ${opts.extra ?? ""}
        }
        repository Widgets for Widget { }
      }
    }
    storage pg { type: postgres }
    resource st { for: Sales, kind: state, use: pg }
    deployable d {
      platform: node
      contexts: [Sales]
      dataSources: [st]
      port: 4000
    }
    test e2e "t" against d {
      ${body}
    }
  }
`;

/** Every create key this fixture requires — the baseline a positive case
 *  supplies so it is testing the thing it names and nothing else. */
const FULL = `code: "c", qty: 1, price: money("1.00"), status: "Draft", cost: { amount: 1, currency: "USD" }, openedAt: "2024-01-01T00:00:00Z"`;

async function codesFor(body: string, opts: { extra?: string; agg?: string } = {}) {
  const { model, errors } = await parseString(sys(body, opts));
  expect(errors).toEqual([]);
  return validateLoomModel(toLoomModel(model))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "<uncoded>");
}

async function messagesFor(body: string, opts: { extra?: string; agg?: string } = {}) {
  const { model, errors } = await parseString(sys(body, opts));
  expect(errors).toEqual([]);
  return validateLoomModel(toLoomModel(model))
    .filter((d) => d.severity === "error")
    .map((d) => d.message);
}

describe("e2e payload — an unknown key in a CREATE body", () => {
  it("refuses the misspelled key (probe 3)", async () => {
    expect(await codesFor(`let w = api.widgets.create({ kode: "A", ${FULL} })`)).toEqual([
      "loom.e2e-unknown-body-key",
    ]);
  });

  it("names the key, the aggregate, the 422 and the accepted keys", async () => {
    const [msg] = await messagesFor(`let w = api.widgets.create({ kode: "A", ${FULL} })`);
    expect(msg).toContain("'kode'");
    expect(msg).toContain("'Widget'");
    expect(msg).toContain("422");
    expect(msg).toContain("code, qty, price, status, cost, openedAt, active, note, tier");
  });

  it("ONE mistake, ONE diagnostic: a typo does not ALSO report the field it misspelled as missing", async () => {
    // `{ kode: … }` makes `code` absent as well.  Reporting both is one typo
    // described twice, and fixing the key resolves the other.
    expect(
      await codesFor(
        `let w = api.widgets.create({ kode: "A", qty: 1, price: money("1.00"), status: "Draft", cost: { amount: 1, currency: "USD" }, openedAt: "2024-01-01T00:00:00Z" })`,
      ),
    ).toEqual(["loom.e2e-unknown-body-key"]);
  });

  it("NON-VACUITY: the correctly spelled body is clean", async () => {
    expect(await codesFor(`let w = api.widgets.create({ ${FULL} })`)).toEqual([]);
  });
});

describe("e2e payload — an unknown key in an OPERATION body", () => {
  it("refuses the misspelled parameter (probe 4)", async () => {
    expect(
      await codesFor(
        `let w = api.widgets.create({ ${FULL} })  api.widgets.applyDiscount(w, { amt: money("1.00") })`,
      ),
    ).toEqual(["loom.e2e-unknown-body-key"]);
  });

  it("names the operation and its real parameter list", async () => {
    const [msg] = await messagesFor(
      `let w = api.widgets.create({ ${FULL} })  api.widgets.applyDiscount(w, { amt: money("1.00") })`,
    );
    expect(msg).toContain("api.widgets.applyDiscount(id, {…})");
    expect(msg).toContain("'amt'");
    expect(msg).toContain("Accepted keys: amount");
  });

  it("NON-VACUITY: the declared parameter is clean", async () => {
    expect(
      await codesFor(
        `let w = api.widgets.create({ ${FULL} })  api.widgets.applyDiscount(w, { amount: money("1.00") })`,
      ),
    ).toEqual([]);
  });

  it("NON-VACUITY: a zero-parameter operation may pass no body at all", async () => {
    expect(await codesFor(`let w = api.widgets.create({ ${FULL} })  api.widgets.touch(w)`)).toEqual(
      [],
    );
  });
});

describe("e2e payload — a missing required create field", () => {
  it("refuses the omission (probe 5)", async () => {
    expect(
      await codesFor(
        `let w = api.widgets.create({ code: "c", price: money("1.00"), status: "Draft", cost: { amount: 1, currency: "USD" }, openedAt: "2024-01-01T00:00:00Z" })`,
      ),
    ).toEqual(["loom.e2e-missing-required-field"]);
  });

  it("names the field and the rule that decides required-ness", async () => {
    const [msg] = await messagesFor(
      `let w = api.widgets.create({ code: "c", price: money("1.00"), status: "Draft", cost: { amount: 1, currency: "USD" }, openedAt: "2024-01-01T00:00:00Z" })`,
    );
    expect(msg).toContain("omits 'qty'");
    expect(msg).toContain("'f: T?'");
    expect(msg).toContain("= default");
    expect(msg).toContain("bare 'bool'");
  });

  it("NON-VACUITY: an OPTIONAL field may be omitted (`note: string?`)", async () => {
    expect(await codesFor(`let w = api.widgets.create({ ${FULL} })`)).toEqual([]);
  });

  it("NON-VACUITY: a bare `bool` may be omitted (the implicit default)", async () => {
    // `active: bool` is absent from FULL and must stay omittable — the
    // language-defined `false`.  This is the arm a required-set derived from
    // type nullability alone would get wrong.
    expect(await codesFor(`let w = api.widgets.create({ ${FULL} })`)).toEqual([]);
  });

  it('NON-VACUITY: an explicitly defaulted field may be omitted (`tier: string = "basic"`)', async () => {
    expect(await codesFor(`let w = api.widgets.create({ ${FULL} })`)).toEqual([]);
  });
});

describe("e2e payload — a literal of the wrong scalar type", () => {
  it("refuses a string for an `int` (probe 6)", async () => {
    expect(
      await codesFor(
        `let w = api.widgets.create({ ${FULL.replace("qty: 1", 'qty: "not-a-number"')} })`,
      ),
    ).toEqual(["loom.e2e-body-type-mismatch"]);
  });

  it("names what was sent, what was declared, and that the body is WIRE", async () => {
    const [msg] = await messagesFor(
      `let w = api.widgets.create({ ${FULL.replace("qty: 1", 'qty: "not-a-number"')} })`,
    );
    expect(msg).toContain(`the string "not-a-number"`);
    expect(msg).toContain("'qty'");
    expect(msg).toContain("declared 'int'");
    expect(msg).toContain("WIRE");
  });

  it("refuses an int for a `bool`", async () => {
    expect(await codesFor(`let w = api.widgets.create({ ${FULL}, active: 1 })`)).toEqual([
      "loom.e2e-body-type-mismatch",
    ]);
  });

  it("refuses an int for a `string`", async () => {
    expect(
      await codesFor(`let w = api.widgets.create({ ${FULL.replace('code: "c"', "code: 7")} })`),
    ).toEqual(["loom.e2e-body-type-mismatch"]);
  });

  // ---- the shapes the corpus sweep proved must stay legal ----

  it('NON-VACUITY: `money("1.00")` is a money literal, not a string', async () => {
    expect(await codesFor(`let w = api.widgets.create({ ${FULL} })`)).toEqual([]);
  });

  it("NON-VACUITY: a plain int is admissible for a `money` / `decimal`", async () => {
    expect(
      await codesFor(
        `let w = api.widgets.create({ ${FULL.replace('price: money("1.00")', "price: 5")} })`,
      ),
    ).toEqual([]);
  });

  it("NON-VACUITY: a `datetime` rides the wire as an ISO-8601 STRING", async () => {
    expect(await codesFor(`let w = api.widgets.create({ ${FULL} })`)).toEqual([]);
  });

  it("NON-VACUITY: a value object is a nested object literal, and its interior is not judged", async () => {
    expect(await codesFor(`let w = api.widgets.create({ ${FULL} })`)).toEqual([]);
  });

  it("NON-VACUITY: an `x.id` reference is not a literal and is left alone", async () => {
    expect(
      await codesFor(
        `let a = api.widgets.create({ ${FULL} })  let b = api.widgets.create({ ${FULL.replace('code: "c"', "code: a.id")} })`,
      ),
    ).toEqual([]);
  });
});

describe("e2e payload — an enum crosses the wire as its member STRING", () => {
  it("accepts the serialized member name", async () => {
    expect(
      await codesFor(
        `let w = api.widgets.create({ ${FULL.replace('status: "Draft"', 'status: "Placed"')} })`,
      ),
    ).toEqual([]);
  });

  it("refuses a string that is not a member, and lists the members", async () => {
    const [msg] = await messagesFor(
      `let w = api.widgets.create({ ${FULL.replace('status: "Draft"', 'status: "Shipped"')} })`,
    );
    expect(msg).toContain(`the string "Shipped"`);
    expect(msg).toContain("Members of 'Status': Draft, Placed");
  });

  it("does NOT duplicate `loom.e2e-unresolved-ref` for the BARE enum form", async () => {
    // `status: Placed` (no quotes) is already that check's business — it tells
    // the author to write the wire string.  A second complaint here would be
    // the same mistake twice.
    const codes = await codesFor(
      `let w = api.widgets.create({ ${FULL.replace('status: "Draft"', "status: Placed")} })`,
    );
    expect(codes).toEqual(["loom.e2e-unresolved-ref"]);
  });
});

describe("e2e payload — a response field the body cannot carry", () => {
  it("refuses the read (probe 7)", async () => {
    expect(
      await codesFor(
        `let w = api.widgets.create({ ${FULL} })  let g = api.widgets.getById(w)  expect(g.nonesuch).toBe("x")`,
      ),
    ).toEqual(["loom.e2e-unknown-response-field"]);
  });

  it("names the binding, the call behind it, and what IS readable", async () => {
    const [msg] = await messagesFor(
      `let w = api.widgets.create({ ${FULL} })  let g = api.widgets.getById(w)  expect(g.nonesuch).toBe("x")`,
    );
    expect(msg).toContain("'g.nonesuch'");
    expect(msg).toContain("api.widgets.getById(…)");
    expect(msg).toContain("'Widget'");
    expect(msg).toContain("undefined");
    expect(msg).toContain("Readable: id, code, qty");
  });

  it("reports a repeated read ONCE", async () => {
    expect(
      await codesFor(
        `let w = api.widgets.create({ ${FULL} })  let g = api.widgets.getById(w)  expect(g.nonesuch).toBe("x")  expect(g.nonesuch).toBe("y")`,
      ),
    ).toEqual(["loom.e2e-unknown-response-field"]);
  });

  it("NON-VACUITY: every declared field, the id and a derived field read clean", async () => {
    expect(
      await codesFor(
        `let w = api.widgets.create({ ${FULL} })  let g = api.widgets.getById(w)  expect(g.id).toBe(w.id)  expect(g.code).toBe("c")  expect(g.qty).toBe(1)  expect(g.note).toBe("n")  expect(g.doubled).toBe(2)`,
        { extra: "derived doubled: int = qty * 2" },
      ),
    ).toEqual([]);
  });

  it("NON-VACUITY: a read off a FIND result is not judged — its envelope is not derived here", async () => {
    // `all()` answers `{items,total}` for a list find and a bare row for a
    // unique-key one; this layer has no derivation for that split, so it stays
    // silent rather than guessing.  145 `all(...)` sites in the corpus depend
    // on it.
    expect(
      await codesFor(
        `let xs = api.widgets.all()  expect(xs.items.length).toBe(0)  expect(xs.total).toBe(0)`,
      ),
    ).toEqual([]);
  });
});

describe("e2e payload — the gate defers where it has no ground truth", () => {
  it("says nothing about a body whose verb does not ROUTE", async () => {
    // One mistake, one diagnostic: a body aimed at a route that does not exist
    // has no contract to be measured against.
    expect(await codesFor(`let w = api.widgets.create({ kode: "A" })`, { agg: "Widget" })).toEqual([
      "loom.e2e-unrouted-verb",
    ]);
  });

  it("says nothing about a `find`'s query arguments", async () => {
    // A find's argument is a QUERY string carrying an implicit pagination set
    // (`page`/`pageSize`/`sort`/`dir`) on top of the declared params.
    expect(
      await codesFor(
        `let xs = api.widgets.all({ page: 1, pageSize: 10, sort: "code", dir: "asc" })`,
      ),
    ).toEqual([]);
  });

  it("says nothing about a body that is not an object literal", async () => {
    expect(
      await codesFor(
        `let w = api.widgets.create({ ${FULL} })  let g = api.widgets.getById(w)  api.widgets.applyDiscount(w, g)`,
      ),
    ).toEqual([]);
  });
});
