// A capability filter over a TPH-nullable boolean column — pairwise F15.
//
// Sharing a table is what makes a subtype's own columns nullable: only rows of
// that `kind` populate them, so the shared table declares them NULL and
// SQLAlchemy types the attribute `Mapped[bool | None]`.  `softDeletable` then
// contributes `filter !this.isDeleted`, which lowered to `not_(Row.is_deleted)`
// — and a bare `InstrumentedAttribute[bool | None]` is not a
// `ColumnElement[bool]`, so `mypy --strict` answers `[arg-type]` four times over
// (once per emitted read).  The capability is right, the layout is right; the
// INTERACTION is the defect, which is exactly what the pairwise inheritance axis
// was added to reach.
//
// The fix is the explicit `.is_(True/False)` spelling for a bare nullable bool
// column in boolean position.  It is the same SQL truth in a `WHERE` — `NOT
// NULL` and `NULL IS false` each drop the row — and it typechecks.
//
// Gated over all three boolean positions the lowering has (`!x`, an `&&`/`||`
// operand, and the bare top-level filter), because the defect is a property of
// the POSITION, not of `not_`; plus the control that a plain (non-TPH) table's
// bool column keeps the byte-identical `not_(...)` spelling.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** One system, four aggregates: the three boolean positions on a TPH concrete
 *  and the non-TPH control.  `filter` is spelled directly rather than through
 *  `softDeletable` so each position is visible in the fixture. */
const src = `
system S {
  subdomain D {
    context C {
      abstract aggregate ThingBase inheritanceUsing: sharedTable {
        note: string
      }
      // (1) negated:  the softDeletable shape.
      aggregate Negated extends ThingBase with crudish {
        archived: bool = false
        filter !this.archived
      }
      // (2) an && operand, beside a comparison that is already a predicate.
      aggregate Conjoined extends ThingBase with crudish {
        live: bool = false
        rank: int = 0
        filter this.live && this.rank > 0
      }
      // (3) the bare top-level filter, which lands straight in .where(...).
      aggregate Bare extends ThingBase with crudish {
        visible: bool = false
        filter this.visible
      }
      // The control: same filter, no inheritance — a plain table's bool column
      // is NOT NULL, so nothing about its emission may change.
      aggregate Flat with crudish {
        archived: bool = false
        filter !this.archived
      }
      repository Negateds for Negated { }
      repository Conjoineds for Conjoined { }
      repository Bares for Bare { }
      repository Flats for Flat { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: python, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}
`;

async function file(suffix: string): Promise<string> {
  const all = await generateSystemFiles(src);
  const key = [...all.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return all.get(key as string) as string;
}

/** The read-scope hook, where every read restriction is rendered once. */
const scope = (): Promise<string> => file("app/db/read_scope.py");

describe("a TPH-nullable bool column in boolean position (F15)", () => {
  it("the schema really declares the column nullable — the premise, not an assumption", async () => {
    const all = await generateSystemFiles(src);
    const schema = all.get([...all.keys()].find((k) => k.endsWith("app/db/schema.py")) as string)!;
    expect(schema).toContain("archived: Mapped[bool | None]");
    // …and the control's is not, which is why the control may keep `not_`.
    expect(schema).toContain("archived: Mapped[bool] = mapped_column(Boolean)");
  });

  it("a negated nullable bool renders .is_(False), never not_()", async () => {
    const py = await scope();
    expect(py).toContain('or_(cls.kind != "Negated", cls.archived.is_(False))');
    expect(py).not.toContain("not_(cls.archived.");
  });

  it("an && operand renders .is_(True) beside the comparison it conjoins", async () => {
    const py = await scope();
    expect(py).toContain("cls.live.is_(True)");
    expect(py).toContain("(cls.rank > 0)");
    // The comparison is already a ColumnElement[bool] — it must NOT be wrapped.
    expect(py).not.toContain("> 0).is_(");
  });

  it("the bare top-level filter renders .is_(True)", async () => {
    expect(await scope()).toContain('or_(cls.kind != "Bare", cls.visible.is_(True))');
  });

  it("no read of a TPH concrete spells the predicate — the hook applies it to every one", async () => {
    const py = await file("app/db/repositories/negated_repository.py");
    const reads = py.split("\n").filter((l) => l.includes("select(NegatedRow)"));
    expect(reads.length, "no reads emitted — the sweep would be vacuous").toBeGreaterThan(2);
    for (const line of reads) expect(line).not.toContain("archived");
  });

  it("a NON-TPH aggregate keeps the not_() spelling", async () => {
    // The coercion is scoped to columns the shared table actually made
    // nullable; on a plain table `Mapped[bool]` is already a ColumnElement[bool].
    const py = await scope();
    expect(py).toContain(
      "with_loader_criteria(FlatRow, lambda cls: not_(cls.archived), include_aliases=True)",
    );
    expect(py).not.toContain("cls.archived.is_(True)");
  });
});
