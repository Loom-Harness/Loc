// `X id` must name an identity — an aggregate (abstract bases included) or an
// entity part.  Every other declaration a type position can name (value
// object, enum, event, payload record, workflow) has no id, so `Pt id` is
// `loom.id-target-not-identity`, reported by `checkIdTargets`
// (src/language/validators/structural.ts) at the reference, naming the kind.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/index.js";

const CODE = "loom.id-target-not-identity";

const ctx = (members: string) => `
  system S { subdomain M { context C {
    ${members}
  } } }
`;

async function idTargetDiags(source: string) {
  const { diagnostics, errors } = await parseString(source);
  return {
    hits: diagnostics.filter((d) => d.code === CODE),
    errors,
  };
}

describe("`X id` resolves only to an identity", () => {
  it.each([
    ["an aggregate", "aggregate Customer { name: string }  aggregate R { c: Customer id }"],
    [
      "an abstract aggregate",
      "abstract aggregate Party { name: string }  aggregate Person extends Party { age: int }  aggregate R { p: Party id }",
    ],
    [
      "an entity part",
      "aggregate Order { n: int  entity Line { q: int } }  aggregate R { l: Line id }",
    ],
    [
      "an entity part of its own aggregate",
      "aggregate Order { n: int  entity Line { q: int }  first: Line id? }",
    ],
    [
      "a collection of aggregate ids",
      "aggregate Tag { n: string }  aggregate R { tags: Tag id[] }",
    ],
  ])("accepts %s", async (_label, members) => {
    const { hits, errors } = await idTargetDiags(ctx(members));
    expect(hits, errors.join("\n")).toEqual([]);
  });

  it("leaves the entity-part ambiguity check in charge of a shared part name", async () => {
    const { hits, errors } = await idTargetDiags(
      ctx(`aggregate A { x: int  entity Line { a: int } }
           aggregate B { y: int  entity Line { b: int } }
           aggregate D { l: Line id }`),
    );
    expect(hits).toEqual([]);
    expect(errors.some((e) => /Ambiguous entity-part reference 'Line id'/.test(e))).toBe(true);
  });

  it("prefers the aggregate when another declaration shares its name", async () => {
    // An event named like the aggregate must not hijack the `X id` link.
    const { hits, errors } = await idTargetDiags(`
      system S {
        subdomain M { context C { aggregate Order { n: int } } }
        subdomain N { context D { event Order { at: datetime }  aggregate R { o: Order id } } }
      }
    `);
    expect(hits, errors.join("\n")).toEqual([]);
  });

  it.each([
    [
      "a value object",
      "valueobject Pt { x: int }  aggregate R { p: Pt id }",
      "Pt",
      "a value object",
      true,
    ],
    ["an enum", "enum Color { red, green }  aggregate R { c: Color id }", "Color", "an enum", true],
    [
      "an event",
      "event Placed { at: datetime }  aggregate R { e: Placed id }",
      "Placed",
      "an event",
      false,
    ],
    [
      "a command payload",
      "command PlaceOrder { qty: int }  aggregate R { c: PlaceOrder id }",
      "PlaceOrder",
      "a command",
      false,
    ],
    [
      "an error payload",
      "error NotFound { what: string }  aggregate R { e: NotFound id }",
      "NotFound",
      "an error",
      false,
    ],
    [
      "a workflow",
      "aggregate O { n: int }  workflow W { create(id: O id) { } }  aggregate R { w: W id }",
      "W",
      "a workflow",
      false,
    ],
  ])("rejects %s, naming the kind", async (_label, members, name, kind, valueHint) => {
    const { hits, errors } = await idTargetDiags(ctx(members));
    expect(hits, errors.join("\n")).toHaveLength(1);
    const raw = hits[0]!.message;
    const msg = typeof raw === "string" ? raw : raw.value;
    expect(msg).toContain(`'${name} id' names ${kind} '${name}'`);
    expect(msg).toContain("only aggregates and entity parts carry an id");
    expect(msg.includes(`hold the value itself: '${name}'`)).toBe(valueHint);
    expect(hits[0]!.severity).toBe(1);
  });

  it("rejects the element of an id collection and an optional id", async () => {
    const { hits } = await idTargetDiags(
      ctx("valueobject Pt { x: int }  aggregate R { ps: Pt id[]  q: Pt id? }"),
    );
    expect(hits).toHaveLength(2);
  });

  it("rejects a non-identity target outside an aggregate (operation / workflow param)", async () => {
    const { hits } = await idTargetDiags(
      ctx(`enum Color { red }
           aggregate R { n: int  operation paint(c: Color id) { n := 1 } }
           workflow W { create(c: Color id) { } }`),
    );
    expect(hits).toHaveLength(2);
  });
});
