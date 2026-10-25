// A type that does not exist must be refused as a TYPE, not as a broken link.
//
// `PrimitiveType` is a keyword alternation, so any other name falls through to
// `NamedType` and becomes a `[NamedDecl:ID]` cross-reference.  A mistyped or
// non-existent type therefore failed as an unresolved REFERENCE, with
// Langium's internal wording:
//
//     length: duration
//     main.ddd:6:13 error: Could not resolve reference to NamedDecl named 'duration'.
//
// `NamedDecl` is a grammar type with no presence in the language a user writes.
// The message did not say the position was a type, did not say which types
// exist, and offered nothing to try — for `strng` it did not even say
// `string`.  (`docs/language.md` does state there is no `duration` field type;
// the compiler did not.)
//
// The catalogue in the replacement is read off the loaded GRAMMAR, not
// restated beside it, so the next primitive added cannot leave the message
// quietly lying — which is the failure mode of every hand-maintained list in
// an error string.

import { describe, expect, it } from "vitest";
import { primitiveTypeNames } from "../../../src/language/type-catalogue.js";
import { extractErrors, parseString } from "../../_helpers/parse.js";

const SYS = (type: string, extra = "") => `system T {
  subdomain S { context C {
    ${extra}
    aggregate Doc { title: ${type}  derived display: string = "x" }
    repository Docs for Doc { }
  } }
  storage p { type: postgres }  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 }
}`;

async function errorsFor(type: string, extra = ""): Promise<string> {
  const { doc } = await parseString(SYS(type, extra));
  return extractErrors(doc.diagnostics).join("\n");
}

describe("an unknown type reports as a type, not as a dangling reference", () => {
  it("names the position and the catalogue, not `NamedDecl`", async () => {
    const e = await errorsFor("timespan");
    expect(e).toContain("Unknown type 'timespan'.");
    expect(e).toContain("Field types are:");
    // The internal wording that said nothing usable.
    expect(e).not.toContain("NamedDecl");
    expect(e).not.toContain("Could not resolve reference");
  });

  it("suggests the nearest type for a typo", async () => {
    expect(await errorsFor("strng")).toContain("Did you mean 'string'?");
  });

  it("suggests a DECLARED type too, not only a primitive", async () => {
    // The hint searches the user's own declarations, which is where most
    // mistyped type names actually point.
    const e = await errorsFor("Moneyy", "valueobject Money { amount: decimal }");
    expect(e).toContain("Did you mean 'Money'?");
  });

  it("offers no suggestion when nothing is close", async () => {
    // A wrong guess is worse than none: `timespan` is not a near miss of any
    // type, and claiming it is would send the reader down a dead end.
    expect(await errorsFor("timespan")).not.toContain("Did you mean");
  });

  it("the catalogue it prints is the grammar's, and is complete", async () => {
    const e = await errorsFor("timespan");
    const names = primitiveTypeNames();
    // Non-empty, or the derivation silently found no rule and the message
    // would be advertising an empty list.
    expect(names.length).toBeGreaterThan(5);
    for (const n of names) expect(e).toContain(n);
    // Spot-check against the grammar's actual alternation, so a derivation
    // that returned some *other* rule's keywords would fail here.
    expect(names).toContain("datetime");
    expect(names).toContain("money");
    expect(names).not.toContain("duration");
  });

  it("a NON-type unresolved reference keeps Langium's wording", async () => {
    // The rewrite is scoped to `NamedDecl`, the reference type both type
    // positions use.  Everything else — a missing ui, page, aggregate in a
    // `repository … for`, … — is untouched.
    const { doc } = await parseString(`system T {
      subdomain S { context C {
        aggregate Doc { title: string  derived display: string = "x" }
        repository Docs for Nope { }
      } }
      storage p { type: postgres }  resource r { for: C, kind: state, use: p }
      deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 }
    }`);
    const e = extractErrors(doc.diagnostics).join("\n");
    expect(e).toContain("Could not resolve reference to Aggregate named 'Nope'.");
    expect(e).not.toContain("Unknown type 'Nope'");
  });

  it("`duration` is named as expression-only, with the int-amount rewrite", async () => {
    // `duration` is a real expression type, so "Unknown type" read as a typo.
    const e = await errorsFor("duration");
    expect(e).toContain("'duration' cannot be written as a type");
    expect(e).toContain("exists only inside expressions");
    expect(e).toContain("Carry the amount as an 'int'");
    expect(e).not.toContain("Unknown type 'duration'");
  });
});

describe("an enum value in a variant-match arm points at the predicate form", () => {
  const SRC = `system T {
    subdomain S { context C {
      enum Priority { Low, Urgent }
      aggregate Ticket {
        priority: Priority
        derived display: string = "x"
        function slaHours(p: Priority): int = match p { Urgent => 4, Low => 48 }
      }
      repository Tickets for Ticket { }
    } }
  }`;

  it("explains on the first arm and points back from the later ones", async () => {
    const { doc } = await parseString(SRC);
    const errors = extractErrors(doc.diagnostics);
    expect(errors.filter((e) => e.includes("Unknown type"))).toEqual([]);
    const first = errors.filter((e) => e.includes("'Urgent' is a value of enum 'Priority'"));
    expect(first).toHaveLength(1);
    expect(first[0]).toContain("match { <subject> == Urgent =>");
    const later = errors.filter((e) => e.includes("'Low' is a value of enum 'Priority'"));
    expect(later).toHaveLength(1);
    expect(later[0]).toContain("see the first arm of this match");
  });

  it("the suggested predicate form validates", async () => {
    const { doc } = await parseString(
      SRC.replace("match p { Urgent => 4, Low => 48 }", "match { p == Urgent => 4, else => 48 }"),
    );
    expect(extractErrors(doc.diagnostics)).toEqual([]);
  });
});
