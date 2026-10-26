// Census: on python, every read restriction is the read-scope hook's, and no
// repository read spells one (#3962).
//
// SQLAlchemy has a native global-criteria mechanism — a `do_orm_execute`
// listener adding `with_loader_criteria` to each ORM SELECT — and native
// single-table inheritance (`polymorphic_on` / `polymorphic_identity`).  The
// generated backend uses both, so the repositories hold only each read's own
// `where`.  A hand-written conjunct there is the defect shape this replaced: a
// read path that forgets one serves the rows it should hide.  Over every corpus
// fixture that generates on python:
//
//   1. no repository or query-projection read spells a `kind ==` — the only
//      one left is the guarded upsert's write-path `where=` (an INSERT … ON
//      CONFLICT is not an ORM read, so the hook does not reach it);
//   2. no restriction the hook hosts is also spelled in a repository or a
//      query-projection read;
//   3. the hook hosts every restriction the IR fact (`readScopeFor`) assigns a
//      relational or embedded aggregate — a TPH concrete's own ones on its
//      root, guarded by its `kind`.

import { describe, expect, it } from "vitest";
import { readFilterRestrictions, readScopeFor } from "../../../src/ir/enrich/read-scope.js";
import { isTphBase, isTphConcrete, rootBaseOf } from "../../../src/ir/util/inheritance.js";
import { snake } from "../../../src/util/naming.js";
import { buildLoomModel, enrichedContexts } from "../../_helpers/ir.js";
import { corpusSourceFor, generateCorpusCase } from "../../fixtures/corpus/harness.js";
import { CORPUS } from "../../fixtures/corpus/manifest.js";

const PYTHON_CASES = CORPUS.filter((f) => f.backends.includes("python")).map((f) => f.id);

/** A read module: a relational / embedded repository, a polymorphic base
 *  reader, or the query-time projection routes. */
function readModules(files: Map<string, string>): [string, string][] {
  return [...files].filter(
    ([path, text]) =>
      (/\/app\/db\/repositories\/\w+_repository\.py$/.test(path) &&
        /^"""\w+ (embedded )?repository( \(shape: embedded\))?\. {2}Auto-generated\."""|^"""Read-only polymorphic/.test(
          text,
        )) ||
      path.endsWith("/app/http/query_projections_routes.py"),
  );
}

interface Criterion {
  row: string;
  /** The predicate over `cls` (a lambda) or over the row class (eager). */
  body: string;
  lambda: boolean;
  guard?: string;
}

/** Every `with_loader_criteria(...)` the hook adds. */
function criteria(scope: string): Criterion[] {
  const out: Criterion[] = [];
  for (const m of scope.matchAll(
    /with_loader_criteria\((\w+), (lambda cls: )?(.*), include_aliases=True\)\)$/gm,
  )) {
    let body = m[3]!;
    let guard: string | undefined;
    const g = /^or_\((?:cls|\w+)\.kind != "(\w+)", (.*)\)$/.exec(body);
    if (g) {
      guard = g[1];
      body = g[2]!;
    }
    out.push({ row: m[1]!, body, lambda: !!m[2], ...(guard ? { guard } : {}) });
  }
  return out;
}

/** How a repository would have spelled `c` inline: over the host row class or
 *  any mapped subclass of it, the principal through the ambient accessor. */
function inlineSpellings(c: Criterion, schema: string): string[] {
  if (c.body === "false()") return [];
  const rows = [
    c.row,
    ...[...schema.matchAll(new RegExp(`^class (\\w+)\\(${c.row}\\):`, "gm"))].map((m) => m[1]!),
  ];
  return rows.flatMap((row) => {
    const overRow = c.lambda
      ? c.body.replace(/\bcls\./g, `${row}.`)
      : c.body.replaceAll(`${c.row}.`, `${row}.`);
    return [overRow, overRow.replace(/\buser\./g, "require_current_user().")];
  });
}

function pick(files: Map<string, string>, suffix: string): string | undefined {
  const k = [...files.keys()].find((p) => p.endsWith(suffix));
  return k ? files.get(k) : undefined;
}

describe("python read-scope census (#3962)", () => {
  it("covers a real population", () => {
    expect(PYTHON_CASES.length).toBeGreaterThan(50);
  });

  it.each(PYTHON_CASES)("%s: no repository read spells a restriction", async (id) => {
    const files = await generateCorpusCase(id, "python");
    const scope = pick(files, "/app/db/read_scope.py") ?? "";
    const schema = pick(files, "/app/db/schema.py") ?? "";
    const spellings = criteria(scope).flatMap((c) => inlineSpellings(c, schema));
    for (const [path, text] of readModules(files)) {
      for (const line of text.split("\n")) {
        if (/\.kind ==/.test(line)) {
          expect(
            line.trim().startsWith("where=") && line.includes("_expected"),
            `${path}: a hand-written discriminator on a read:\n${line}`,
          ).toBe(true);
        }
      }
      for (const s of spellings) {
        expect(text.includes(s), `${path} spells the hook's restriction inline: ${s}`).toBe(false);
      }
    }
  });

  it.each(PYTHON_CASES)("%s: the hook hosts every restriction of the IR fact", async (id) => {
    const files = await generateCorpusCase(id, "python");
    const scope = pick(files, "/app/db/read_scope.py") ?? "";
    // A principal-bound restriction also carries its no-principal `false()` arm.
    const all = criteria(scope).filter((c) => c.body !== "false()");
    const loom = await buildLoomModel(corpusSourceFor(id, "python"));
    for (const ctx of enrichedContexts(loom)) {
      const pool = ctx.aggregates;
      for (const agg of pool) {
        const repo = pick(files, `/app/db/repositories/${snake(agg.name)}_repository.py`);
        // Document / event-sourced aggregates evaluate their restrictions in-app.
        const sqlScoped =
          isTphBase(agg, pool) ||
          (!!repo &&
            /^"""\w+ (embedded )?repository( \(shape: embedded\))?\. {2}Auto-generated\."""/.test(
              repo,
            ));
        if (!sqlScoped || (agg.isAbstract && !isTphBase(agg, pool))) continue;
        const own = readFilterRestrictions(readScopeFor(agg, pool));
        if (isTphConcrete(agg, pool)) {
          // The root hosts what every row passes; the rest is this concrete's.
          const rootHosted = readFilterRestrictions(
            readScopeFor(rootBaseOf(agg, pool), pool),
          ).length;
          const hosted = all.filter((c) => c.guard === agg.name).length;
          expect(hosted, `${id}: ${agg.name}'s own restrictions, kind-guarded on its root`).toBe(
            own.length - rootHosted,
          );
          continue;
        }
        const hosted = all.filter((c) => c.row === `${agg.name}Row` && !c.guard).length;
        expect(hosted, `${id}: ${agg.name}'s restrictions in the hook`).toBe(own.length);
      }
    }
  });
});
