// Regression (F-008, residual sites): a value object declared in ANOTHER
// context of the same system, consumed by the two aggregate shapes whose python
// emission still resolved it against the consuming context's OWN value objects.
//
// F-008's core — the relational repository binding `"location"` / reading
// `row.location` against a `schema.py` that declares `location_value` — was
// closed in `repository-builder.ts` by #3060.  The same bare
// `ctx.valueObjects.find(...)` survived at two more per-context call sites, and a
// miss there does not fail, it FALLS BACK to one opaque column named after the
// field:
//
//   - `py-columns.columnsFor`, reached per context by `tphAssertNarrow` (and
//     `find-predicate`).  A TPH concrete's own required field is narrowed before
//     hydration with `assert row.<col> is not None`; for a sibling-context VO it
//     narrowed `row.code` on a row model that declares only `code_value` — an
//     `AttributeError` on EVERY read of the aggregate.  (So F-008 did have an
//     inheritance-shaped arm after all — just not the one first reported.)
//   - the event-sourced `to_wire`, which put the VO dataclass itself on the wire
//     (`"code": root.code`) where every other path emits `{"value": …}`; the
//     route's pydantic `response_model` rejects a dataclass for a `BaseModel`
//     field, so every read 500s.
//
// The schema emitter never misses: it runs on the MERGED context
// (`renderPySchema(merged, …)`), where a sibling VO is an own one.  The callers
// above run PER CONTEXT.  That asymmetry is the whole defect class.
//
// WHY THIS FIXTURE SHAPE (experience_gathered.md §118): the defect needs a VO
// declared in context A and consumed in context B, with BOTH contexts on ONE
// python deployable — and the consumer must be a TPH concrete or an
// event-sourced aggregate.  The corpus row `vo-cross-context` carries the first
// two properties with a plain relational consumer only, which #3060 already
// fixed, so it passes over both residual sites.  The first test asserts this
// fixture keeps all three properties.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
  system S {
    subdomain D {
      context A {
        valueobject Code { value: string }
        aggregate Holder with crudish {
          name: string
          code: Code
          derived display: string = name
        }
        repository Holders for Holder { }
      }
      context B {
        event Opened { ledger: Ledger id, code: Code }
        aggregate Ledger persistedAs: eventLog {
          code: Code
          create open(code: Code) { emit Opened { ledger: id, code: code } }
          apply(e: Opened) { code := e.code }
        }
        repository Ledgers for Ledger { }

        abstract aggregate Party inheritanceUsing: sharedTable {
          label: string
          derived display: string = label
        }
        aggregate Shipper extends Party with crudish {
          code: Code
        }
        repository Shippers for Shipper { }
      }
    }
    storage primary { type: postgres }
    resource aState { for: A, kind: state, use: primary }
    resource bState { for: B, kind: state, use: primary }
    resource bLog { for: B, kind: eventLog, use: primary }
    deployable api { platform: python  contexts: [A, B]  dataSources: [aState, bState, bLog]  port: 3000 }
  }
`;

function pick(files: Map<string, string>, suffix: string): string {
  const k = [...files.keys()].find((key) => key.endsWith(suffix));
  expect(k, `${suffix} not emitted`).toBeDefined();
  return files.get(k!)!;
}

/** Every `<attr>: Mapped[...]` the named row model declares. */
function declaredColumns(schema: string, rowClass: string): Set<string> {
  const from = schema.slice(schema.indexOf(`class ${rowClass}(`));
  const nextClass = from.indexOf("\nclass ", 1);
  const body = from.slice(0, nextClass === -1 ? undefined : nextClass);
  return new Set([...body.matchAll(/^\s{4}(\w+): Mapped\[/gm)].map((m) => m[1]!));
}

describe("python — a sibling-context value object on a TPH concrete and an event-sourced aggregate", () => {
  it("keeps the fixture's reaching shape", async () => {
    // §118: a fixture that loses the defect's shape keeps passing over it.
    const files = await generateSystemFiles(SRC);
    const schema = pick(files, "app/db/schema.py");
    // Both contexts on ONE python deployable (one schema.py, two pg schemas)…
    expect(schema).toContain('{"schema": "a"}');
    expect(schema).toContain('{"schema": "b"}');
    // …`Code` declared in A, so for B it is a sibling, not an own VO…
    expect(SRC.indexOf("valueobject Code")).toBeGreaterThan(SRC.indexOf("context A"));
    expect(SRC.indexOf("valueobject Code")).toBeLessThan(SRC.indexOf("context B"));
    // …and B's consumers really took the TPH and event-sourced paths.
    expect(schema).not.toContain("class ShipperRow(");
    expect(declaredColumns(schema, "PartyRow")).toContain("kind");
    expect(pick(files, "app/db/repositories/ledger_repository.py")).toContain("_events");
  });

  it("TPH: narrows the flattened column before hydration, never the field name", async () => {
    const files = await generateSystemFiles(SRC);
    const repo = pick(files, "app/db/repositories/shipper_repository.py");
    expect(repo).toContain("assert row.code_value is not None");
    expect(repo).not.toContain("assert row.code is not None");
  });

  it("TPH: every column the hydrate reads is one PartyRow declares", async () => {
    // Ties the repository to its OWN schema.py — the disagreement F-008 was —
    // in the form that catches any future divergence on the read path.
    const files = await generateSystemFiles(SRC);
    const declared = declaredColumns(pick(files, "app/db/schema.py"), "PartyRow");
    const repo = pick(files, "app/db/repositories/shipper_repository.py");
    const hydrate = repo.slice(repo.indexOf("def _hydrate"));
    const read = [...new Set([...hydrate.matchAll(/\brow\.(\w+)\b/g)].map((m) => m[1]!))];
    expect(read.length).toBeGreaterThan(0);
    for (const attr of read) {
      expect(declared, `read column ${attr} is not declared on PartyRow`).toContain(attr);
    }
  });

  it("event-sourced: to_wire nests the VO as a wire dict, not the domain dataclass", async () => {
    const files = await generateSystemFiles(SRC);
    const repo = pick(files, "app/db/repositories/ledger_repository.py");
    const toWire = repo.slice(repo.indexOf("def to_wire"));
    expect(toWire).toContain('"code": {"value": root.code.value},');
    expect(toWire).not.toContain('"code": root.code,');
  });
});
