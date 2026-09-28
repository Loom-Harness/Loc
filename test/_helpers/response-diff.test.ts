import { describe, expect, it } from "vitest";
import {
  type BackendCapture,
  DEFAULT_NORMALIZE,
  diffAllPairs,
  diffBodies,
  type Json,
  normalizeBody,
  renderReport,
} from "./response-diff.js";

/** normalize then diff — the runner's exact pipeline. */
const nd = (a: Json, b: Json) => diffBodies(normalizeBody(a), normalizeBody(b));

describe("response-diff", () => {
  describe("normalizeBody", () => {
    it("collapses uuids and ISO timestamps to tokens (per-run variance silenced)", () => {
      const body: Json = {
        id: "a1b2c3d4-0000-4000-8000-000000000000",
        placedAt: "2026-07-21T10:00:00.123Z",
      };
      expect(normalizeBody(body)).toEqual({ id: "<volatile:key>", placedAt: "<timestamp>" });
    });
    it("collapses both CANONICAL spellings (RS-38) — a whole second and exactly three digits", () => {
      // The per-run VALUE is silenced: a `now()` stamp lands on a whole second
      // one time in a thousand, and that is not a divergence.
      expect(nd({ at: "2026-07-21T10:00:00.123Z" }, { at: "2026-07-21T10:00:00Z" })).toEqual([]);
      expect(nd({ at: "2026-07-21T10:00:00.120Z" }, { at: "2026-07-21T11:59:59.999Z" })).toEqual(
        [],
      );
    });
    it("keeps a NON-canonical spelling verbatim, so the FORM divergence surfaces (F2-W-06)", () => {
      // Every one of these is the same instant a canonical `.120Z` names, and
      // every one shipped from some backend through a green gate while the
      // regex tolerated them all.
      for (const spelling of [
        "2026-07-21T10:00:00.12Z", // node's old minimal trim
        "2026-07-21T10:00:00.120000Z", // python isoformat, elixir :utc_datetime_usec
        "2026-07-21T10:00:00.1200000Z", // .NET "o"
        "2026-07-21T10:00:00.000Z", // an unconditional three digits on a whole second
        "2026-07-21T10:00:00+00:00", // an offset instead of Z
        "2026-07-21 10:00:00", // a space separator, no zone
      ]) {
        expect(normalizeBody({ at: spelling })).toEqual({ at: spelling });
        const [d] = nd({ at: "2026-07-21T10:00:00.120Z" }, { at: spelling });
        expect(d).toMatchObject({ kind: "value", path: "$.at" });
      }
    });
    it("keeps keys — a MISSING volatile key still surfaces (absence is contract)", () => {
      const withKey: Json = { id: "a1b2c3d4-0000-4000-8000-000000000000", name: "x" };
      const without: Json = { name: "x" };
      const [d] = nd(withKey, without);
      expect(d.kind).toBe("key-set");
      expect(d.path).toBe("$.id");
    });
    it("sorts object keys so key order never registers as a difference", () => {
      expect(normalizeBody({ b: 1, a: 2 })).toEqual(normalizeBody({ a: 2, b: 1 }));
    });
    it("does not touch a non-volatile string that merely looks enum-ish", () => {
      expect(normalizeBody({ status: "pending" })).toEqual({ status: "pending" });
    });
  });

  describe("diffBodies — the divergence taxonomy", () => {
    it("enum casing: pending ≠ PENDING (the RS-2 class)", () => {
      const [d] = nd({ status: "pending" }, { status: "PENDING" });
      expect(d).toMatchObject({
        kind: "enum-casing",
        path: "$.status",
        a: "pending",
        b: "PENDING",
      });
    });
    it("empty collection vs null: [] ≠ null (the RS-8/absence class)", () => {
      const [d] = nd({ lines: [] }, { lines: null });
      expect(d).toMatchObject({ kind: "null-vs-empty", path: "$.lines" });
    });
    it("the full earlier example: two real divergences, timestamps/ids silenced", () => {
      const hono: Json = {
        id: "aaaaaaaa-0000-4000-8000-000000000000",
        customer: "Acme",
        total: 9.99,
        status: "pending",
        lines: [],
        placedAt: "2026-07-21T10:00:00.250Z",
      };
      const java: Json = {
        id: "bbbbbbbb-0000-4000-8000-000000000000",
        customer: "Acme",
        total: 9.99,
        status: "PENDING",
        lines: null,
        placedAt: "2026-07-21T10:00:00Z",
      };
      const kinds = nd(hono, java)
        .map((d) => `${d.path}:${d.kind}`)
        .sort();
      expect(kinds).toEqual(["$.lines:null-vs-empty", "$.status:enum-casing"]);
    });
    it("value: a genuinely different scalar (not casing)", () => {
      const [d] = nd({ total: 9.99 }, { total: 9.9 });
      expect(d.kind).toBe("value");
    });
    it("type-mismatch: array vs object is a shape break", () => {
      const [d] = nd({ items: [] }, { items: {} });
      // [] vs {} are both empty collections of different shape → type-mismatch, not null-vs-empty
      expect(d.kind).toBe("type-mismatch");
    });
    it("ordering: same members, different order (a real drop-in break)", () => {
      const [d] = nd({ tags: ["a", "b"] }, { tags: ["b", "a"] });
      expect(d.kind).toBe("ordering");
    });
    it("identical bodies → no divergence", () => {
      const body: Json = { a: 1, b: [{ c: "x" }] };
      expect(nd(body, structuredClone(body))).toEqual([]);
    });
    it("recurses into nested arrays of objects with a precise path", () => {
      const a: Json = { lines: [{ sku: "A", qty: 1 }] };
      const b: Json = { lines: [{ sku: "A", qty: 2 }] };
      const [d] = nd(a, b);
      expect(d.path).toBe("$.lines[0].qty");
    });
  });

  describe("diffAllPairs", () => {
    it("compares every pair over shared endpoints only", () => {
      const caps: BackendCapture[] = [
        { backend: "node", reads: { "/orders": normalizeBody({ status: "pending" }) } },
        { backend: "java", reads: { "/orders": normalizeBody({ status: "PENDING" }) } },
        { backend: "python", reads: { "/orders": normalizeBody({ status: "pending" }) } },
      ];
      const pairs = diffAllPairs(caps);
      // node↔java and java↔python diverge; node↔python agree
      expect(pairs.map((p) => `${p.a}↔${p.b}`).sort()).toEqual(["java↔python", "node↔java"]);
    });
    it("skips an endpoint a backend didn't serve (no false key-set)", () => {
      const caps: BackendCapture[] = [
        {
          backend: "node",
          reads: { "/a": normalizeBody({ x: 1 }), "/b": normalizeBody({ y: 1 }) },
        },
        { backend: "java", reads: { "/a": normalizeBody({ x: 1 }) } },
      ];
      expect(diffAllPairs(caps)).toEqual([]);
    });
  });

  describe("renderReport", () => {
    it("clean state reads as an explicit pass", () => {
      expect(renderReport([])).toContain("✅ No divergences");
    });
    it("buckets by kind and frames each as a candidate RS-rule", () => {
      const caps: BackendCapture[] = [
        { backend: "node", reads: { "/o": normalizeBody({ status: "pending", lines: [] }) } },
        { backend: "java", reads: { "/o": normalizeBody({ status: "PENDING", lines: null }) } },
      ];
      const md = renderReport(diffAllPairs(caps));
      expect(md).toContain("## enum-casing (1)");
      expect(md).toContain("## null-vs-empty (1)");
      expect(md).toContain("candidate RS-rule");
    });
  });

  it("DEFAULT_NORMALIZE is exported for the runner to reuse", () => {
    expect(DEFAULT_NORMALIZE.volatileValue?.length).toBeGreaterThan(0);
  });
});
