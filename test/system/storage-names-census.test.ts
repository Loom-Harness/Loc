// ---------------------------------------------------------------------------
// The storage-names census: a SQL table name or a URL route segment is spelled
// in exactly one place.
//
// A table or route named after a declaration is its snake_case plural, and
// `plural(snake(n))` and `snake(plural(n))` disagree for a name that ends in an
// acronym (`ProductSKU` → `product_skus` vs `product_sk_us`).  Backends that
// composed the two by hand mapped their ORM to a table the migration never
// created.  The spelling now lives in `src/util/storage-names.ts`
// (`tableNameFor` / `routeSegmentFor`), with the IR-node accessors in
// `src/ir/enrich/storage-names.ts`, and this census keeps it there:
//
//   1. No composition of `snake` and `plural` anywhere in `src/` outside the
//      two naming modules — neither nested (`snake(plural(x))`) nor through a
//      variable (`snake(pluralName)`, `plural(oldStem)`).
//   2. No private re-implementation of `plural`.
//   3. Every raw `plural(` call in the emitters (`src/generator`,
//      `src/platform`, the migrations builder) builds something that is
//      neither a table nor a route — a target-language identifier, a folder,
//      a UI label.  A call matching one of the reasoned SAFE_SHAPES passes; any
//      other needs a per-file waiver whose count matches exactly, so a new raw
//      call (or a stale waiver) fails until someone looks at it.
//
// The answer-key half is `test/conformance/acronym-storage-names.test.ts`.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SRC = join(REPO_ROOT, "src");

/** The only files that may compose `snake` and `plural`. */
const SPELLING_HOMES = new Set([
  "src/util/storage-names.ts",
  // `legacyWorkflowStateTableName`: the pre-fix saga-table spelling, read only
  // to rename an existing table.
  "src/util/naming.ts",
]);

function collectTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "generated") continue;
      collectTs(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const rel = (f: string): string => relative(REPO_ROOT, f).replaceAll("\\", "/");

/** Code lines only — a comment may quote the forbidden spelling to explain it. */
function codeLines(file: string): { line: number; text: string }[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => !/^\s*(\/\/|\*|\/\*)/.test(text));
}

const ALL_SRC = collectTs(SRC);

/** `snake(plural(`, `plural(snake(`, and the two through a variable whose name
 *  says it already holds the other half (`snake(pluralName)`, `plural(oldStem)`,
 *  `plural(snakeName)`). */
