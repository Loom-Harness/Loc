// `loom.create-field-type` (M-T6.18 gap #3) — the VALUE-type twin of the
// factory create-input NAME gate (`loom.create-unknown-field` /
// `loom.create-server-field`).  An `Agg.create({ field: value })` entry whose
// name IS a valid create-input field but whose value type mismatches
// (`Order.create({ qty: "abc" })` where `qty: int`) names a valid field, so the
// name gate passes it — then the emitted backend's create-input DTO fails its
// own tsc/gradle/mix.  Model-wide, so it fires wherever the call lives — test
// blocks, aggregate operations, and workflow `create`/`handle` bodies.

import { describe, expect, it } from "vitest";
import { lspCodes } from "../../_helpers/diagnostics.js";
import { parseString } from "../../_helpers/parse.js";

const sys = (body: string) => `
system Demo {
  subdomain S {
    context C {
      enum Status { Open, Done }
      aggregate Task with crudish {
        title: string
        qty: int
        price: money
        status: Status
        createdAt: datetime managed
        ${body}
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] port: 3000 }
}`;

async function codes(body: string): Promise<string[]> {
  const { diagnostics } = await parseString(sys(body), { validate: true });
  return lspCodes(diagnostics);
}

const TYPE = "loom.create-field-type";
const UNKNOWN = "loom.create-unknown-field";

describe("loom.create-field-type (factory create-input value types, M-T6.18)", () => {
  it("rejects a string value in an int create-input field", async () => {
    expect(
      await codes(
        'test "t" { let x = Task.create({ title: "a", qty: "oops", price: 0, status: Open }) }',
      ),
    ).toContain(TYPE);
  });

  it("is CLEAN when every entry value type matches", async () => {
    expect(
      await codes(
        'test "t" { let x = Task.create({ title: "a", qty: 3, price: 0, status: Open }) }',
      ),
    ).not.toContain(TYPE);
  });

  it("admits int-literal promotion into a money field", async () => {
    // `price: 5` (an int literal) into a `money` field — same ergonomic promotion
    // defaults / `:=` / construction values accept.
    expect(
      await codes(
        'test "t" { let x = Task.create({ title: "a", qty: 3, price: 5, status: Open }) }',
      ),
    ).not.toContain(TYPE);
  });

  it("does not add a type error for an UNKNOWN field name (name gate owns it)", async () => {
    const c = await codes(
      'test "t" { let x = Task.create({ title: "a", qty: 3, price: 0, status: Open, bogus: "x" }) }',
    );
    expect(c).toContain(UNKNOWN);
    expect(c).not.toContain(TYPE);
  });

  it("suppresses on an unresolvable (unknown) value", async () => {
    expect(
      await codes(
        'test "t" { let x = Task.create({ title: "a", qty: nope, price: 0, status: Open }) }',
      ),
    ).not.toContain(TYPE);
  });

  // The marquee case: the same factory call inside a WORKFLOW create body — a
  // site the statement walk never reaches, so this model-wide gate is what
  // catches it there.
  it("flags a wrong-typed create-input value inside a workflow `create` body", async () => {
    const { diagnostics } = await parseString(
      `
system Demo {
  subdomain S {
    context C {
      enum Status { Open, Done }
      aggregate Task with crudish {
        title: string
        qty: int
        status: Status
      }
      workflow W {
        create(label: string) {
          let o = Task.create({ title: "a", qty: "abc", status: Open })
        }
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] port: 3000 }
}`,
      { validate: true },
    );
    expect(lspCodes(diagnostics)).toContain(TYPE);
  });
});

// ---------------------------------------------------------------------------
// `loom.create-field-id-target` — the sibling the wire-family comparison above
// cannot make.
//
// The permissiveness of `loom.create-field-type` is deliberate and documented:
// a create call is the WIRE boundary, so a `string` literal standing in for a
// `datetime` / `guid` / `X id` is idiomatic and must pass.  It compares wire
// FAMILIES, and two ids both serialise as text — so passing a `B id` where an
// `A id` is declared sailed through with `0 error(s)`, in a production workflow,
// writing a row that points at the wrong table.  The same confusion in an
// assignment or a comparison was already caught precisely ("Cannot assign
// 'B id' to 'A id'"), which is what made the create hole worth its own arm:
// it is the one position where the wrong id is PERSISTED.
// ---------------------------------------------------------------------------

const ID_TARGET = "loom.create-field-id-target";

const twoAggregates = (call: string) => `
context C {
  aggregate A with crudish { code: string  derived display: string = code }
  aggregate B with crudish { label: string  derived display: string = label }
  aggregate R with crudish { a: A id  n: int  at: datetime  ref: guid }
  repository As for A { }
  repository Bs for B { }
  repository Rs for R { }
  workflow W {
    create(aid: A id, bid: B id, s: string) {
      ${call}
    }
  }
}`;

describe("loom.create-field-id-target — the wrong aggregate's id", () => {
  it("rejects a `B id` where the field declares `A id`", async () => {
    const { diagnostics } = await parseString(
      twoAggregates(`let r = R.create({ a: bid, n: 1, at: now(), ref: s })`),
      { validate: true },
    );
    expect(lspCodes(diagnostics)).toContain(ID_TARGET);
  });

  it("accepts the matching id", async () => {
    const { diagnostics } = await parseString(
      twoAggregates(`let r = R.create({ a: aid, n: 1, at: now(), ref: s })`),
      { validate: true },
    );
    expect(lspCodes(diagnostics)).not.toContain(ID_TARGET);
  });

  // The three wire coercions the gate above exists to permit.  If any of these
  // starts failing, the id arm has over-reached into the JSON boundary it was
  // explicitly carved out of.
  it("still accepts a plain string for an id, a datetime and a guid", async () => {
    const { diagnostics } = await parseString(
      twoAggregates(`let r = R.create({ a: s, n: 1, at: s, ref: s })`),
      { validate: true },
    );
    expect(lspCodes(diagnostics)).not.toContain(ID_TARGET);
    expect(lspCodes(diagnostics)).not.toContain(TYPE);
  });
});
