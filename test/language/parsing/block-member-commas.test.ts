// G4 — commas between block members, in every block that has members.
//
// `event` and `payload` bodies have always accepted `a: string, b: int`
// (`EventDecl`: `(fields+=Property (','? fields+=Property)* ','?)?`).  The four
// rules that did NOT — `Aggregate`, `ValueObject`, `EntityPart`, `UserBlock` —
// rejected the same idiom with `Expecting token of type '}' but found ','`,
// which is a bad first-run experience for a separator the language uses
// everywhere else (deployable members, enum values, payload fields).  Worse,
// `README.md` and `docs/page-metamodel.md` already SHOWED the comma form.
//
// The change is separator-only: `','?` is optional in both directions, so the
// newline form is untouched and the comma form is not a different model.  The
// second half of this file is the part that matters — the two spellings must
// produce BYTE-IDENTICAL generated output, not merely both parse.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { parseString } from "../../_helpers/parse.js";

/**
 * One system exercising all four rules at once, with `SEP` standing in for the
 * member separator: `"\n"` is the historical spelling, `",\n"` the one G4 adds.
 *
 * Note the members deliberately span more than `Property`: an `entity` part, a
 * `contains`, a `derived`, an `invariant` and an `operation` all sit in the
 * aggregate, because the new `(','? members+=AggregateMember)*` shape applies to
 * the whole `AggregateMember` union — not just to fields — and a block-bodied
 * member followed by a comma is exactly where a naive edit would break.
 */
const shop = (sep: string): string => `
system Shop {
  user {
    id: string${sep}
    role: string
  }

  subdomain Sales {
    context Orders {
      valueobject Address {
        street: string${sep}
        city: string${sep}
        invariant street != ""
      }

      aggregate Order {
        customer: string${sep}
        total: money${sep}
        ship: Address${sep}
        entity Line {
          sku: string${sep}
          qty: int
        }${sep}
        contains lines: Line[]${sep}
        derived label: string = customer${sep}
        invariant customer != ""${sep}
        operation retitle(who: string) {
          customer := who
        }
      }

      repository Orders for Order { }
    }
  }

  storage db { type: postgres }
  resource st { for: Orders, kind: state, use: db }

  deployable api {
    platform: node,
    contexts: [Orders],
    dataSources: [st],
    port: 3000,
    auth: required
  }
}
`;

describe("G4 — comma separators between block members", () => {
  it("parses the newline form (unchanged)", async () => {
    const { errors } = await parseString(shop("\n"), { validate: true });
    expect(errors, `unexpected: ${errors.join("\n")}`).toEqual([]);
  });

  it("parses the comma form in aggregate / valueobject / entity / user bodies", async () => {
    const { errors } = await parseString(shop(",\n"), { validate: true });
    expect(errors, `unexpected: ${errors.join("\n")}`).toEqual([]);
  });

  it("accepts a trailing comma after the last member of each block", async () => {
    const src = `
system S {
  user { id: string, role: string, }
  subdomain D { context C {
    valueobject Money2 { amount: int, currency: string, }
    aggregate Thing {
      name: string,
      entity Part { code: string, },
      contains parts: Part[],
    }
    repository Things for Thing { }
  } }
  deployable api { platform: node, contexts: [C], port: 3000, auth: required }
}
`;
    const { errors } = await parseString(src, { validate: true });
    expect(errors, `unexpected: ${errors.join("\n")}`).toEqual([]);
  });

  it("accepts the two spellings MIXED inside one block", async () => {
    // `','?` is optional per gap, not a per-block mode — a model half-converted
    // by hand must not be a parse error.
    const src = `
system S {
  subdomain D { context C {
    aggregate Thing {
      a: string, b: int
      c: string, d: int
    }
    repository Things for Thing { }
  } }
  deployable api { platform: node, contexts: [C], port: 3000 }
}
`;
    const { errors } = await parseString(src, { validate: true });
    expect(errors, `unexpected: ${errors.join("\n")}`).toEqual([]);
  });

  it("emits BYTE-IDENTICAL output from the comma form and the newline form", async () => {
    const [newlines, commas] = await Promise.all([
      generateSystemFiles(shop("\n")),
      generateSystemFiles(shop(",\n")),
    ]);

    expect([...commas.keys()].sort()).toEqual([...newlines.keys()].sort());
    expect(newlines.size).toBeGreaterThan(10);

    const differing = [...newlines.keys()]
      .filter((path) => newlines.get(path) !== commas.get(path))
      .sort();
    expect(differing, `the separator changed emitted content in: ${differing.join(", ")}`).toEqual(
      [],
    );
  });
});
