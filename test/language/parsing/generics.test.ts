// Carrier-bounded generic payloads (payload-transport-layer.md, P3a).
// Grammar surface — ML-postfix instantiation with the blessed keyword
// constructor `paged` — plus the soft-keyword admission that keeps fields
// named `paged` / `envelope` parsing, the AST-level carrier-bound validator,
// and the refusal of the removed `envelope` carrier.

import { describe, expect, it } from "vitest";
import type { LspDiagnostic as Diagnostic } from "../../_helpers/diagnostics.js";
import { parseRawOk, parseString } from "../../_helpers/parse.js";

const errorCodes = (diags: Diagnostic[]): (string | number | undefined)[] =>
  diags.filter((d) => d.severity === 1).map((d) => d.code);

describe("generics — grammar (P3a)", () => {
  it("parses a single postfix carrier on a primitive (`string paged`)", () => {
    expect(parseRawOk(`context C { valueobject V { items: string paged } }`)).toBe(true);
  });

  it("parses a postfix carrier on an `X id` base (`Customer id paged`)", () => {
    expect(
      parseRawOk(`context C {
        aggregate Customer { name: string }
        valueobject V { refs: Customer id paged }
      }`),
    ).toBe(true);
  });

  it("parses array-outside-carrier (`string paged[]`)", () => {
    expect(parseRawOk(`context C { valueobject V { pages: string paged[] } }`)).toBe(true);
  });

  it("parses chained constructors (`string paged paged`)", () => {
    // Grammar admits nesting (forward-compatible); the carrier-bound
    // validator restricts it in v1 — see the validator suite below.
    expect(parseRawOk(`context C { valueobject V { x: string paged paged } }`)).toBe(true);
  });
});

describe("generics — soft-keyword admission (P3a)", () => {
  it("still allows a field named `paged`", () => {
    expect(parseRawOk(`context C { valueobject V { paged: int } }`)).toBe(true);
  });

  it("still allows a field named `envelope`", () => {
    expect(parseRawOk(`context C { valueobject V { envelope: string } }`)).toBe(true);
  });

  it("allows a `paged`-named field after an optional/array-suffixed field", () => {
    // The postfix ctor loop sits *before* the `?` / `[]` suffix, so an
    // optional-suffixed field cleanly terminates and the next `paged` token
    // is read as a new member name.
    expect(parseRawOk(`context C { valueobject V { a: int? paged: string } }`)).toBe(true);
    expect(parseRawOk(`context C { valueobject V { a: int[] envelope: string } }`)).toBe(true);
  });

  it("allows a `paged`-named field directly after a bare-type field", () => {
    // This position used to be the accepted, narrow cost of keyword-postfix
    // instantiation: `a: int paged: …` greedily read `paged` as a carrier on
    // `int` (`paged(int)`) and then choked on the `:`, so the carrier words
    // were only usable as field names when the PRECEDING field carried a `?` /
    // `[]` suffix.  Pairwise finding F4 showed the same swallow on the
    // `FieldAccess` modifiers (`secret`) and the `message "…"` clause, i.e. a
    // class rather than a one-off, and it is closed in the lexer:
    // `src/language/soft-keyword-colon-guard.ts` — a guarded soft keyword
    // immediately followed by `:` is an `ID`, never a keyword.  The cost is
    // therefore no longer paid, and no suffix/reordering workaround is needed.
    expect(parseRawOk(`context C { valueobject V { a: int paged: string } }`)).toBe(true);
    expect(parseRawOk(`context C { valueobject V { a: int envelope: string } }`)).toBe(true);
  });
});

describe("generics — carrier-bound validator (P3a)", () => {
  it("rejects nested carriers (`string paged paged`) with loom.generic-arg-not-carrier", async () => {
    const { diagnostics } = await parseString(`context C { response R { x: string paged paged } }`);
    expect(errorCodes(diagnostics)).toContain("loom.generic-arg-not-carrier");
  });

  it("accepts a single carrier in a transport position (payload field)", async () => {
    const { diagnostics } = await parseString(`context C { response R { items: string paged } }`);
    expect(errorCodes(diagnostics)).not.toContain("loom.generic-arg-not-carrier");
    expect(errorCodes(diagnostics)).not.toContain("loom.generic-position");
  });
});

describe("generics — position restriction (P3b)", () => {
  it("allows a carrier as a payload field", async () => {
    const { diagnostics } = await parseString(`context C { response R { items: string paged } }`);
    expect(errorCodes(diagnostics)).not.toContain("loom.generic-position");
  });

  it("allows a carrier as a queryHandler return (paged read exposed through the read-only port)", async () => {
    const { diagnostics } = await parseString(`context C {
      aggregate Order { region: string }
      repository Orders for Order
      criterion InRegion(rgn: string) of Order = region == rgn
      queryHandler ListInRegion(rgn: string): Order paged {
        let r = Orders.all(InRegion(rgn))
        return r
      }
    }`);
    expect(errorCodes(diagnostics)).not.toContain("loom.generic-position");
  });

  it("rejects a carrier as a stored aggregate/value-object field (loom.generic-position)", async () => {
    const { diagnostics } = await parseString(
      `context C { valueobject V { items: string paged } }`,
    );
    expect(errorCodes(diagnostics)).toContain("loom.generic-position");
  });
});

describe("generics — the removed `envelope` carrier", () => {
  it("still parses, so the refusal can name the replacement", () => {
    expect(parseRawOk(`context C { response R { e: string envelope } }`)).toBe(true);
  });

  it("is refused with loom.envelope-removed and nothing else", async () => {
    const { diagnostics } = await parseString(`context C { response R { e: string envelope } }`);
    expect(errorCodes(diagnostics)).toEqual(["loom.envelope-removed"]);
  });

  it("is refused in every position, alone (no position or nesting error beside it)", async () => {
    const { diagnostics } = await parseString(
      `context C { valueobject V { e: string envelope  p: string envelope paged } }`,
    );
    const codes = errorCodes(diagnostics);
    expect(codes.filter((c) => c === "loom.envelope-removed")).toHaveLength(2);
    expect(codes).not.toContain("loom.generic-arg-not-carrier");
    // `string envelope paged` is `string paged` — a carrier in a stored
    // position, refused as such.
    expect(codes.filter((c) => c === "loom.generic-position")).toHaveLength(1);
  });
});
