// ---------------------------------------------------------------------------
// Java — the deep/global tenancy scope as an entity filter.
//
// `policy { allow deep on Doc }` widens the tenant floor to the caller's org
// and its descendants (materialized `data_key` paths), with the NULL-dataKey
// fallback to the flat tenant.  It is one auto-enabled Hibernate `@Filter` on
// the entity: the anchored `position(...) = 1` test decides the row, and the
// prefix `like` in front of it is the sargable prefilter the `data_key`
// text_pattern_ops index serves.  Each claim — and the LIKE pattern built
// from the anchor, escaped in Java — is a `@ParamDef` resolved per query.  No
// query names it: not the repository's `@Query`, not the projection
// aggregation's `createQuery` (which once 500ed on a leaked SpEL `:#{`).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system JavaHierarchy {
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

      projection DocTotals {
        docs: int
        volume: int
        from Doc as d
        select docs = count(), volume = sum(d.total)
      }
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

const VIEWS = "api1/src/main/java/com/loom/api1/application/views/CQueryProjections.java";
const DOC_REPO = "api1/src/main/java/com/loom/api1/features/docs/DocJpaRepository.java";
const DOC = "api1/src/main/java/com/loom/api1/features/docs/Doc.java";

describe("java — deep-scope tenancy is the entity's filter", () => {
  it("renders the descendant-or-self scope with the NULL-dataKey fallback", async () => {
    const doc = (await generateSystemFiles(SRC)).get(DOC)!;
    expect(doc).toContain(
      `@Filter(name = "Doc_tenantOwned", condition = "((data_key is not null and (data_key = :__cuOrgPath or (data_key like :__cuSubtreeOrgPath escape '!' and position(concat(:__cuOrgPath, '.') in data_key) = 1))) or (data_key is null and tenant_id = :__cuTenantId))")`,
    );
  });

  it("escapes the LIKE pattern in Java, null without a principal (fail-closed)", async () => {
    const doc = (await generateSystemFiles(SRC)).get(DOC)!;
    expect(doc).toContain(
      'return __cu == null || __cu.orgPath() == null ? null : __cu.orgPath().replace("!", "!!").replace("%", "!%").replace("_", "!_") + ".%";',
    );
    expect(doc).toContain("return __cu == null ? null : __cu.orgPath();");
  });

  it("no query names the scope — no SpEL anywhere", async () => {
    const files = await generateSystemFiles(SRC);
    for (const f of [VIEWS, DOC_REPO]) {
      expect(files.get(f)!).not.toMatch(/dataKey|tenantId|:#\{/);
    }
  });
});
