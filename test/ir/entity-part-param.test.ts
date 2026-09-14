// -------------------------------------------------------------------------
// M-T5.34 / #2864 D6, fleet-plan decision D-2 —
// `loom.entity-part-param-unsupported`.
//
// An entity-part-typed parameter on a public action has no wire
// materialization on any backend (node emits `z.array(z.unknown())` + an
// identity map; dotnet/java/python don't compile).  D-2 rejects it rather than
// guessing at the replace-vs-merge identity question in an emitter.
//
// The tests below pin the REJECTION and, just as importantly, all three
// boundaries — because each one was verified against the emitters rather than
// assumed, and a widened gate here would break working models.
// -------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

const CODE = "loom.entity-part-param-unsupported";

async function codesFor(source: string): Promise<string[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => d.code ?? "");
}

async function messageFor(source: string): Promise<string> {
  const { model } = await parseString(source, { validate: false });
  return (
    validateLoomModel(enrichLoomModel(lowerModel(model))).find((d) => d.code === CODE)?.message ??
    ""
  );
}

const wrap = (ctxBody: string) => `
system S {
  subdomain D { context Ops {
${ctxBody}
    repository Orders for Order { }
  } }
}`;

const entityCollectionParam = wrap(`
    aggregate Order {
      ref: string
      lines: Line[]
      entity Line { sku: string  qty: int }
      operation replaceLines(newLines: Line[]) { lines := newLines }
    }`);

// The alternative the diagnostic recommends.  Verified on fresh main to emit
// `z.array(LineSchema)` + `new Line(e.sku, e.qty)` — i.e. the advice works.
const valueObjectParam = wrap(`
    valueobject Line { sku: string  qty: int }
    aggregate Order {
      ref: string
      lines: Line[]
      operation replaceLines(newLines: Line[]) { lines := newLines }
    }`);

describe("loom.entity-part-param-unsupported", () => {
  it("rejects an entity-part COLLECTION parameter", async () => {
    expect(await codesFor(entityCollectionParam)).toContain(CODE);
  });

  it("rejects a SCALAR entity-part parameter too", async () => {
    const scalar = wrap(`
    aggregate Order {
      ref: string
      head: Head
      entity Head { note: string }
      operation setHead(h: Head) { head := h }
    }`);
    expect(await codesFor(scalar)).toContain(CODE);
  });

  it("the value-object spelling — the advice the message gives — passes", async () => {
    expect(await codesFor(valueObjectParam)).not.toContain(CODE);
  });

  it("points at the value-object alternative by name", async () => {
    const msg = await messageFor(entityCollectionParam);
    expect(msg).toContain("valueobject");
    expect(msg).toContain("Line");
    expect(msg).toContain("newLines");
  });

  // --- the three boundaries, each verified against the emitters -----------

  it("BOUNDARY: a `private` operation never crosses the wire, so it is not judged", async () => {
    const priv = wrap(`
    aggregate Order {
      ref: string
      lines: Line[]
      entity Line { sku: string  qty: int }
      private operation replaceLines(newLines: Line[]) { lines := newLines }
    }`);
    expect(await codesFor(priv)).not.toContain(CODE);
  });

  it("BOUNDARY: a declared `create`'s parameter list is not the request contract", async () => {
    // The create input is derived from the aggregate's FIELDS, where a
    // containment already emits `<Part>Response` correctly.  Gating the create
    // position here would reject a model that generates fine (and it is #2861's
    // finding, not this packet's).
    const create = wrap(`
    aggregate Order {
      ref: string
      lines: Line[]
      entity Line { sku: string  qty: int }
      create(ref: string, lines: Line[]) { }
    }`);
    expect(await codesFor(create)).not.toContain(CODE);
  });

  it("BOUNDARY: a payload/command param also lowers to `entity` and must NOT be caught", async () => {
    // #2886 emits wire types for payload-typed params; they need no ruling.
    // The discriminator is "the name is an entity PART of the aggregate".
    const payload = wrap(`
    command Reprice { factor: int }
    aggregate Order {
      ref: string
      total: int
      operation reprice(c: Reprice) { total := total * c.factor }
    }`);
    expect(await codesFor(payload)).not.toContain(CODE);
  });

  it("an aggregate with parts but no part-typed parameter is untouched", async () => {
    const clean = wrap(`
    aggregate Order {
      ref: string
      lines: Line[]
      entity Line { sku: string  qty: int }
      operation rename(name: string) { ref := name }
    }`);
    expect(await codesFor(clean)).not.toContain(CODE);
  });
});
