// M-T5.33 — a page-body lambda parameter's TYPE, and what it costs when the
// lowering has none.
//
// `QueryView { of: <apiHandle>.<Projection>, data: s => … }` is the fifth
// `of:` form `docs/page-metamodel.md` §9.3 documents.  `ofReadResultType`
// recognised only `<handle>.<Aggregate>.<verb>` and returned `undefined` for
// it, so `queryDataType` could not answer and the `data:` lambda lowered at
// the `string` placeholder (`lower-expr.ts`, `env.rowElem ?? primitive
// string`).  Every field read off the row then typed as `string`.
//
// Two shipped defects fell out of that one erasure, both found by building a
// claims dashboard, both silent (`0 error(s), 0 warning(s)`):
//
//   F-107  `Stat { "Gross", s.gross }` emitted `{totals.data.gross}` — a
//          decimal.js `Decimal` into a React text slot, `TS2322`.  The
//          `loom.money-in-text-slot` gate could not see a money field to
//          refuse, because there was no money type to see.
//   F-106  `s.gross.round(0)` emitted decimal.js's ZERO-argument `.round(0)`
//          (`TS2554`) instead of `toDecimalPlaces(0, Decimal.ROUND_HALF_UP)` —
//          the shared `money.round` intrinsic never matched a `string`
//          receiver.
//
// So the assertions below are on the TYPES, not on emitted bytes: the types
// are the fix, and both emitters are downstream consumers of them.

import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { ExprIR, TypeIR } from "../../src/ir/types/loom-ir.js";
import { parseString } from "../_helpers/index.js";

const sys = (projection: string, body: string) => `
system Claims {
  subdomain Ops {
    context Ap {
      aggregate Claim with crudish {
        reference: string
        claimedTotal: money
        derived display: string = reference
      }
      repository Claims for Claim { }
${projection}
    }
  }
  api ApApi from Ops
  storage pg { type: postgres }
  resource apState { for: Ap, kind: state, use: pg }
  deployable api {
    platform: node
    contexts: [Ap]
    dataSources: [apState]
    serves: ApApi
    port: 4000
  }
  ui web {
    framework: react
    api Ap: ApApi
    area Home {
      page Dash {
        route: "/"
        title: "Dashboard"
        body: ${body}
      }
    }
  }
  deployable webapp {
    platform: static
    targets: api
    ui: web { Ap: api }
    port: 3000
  }
}`;

const SINGLETON = `      projection Totals {
        gross: money
        rows: int
        from Claim as c
        select gross = sum(c.claimedTotal), rows = count()
      }`;

const GROUPED = `      projection ByRef {
        ref: string
        gross: money
        from Claim as c
        group by c.reference
        select ref = c.reference, gross = sum(c.claimedTotal)
      }`;

/** Every `member` access in the page body, as `.name → memberType`. */
async function memberTypes(projection: string, body: string): Promise<Map<string, TypeIR>> {
  const { model } = await parseString(sys(projection, body), { validate: false });
  const loom = lowerModel(model);
  const out = new Map<string, TypeIR>();
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const node = n as Record<string, unknown> & { kind?: string };
    if (node.kind === "member" && node.memberType) {
      out.set(String(node.member), node.memberType as TypeIR);
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) for (const x of v) walk(x);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(loom.systems[0]?.uis[0]?.pages[0]?.body as ExprIR);
  return out;
}

describe("M-T5.33 — a QueryView over a projection types its row", () => {
  it("types a money field off a SINGLETON projection row as money, not string", async () => {
    const types = await memberTypes(
      SINGLETON,
      `QueryView { of: Ap.Totals, data: s => Group { Stat { "Gross", s.gross } } }`,
    );
    expect(types.get("gross")).toEqual({ kind: "primitive", name: "money" });
  });

  it("types a non-money field off the same row too — the erasure was total", async () => {
    // `rows: int` also typed as `string` before, which is the tell that this
    // was a missing binding and not a money-specific hole.
    const types = await memberTypes(
      SINGLETON,
      `QueryView { of: Ap.Totals, data: s => Group { Stat { "Rows", s.rows } } }`,
    );
    expect(types.get("rows")).toEqual({ kind: "primitive", name: "int" });
  });

  it("types the ROW of a GROUPED projection, whose read is an array", async () => {
    // A grouped read binds `rows: <Row>[]`, so the element type has to survive
    // the array wrapper for `For`'s item lambda to bind it.
    const types = await memberTypes(
      GROUPED,
      `QueryView { of: Ap.ByRef, data: rows => For { each: rows, r => Stat { "G", Money { r.gross } } } }`,
    );
    expect(types.get("gross")).toEqual({ kind: "primitive", name: "money" });
  });

  it("still types an AGGREGATE-rooted read — the path that always worked", async () => {
    // The control.  A regression here would mean the projection arm captured
    // a chain the aggregate scan should have won.
    const types = await memberTypes(
      SINGLETON,
      `QueryView { of: Ap.Claim.all, data: rows => For { each: rows, c => Stat { "T", Money { c.claimedTotal } } } }`,
    );
    expect(types.get("claimedTotal")).toEqual({ kind: "primitive", name: "money" });
  });

  it("leaves the row UNBOUND when the of: names a projection plus a verb", async () => {
    // A projection read names no verb — the projection IS the read.  A
    // trailing suffix means this is not the projection form, and inventing a
    // binding for it would be a wrong answer rather than a missing one.
    const types = await memberTypes(
      SINGLETON,
      `QueryView { of: Ap.Totals.all, data: s => Group { Stat { "Gross", s.gross } } }`,
    );
    expect(types.get("gross")).toEqual({ kind: "primitive", name: "string" });
  });
});
