// Census: on elixir, every read restriction lives in the aggregate's schema
// module — `base_query/0` or a `__loom_filter__/3` clause `Repo.prepare_query/3`
// applies — and no other generated module spells one (#3964).
//
// Ecto has a native hook for this (`Repo.prepare_query/3`, which every
// `Repo.all`/`one`/`aggregate`/`stream` runs through), so the repositories,
// retrievals and query projections hold only each read's own `where`.  A
// hand-spliced conjunct there is the defect shape this replaced: a read path
// that forgets one serves the rows it should hide.  Over every corpus fixture
// that generates on elixir:
//
//   1. no module but a schema spells a `record.kind ==` / `!=` discriminator;
//   2. no module but a schema spells a restriction a schema hosts — except the
//      write-scope load `find_by_id_for_write`, which swaps the read scope for
//      the write ladder (`skip_filters: :all`) and spells that ladder itself;
//   3. each relational aggregate's schema hosts every restriction the IR fact
//      (`readScopeFor`) assigns it, rendered exactly as `ectoReadScope` does —
//      a TPH root also hosts its subtypes' own, kind-guarded.

import { describe, expect, it } from "vitest";
import { renderEctoRestriction } from "../../../src/generator/elixir/vanilla/capability-filter.js";
import { ectoReadScope } from "../../../src/generator/elixir/vanilla/read-scope-emit.js";
import { readFilterRestrictions, readScopeFor } from "../../../src/ir/enrich/read-scope.js";
import { upperFirst } from "../../../src/util/naming.js";
import { buildLoomModel, enrichedContexts } from "../../_helpers/ir.js";
import { corpusSourceFor, generateCorpusCase } from "../../fixtures/corpus/harness.js";
import { CORPUS } from "../../fixtures/corpus/manifest.js";

const ELIXIR_CASES = CORPUS.filter((f) => f.backends.includes("vanilla")).map((f) => f.id);

/** A schema module carrying a read scope. */
const isScopedSchema = (text: string): boolean => /\n {2}def base_query, do: /.test(text);

/** Every predicate a schema hosts: `base_query/0`'s and each clause's. */
function hostedPredicates(schema: string): string[] {
  const out: string[] = [];
  const base = /def base_query, do: Ecto\.Query\.from\(record in __MODULE__, where: (.*)\)$/m.exec(
    schema,
  );
  if (base) out.push(base[1]!);
  for (const m of schema.matchAll(/do: Ecto\.Query\.where\(query, \[record\], (.*)\)$/gm)) {
    out.push(m[1]!);
  }
  return out;
}

/** The lines of `text` outside a `find_by_id_for_write` definition. */
function readLines(text: string): string[] {
  const out: string[] = [];
  let inWrite = false;
  for (const line of text.split("\n")) {
    if (/^ {2}def find_by_id_for_write\(/.test(line)) inWrite = true;
    else if (inWrite && /^ {2}end$/.test(line)) {
      inWrite = false;
      continue;
    }
    if (!inWrite) out.push(line);
  }
  return out;
}

describe("elixir read-scope census (#3964)", () => {
  it("covers a real population", () => {
    expect(ELIXIR_CASES.length).toBeGreaterThan(50);
  });

  it.each(ELIXIR_CASES)("%s: no read module spells a restriction", async (id) => {
    const files = await generateCorpusCase(id, "vanilla");
    const lib = [...files].filter(([p]) => /\/lib\/.*\.ex$/.test(p));
    const schemas = lib.filter(([, t]) => isScopedSchema(t));
    const schemaPaths = new Set(schemas.map(([p]) => p));
    const spellings = new Set(
      schemas
        .flatMap(([, t]) => hostedPredicates(t))
        // `fragment("false")` (a `deny`) is not a spelling a read could share.
        .filter((p) => p !== `fragment("false")`),
    );
    for (const [path, text] of lib) {
      if (schemaPaths.has(path)) continue;
      // An Ecto query's predicate — `where:` in `from(...)` or a `where(...)`
      // pipe.  A `shape: document` read evaluates its restrictions IN-APP over
      // the rehydrated embed (`Enum.filter`), which is not an Ecto query and
      // has no `prepare_query` to ride.
      const queryLines = readLines(text).filter((l) => /\bwhere(:|\()/.test(l));
      for (const line of queryLines) {
        expect(
          /\brecord\.kind (==|!=) "/.test(line),
          `${path}: a hand-written discriminator on a read:\n${line}`,
        ).toBe(false);
        for (const s of spellings) {
          expect(line.includes(s), `${path} spells a hosted restriction inline: ${s}`).toBe(false);
        }
      }
    }
  });

  it.each(ELIXIR_CASES)("%s: each schema hosts every restriction of the IR fact", async (id) => {
    const files = await generateCorpusCase(id, "vanilla");
    const loom = await buildLoomModel(corpusSourceFor(id, "vanilla"));
    const schemaOf = (agg: string): [string, string] | undefined =>
      [...files].find(
        ([p, t]) =>
          p.endsWith(".ex") &&
          isScopedSchema(t) &&
          new RegExp(`^defmodule \\S+\\.${upperFirst(agg)} do$`, "m").test(t),
      );
    for (const ctx of enrichedContexts(loom)) {
      const pool = ctx.aggregates;
      for (const agg of pool) {
        const hit = schemaOf(agg.name);
        if (!hit) continue;
        const [path, schema] = hit;
        const contextModule = new RegExp(
          `^defmodule (\\S+)\\.${upperFirst(agg.name)} do$`,
          "m",
        ).exec(schema)![1]!;
        const scope = ectoReadScope(agg, pool, contextModule);
        const hosted = hostedPredicates(schema).join("\n");
        if (scope.baseWhere) expect(hosted, `${path}: base_query`).toContain(scope.baseWhere);
        for (const c of scope.clauses) {
          expect(schema, `${path}: the ${c.key} clause`).toContain(
            `def __loom_filter__(query, :${c.key}, `,
          );
          expect(hosted, `${path}: the ${c.key} predicate`).toContain(c.predicate);
        }
        // Every predicate-bearing restriction of the IR fact is rendered into
        // the schema, the subtypes' own ones on a TPH root included.
        const fact = readScopeFor(agg, pool);
        const preds = [
          ...readFilterRestrictions(fact).map((r) => r.predicate),
          ...fact.subtypeRestrictions.map((g) => g.restriction.predicate!),
        ];
        for (const p of preds) {
          expect(hosted, `${path}: hosts ${agg.name}'s restriction`).toContain(
            renderEctoRestriction(p, contextModule),
          );
        }
      }
    }
  });
});
