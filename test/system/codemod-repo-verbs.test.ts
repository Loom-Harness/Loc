// The codemod for the repository-verb hard cutover
// (`scripts/codemod-repo-verbs.mjs`, D-REPO-VERBS), and the tree gate that
// keeps the repo's own `.ddd` corpus migrated.
//
// The first half drives the pure core: every retired verb, the retrieval
// literal (with and without `sort:`), the receivers it must NOT touch (a
// domain service's `run`, an e2e `api.…` handle, an Ecto `Repo.delete` in an
// expectation string), and idempotence.  A rewritten source must parse and
// validate clean — a codemod that emits something the compiler refuses fails
// here.  The second half walks every tracked `.ddd`.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rewriteRepoVerbs } from "../../scripts/codemod-repo-verbs.mjs";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const wrap = (body: string) => `system S {
  subdomain D {
    context C {
      aggregate Order with crudish { code: string  total: int }
      repository Orders for Order { }
      criterion Big(min: int) of Order = this.total >= min
      retrieval Recent of Order { where: Big(0)  sort: [code desc] }
      workflow W {
        create(id: Order id) {
${body}
        }
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node  contexts: [C]  dataSources: [st]  port: 3000 }
}`;

/** Parse + AST-validate + IR-validate; every error, from any phase. */
async function errorsOf(src: string): Promise<string[]> {
  const { model, errors } = await parseString(src);
  if (errors.length > 0) return errors;
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => `${d.code}: ${d.message}`);
}

describe("codemod-repo-verbs — rewriteRepoVerbs", () => {
  it("renames every retired verb, and the result validates clean", async () => {
    const src = wrap(`          let a = Orders.getById(id)
          let b = Orders.findById(id)
          let c = Orders.findAll(Big(1), page: { offset: 0, limit: 5 })
          let d = Orders.run(Recent, page: { limit: 5 })
          let e = Orders.run(Big(2), page: { limit: 5 })
          let f = Orders.run(retrieval { where: Big(3)  sort: [code desc] }, page: { limit: 5 })
          Orders.delete(a)`);
    const r = rewriteRepoVerbs(src);
    expect(r.counts).toEqual({
      getById: 1,
      findById: 1,
      findAll: 1,
      run: 2,
      "run(retrieval {…})": 1,
      delete: 1,
    });
    expect(r.text).toContain("let a = Orders.get(id)");
    expect(r.text).toContain("let b = Orders.find(id)");
    expect(r.text).toContain("let c = Orders.all(Big(1), page: { offset: 0, limit: 5 })");
    expect(r.text).toContain("let d = Orders.all(Recent, page: { limit: 5 })");
    expect(r.text).toContain("let f = Orders.all(Big(3), sort: [code desc], page: { limit: 5 })");
    expect(r.text).toContain("Orders.remove(a)");
    expect(await errorsOf(r.text)).toEqual([]);
    // The un-migrated source is refused, naming the new verbs.
    const before = await errorsOf(src);
    expect(before.join("\n")).toMatch(/retrieval \{ where: C sort: \[…\] \}` literal/);
  });

  it("leaves receivers that are not repositories alone", () => {
    const src = `
      domainService Transfer { operation run(a: int): int { return a } }
      repository Orders for Order
      let x = Transfer.run(1)
      let y = api.orders.getById(id)
      expect(out).toContain("|> Repo.delete(record)")`;
    expect(rewriteRepoVerbs(src).changed).toBe(0);
  });

  it("rewrites a context test's aggregate-rooted reads", () => {
    const src =
      "aggregate Order { }\nrepository Orders for Order\nlet o = Order.getById(id)  Order.delete(o)";
    const r = rewriteRepoVerbs(src);
    expect(r.text).toContain("Order.get(id)");
    // `delete` is no aggregate-rooted read: only a repository spells it.
    expect(r.text).toContain("Order.delete(o)");
  });

  it("treats `Repo` and plural receivers as repositories in Markdown only", () => {
    expect(rewriteRepoVerbs("`Repo.run(C)` / `Tasks.getById(id)`", { markdown: true }).text).toBe(
      "`Repo.all(C)` / `Tasks.get(id)`",
    );
    expect(rewriteRepoVerbs("`Repo.run(C)` / `Tasks.getById(id)`").changed).toBe(0);
  });

  it("refuses a retrieval literal it cannot express, and is idempotent", () => {
    const loads = "repository Orders for Order\nOrders.run(retrieval { where: C  loads: [lines] })";
    const r = rewriteRepoVerbs(loads);
    expect(r.changed).toBe(0);
    expect(r.refused).toHaveLength(1);
    const once = rewriteRepoVerbs(wrap("          let a = Orders.getById(id)")).text;
    expect(rewriteRepoVerbs(once)).toMatchObject({ text: once, changed: 0 });
  });
});

describe("codemod-repo-verbs — the tracked corpus is migrated", () => {
  const SKIP = new Set(["node_modules", ".git", "dist", "out", ".loom", ".claude"]);
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(path.join(dir, e.name));
      } else if (e.name.endsWith(".ddd")) files.push(path.join(dir, e.name));
    }
  };
  walk(repoRoot);

  it("walks the corpus (vacuity guard)", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no `.ddd` in the tree still spells a retired repository verb", () => {
    const stale = files.filter((f) => {
      const r = rewriteRepoVerbs(fs.readFileSync(f, "utf8"));
      return r.changed > 0 || r.refused.length > 0;
    });
    expect(stale.map((f) => path.relative(repoRoot, f))).toEqual([]);
  });
});
