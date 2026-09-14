// ---------------------------------------------------------------------------
// `src/generator/java/render-sql-restriction.ts` — the principal-`scope`
// refusal, made a FLOOR instead of a hope.
//
// `renderSqlRestriction` builds the STATIC SQL fragment behind Hibernate's
// `@SQLRestriction`, which Hibernate appends to every SELECT for the entity.
// Static means parameterless: there is no ambient principal at that seam, so a
// principal-referencing predicate cannot be expressed there.  Its `authz-filter`
// arm therefore throws on the `scope` decision:
//
//     case "scope":
//       throw unsupported("principal-referencing `scope` filter (needs the
//                          Specification path)");
//
// A throw reached at codegen time is a CRASH, not a diagnostic — so the wave's
// rule is that it either earns a `loom.*` code or is PROVEN unreachable.  It is
// unreachable, and this file pins each LINK of the chain that makes it so,
// because a chain proved only end-to-end goes quiet the moment one link moves:
//
//   1. a `scope` decision CARRIES `currentUser.<anchor>` and
//      `currentUser.tenantId` as real child expressions (`AuthzFilterKind`);
//   2. `walkExprChildren` DESCENDS into those two children for an
//      `authz-filter` node (`src/ir/util/walk.ts`);
//   3. so `exprUsesCurrentUser` answers true for the sentinel;
//   4. and BOTH callers of `renderSqlRestriction` — `sqlRestrictionFilters` and
//      `promotedFilters` in `capability-filter.ts` — drop every predicate for
//      which that is true, before the renderer is reached.
//
// Link 2 is the load-bearing one and the easiest to lose: it is a single `if`
// inside one `case` of the shared walker, and deleting it turns a compile-time
// crash on `policy { allow deep on X }` back on with no other test failing.
// The mutation proof for this file is exactly that deletion.
//
// The end-to-end arm is kept too — it is what a reader checks first — but it is
// the LAST assertion, not the only one.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  promotedFilters,
  sqlRestrictionFilters,
} from "../../../src/generator/java/capability-filter.js";
import { renderSqlRestriction } from "../../../src/generator/java/render-sql-restriction.js";
import type { EnrichedAggregateIR, ExprIR } from "../../../src/ir/types/loom-ir.js";
import { exprUsesCurrentUser } from "../../../src/ir/types/loom-ir.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** The `scope` sentinel exactly as `enrichments.ts` builds it: the two claim
 *  reads are resolved `member` sub-expressions over a `current-user` ref. */
const claim = (name: string): ExprIR => ({
  kind: "member",
  receiver: { kind: "ref", name: "currentUser", refKind: "current-user" },
  member: name,
  receiverType: { kind: "primitive", name: "string" },
  memberType: { kind: "primitive", name: "string" },
});

const SCOPE: ExprIR = {
  kind: "authz-filter",
  aggregate: "Doc",
  filter: { kind: "scope", anchorClaim: claim("orgPath"), tenantClaim: claim("tenantId") },
};

const DENY: ExprIR = { kind: "authz-filter", aggregate: "Doc", filter: { kind: "deny" } };

/** An aggregate shaped only as far as the two gatekeepers read it. */
const aggWith = (filters: ExprIR[], origins: (string | undefined)[]): EnrichedAggregateIR =>
  ({
    name: "Doc",
    contextFilters: filters,
    contextFilterOrigins: origins,
  }) as unknown as EnrichedAggregateIR;

const SRC = `
system JavaScope {
  user { id: guid  tenantId: string }
  tenancy by user.tenantId of Org

  subdomain S {
    context C {
      aggregate Doc with tenantOwned {
        owner: string
        total: int
      }
      aggregate Org {
        name: string
        implements tenantRegistry
      }
      repository Docs for Doc { }
      repository Orgs for Org { }
      policy { allow deep on Doc }
    }
  }

  api ShopApi from S
  storage primarySql { type: postgres }
  resource shopState { for: C, kind: state, use: primarySql }
  deployable api1 {
    platform: java
    contexts: [C]
    dataSources: [shopState]
    serves: ShopApi
    port: 8081
    auth: required
  }
}
`;

const DOC_ENTITY = "api1/src/main/java/com/loom/api1/features/docs/Doc.java";

describe("render-sql-restriction: the principal-`scope` refusal is unreachable", () => {
  // LINK 1 + 2 + 3 — the sentinel carries the principal, the shared walker
  // descends into it, and the classifier therefore sees it.
  it("classifies a `scope` sentinel as principal-referencing", () => {
    expect(exprUsesCurrentUser(SCOPE)).toBe(true);
    // …and the CONTRAST: `deny` is a childless leaf, which is why it is the one
    // authz decision that DOES reach the static renderer.
    expect(exprUsesCurrentUser(DENY)).toBe(false);
    expect(renderSqlRestriction(DENY)).toBe("1 = 0");
  });

  // The refusal itself, characterised rather than assumed dead: if the arm ever
  // stops throwing, this file should be the thing that notices.
  it("still refuses the `scope` decision when called directly", () => {
    expect(() => renderSqlRestriction(SCOPE)).toThrowError(/principal-referencing/);
  });

  // LINK 4 — both callers drop it first.  A vacuity guard makes sure the
  // fixture aggregate actually carries a scope predicate, so "dropped" is not
  // "there was nothing there".
  it("is dropped by BOTH callers before the renderer is reached", () => {
    const promoted = new Set(["scopeCap"]);
    const agg = aggWith([SCOPE, DENY], ["scopeCap", undefined]);
    expect(agg.contextFilters, "vacuity: the fixture must carry the scope predicate").toHaveLength(
      2,
    );

    // `sqlRestrictionFilters` — the always-on `@SQLRestriction` path.
    const statics = sqlRestrictionFilters(agg, new Set());
    expect(statics).toEqual([DENY]);
    expect(() => statics.map(renderSqlRestriction)).not.toThrow();

    // `promotedFilters` — the bypassable `@FilterDef`/`@Filter` path, which
    // calls the SAME renderer and is the arm a reader is most likely to forget.
    expect(promotedFilters(aggWith([SCOPE], ["scopeCap"]), promoted)).toEqual([]);
  });

  // END TO END — the shape that would crash codegen if any link above moved.
  it("generates a deep-scoped java project without reaching the refusal", async () => {
    const files = await generateSystemFiles(SRC);
    const entity = files.get(DOC_ENTITY);
    expect(entity, "the deep-scoped entity must be emitted").toBeTruthy();
    // The principal scope rides the Specification / SpEL query path, never the
    // static restriction — so the entity carries no `@SQLRestriction` at all
    // here, and certainly no subtree predicate.
    expect(entity).not.toContain("@SQLRestriction");
    expect(entity).not.toContain("dataKey like");
  });
});
