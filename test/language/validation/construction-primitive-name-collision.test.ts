// F-014 (#2922) — a user record whose name COLLIDES with a walker primitive
// (`Money`, `Card`, `Table`, `Badge`, `Stack`, …) used to skip every record
// construction check.  `resolveRecordDecl` bailed out on `isWalkerPrimitive(name)`
// unconditionally, so `Money { amount: money("1.00") }` in an aggregate
// operation — `currency` omitted — validated clean and emitted
// `new Money(new Decimal("1.00"))` against a 2-arg constructor (TS2554).
//
// The skip is POSITION-dependent: a walker primitive is a primitive only inside
// a `ui` / page / component body, where the walker runs.  Everywhere else the
// name is an ordinary record.  These tests pin both halves — the checks fire in
// domain position, and page bodies are untouched.

import { describe, expect, it } from "vitest";
import { lspCodes } from "../../_helpers/diagnostics.js";
import { parseString } from "../../_helpers/parse.js";

const MISSING = "loom.construction-missing-field";
const UNKNOWN = "loom.unknown-construction-field";

/** A system whose context declares a record named `name` and an aggregate that
 *  constructs it in an `operation` — DOMAIN position, not a page body. */
const domainSrc = (name: string, ctor: string) => `
system Demo {
  subdomain S {
    context C {
      valueobject ${name} { amount: decimal  currency: string }
      aggregate T with crudish {
        m: ${name}
        operation o() { m := ${ctor} }
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] port: 3000 }
}`;

async function domainCodes(name: string, ctor: string): Promise<string[]> {
  const { diagnostics } = await parseString(domainSrc(name, ctor), { validate: true });
  return lspCodes(diagnostics);
}

/** The same record name, but constructed inside a PAGE body, where it is the
 *  walker primitive and carries the primitive's own argument surface. */
const pageSrc = (body: string) => `
system Demo {
  subdomain S {
    context C {
      valueobject Money { amount: decimal  currency: string }
      aggregate T with crudish { price: decimal }
    }
  }
  ui WebApp {
    page P {
      route: "/p"
      body: ${body}
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] port: 3000 }
  deployable web { platform: static, targets: api, ui: WebApp, port: 3001 }
}`;

async function pageCodes(body: string): Promise<string[]> {
  const { diagnostics } = await parseString(pageSrc(body), { validate: true });
  return lspCodes(diagnostics);
}

describe("F-014 — a record named after a walker primitive is still a record outside page bodies", () => {
  it("flags a missing required field on `Money` in an aggregate operation", async () => {
    expect(await domainCodes("Money", "Money { amount: 1.00 }")).toContain(MISSING);
  });

  it("flags an unknown field on `Money` in an aggregate operation", async () => {
    const codes = await domainCodes("Money", 'Money { amount: 1.00, currency: "USD", bogus: 3 }');
    expect(codes).toContain(UNKNOWN);
  });

  it("is CLEAN when the collision-named record is constructed completely", async () => {
    const codes = await domainCodes("Money", 'Money { amount: 1.00, currency: "USD" }');
    expect(codes).not.toContain(MISSING);
    expect(codes).not.toContain(UNKNOWN);
  });

  // The hole is a CLASS, not a `Money` special case: 18 of the 56 walker
  // primitive names are plausible domain records.  Each one must now be
  // checked in domain position.
  const PLAUSIBLE_RECORD_NAMES = [
    "Alert",
    "Avatar",
    "Badge",
    "Button",
    "Card",
    "Divider",
    "Empty",
    "Field",
    "Grid",
    "Image",
    "Modal",
    "Money",
    "Section",
    "Stack",
    "Stat",
    "Table",
    "Tabs",
    "Text",
  ] as const;

  it.each(
    PLAUSIBLE_RECORD_NAMES,
  )("flags a missing required field on a record named `%s`", async (name) => {
    expect(await domainCodes(name, `${name} { amount: 1.00 }`)).toContain(MISSING);
  });

  // ---- the other half: page bodies must NOT regress ----

  it("does not flag `Money { <expr> }` in a page body — it is the formatter primitive", async () => {
    const codes = await pageCodes("Money { 12.50 }");
    expect(codes).not.toContain(MISSING);
    expect(codes).not.toContain(UNKNOWN);
  });

  it("does not flag a primitive's own named args in a page body", async () => {
    // `currency:` is a Money-primitive arg, not a field of the user's record;
    // in page position neither check may reach it.
    const codes = await pageCodes('Money { 12.50, currency: "USD" }');
    expect(codes).not.toContain(MISSING);
    expect(codes).not.toContain(UNKNOWN);
  });

  it("does not flag a layout primitive nested in a page body", async () => {
    const codes = await pageCodes('Stack { Card { Text { "hi" } }, Divider { } }');
    expect(codes).not.toContain(MISSING);
    expect(codes).not.toContain(UNKNOWN);
  });
});
