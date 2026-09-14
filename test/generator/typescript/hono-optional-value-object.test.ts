// Optional value-object fields on Hono — the save deref and the read null-probe
// must both target the FLATTENED leaf columns, not a `row.<field>` /
// `aggregate.<field>` that does not exist / may be null.
//
// From `docs/audits/repo-code-review-2026-07.md` C1: an optional VO field
// (`billing: Address?`) was broken end-to-end on the Hono backend —
//   • save projected `aggregate.billing.street` with NO guard on the parent, so
//     persisting an aggregate whose optional VO is null threw a TypeError; and
//   • read guarded on `row.billing == null` (a column that never exists — the VO
//     flattens to `billing_street`/`billing_city`), so `undefined == null` was
//     always true and the VO ALWAYS hydrated to null even when data was present
//     (silent data loss).
// No example exercised an optional singular VO, so the compile gates never saw
// it.  This pins the guarded, correct-column output on both paths.
//
// ── Second pass: `docs/audits/2026-09-10-eshop-dev-experience.md` D5/P3 ──────
// The guards above were placed correctly but NARROWED nothing beyond the one
// expression they mention, and both halves broke one level past what the first
// pass measured:
//
//   READ   an optional VO makes EVERY flattened leaf column nullable, and the
//          `== null` probe narrows only the leaf it names.  The other leaves
//          stayed `string | null` against a constructor wanting `string`
//                                                              → TS2345
//   SAVE   the guard was threaded DOWN as the next `valueExpr`, so each hop
//          re-evaluated the ternary and dereferenced its RESULT —
//          `(o == null ? null : o.geo).lat` — which TypeScript does not narrow
//                                                              → TS2531
//          Invisible on a VO of plain strings (nothing is dereferenced past the
//          first hop) and fatal on one carrying `money` (`.toString()`) or a
//          nested VO.
//
// Both were measured by `tsc --noEmit` on the generated api, and both are
// covered end-to-end by the `optional-valueobject` corpus fixture; these
// assertions pin the exact emitted shape so a regression names itself here
// instead of surfacing as a compile-tier failure ten minutes later.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SYSTEM = `
system PS {
  subdomain D {
    context Shop {
      valueobject Address {
        street: string
        city: string
      }
      aggregate Order with crudish {
        code: string
        billing: Address?
      }
      repository Orders for Order { }
    }
  }
  api A from D
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable d { platform: node, contexts: [Shop], dataSources: [st], serves: A, port: 3000 }
}`;

// The same shape one level deeper: a REQUIRED sibling to prove the fix did not
// disturb the path that already worked, an optional subfield INSIDE the VO, a
// `money` subfield the save path has to dereference, and a nested VO under the
// optional one.
const DEEP = `
system PD {
  subdomain D {
    context Shop {
      valueobject Geo { lat: decimal  lng: decimal }
      valueobject Addr {
        line1: string
        line2: string?
        rent: money
        geo: Geo
      }
      aggregate Person with crudish {
        name: string
        home: Addr
        office: Addr?
      }
      repository Persons for Person { }
    }
  }
  api A from D
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable d { platform: node, contexts: [Shop], dataSources: [st], serves: A, port: 3000 }
}`;

describe("Hono optional value-object field", () => {
  it("guards the parent deref on save and probes the leaf column on read", async () => {
    const files = await generateSystemFiles(SYSTEM);
    const repo = files.get("d/db/repositories/order-repository.ts");
    expect(repo).toBeDefined();

    // Read: the null-probe is the first FLATTENED leaf column, and the outer
    // (wrong) `root.billing == null` guard is gone.  Every OTHER leaf carries
    // the non-null assertion the probe cannot narrow for it — without it the
    // constructor call is a TS2345 per subfield, on every read path.
    expect(repo).toContain(
      "billing: (root.billing_street == null ? null : new Address(root.billing_street!, root.billing_city!))",
    );
    // The buggy nested double-guard (outer probe on the nonexistent `root.billing`
    // column) must be gone.  `toWire`, which operates on the DOMAIN object, still
    // legitimately references `root.billing`, so scope the negative to the pattern.
    expect(repo).not.toContain("root.billing == null ? null : (root.billing_street");
    // The un-narrowed form the audit measured.
    expect(repo).not.toContain("new Address(root.billing_street, root.billing_city)");

    // Save: the parent VO deref is guarded, so a null `billing` persists as null
    // columns instead of throwing on `.street`.
    expect(repo).toContain(
      "billing_street: (aggregate.billing == null ? null : aggregate.billing!.street)",
    );
    expect(repo).toContain(
      "billing_city: (aggregate.billing == null ? null : aggregate.billing!.city)",
    );
    expect(repo).not.toContain("billing_street: aggregate.billing.street");
  });

  it("narrows EVERY leaf of the group, and only the ones the guard covers", async () => {
    const files = await generateSystemFiles(DEEP);
    const repo = files.get("d/db/repositories/person-repository.ts");
    expect(repo).toBeDefined();
    const src = repo as string;

    // The optional VO: the probe names the first leaf, every other REQUIRED
    // leaf is asserted non-null, and the nested VO's leaves are asserted too —
    // the assertion has to survive the recursion AND land inside the numeric
    // conversion (`Number(root.office_geo_lat!)`), not outside it.
    expect(src).toContain("root.office_line1 == null ? null : new Addr(root.office_line1!");
    expect(src).toContain("root.office_rent!");
    expect(src).toContain("new Geo(Number(root.office_geo_lat!), Number(root.office_geo_lng!))");

    // …but the subfield that is OPTIONAL IN THE VO keeps its own null: it can
    // legitimately be null with the VO present, so asserting it would be a lie.
    expect(src).toContain("(root.office_line2 == null ? null : root.office_line2)");
    expect(src).not.toContain("root.office_line2!");

    // The REQUIRED sibling is untouched — its columns are NOT NULL, so nothing
    // to narrow.  This is the guard against "fix it by asserting everything".
    expect(src).toContain("new Addr(root.home_line1, ");
    expect(src).not.toContain("root.home_line1!");
    expect(src).not.toContain("root.home_city!");
  });

  it("guards the save path ONCE per group rather than per hop", async () => {
    const files = await generateSystemFiles(DEEP);
    const repo = files.get("d/db/repositories/person-repository.ts");
    expect(repo).toBeDefined();
    const src = repo as string;

    // One guard, wrapped around the whole leaf expression, over a `!`-asserted
    // root.  The `money` subfield is the one that must be DEREFERENCED
    // (`.toString()` for the numeric column) — the shape the per-hop ternary
    // could not produce without tripping TS2531.
    expect(src).toContain(
      "office_line1: (aggregate.office == null ? null : aggregate.office!.line1)",
    );
    expect(src).toContain(
      "office_rent: (aggregate.office == null ? null : aggregate.office!.rent.toString())",
    );
    expect(src).toContain(
      "office_geo_lat: (aggregate.office == null ? null : String(aggregate.office!.geo.lat))",
    );

    // The per-hop form: a ternary threaded down as the next receiver and then
    // dereferenced.  This is the exact TS2531 the audit measured.
    expect(src).not.toContain("(aggregate.office == null ? null : aggregate.office.geo).lat");
    expect(src).not.toContain("(aggregate.office == null ? null : aggregate.office.rent).toString");

    // The required sibling still projects unguarded — nothing to guard.
    expect(src).toContain("home_rent: aggregate.home.rent.toString()");
  });
});
