import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Python backend — capability `filter` on a shape: document aggregate
// (DEBT-02 tail).  The jsonb blob isn't per-field queryable, so the predicate
// is evaluated IN-APP over the REHYDRATED domain instance (a list-comprehension
// filter), the SQLAlchemy analogue of node's `documentCapabilityBody`
// `.filter(...)` — NOT a SQL `where` like the relational / embedded paths.
// Both shapes wired: a non-principal filter (`!this.archived`) and a principal
// filter (`this.tenantId == currentUser.tenantId`, bound against the ambient
// `require_current_user()` accessor).  Statically gated ruff + mypy --strict by
// the `document-tenancy.ddd` python-build case.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(
  path.resolve(here, "../../e2e/fixtures/python-build/document-tenancy.ddd"),
  "utf8",
);

async function repo(): Promise<string> {
  return (await generateSystemFiles(FIXTURE)).get("api/app/db/repositories/article_repository.py")!;
}

describe("python shape: document capability filter", () => {
  it("imports the ambient principal accessor (not a read-method param)", async () => {
    expect(await repo()).toContain("from app.auth.user import require_current_user");
  });

  it("gates find_by_id by the in-app predicate (hidden → not-found)", async () => {
    const r = await repo();
    expect(r).toContain("current_user = require_current_user()");
    expect(r).toContain("rec = _article_from_doc(row.data, row.row_version)");
    expect(r).toContain(
      "if not ((not rec.archived) and (rec.tenant_id == current_user.tenant_id)):",
    );
    expect(r).toContain("            return None");
  });

  it("filters all() over the rehydrated documents", async () => {
    expect(await repo()).toContain(
      "return [x for x in (_article_from_doc(r.data, r.row_version) for r in rows) " +
        "if ((not x.archived) and (x.tenant_id == current_user.tenant_id))]",
    );
  });

  it("filters find_many_by_ids by the capability predicate", async () => {
    const r = await repo();
    // The id-restricted SQL read still rehydrates + filters in-app.
    expect(r).toContain("select(ArticleRow).where(ArticleRow.id.in_(list(ids)))");
    expect(r).toContain(
      "return [x for x in (_article_from_doc(r.data, r.row_version) for r in rows) " +
        "if ((not x.archived) and (x.tenant_id == current_user.tenant_id))]",
    );
  });

  // A criterion read over a document aggregate: the handler calls
  // `run_find_all_by_articles_popular`, and the document repository emits no
  // retrieval method, so the call names a method that does not exist.  `fails`
  // until the document repository emits criterion reads (capability predicate
  // AND-ed with the criterion over a raw load); then drop `.fails`.
  it.fails("a criterion read's repository method exists (document repository emits none)", async () => {
    const fixture = FIXTURE.replace(
      /(criterion ArticlesPopular\(min: int\) of Article = this\.viewCount >= min)/,
      `$1
      queryHandler GetPopular(min: int): Article {
        if let a = Articles.find(ArticlesPopular(min)) {
          return a
        } else {
          notFound
        }
      }`,
    );
    const files = await generateSystemFiles(fixture);
    expect(files.get("api/app/application/get_popular.py")).toContain(
      "await articles.run_find_all_by_articles_popular(min, limit=1)",
    );
    const r = files.get("api/app/db/repositories/article_repository.py")!;
    expect(r).toContain("    async def run_find_all_by_articles_popular(self, min: int");
  });
});
