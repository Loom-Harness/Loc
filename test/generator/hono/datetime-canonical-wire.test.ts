// node/Hono — the CANONICAL `datetime` wire form (RS-4, F2-W-05).
//
// RS-4 (docs/conformance-semantics.md) pins the canonical wire spelling of an
// instant as `…T00:00:00Z` — trailing zero fractional seconds trimmed.  Node
// was the one backend that did NOT do that: `Date.toISOString()` always pads
// the fraction to three digits, so every datetime field on every read route
// shipped `…T00:00:00.000Z` while .NET trimmed with this same regex, java's
// `Instant.toString()` and python's `isoformat()` omit a zero fraction, and
// elixir's `:utc_datetime` carries no fraction at all — four against one.
//
// Structurally invisible to the differential harness: `test/_helpers/
// response-diff.ts` normalises `.000Z` and the no-fraction form to one
// `<timestamp>` token by design, and the OpenAPI dimension only compares
// `format: date-time`.  Hence a direct pin on the emitted expression.
//
// The repository read path was the FIRST half of that fix and this file pinned
// only that half — which is why the RAW-ROW read routes kept shipping `.000Z`
// for another wave: a folded projection / workflow instance / raw-table query
// projection hands a persistence row straight to `httpCtx.json(...)`, so a
// `datetime` column reaches `JSON.stringify` as a JS `Date` and serialises
// through `Date.prototype.toJSON` — a bare `toISOString()`.  It surfaced as a
// `behavioral-mikroorm` failure on #3023 (`GET /api/projections/order_board/
// {id}` answering `"at": "2026-09-28T15:48:23.000Z"`), i.e. ONLY when the
// instant lands on an exact second.  Both emitters are pinned below now.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = `
system W {
  subdomain S {
    context C {
      aggregate Widget with crudish {
        name: string
        releasedAt: datetime
        retiredAt: datetime?
      }
      repository Widgets for Widget { }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d {
    platform: node
    contexts: [C]
    dataSources: [st]
    serves: A
    port: 4000
  }
}`;

// The exact suffix the emitted expression carries — the all-zero `.000` group
// dropped (RS-4), every other fraction kept at exactly three digits (RS-38).
// Written out here so a change to the trim is a change to this literal, not a
// silent re-spelling of every timestamp on the wire.  It used to be
// `/\.?0+Z$/`, which also ate the trailing zero of `.120` (F2-W-06).
const TRIM = '.toISOString().replace(/\\.000Z$/, "Z")';

describe("node datetime wire form", () => {
  it("trims the zero fraction on required and optional datetime fields", async () => {
    const repo = (await generateSystemFiles(SOURCE)).get("d/db/repositories/widget-repository.ts")!;
    expect(repo).toContain(`releasedAt: (root.releasedAt as Date)${TRIM}`);
    expect(repo).toContain(
      `retiredAt: (root.retiredAt == null ? null : (root.retiredAt == null ? null : (root.retiredAt as Date)${TRIM}))`,
    );
    // No bare `.toISOString()` survives on the wire path — that spelling is
    // precisely the `.000Z` divergence.
    expect(repo).not.toMatch(/toISOString\(\)(?!\.replace)/);
  });

  it("produces the canonical form the other four backends agree on", () => {
    // The emitted trim, evaluated: a whole-second instant loses its fraction
    // (the RS-4 observable), a real sub-second one keeps its digits, and the
    // SECONDS field is never eaten — `toISOString()` always supplies the `.mmm`
    // group the regex anchors on.
    const canonical = (iso: string): string => new Date(iso).toISOString().replace(/\.000Z$/, "Z");
    expect(canonical("2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00Z");
    expect(canonical("2026-01-01T00:00:20Z")).toBe("2026-01-01T00:00:20Z");
    expect(canonical("2026-01-01T10:20:30Z")).toBe("2026-01-01T10:20:30Z");
    expect(canonical("2026-01-01T00:00:10.123Z")).toBe("2026-01-01T00:00:10.123Z");
    // RS-38: a fraction keeps exactly three digits — the trailing zero of
    // `.120` is contract, not noise (the old trim spelled it `.12Z`) …
    expect(canonical("2026-01-01T00:00:10.120Z")).toBe("2026-01-01T00:00:10.120Z");
    expect(canonical("2026-01-01T00:00:10.100Z")).toBe("2026-01-01T00:00:10.100Z");
    // … and sub-millisecond input truncates (a JS `Date` is ms-resolution).
    expect(canonical("2026-01-01T00:00:10.9996Z")).toBe("2026-01-01T00:00:10.999Z");
  });
});

// The RAW-ROW read surfaces: no repository `toWire` stands between the
// persistence row and `httpCtx.json`, so each emitter must canonicalise the
// `datetime` props itself.  One source (`src/generator/typescript/
// raw-row-wire.ts`) builds the helper from `canonicalIsoExpr`, so the trim
// literal below is still the only spelling in the tree.
const RAW_SOURCE = (persistence = ""): string => `
system R {
  subdomain S {
    context C {
      aggregate Order with crudish {
        customerId: string
        operation place() { emit OrderPlaced { orderRef: id, at: now() } }
      }
      repository Orders for Order { }
      event OrderPlaced { orderRef: Order id, at: datetime }
      projection OrderBoard keyed by orderRef {
        orderRef: Order id
        at: datetime
        seenAt: datetime?
        on(e: OrderPlaced) { orderRef := e.orderRef  at := e.at  seenAt := e.at }
      }
      projection BoardEcho {
        orderRef: Order id
        at: datetime
        from OrderBoard select orderRef = orderRef, at = at
      }
      workflow Fulfil {
        orderRef: Order id
        startedAt: datetime
        create(orderRef: Order id) { startedAt := now() }
      }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d {
    platform: node${persistence}
    contexts: [C]
    dataSources: [st]
    serves: A
    port: 4000
  }
}`;

/** Emitted source with its comments removed — see the sweep below. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// The emitted helper's body — the SAME trim the repository path applies, reached
// from a `Date`-valued row prop instead of a domain field.
const RAW_HELPER = `  if (v instanceof Date) return v${TRIM};`;

describe("node datetime wire form — raw persistence rows", () => {
  // Both adapters hydrate a `datetime` column to a JS `Date` (drizzle's
  // `timestamp(...)` defaults to `mode: "date"`; MikroORM's `datetime` likewise),
  // so both must canonicalise.  The mikro leg is the one #3023 actually failed on.
  for (const [label, persistence] of [
    ["drizzle", ""],
    ["mikroorm", " { persistence: mikroorm }"],
  ] as const) {
    describe(label, () => {
      it("canonicalises a folded projection's list and by-key rows", async () => {
        const files = await generateSystemFiles(RAW_SOURCE(persistence));
        const proj = files.get("d/http/projections.ts")!;
        // Declared once at module level, built from `canonicalIsoExpr` …
        expect(proj).toContain(RAW_HELPER);
        // … and called on EVERY datetime prop of BOTH routes — the required one
        // and the optional one, on the list and on the by-key read.
        expect(proj).toContain(
          "rows.map((r) => ({ ...r, at: __wireInstant(r.at), seenAt: __wireInstant(r.seenAt) }))",
        );
        expect(proj).toContain(
          "{ ...row, at: __wireInstant(row.at), seenAt: __wireInstant(row.seenAt) }",
        );
        // The pre-fix spelling: the row handed over verbatim.  This is the exact
        // text that shipped `.000Z`.
        expect(proj).not.toMatch(/json\(rows as unknown as/);
        expect(proj).not.toMatch(/json\(row as unknown as/);
      });

      it("canonicalises a workflow instance's list and by-id rows", async () => {
        const files = await generateSystemFiles(RAW_SOURCE(persistence));
        const wf = files.get("d/http/workflows.ts")!;
        expect(wf).toContain(RAW_HELPER);
        expect(wf).toContain("rows.map((r) => ({ ...r, startedAt: __wireInstant(r.startedAt) }))");
        expect(wf).toContain("{ ...row, startedAt: __wireInstant(row.startedAt) }");
        expect(wf).not.toMatch(/json\(rows as unknown as/);
        expect(wf).not.toMatch(/json\(row as unknown as/);
      });

      it("canonicalises a `datetime` selected off a raw-table query projection", async () => {
        const files = await generateSystemFiles(RAW_SOURCE(persistence));
        const q = files.get("d/http/query-projections.ts")!;
        expect(q).toContain(RAW_HELPER);
        // The `select`ed column, wrapped in place — the arm whose own comment used
        // to say this was the one coercion it might still need.
        expect(q).toContain("at: __wireInstant(r.at)");
        // The id column is already a string and stays untouched.
        expect(q).toContain("orderRef: r.orderRef");
      });

      it("leaves a raw `toISOString()` nowhere on any of the three surfaces", async () => {
        const files = await generateSystemFiles(RAW_SOURCE(persistence));
        for (const path of [
          "d/http/projections.ts",
          "d/http/workflows.ts",
          "d/http/query-projections.ts",
        ]) {
          // Comments stripped first: the emitted helper's own doc-comment NAMES
          // the un-trimmed spelling (it explains why the trim exists), and a gate
          // a comment can trip is a gate nobody can reword around.  The claim is
          // about emitted CODE.
          expect(stripComments(files.get(path)!), path).not.toMatch(/toISOString\(\)(?!\.replace)/);
        }
      });
    });
  }

  it("emits no helper, and no re-spread, for a datetime-free read model", async () => {
    // The byte-identity half: a projection whose row carries no instant keeps the
    // verbatim `rows` / `row` expression it has always had, so this fix churns
    // only the trees that actually had the defect.
    const files = await generateSystemFiles(`
system N {
  subdomain S {
    context C {
      aggregate Order with crudish {
        customerId: string
        operation place() { emit OrderPlaced { orderRef: id, label: "x" } }
      }
      repository Orders for Order { }
      event OrderPlaced { orderRef: Order id, label: string }
      projection Labels keyed by orderRef {
        orderRef: Order id
        label: string
        on(e: OrderPlaced) { orderRef := e.orderRef  label := e.label }
      }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d {
    platform: node
    contexts: [C]
    dataSources: [st]
    serves: A
    port: 4000
  }
}`);
    const proj = files.get("d/http/projections.ts")!;
    expect(proj).not.toContain("__wireInstant");
    expect(proj).toContain("json(rows as unknown as z.infer<typeof LabelsListResponse>, 200)");
    expect(proj).toContain("json(row as unknown as z.infer<typeof LabelsResponse>, 200)");
  });
});
