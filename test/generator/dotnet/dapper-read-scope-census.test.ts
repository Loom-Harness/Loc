// The Dapper adapter takes every read restriction from ONE IR fact —
// `readScopeFor` (`src/ir/enrich/read-scope.ts`) — and renders it ONCE per
// aggregate into a generated `<Agg>Scope` helper that every statement splices.
//
// Dapper has no global query filter and no discriminator mapping, so each
// statement over an aggregate's rows must apply the `kind` scope and the
// capability / tenancy / deny predicates by hand.  The guarantee that no
// statement forgets one, or spells one differently, has two halves:
//
//   1. SOURCE census — no Dapper repository emitter reads the raw filter arrays
//      the fact is derived from, calls `discriminatorValue`, or spells the `kind`
//      equality: `emit/dapper-scope.ts` is the one module that does.
//   2. EMISSION census — over fixtures that exercise TPH, capability, tenancy,
//      deny and `ignoring` reads (and a runtime-bypass retrieval), no generated
//      repository statement carries a scope predicate or a `kind` literal: with
//      the `<Agg>Scope` class cut off the end of the file, none of the SQL it
//      holds appears anywhere in the repository.
//
// Out of this census (tracked, not silently waived): the Dapper query-time
// PROJECTIONS (`query-projection-emit.ts`) still compose their own aggregation
// `WHERE` — see the "projections" test below, which pins the gap so it ratchets.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dapperScopeClass } from "../../_helpers/dapper-scope.js";
import { generateSystemFiles } from "../../_helpers/index.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

const ROOT = path.resolve(__dirname, "../../..");

/** Every Dapper repository emitter: the relational / document / event-sourced
 *  repositories, the polymorphic base reader and the workflow infrastructure.
 *  (`dapper-migrations.ts` owns DDL, where `kind` is a column definition.) */
const DAPPER_SOURCES = [
  "src/generator/dotnet/emit/dapper.ts",
  "src/generator/dotnet/emit/dapper-base-reader.ts",
  "src/generator/dotnet/emit/dapper-workflow.ts",
  "src/generator/dotnet/emit/dapper-session.ts",
];

/** Source with comments blanked, so prose that NAMES a forbidden symbol does not trip the census. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const FORBIDDEN: { what: string; re: RegExp }[] = [
  { what: "a raw read of the filter arrays", re: /\.contextFilter(s|Origins|Refs)\b/ },
  { what: "a hand-derived TPH discriminator", re: /\bdiscriminatorValue\s*\(/ },
  { what: "a spelling of the `kind` equality", re: /\bkind = ['"`$]/ },
  { what: "a spelling of the `kind` equality", re: /\.kind = ['"`$]/ },
];

describe("dapper read-scope census — source", () => {
  it("covers the repository and base-reader emitters", () => {
    expect(DAPPER_SOURCES.every((f) => fs.existsSync(path.join(ROOT, f)))).toBe(true);
    expect(DAPPER_SOURCES).toContain("src/generator/dotnet/emit/dapper.ts");
  });

  it.each(DAPPER_SOURCES)("%s re-derives no read restriction", (rel) => {
    const src = code(rel);
    const hits = FORBIDDEN.flatMap(({ what, re }) =>
      src
        .split("\n")
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => re.test(l))
        .map(({ l, i }) => `${rel}:${i + 1} ${what}: ${l.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});

const FEATURES = [
  "tph",
  "inheritance",
  "inheritance-base-reads",
  "inheritance-read-restrictions",
  "tph-crossings",
  "find-bypass",
  "tenancy-owned",
  "tenancy-hierarchy",
  "policy-deny",
  "projection-tph-source",
];

/** Every SQL constant the generated `<Agg>Scope` classes of a file hold, plus the TPH kind literal. */
function scopeSql(scopeClass: string): string[] {
  const out: string[] = [];
  for (const m of scopeClass.matchAll(/public const string \w+ = "(.*?)";/g)) out.push(m[1]!);
  for (const m of scopeClass.matchAll(/parts\.Add\("(.*?)"\);/g)) out.push(m[1]!);
  return out.filter((s) => s.length > 0);
}

