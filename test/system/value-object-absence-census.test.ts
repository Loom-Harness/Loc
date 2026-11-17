// Gate for D-ONE-SCHEMA (docs/decisions).
import { readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// ---------------------------------------------------------------------------
// Optional value-object absence census (D-ONE-SCHEMA).
//
// THE INVARIANT.  An optional value object stored as leaf columns reads back
// as absent when the leaves it requires are NULL — one rule, decided once by
// `absenceProbe` (`src/ir/plan/value-object-columns.ts`), and made exact by the
// shared null-consistency CHECK.  A reader that picks its own probe leaves (the
// first leaf, the first required leaf, every leaf) answers differently on a
// row the next reader takes the other way, the defect the CHECK and the
// multi-backend matrix exist to rule out.
//
// THE DETECTOR.  In every emitter file that walks value-object leaves
// (mentions `voLeaves`, a `VoLeaf` type or a `…LeafPaths` helper), a
// `filter`/`find` that picks leaves by `!x.nullable` / `!x.optional` is a
// re-derivation of the probe.  No waivers: such a file asks `absenceProbe`.
//
// THE READERS.  Each file that renders an optional value object's absence
// takes its probe from `absenceProbe`; a listed reader that stops importing it
// fails, so the list stays the live set.
//
// ORM-NATIVE MAPPINGS.  EF Core and Hibernate map an optional value object
// through the ORM, which decides existence by its own rule; they render no
// probe.  That rule answers like `absenceProbe` on every row the shared CHECK
// admits, and the multi-backend matrix's `ABSENCE_ROWS` cells (which fail when
// the CHECK is loosened) keep it so.  Each is a `standing` entry with its
// reason; one that starts importing `absenceProbe` moves to READERS.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOTS = ["src/generator", "src/platform"];
const PLAN = "src/ir/plan/value-object-columns.ts";

/** The emitters that render an optional value object's absence. */
const READERS = [
  "src/generator/typescript/repository-find-hydrate.ts",
  "src/generator/typescript/raw-row-wire.ts",
  "src/generator/typescript/emit/mikroorm-entities.ts",
  "src/generator/dotnet/emit/dapper.ts",
  "src/generator/python/repository-builder.ts",
  "src/generator/elixir/vanilla/schema-emit.ts",
];

/** Mappings that leave existence to the ORM — standing, with the reason. */
const ORM_NATIVE: Record<string, { standing: string }> = {
  "src/generator/dotnet/emit/efcore.ts": {
    standing:
      "EF Core owned type: the ORM's existence check over the owned columns; equals absenceProbe on every row the CHECK admits (#6155)",
  },
  "src/generator/java/emit/enums-vos.ts": {
    standing:
      "Hibernate @Embedded record: absent when every column is NULL; equals absenceProbe on every row the CHECK admits (#6155)",
  },
};

const WALKS_LEAVES = /\bvoLeaves\b|\bVoLeaf\b|\w+LeafPaths\b/;
const PICKS_BY_OPTIONALITY =
  /\b(?:filter|find)\(\s*\(?(\w+)\)?\s*=>\s*!\s*\1\.(?:nullable|optional)\b/g;

function files(dir: string): string[] {
  const abs = path.join(repoRoot, dir);
  return readdirSync(abs).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(repoRoot, rel)).isDirectory()) return files(rel);
    return rel.endsWith(".ts") ? [rel] : [];
  });
}

/** `file:line` of every leaf pick by optionality in a leaf-walking file. */
function reDerivations(rel: string, text: string): string[] {
  if (!WALKS_LEAVES.test(text)) return [];
  const out: string[] = [];
  for (const m of text.matchAll(PICKS_BY_OPTIONALITY)) {
    out.push(`${rel}:${text.slice(0, m.index).split("\n").length}`);
  }
  return out;
}

describe("optional value-object absence census", () => {
  it("the detector sees a probe picked from the leaves", () => {
    const seeded = "interface VoLeaf {}\nconst p = leaves.find((l) => !l.optional);\n";
    expect(reDerivations("seeded.ts", seeded)).toEqual(["seeded.ts:2"]);
    expect(reDerivations("seeded.ts", "const p = fields.find((f) => !f.optional);\n")).toEqual([]);
  });

  it("no emitter picks probe leaves by optionality — it asks absenceProbe", () => {
    const all = ROOTS.flatMap(files);
    expectReach("emitter files", all.length, 750);
    expectReach(
      "leaf-walking emitter files",
      all.filter((rel) => WALKS_LEAVES.test(readFileSync(path.join(repoRoot, rel), "utf8"))).length,
      3,
    );
    const found = all.flatMap((rel) =>
      reDerivations(rel, readFileSync(path.join(repoRoot, rel), "utf8")),
    );
    expect(found).toEqual([]);
  });

  it("every listed reader takes its probe from absenceProbe", () => {
    const stale = READERS.filter((rel) => {
      const text = readFileSync(path.join(repoRoot, rel), "utf8");
      return !/\babsenceProbe\b[^;]*from "[./]*ir\/plan\/value-object-columns\.js"/.test(text);
    });
    expect(stale).toEqual([]);
    for (const [rel, w] of Object.entries(ORM_NATIVE)) {
      expect(w.standing.trim().length, rel).toBeGreaterThan(0);
      expect(readFileSync(path.join(repoRoot, rel), "utf8"), rel).not.toMatch(/\babsenceProbe\b/);
    }
    expect(readFileSync(path.join(repoRoot, PLAN), "utf8")).toContain(
      "export function absenceProbe(",
    );
  });
});
