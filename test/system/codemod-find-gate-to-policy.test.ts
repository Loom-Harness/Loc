// The codemod for the `find … requires` hard cutover
// (`scripts/codemod-find-gate-to-policy.mjs`), and the tree gate that keeps the
// repo's own `.ddd` corpus migrated.
//
// The first half drives the pure core over the shapes a real project has
// (same-line and own-line clauses, a `where` / `ignoring` / comment after the
// gate, a find left identical to the injected one, differing gates, the
// idempotent re-run); every rewritten source must also PARSE, so a codemod that
// emits something the grammar refuses fails here.  The second half walks every
// tracked `.ddd` and fails on one still carrying a find gate.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moveFindGates } from "../../scripts/codemod-find-gate-to-policy.mjs";
import { parseErrorsOf } from "../_helpers/parse.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const wrap = (members: string) => `system S {
  user { id: string  role: string }
  subdomain D {
    context C {
      aggregate Order with crudish { code: string  open: bool }
${members}
    }
  }
}`;

describe("codemod-find-gate-to-policy — moveFindGates", () => {
  it("moves a same-line gate to a policy line after the repository", () => {
    const src = wrap(`      repository Orders for Order {
        find byId(id: Order id): Order? requires currentUser.role == "clerk"
      }`);
    const { text, changed, conflicts } = moveFindGates(src);
    expect(changed).toBe(1);
    expect(conflicts).toEqual([]);
    expect(text).toBe(
      wrap(`      repository Orders for Order {
        find byId(id: Order id): Order?
      }
      policy { read Order requires currentUser.role == "clerk" }`),
    );
    expect(parseErrorsOf(text)).toEqual([]);
  });

  it("keeps a following `where` / `ignoring` / comment on the find", () => {
    const src = wrap(`      repository Orders for Order {
        find open(): Order[] requires currentUser.role == "clerk" where open == true // the open ones
        find any(): Order[] requires currentUser.role == "clerk" ignoring *
      }`);
    const { text } = moveFindGates(src);
    expect(text).toContain("find open(): Order[] where open == true // the open ones");
    expect(text).toContain("find any(): Order[] ignoring *");
    expect(text).toContain('policy { read Order requires currentUser.role == "clerk" }');
    expect(parseErrorsOf(text)).toEqual([]);
  });

  it("drops a `requires` line of its own, keeping the `where` line", () => {
    const src = wrap(`      repository Orders for Order {
        find open(): Order[]
          requires currentUser.role == "clerk"
          where open == true
      }`);
    const { text } = moveFindGates(src);
    expect(text).toContain("find open(): Order[]\n          where open == true\n");
    expect(parseErrorsOf(text)).toEqual([]);
  });

  it("deletes a find left identical to the injected `all`, keeps an unpaged one", () => {
    const paged = moveFindGates(
      wrap(`      repository Orders for Order {
        // the list read, gated — this comment goes with the find
        find all(): Order paged requires true
      }`),
    ).text;
    expect(paged).toContain("repository Orders for Order {}");
    expect(paged).not.toContain("this comment goes with the find");
    expect(paged).toContain("policy { read Order requires true }");
    expect(parseErrorsOf(paged)).toEqual([]);
    const array = moveFindGates(
      wrap(`      repository Orders for Order {
        find all(): Order[] requires true
      }`),
    ).text;
    expect(array).toContain("find all(): Order[]\n");
  });

  it("merges differing gates onto the list read's and reports the repository", () => {
    const { text, conflicts } = moveFindGates(
      wrap(`      repository Orders for Order {
        find mine(): Order[] requires true where open == true
        find all(): Order[] requires currentUser.role == "clerk"
      }`),
    );
    expect(conflicts).toEqual([{ repository: "Orders", aggregate: "Order" }]);
    expect(text).toContain('policy { read Order requires currentUser.role == "clerk" }');
    expect(text).toContain("Dropped: `true`. Review.");
    expect(parseErrorsOf(text)).toEqual([]);
  });

  it("is idempotent, and leaves gate-free and commented-out sources alone", () => {
    const once = moveFindGates(
      wrap(`      repository Orders for Order {
        find all(): Order[] requires true
      }`),
    ).text;
    expect(moveFindGates(once)).toEqual({ text: once, changed: 0, conflicts: [] });
    const commented =
      wrap(`      // repository Orders for Order { find all(): Order[] requires true }
      repository Orders for Order { find mine(): Order[] where open == true }`);
    expect(moveFindGates(commented).changed).toBe(0);
  });
});

describe("codemod-find-gate-to-policy — the tracked corpus is migrated", () => {
  const SKIP = new Set(["node_modules", ".git", "dist", "out", ".loom"]);
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(path.join(dir, e.name));
      } else if (e.name.endsWith(".ddd")) files.push(path.join(dir, e.name));
    }
  };
  walk(repoRoot);

  it("no `.ddd` in the tree still declares a find gate", () => {
    const stale = files.filter((f) => moveFindGates(fs.readFileSync(f, "utf8")).changed > 0);
    expect(stale.map((f) => path.relative(repoRoot, f))).toEqual([]);
  });
});
