// ---------------------------------------------------------------------------
// The storage-names census: a SQL table name or a URL route segment is spelled
// in exactly one place, and an emitter never decides which declaration a table
// is spelled from.
//
// A table or route named after a declaration is its snake_case plural, and
// `plural(snake(n))` and `snake(plural(n))` disagree for a name that ends in an
// acronym (`ProductSKU` → `product_skus` vs `product_sk_us`).  The spelling
// lives in `src/util/storage-names.ts` (`tableNameFor` / `routeSegmentFor`);
// the node accessors in `src/ir/enrich/storage-names.ts` decide which name a
// node's table is spelled from (a TPH concrete's rows live in its root's
// table).  This census is the permanent half of that rule:
//
//   1. No composition of `snake` and `plural` anywhere in `src/` outside the
//      two naming modules — neither nested (`snake(plural(x))`) nor through a
//      variable (`snake(pluralName)`, `plural(oldStem)`).
//   2. No emitter (`src/generator`, `src/platform`) calls the name-keyed
//      `tableNameFor`: it reads the table off the node it is emitting.
//
// The behavioural half — every table an ORM maps is one the migration created,
// every route a backend mounts is the one its client calls — is
// `test/conformance/acronym-storage-names.test.ts` (every adapter, the acronym
// trap) and `test/conformance/corpus-storage-names.test.ts` (every corpus
// feature).  This census catches what those cannot reach: an emitter path no
// fixture exercises, such as a new backend's first migration.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

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

describe("storage-names census", () => {
  it("reaches src/ and the emitter roots", () => {
    expectReach("src/ files", ALL_SRC.length, 1050);
    expectReach("src/generator files", collectTs(join(SRC, "generator")).length, 581);
    expectReach("src/platform files", collectTs(join(SRC, "platform")).length, 36);
  });

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

  it("no emitter spells a table from a name — tables come off the node", () => {
    const hits: string[] = [];
    for (const f of [...collectTs(join(SRC, "generator")), ...collectTs(join(SRC, "platform"))]) {
      for (const { line, text } of codeLines(f)) {
        if (/\btableNameFor\b/.test(text)) hits.push(`${rel(f)}:${line}: ${text.trim()}`);
      }
    }
    expect(
      hits,
      "read the table off the node: aggregateTableName / partTableName / projectionTableName / aggregateTableNameOf (src/ir/enrich/storage-names.ts)",
    ).toEqual([]);
  });
});
