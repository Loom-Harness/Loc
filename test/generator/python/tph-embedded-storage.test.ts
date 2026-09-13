// TPH (`sharedTable`) beats the saving-shape modifier — pairwise F13.
//
// `shape: embedded` on a concrete that shares its abstract base's table is the
// one crossing where the two storage decisions collide, and the phase-⑨
// migration builder already rules it: `tablesForOneAggregate`
// (src/system/migrations-builder.ts) tests `isTphConcrete` / `isTphBase` BEFORE
// the shape arms, so the DDL for such a concrete is the shared base table plus
// RELATIONAL child tables for its containments — no jsonb column anywhere.  The
// drizzle schema emitter agrees.  Python did not: its emit loop tested the shape
// first, so it emitted a SECOND table (`things`, with a jsonb `lines` column)
// that no migration creates, while the base table already carried the same
// columns.  The repository then straddled both — `save` wrote `ThingRow`, a find
// read `ThingBaseRow` — and imported only the first, which is F13's `ruff` F821.
//
// Two oracles, because the import error was the SYMPTOM and the phantom table
// was the defect:
//
//   * a SWEEP over every emitted module for a row class / `PagedResult` used but
//     never imported (`experience_gathered.md` §104 — the bug travels on the
//     import-obligation axis, so the gate asserts over every module, with a
//     vacuity guard that the fixture really produces the shape);
//   * the declared `__tablename__` set checked against the CREATE TABLE set in
//     the emitted migration SQL — an expected value from OUTSIDE this emitter
//     (rule 12), which is the only assertion that can see a table nothing
//     creates.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const src = `
system S {
  subdomain D {
    context C {
      abstract aggregate ThingBase inheritanceUsing: sharedTable {
        note: string
      }
      // The subject: an EMBEDDED concrete of a sharedTable base.
      aggregate Thing extends ThingBase shape: embedded with crudish {
        label: string
        amount: int = 0
        contains lines: Line[]
        entity Line {
          sku: string
          qty: int
        }
      }
      // A sibling concrete with no shape modifier at all — the control that
      // says the shared table is genuinely shared, and the reason the sweep
      // sees more than one row class.
      aggregate Gadget extends ThingBase with crudish {
        code: string
      }
      repository Things for Thing {
        find byLabel(l: string): Thing paged where this.label == l
      }
      repository Gadgets for Gadget { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: python, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}
`;

async function files(): Promise<Map<string, string>> {
  return await generateSystemFiles(src);
}

async function file(suffix: string): Promise<string> {
  const all = await files();
  const key = [...all.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return all.get(key as string) as string;
}

/** Python source with every string literal blanked, so a name quoted inside one
 *  (a `kind` discriminator value, a log field) is not read as a reference. */
function withoutStrings(py: string): string {
  return py.replace(/"""[\s\S]*?"""/g, '""').replace(/"(?:\\.|[^"\\])*"/g, '""');
}

/** The names a module BINDS at module level: imported, or defined here.
 *
 *  Both import spellings the emitters use are read — the one-line
 *  `from x import a, b` and the parenthesised block form (`problem.py` writes
 *  one) — because a form this helper cannot parse would silently hollow the
 *  sweep out rather than fail it. */
function boundNames(py: string): Set<string> {
  const out = new Set<string>();
  const add = (names: string): void => {
    for (const n of names.split(",")) {
      const name = n.trim().split(" as ").pop()?.trim();
      if (name) out.add(name);
    }
  };
  let openImport = false;
  for (const line of py.split("\n")) {
    if (openImport) {
      add(line.replace(")", ""));
      if (line.includes(")")) openImport = false;
      continue;
    }
    const imported = /^from [\w.]+ import (.*)$/.exec(line);
    if (imported) {
      const rest = imported[1]!.trim();
      if (rest === "(") openImport = true;
      else add(rest.replace(/[()]/g, ""));
      continue;
    }
    const defined = /^(?:class|def|async def) (\w+)/.exec(line);
    if (defined) out.add(defined[1]!);
    const assigned = /^(\w+)(?::[^=]+)? = /.exec(line);
    if (assigned) out.add(assigned[1]!);
  }
  return out;
}

/** Persistence names whose import obligation this sweep enforces: every
 *  SQLAlchemy row class, plus the paged carrier the `paged` find returns. */
const PERSISTENCE_NAMES = /\b([A-Z][A-Za-z0-9]*Row|PagedResult)\b/g;

describe("a TPH concrete's `shape:` never reaches storage (F13)", () => {
  it("no emitted module uses a row class or PagedResult it never imported", async () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const [path, content] of await files()) {
      if (!path.endsWith(".py")) continue;
      scanned++;
      const bound = boundNames(content);
      for (const m of withoutStrings(content).matchAll(PERSISTENCE_NAMES)) {
        if (!bound.has(m[1]!)) offenders.push(`${path}: ${m[1]}`);
      }
    }
    expect(scanned, "no python modules emitted at all").toBeGreaterThan(10);
    expect([...new Set(offenders)], "used but never imported").toEqual([]);
  });

  it("the fixture really produces both shapes — the sweep is not vacuous", async () => {
    const repo = await file("app/db/repositories/thing_repository.py");
    // Both names the sweep hunts for are genuinely referenced by this module:
    // the TPH owner row (the shared table the concrete's rows live in) and the
    // paged carrier the declared `paged` find returns.
    expect(withoutStrings(repo)).toMatch(/\bThingBaseRow\b/);
    expect(withoutStrings(repo)).toMatch(/\bPagedResult\b/);
  });

  it("the repository targets the shared table, never a table of its own", async () => {
    // `ThingRow` is the phantom: the concrete's own pluralised table, which the
    // migration never creates.  A single reference is a write (or a read) that
    // would fail at runtime with `relation "main.things" does not exist`.
    const repo = await file("app/db/repositories/thing_repository.py");
    expect(withoutStrings(repo)).not.toMatch(/\bThingRow\b/);
  });

  it("every declared __tablename__ is a table the migration SQL creates", async () => {
    const all = await files();
    const schema = all.get([...all.keys()].find((k) => k.endsWith("app/db/schema.py")) as string)!;
    const sqlKey = [...all.keys()].find((k) => k.endsWith(".sql") && k.includes("migrations"));
    expect(sqlKey, "no migration SQL emitted").toBeDefined();
    const sql = all.get(sqlKey as string) as string;

    const declared = [...schema.matchAll(/__tablename__ = "([^"]+)"/g)].map((m) => m[1]!).sort();
    const created = [...sql.matchAll(/CREATE TABLE "[^"]+"\."([^"]+)"/g)].map((m) => m[1]!).sort();

    // Vacuity guard: the fixture must produce the real, multi-table schema this
    // crossing is about — an empty-vs-empty comparison passes and proves
    // nothing, and so does one that never reached the containment.
    expect(declared, "the fixture's own tables are missing").toEqual(["lines", "thing_bases"]);
    // Both directions.  A model with no table is the F13 defect (a write to a
    // relation that does not exist); a table with no model is its mirror.
    expect(declared).toEqual(created);
  });

  it("the containment is a child table FK'd to the SHARED base row", async () => {
    // The positive statement of what `embedded` degrades to under TPH — the
    // parent column names the BASE, not the concrete, because the base owns the
    // row the child hangs off.
    const schema = await file("app/db/schema.py");
    expect(schema).toContain('__tablename__ = "lines"');
    expect(schema).toContain('mapped_column("thing_base_id"');
    expect(schema).not.toContain("JSONB");
  });
});