/** A repository file without its trailing scope class. */
function bodyOf(src: string): string {
  return src.slice(0, src.length - dapperScopeClass(src).length);
}

async function dapperFiles(source: string): Promise<Map<string, string>> {
  return generateSystemFiles(source);
}

function leaks(files: ReadonlyMap<string, string>): { scoped: number; leaks: string[] } {
  const found: string[] = [];
  let scoped = 0;
  for (const [p, src] of files) {
    if (!/Infrastructure\/Repositories\/\w+Repository\.cs$/.test(p)) continue;
    const cls = dapperScopeClass(src);
    const body = bodyOf(src);
    if (cls) scoped++;
    for (const sql of scopeSql(cls)) {
      if (body.includes(sql)) found.push(`${p}: spells scope SQL ${sql}`);
    }
    // A TPH write spells no `kind` literal either: the INSERT column VALUES and the
    // DELETE / conflict guards splice the scope class.
    for (const m of body.matchAll(/\bkind = '[^']*'|VALUES \(@\w+, '[^']*'/g)) {
      found.push(`${p}: spells a kind literal ${m[0]}`);
    }
  }
  return { scoped, leaks: found };
}

describe("dapper read-scope census — emitted repositories", () => {
  it.each(FEATURES)("%s: no repository statement spells a scope predicate", async (feature) => {
    const files = await dapperFiles(corpusSourceFor(feature, "dotnet", "dapper"));
    const r = leaks(files);
    expect(r.scoped, `${feature} emits at least one scope class`).toBeGreaterThan(0);
    expect(r.leaks).toEqual([]);
  });

  it("a runtime-bypass retrieval splices the scope class (no inlined capability list)", async () => {
    const src = fs
      .readFileSync(path.join(ROOT, "test/e2e/fixtures/dotnet-build/filter-bypass.ddd"), "utf8")
      .replace(/platform:\s*dotnet\b/, "platform: dotnet { persistence: dapper }");
    const files = await dapperFiles(src);
    const r = leaks(files);
    expect(r.leaks).toEqual([]);
    const all = [...files].filter(([p]) => p.endsWith("Repository.cs")).map(([, s]) => s);
    expect(all.some((s) => /Scope\.Runtime\(bypass\)/.test(s))).toBe(true);
    expect(all.some((s) => /public static string Runtime\(FilterBypass bypass\)/.test(s))).toBe(
      true,
    );
  });

  it("the TPH polymorphic base reads one SELECT, switches the row parser per kind and pages by id", async () => {
    const files = await dapperFiles(corpusSourceFor("inheritance-base-reads", "dotnet", "dapper"));
    const repo = files.get("d/Infrastructure/Repositories/EquipmentRepository.cs")!;
    expect(repo, "the TPH base reader is emitted").toBeDefined();
    expect(repo).toContain('["Crane"] = reader.GetRowParser<BaseRow>(typeof(CraneRow))');
    expect(repo).toContain('["Forklift"] = reader.GetRowParser<BaseRow>(typeof(ForkliftRow))');
    expect(repo).toContain("ORDER BY id LIMIT @__take OFFSET @__offset");
    expect(repo).toContain("SELECT COUNT(*) FROM equipments");
    // The base read spells no scope predicate: it splices the base's polymorphic scope.
    expect(repo).toContain("EquipmentScope.Polymorphic");
    expect(files.get("d/Api/EquipmentsController.cs")).toContain('[Route("api/equipments")]');
  });

  it("projections — the aggregation WHERE of a query-time projection is NOT yet the scope helper", async () => {
    // The ratchet for the gap named in the header: when the projection emitter
    // takes the helper, this flips and the test is deleted with the waiver.
    const files = await dapperFiles(corpusSourceFor("projection-tph-source", "dotnet", "dapper"));
    const handlers = [...files].filter(([p]) =>
      /Application\/Projections\/\w+QpHandler\.cs$/.test(p),
    );
    expect(handlers.length, "query-time projection handlers are emitted").toBeGreaterThan(0);
    expect(handlers.some(([, src]) => /kind = '/.test(src))).toBe(true);
  });
});
