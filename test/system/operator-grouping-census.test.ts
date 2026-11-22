// Census: every renderer of `binary` / `unary` ExprIR nodes takes its operand
// grouping from `src/generator/_expr/grouping.ts`.
//
// Grouping is structural: `binary(-, x, binary(-, a, b))` means `x - (a - b)`
// with no `paren` node, and the construction sites that build operator nodes
// (lowering, enrichment, macros) do not write one.  A renderer that splices
// `${left} ${op} ${right}` on its own regroups such a tree silently — the
// output compiles and computes another value.  So every file under
// `src/generator/` and `src/system/` that names the `binary` kind is
// classified here: it imports the shared grouping, or it carries a standing
// reason it cannot regroup.  A new file fails until it is classified; a stale
// row fails until it is deleted.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

const ROOT = path.resolve(__dirname, "../..");
const SCANNED = ["src/generator", "src/system"];

/** Files that name the `binary` kind but cannot regroup an operand. */
const STANDING: Record<string, string> = {
  "src/generator/_expr/grouping.ts": "the shared grouping itself",
  "src/generator/_expr/authz-filter-inapp.ts": "rewrites / tests the tree; renders nothing",
  "src/generator/_frontend/store-field-init.ts": "parenthesises every binary it renders",
  "src/generator/_walker/primitives/forms.ts": "a predicate over the tree; renders nothing",
  "src/generator/_walker/walker-core.ts":
    "dispatches to the frontend leaf tables (js-expr-leaves, FS_LEAVES, DART_LEAVES), which parenthesise every operator node — pinned by test/generator/_expr/grouping.test.ts",
  "src/generator/feliz/fs-expr.ts": "FS_LEAVES parenthesise every operator node (see walker-core)",
  "src/generator/dotnet/emit/dapper.ts": "parenthesises every binary it renders",
  "src/generator/dotnet/emit/efcore.ts": "collects column refs; renders nothing",
  "src/generator/dotnet/emit/tests.ts": "parenthesises a binary/unary before splicing it",
  "src/generator/dotnet/render-expr.ts":
    "a kind table / type probe; rendering rides renderExprWith",
  "src/generator/elixir/render-expr.ts": "a type probe; rendering rides renderExprWith",
  "src/generator/python/render-expr.ts": "a shape probe; rendering rides renderExprWith",
  "src/generator/elixir/vanilla/denial.ts": "a shape probe; renders nothing",
  "src/generator/elixir/vanilla/provenance-emit.ts":
    "checks leaves and collects params; renders nothing",
  "src/generator/elixir/vanilla/wire-serialize.ts": "a predicate over the tree; renders nothing",
  "src/generator/java/render-criteria.ts":
    "a CriteriaBuilder call per operator (`cb.and(…)`), never infix",
  "src/generator/python/emit/tests.ts": "a shape probe; renders nothing",
  "src/generator/python/find-predicate.ts": "`and_(…)` / `or_(…)` calls and a parenthesised infix",
  "src/generator/sql-pg-expr.ts": "parenthesises every binary it renders",
  "src/generator/typescript/emit/mikroorm-filter.ts":
    "structured filter keys; its raw-SQL comparisons take only a column or a bind as operands",
  "src/generator/typescript/repository-find-predicate.ts":
    "a drizzle call per operator (`and(…)`, `eq(…)`), never infix",
};

const NAMES_BINARY = /case "binary"|kind === "binary"/;
const IMPORTS_GROUPING =
  /from "(?:\.\.?\/)+(?:generator\/)?_expr\/grouping\.js"|from "\.\/grouping\.js"/;

function scan(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${ent.name}`;
      if (ent.isDirectory()) walk(rel);
      else if (ent.name.endsWith(".ts")) out.push(rel);
    }
  };
  for (const d of SCANNED) walk(d);
  return out.sort();
}

describe("operator-grouping census", () => {
  const files = scan();

  it("reaches the renderers it governs", () => {
    const naming = files.filter((f) =>
      NAMES_BINARY.test(fs.readFileSync(path.join(ROOT, f), "utf8")),
    );
    expectReach("files naming the binary kind", naming.length, 30);
  });

  it("every renderer of a binary node groups through _expr/grouping.ts or has a standing reason", () => {
    const offenders = files.filter((f) => {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      return NAMES_BINARY.test(src) && !IMPORTS_GROUPING.test(src) && !(f in STANDING);
    });
    expect(
      offenders,
      "route the operands through groupedOperands/groupedOperand, or add a STANDING reason",
    ).toEqual([]);
  });

  it("no STANDING row is stale", () => {
    const stale = Object.keys(STANDING).filter((f) => {
      const abs = path.join(ROOT, f);
      if (!fs.existsSync(abs)) return true;
      const src = fs.readFileSync(abs, "utf8");
      return (
        !NAMES_BINARY.test(src) ||
        (IMPORTS_GROUPING.test(src) && f !== "src/generator/_expr/grouping.ts")
      );
    });
    expect(stale).toEqual([]);
  });
});
