import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// M-T6.14 — the saga / projection EF `HasColumnName` CORRELATION.
//
// The bug the mission names (from the S7 Slice C review): a workflow saga-state
// row and a projection read-model row are EF-mapped entities whose TABLE is
// created by the phase-⑨ migration chain, not by EF.  Those two halves are
// emitted by different files from different inputs — `workflow-state-emit.ts` /
// `projection-state-emit.ts` build the `IEntityTypeConfiguration`, while
// `migrations-builder.ts` → `sql-pg.ts` builds the DDL — and they agree only
// because each independently spells `snake(field.name)`.  When they disagreed,
// EF fell back to the PascalCase property name and every read by correlation
// threw `42703 column does not exist` at runtime: compile-green on
// `dotnet build /warnaserror`, because a column name is a string.
//
// WHY THIS TEST IS NOT "the config contains HasColumnName(...)".  A spot
// assertion for a literal the emitter also writes verifies CONSISTENCY, not
// CORRECTNESS (completion-waves §3 rule 12) — it passes just as happily if both
// sides drift together, and says nothing at all about the columns it forgot to
// name.  So the expected value here comes from OUTSIDE the EF emitter: the
// emitted MIGRATION SQL is parsed for the table's real column list, and the
// config's `HasColumnName` set must equal it, column for column, for every
// state-carrying table in the project.  It also sweeps (rule 11) rather than
// sampling: one table with a correct mapping proves nothing about the next.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

/** `builder.ToTable("<table>"[, "<schema>"])` — the table an EF configuration
 *  maps, as the migration DDL spells it. */
function mappedTable(cfg: string): string | undefined {
  return /builder\.ToTable\("([^"]+)"/.exec(cfg)?.[1];
}

/** Every `HasColumnName("<col>")` in an EF configuration. */
function mappedColumns(cfg: string): string[] {
  return [...cfg.matchAll(/\.HasColumnName\("([^"]+)"\)/g)].map((m) => m[1] as string).sort();
}

/** The column list of `CREATE TABLE … "<table>" ( … )` in the emitted migration
 *  SQL.  Reads the DDL, which is derived from `MigrationsIR` — a different
 *  input, through a different renderer, from the EF configuration. */
function ddlColumns(sql: string, table: string): string[] | undefined {
  const open = new RegExp(`CREATE TABLE (?:""[^"]+""\\.)?""${table}"" \\(`).exec(sql);
  if (!open) return undefined;
  const body = sql.slice(open.index + open[0].length);
  const end = body.indexOf("\n);");
  if (end < 0) return undefined;
  return body
    .slice(0, end)
    .split("\n")
    .map((l) => /^\s*""([^"]+)""\s/.exec(l)?.[1])
    .filter((c): c is string => c !== undefined)
    .sort();
}

describe("dotnet — saga / projection state tables map the columns the migration creates", () => {
  it("every state-row configuration's HasColumnName set equals its table's DDL columns", async () => {
    // Two corpus fixtures, because the two emitters are separate files: `saga`
    // carries a correlated workflow (`workflow-state-emit.ts`), `projection` a
    // keyed read model (`projection-state-emit.ts`).  A single fixture would
    // leave one arm unexercised — the shape rule 13 exists for.
    let checked = 0;
    for (const fixture of ["saga", "projection"]) {
      const src = fs
        .readFileSync(path.join(repoRoot, "test", "fixtures", "corpus", `${fixture}.ddd`), "utf8")
        .replace("__PLATFORM__", "dotnet");
      const files = await generateSystemFiles(src);
      const migration = [...files.entries()]
        .filter(([p]) => /Migrations\/.*\.cs$/.test(p))
        .map(([, c]) => c)
        .join("\n");
      expect(migration, `${fixture}: no migration emitted`).not.toBe("");

      for (const [p, cfg] of files) {
        // The saga-state / projection-row configurations only; an AGGREGATE's
        // configuration maps columns EF itself can create and is not the
        // correlation this mission names.
        if (!/Configurations\/.*(State|Row)Configuration\.cs$/.test(p)) continue;
        const table = mappedTable(cfg);
        expect(table, `${p}: no ToTable`).toBeDefined();
        const declared = ddlColumns(migration, table!);
        expect(declared, `${p}: table "${table}" is in no emitted migration`).toBeDefined();
        expect(
          mappedColumns(cfg),
          `${p}: the EF model and the migration DDL disagree on table "${table}" — ` +
            "an unnamed column falls back to the PascalCase property and 42703s at runtime",
        ).toEqual(declared);
        checked++;
      }
    }
    // Vacuity guard: a rename of the configuration files would make the loop
    // above select nothing and pass while checking nothing.
    expect(checked, "no state-row configurations found — the selector went blind").toBeGreaterThan(
      1,
    );
  }, 120_000);
});