const COMPOSED = [
  /\bsnake\(\s*plural\(/,
  /\bplural\(\s*snake\(/,
  /\bsnake\(\s*\w*[Pp]lural\w*\s*\)/,
  /\bplural\(\s*\w*(?:[Ss]nake|[Ss]tem)\w*\s*\)/,
];

/** A raw `plural(` whose result is visibly not a table or a route. */
const SAFE_SHAPES: { re: RegExp; why: string }[] = [
  { re: /humanize\(plural\(/, why: "a human-facing label (`Product Skus`)" },
  { re: /useAll\$\{plural\(/, why: "the frontend list-hook identifier (`useAllOrders`)" },
  {
    re: /(?:Domain|Application|Api)[./]\$\{(?:upperFirst\()?plural\(/,
    why: "a C# namespace or project folder (`Domain.Orders`, `Application/Orders/…`)",
  },
  {
    re: /lowerFirst\(plural\(/,
    why: "a camelCase identifier — the drizzle table handle `schema.orders` or a Java repository bean `ordersRepository` — never the SQL name",
  },
  {
    re: /plural\(upperFirst\(|upperFirst\(plural\(/,
    why: "a PascalCase identifier — a C# DbSet / controller / folder, an F# message, an OpenAPI tag",
  },
  { re: /\$\{plural\([^)]*\)\}Controller/, why: "a controller class name (`OrdersController`)" },
  {
    re: /(?:namePlural|pluralAggregateName): plural\(/,
    why: "the page-shell template's PascalCase plural (`useAllOrders`, `allOrders`)",
  },
];

/** Raw `plural(` calls that match no SAFE_SHAPE, per file, with the reason none
 *  of them names a table or a route.  The count must match exactly. */
const WAIVERS: Record<string, { count: number; why: string }> = {
  "src/generator/java/adapters/by-layer-layout.ts": {
    count: 1,
    why: "the Java package segment (`features.orders`)",
  },
  "src/generator/dotnet/index.ts": { count: 1, why: "the C# aggregate folder (`Domain/Orders`)" },
  "src/generator/dotnet/cqrs-emit.ts": { count: 1, why: "the C# aggregate folder" },
  "src/generator/dotnet/adapters/cqrs-style.ts": { count: 1, why: "the C# aggregate folder" },
  "src/generator/dotnet/emit/join-entities.ts": {
    count: 1,
    why: "the C# DbSet property of a join entity (`ProductSkuAliases`); its SQL name is `AssociationIR.joinTable`",
  },
  "src/generator/dotnet/auth-emit.ts": {
    count: 1,
    why: "the C# DbSet property of the tenant registry",
  },
  "src/generator/python/explicit-handlers-emit.ts": {
    count: 1,
    why: "the repository name a Python handler keys its repo handles by",
  },
  "src/generator/_packs/loader.ts": {
    count: 1,
    why: "the design packs' `plural` Handlebars helper",
  },
};

describe("storage-names census", () => {
  it("no file outside the naming modules composes snake and plural", () => {
    const hits: string[] = [];
    for (const f of ALL_SRC) {
      if (SPELLING_HOMES.has(rel(f))) continue;
      for (const { line, text } of codeLines(f)) {
        if (COMPOSED.some((re) => re.test(text))) hits.push(`${rel(f)}:${line}: ${text.trim()}`);
      }
    }
    expect(
      hits,
      "spell a table with tableNameFor / aggregateTableName and a route with routeSegmentFor (src/ir/enrich/storage-names.ts)",
    ).toEqual([]);
  });

  it("no file re-implements plural", () => {
    const hits: string[] = [];
    for (const f of ALL_SRC) {
      if (rel(f) === "src/util/naming.ts") continue;
      for (const { line, text } of codeLines(f)) {
        if (/\bfunction\s+plural\w*\s*\(|\bconst\s+plural\w*\s*=\s*\(/.test(text)) {
          hits.push(`${rel(f)}:${line}: ${text.trim()}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("every raw plural( in the emitters builds an identifier or a label, never a table or a route", () => {
    const emitters = [
      ...collectTs(join(SRC, "generator")),
      ...collectTs(join(SRC, "platform")),
      join(SRC, "system", "migrations-builder.ts"),
    ];
    const unwaived: Record<string, string[]> = {};
    for (const f of emitters) {
      for (const { line, text } of codeLines(f)) {
        // A call is safe when some SAFE_SHAPE match spans its `plural(`.
        const safeSpans = SAFE_SHAPES.flatMap((s) =>
          [...text.matchAll(new RegExp(s.re, "g"))].map((m) => [m.index, m.index + m[0].length]),
        );
        for (const call of text.matchAll(/(?<![\w.$])plural\(/g)) {
          if (safeSpans.some(([a, b]) => call.index >= a && call.index < b)) continue;
          const sites = unwaived[rel(f)] ?? [];
          sites.push(`${line}: ${text.trim()}`);
          unwaived[rel(f)] = sites;
        }
      }
    }
    const mismatched: string[] = [];
    for (const [file, sites] of Object.entries(unwaived)) {
      const w = WAIVERS[file];
      if (!w)
        mismatched.push(`${file}: ${sites.length} unwaived raw plural( — ${sites.join(" | ")}`);
      else if (w.count !== sites.length) {
        mismatched.push(
          `${file}: waiver says ${w.count}, found ${sites.length} — ${sites.join(" | ")}`,
        );
      }
    }
    for (const file of Object.keys(WAIVERS)) {
      if (!unwaived[file]) mismatched.push(`${file}: stale waiver — no unmatched raw plural( left`);
    }
    expect(
      mismatched,
      "a table or route goes through src/ir/enrich/storage-names.ts; a genuine identifier gets a SAFE_SHAPE or a reasoned waiver",
    ).toEqual([]);
  });
});
