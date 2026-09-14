// ---------------------------------------------------------------------------
// M-T4.2 (wave C2 packet 2d) — java aggregates a `shape: document` source.
//
// THE DEFECT.  Java's direct-table aggregation runs JPQL through the
// `EntityManager` (`select count(e) from Article e`), and a document aggregate
// has NO JPA `@Entity` anywhere in the emitted project — it round-trips one
// jsonb column through a `JdbcTemplate` repository.  Hibernate therefore failed
// the query with "could not resolve root entity" at REQUEST time: a project
// that compiled, booted, and 500d on the first read.  It was refused honestly
// (`loom.projection-whole-table-aggregation-unsupported#document` and its
// grouped twin) while the other four backends emitted the same shape.
//
// THE FIX is not a different query — it is the same query, run NATIVE.  A
// document table is `(id, data, version)`, and `columnlessProjectionSource`
// already guarantees `id` is the only member a direct-table arm over such a
// source may name, so `e.id` reads identically in JPQL and in SQL and the
// `where` / grouping-key renderers are shared verbatim.  Only two things move:
// the entity name becomes the schema-qualified TABLE
// (`QueryProjectionCtx.documentTableOf`), and `count(e)` becomes `count(*)`.
// The binding (`setParameter`) and the promoted-capability bypass wrap are the
// same code on both paths.
//
// WHY THE TABLE COMES FROM THE CALL SITE rather than being derived here: the
// effective saving shape depends on the aggregate's `shape:` header AND on the
// deployable's resolved dataSource config, which the orchestrator already has
// (`resolveDataSourceConfig`) and this emitter does not.  Threading a resolver
// keeps the shape question in the one place that can answer it.
//
// Runtime proof (rule 10/12 — a compile tier cannot see a wrong number): on a
// booted Spring Boot app against a real Postgres 18, the singleton arm answers
// `{"articles":0}` and then `{"articles":3}` after three creates, and the
// grouped arm answers one row per id.  Both numbers come from the database.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = (body: string, shape: string) => `
system DocAgg {
  subdomain S {
    context Cms {
      aggregate Article ${shape}with crudish {
        title: string
        viewCount: int
      }
      repository Articles for Article { }
${body}
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: Cms, kind: state, use: pg }
  deployable d {
    platform: java
    contexts: [Cms]
    dataSources: [st]
    serves: A
    port: 4000
  }
}`;

const SINGLETON = `
      projection ArticleVolume {
        articles: int
        from Article as a
        select articles = count()
      }`;

const GROUPED = `
      projection PerId {
        key: guid
        n: int
        from Article as a
        group by a.id
        select key = a.id, n = count()
      }`;

const VIEWS = "d/src/main/java/com/loom/d/application/views/CmsQueryProjections.java";

const views = async (body: string, shape = "shape: document, "): Promise<string> => {
  const f = (await generateSystemFiles(SRC(body, shape))).get(VIEWS);
  expect(f, `${VIEWS} was not emitted`).toBeTruthy();
  return f!;
};

describe("java — aggregation over a `shape: document` source", () => {
  it("runs the singleton arm NATIVE against the document table, not as JPQL", async () => {
    const src = await views(SINGLETON);
    expect(src).toContain('entityManager.createNativeQuery("select count(*) from cms.articles e")');
    // The two halves that make it native, asserted separately so a partial
    // revert (native query, JPQL text — or vice versa) cannot pass:
    expect(src, "the entity name must not survive as a JPQL root").not.toContain("from Article e");
    expect(src, "`count(e)` names an entity native SQL has no word for").not.toContain("count(e)");
  });

  it("runs the GROUPED arm native too — the other direct-table arm", async () => {
    const src = await views(GROUPED);
    expect(src).toContain(
      'entityManager.createNativeQuery("select e.id, count(*) from cms.articles e group by e.id order by e.id")',
    );
  });

  // THE CONTRAST, and the reason this is a SHAPE fix rather than an
  // aggregation-wide one: a relationally-mapped source keeps the JPQL path
  // byte-for-byte, because there the entity exists and Hibernate's typed query
  // is the better read.
  it("leaves a RELATIONAL source on the JPQL path", async () => {
    const src = await views(SINGLETON, "");
    expect(src).toContain('entityManager.createQuery("select count(e) from Article e")');
    expect(src).not.toContain("createNativeQuery");
  });

  it("keeps the per-row arm on the repository, on either shape", async () => {
    // The row read hydrates through the document repository, which has no JPA
    // entity to need — so it never had this defect and must not acquire a
    // native query now.
    const src = await views(`
      projection ArticleTitles {
        heading: string
        from Article as a
        select heading = a.title
      }`);
    expect(src).toContain("articlesRepository.articleTitles()");
    expect(src).not.toContain("createNativeQuery");
  });
});
