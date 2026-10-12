// Unknown-name suggestions at the AST layer (phase ④):
//
//   * `done: boolean` → `Unknown type 'boolean'.` used to stop there — `boolean`
//     is three edits from `bool`, past any sane typo threshold.  A table of the
//     spellings other languages use (`OTHER_LANGUAGE_TYPE_ALIASES`) answers
//     when edit distance finds nothing.
//   * The AST twins of the IR unknown-field diagnostics (`emit-unknown-field`,
//     `create-unknown-field`, `unknown-construction-field`) run first in
//     normal use, so they carry the same "Did you mean" as the IR ones.

import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import {
  OTHER_LANGUAGE_TYPE_ALIASES,
  primitiveTypeNames,
  typeAliasFor,
} from "../../src/language/type-catalogue.js";

const sys = (members: string, extra = "") => `
system S {
  subdomain M {
    context C {
      valueobject Addr { city: string }
      event Done { total: int }
      aggregate Task with crudish {
        title: string
        ${members}
      }
      repository Tasks for Task { }
      ${extra}
    }
  }
}`;

async function messages(src: string): Promise<string[]> {
  return (await validate(src)).diagnostics.map((d) => d.message);
}

describe("other-language type spellings", () => {
  it("`boolean` suggests `bool` and keeps the long field-type tail", async () => {
    const m = (await messages(sys("done: boolean"))).find((x) => x.includes("'boolean'"));
    expect(m).toContain("Unknown type 'boolean'. Did you mean 'bool'?");
    expect(m).toContain("Field types are: bool, datetime");
  });

  it("an ambiguous spelling offers both readings", async () => {
    const m = (await messages(sys("n: number"))).find((x) => x.includes("'number'"));
    expect(m).toContain("Did you mean 'int' or 'decimal'?");
  });

  it.each([
    ["integer", "int"],
    ["Boolean", "bool"],
    ["str", "string"],
    ["text", "string"],
    ["uuid", "guid"],
    ["timestamp", "datetime"],
    ["DateTime", "datetime"],
    ["double", "decimal"],
    ["bigint", "long"],
    ["object", "json"],
  ])("`%s` suggests `%s`", async (spelt, primitive) => {
    const m = (await messages(sys(`x: ${spelt}`))).find((x) => x.includes(`'${spelt}'`));
    expect(m).toContain(`Did you mean '${primitive}'?`);
  });

  it("a near miss still wins over the table (`strng` → `string`)", async () => {
    const m = (await messages(sys("x: strng"))).find((x) => x.includes("'strng'"));
    expect(m).toContain("Did you mean 'string'?");
  });

  it("an unrelated name gets no suggestion", async () => {
    const m = (await messages(sys("x: Zebra"))).find((x) => x.includes("'Zebra'"));
    expect(m).toContain("Unknown type 'Zebra'.  Field types are:");
  });

  it("every alias target is a real primitive keyword", () => {
    const primitives = new Set(primitiveTypeNames());
    for (const [alias, targets] of Object.entries(OTHER_LANGUAGE_TYPE_ALIASES)) {
      expect(alias).toBe(alias.toLowerCase());
      for (const t of targets) expect(primitives, `${alias} → ${t}`).toContain(t);
    }
    expect(typeAliasFor("nope")).toEqual([]);
  });
});

describe("AST unknown-field diagnostics suggest the nearest field", () => {
  it("loom.unknown-construction-field", async () => {
    const ms = await messages(sys('addr: Addr\n operation mv() { addr := Addr { cty: "x" } }'));
    expect(ms.find((m) => m.includes("has no field 'cty'"))).toContain("Did you mean 'city'?");
  });

  it("loom.create-unknown-field", async () => {
    const ms = await messages(
      sys("", "workflow W { create(x: string) { let t = Task.create({ titel: x }) } }"),
    );
    expect(ms.find((m) => m.includes("no create-input field 'titel'"))).toContain(
      "Did you mean 'title'?",
    );
  });

  it("loom.emit-unknown-field", async () => {
    const ms = await messages(sys("operation go() { emit Done { totl: 1 } }"));
    expect(ms.find((m) => m.includes("has no field 'totl'"))).toContain("Did you mean 'total'?");
  });
});
