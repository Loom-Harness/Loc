// RS-36 / D-FIRST-ON-EMPTY — `.first` is PARTIAL on every backend, `.firstOrNull`
// is the total form.
//
// `src/util/collection-ops.ts` declares `first` as returning a NON-OPTIONAL `T`.
// Three backends already honoured that by failing at the point of the mistake
// (dotnet `.First()` → InvalidOperationException, java `.get(0)` →
// IndexOutOfBoundsException, python `[0]` → IndexError) and two did not: node
// rendered a bare `[0]` (`undefined`, which then ships on the wire) and elixir
// rendered `List.first/1` for BOTH ops — literally the same snippet, so the
// non-optional form had no distinct meaning at all (ledger `F2-EXPR-7`).
//
// This pins the two halves the contract actually needs, per backend:
//
//   1. the `first` rendering can FAIL on an empty receiver, and
//   2. `first` and `firstOrNull` are DIFFERENT renderings
//
// — (2) is what catches the elixir shape, which (1) alone cannot: `List.first`
// satisfies no raise and reads as a plausible implementation of either op.
//
// The renderer tables are asserted directly rather than through a generated
// project because the divergence is a LEAF, and a leaf table is where a future
// backend would reintroduce it.

import { describe, expect, it } from "vitest";
import { CS_COLLECTION_RENDERERS } from "../../src/generator/dotnet/render-expr.js";
import { ELIXIR_COLLECTION_RENDERERS } from "../../src/generator/elixir/render-expr.js";
import { JAVA_COLLECTION_RENDERERS } from "../../src/generator/java/render-expr.js";
import { PY_COLLECTION_RENDERERS } from "../../src/generator/python/render-expr.js";
import { TS_COLLECTION_RENDERERS } from "../../src/generator/typescript/render-expr.js";
import { COLLECTION_OP_SIGNATURES } from "../../src/util/collection-ops.js";

type Renderer = (recv: string, args: string[], e?: unknown) => string;

const TABLES: Record<string, Record<string, Renderer>> = {
  node: TS_COLLECTION_RENDERERS as Record<string, Renderer>,
  dotnet: CS_COLLECTION_RENDERERS as Record<string, Renderer>,
  java: JAVA_COLLECTION_RENDERERS as Record<string, Renderer>,
  python: PY_COLLECTION_RENDERERS as Record<string, Renderer>,
  elixir: ELIXIR_COLLECTION_RENDERERS as Record<string, Renderer>,
};

/** The native construct on each backend that FAILS rather than yielding a
 *  null-ish value.  An expected value from OUTSIDE the emitter: each of these
 *  is named in D-FIRST-ON-EMPTY, and each is the language's own documented
 *  raising form — not whatever the table happens to say. */
const RAISES_ON_EMPTY: Record<string, RegExp> = {
  // An explicit guard: a bare `[0]` is `undefined`, so node has to add one.
  node: /length === 0[\s\S]*throw new Error/,
  // `List<T>.First()` — InvalidOperationException on an empty sequence
  // (`FirstOrDefault()` is the total form and must NOT appear here).
  dotnet: /\.First\(\)/,
  // `List.get(0)` — IndexOutOfBoundsException.
  java: /\.get\(0\)/,
  // `seq[0]` — IndexError.
  python: /\[0\]/,
  // `hd/1` — ArgumentError on `[]` (`List.first/1` returns nil and is the
  // total form).
  elixir: /^hd\(/,
};

const RECV = "__recv";

describe("RS-36 — `.first` is partial, `.firstOrNull` is total (D-FIRST-ON-EMPTY)", () => {
  it("the catalogue still declares the two arities this rule rests on", () => {
    // Vacuity guard: the whole rule is "the DECLARED type is non-optional".
    // If someone flips `first` to `T?` these assertions must be revisited, not
    // silently satisfied.
    const sig = (n: string) => COLLECTION_OP_SIGNATURES.find((o) => o.name === n)?.signature;
    expect(sig("first"), "`first` must stay non-optional — RS-36 rests on it").toBe("T");
    expect(sig("firstOrNull")).toBe("T?");
  });

  for (const [backend, table] of Object.entries(TABLES)) {
    it(`${backend}: \`first\` renders a form that FAILS on an empty receiver`, () => {
      const rendered = table.first?.(RECV, []);
      expect(rendered, `${backend} has no \`first\` renderer`).toBeTypeOf("string");
      expect(
        rendered,
        `${backend} renders \`first\` as '${rendered}', which does not fail on an empty ` +
          `receiver — RS-36 requires the read to fail at the point of the mistake rather ` +
          `than hand back a value that lies about its declared non-optional type`,
      ).toMatch(RAISES_ON_EMPTY[backend]!);
    });

    it(`${backend}: \`first\` and \`firstOrNull\` are DIFFERENT renderings`, () => {
      const first = table.first?.(RECV, []);
      const orNull = table.firstOrNull?.(RECV, []);
      expect(orNull, `${backend} has no \`firstOrNull\` renderer`).toBeTypeOf("string");
      expect(
        first,
        `${backend} renders \`first\` and \`firstOrNull\` identically ('${first}') — the ` +
          `partial and the total form cannot be the same snippet, which is exactly the ` +
          `elixir defect F2-EXPR-7 recorded (both were \`List.first/1\`)`,
      ).not.toBe(orNull);
    });

    it(`${backend}: \`firstOrNull\` stays TOTAL (no raising form)`, () => {
      const orNull = table.firstOrNull?.(RECV, []) ?? "";
      expect(
        orNull,
        `${backend} renders \`firstOrNull\` as '${orNull}' — the total form must not raise`,
      ).not.toMatch(/throw new Error|^hd\(|\.First\(\)/);
    });
  }

  it("node evaluates the receiver exactly once", () => {
    // A `recv.length > 0 ? recv[0] : throw` ternary would emit the whole
    // receiver CHAIN twice (`o.lines.filter(...)` and every hook call inside a
    // frontend body), so the guard is an IIFE taking the receiver as a
    // parameter.  Pinned because the obvious refactor breaks it silently.
    const rendered = TS_COLLECTION_RENDERERS.first?.("o.lines.filter(f)", []) ?? "";
    const occurrences = rendered.split("o.lines.filter(f)").length - 1;
    expect(
      occurrences,
      `node's \`first\` guard names the receiver ${occurrences} times: '${rendered}'`,
    ).toBe(1);
  });

  it("the failure message names the total form", () => {
    const rendered = TS_COLLECTION_RENDERERS.first?.(RECV, []) ?? "";
    expect(rendered).toContain("firstOrNull");
  });
});
