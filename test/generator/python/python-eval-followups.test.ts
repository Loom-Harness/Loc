import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Eval-closure Wave B5 — three python emission defects, pinned on the same
// fixture the `generated-python-build` tier compiles (ruff + mypy --strict):
//
// - #15a  two `contains` collections: `save` rebound ONE loop variable
//         (`child`) from `Line` to `Photo` — mypy `Incompatible types in
//         assignment` + `"Line" has no attribute "url"`.
// - B-A3a a value-object workflow-state field: the row flattens it to leaf
//         columns, yet allocation wrote `total=""` and the handler / instance
//         route read and wrote `row.total` — an attribute no column backs.
// - B-A1  a declared `find all() where <pred>` on the document, embedded and
//         event-sourced shapes: `all()` returned every row.
//
// Each positive assertion names the emitted line the fix produces; each
// negative one names the exact pre-fix shape, so a regression fails on it.
// ---------------------------------------------------------------------------

const FIXTURE = path.resolve(__dirname, "../../e2e/fixtures/python-build/eval-followups.ddd");

let files: Map<string, string>;
beforeAll(async () => {
  files = await generateSystemFiles(fs.readFileSync(FIXTURE, "utf8"));
});

function file(suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `no file ending ${suffix}`).toBeDefined();
  return files.get(key as string) as string;
}

function method(body: string, name: string): string {
  const start = body.indexOf(`    async def ${name}(`);
  expect(start, `no method ${name}`).toBeGreaterThanOrEqual(0);
  const next = body.indexOf("\n    async def ", start + 1);
  return body.slice(start, next === -1 ? undefined : next);
}

describe("#15a — two `contains` collections keep distinct save locals", () => {
  it("names each containment level's loop variable by its path", () => {
    const save = method(file("/app/db/repositories/work_order_repository.py"), "save");
    expect(save).toContain("        for __lines in aggregate.lines:");
    expect(save).toContain("        for __photos in aggregate.photos:");
    // The nested level is keyed by its parent's loop variable and its own path.
    expect(save).toContain("            for __lines_notes in __lines.notes:");
    expect(save).toContain(
      "                select(NoteRow.id).where(NoteRow.parent_id == __lines.id)",
    );
    expect(save).not.toMatch(/\bfor child in\b/);
    expect(save).not.toMatch(/\bchild_row\b/);
  });
});

describe("B-A3a — a value-object workflow-state field agrees with its columns", () => {
  it("gives the state row a property pair over the flattened leaf columns", () => {
    const schema = file("/app/db/schema.py");
    const row = schema.slice(schema.indexOf("class BillingRow(Base):"));
    expect(row).toContain("    total_amount: Mapped[Decimal] = mapped_column(Numeric)");
    expect(row).toContain(
      [
        "    @property",
        "    def total(self) -> Money:",
        "        return Money(float(self.total_amount), self.total_currency)",
        "",
        "    @total.setter",
        "    def total(self, value: Money) -> None:",
        "        self.total_amount = Decimal(str(value.amount))",
        "        self.total_currency = value.currency",
      ].join("\n"),
    );
    // Nested value object: rebuilt through its own constructor.
    expect(row).toContain(
      "        return Addr(self.ship_line1, self.ship_line2, Geo(float(self.ship_geo_lat), float(self.ship_geo_lng)))",
    );
    // Optional value object: absent when its probe column is null.
    expect(row).toContain("    def alt(self) -> Money | None:");
    expect(row).toContain(
      "        self.alt_amount = (Decimal(str(value.amount)) if value is not None else None)",
    );
    expect(schema).toContain("from app.domain.value_objects import Addr, Geo, Money");
    expect(schema).toContain("from app.db.wire import required");
  });

  it("allocates the leaf columns, not a string for the value object", () => {
    const dispatch = file("/app/dispatch.py");
    expect(dispatch).toContain(
      'state = BillingRow(order_id=__key, total_amount=Decimal("0"), total_currency="", ship_line1="", ship_geo_lat=Decimal("0"), ship_geo_lng=Decimal("0"))',
    );
    expect(dispatch).not.toContain('total=""');
    expect(dispatch).not.toContain('ship=""');
  });
});

describe("B-A1 — a declared `find all() where` keeps its filter on every python shape", () => {
  it("document: filters in-app with the ambient principal, finds read a raw load", () => {
    const repo = file("/app/db/repositories/folder_repository.py");
    const all = method(repo, "all");
    expect(all).toContain("        current_user = require_current_user()");
    expect(all).toContain("if (x.owner_user_id == current_user.id)]");
    expect(all).not.toContain("        return [_folder_from_doc(r.data, r.version) for r in rows]");
    expect(repo).toMatch(/from app\.auth\.user import [^\n]*\brequire_current_user\b/);
    // `by_title` must not layer on the now-narrowed `all()`.
    const byTitle = method(repo, "by_title");
    expect(byTitle).not.toContain("await self.all()");
    expect(byTitle).toContain("select(FolderRow).order_by(FolderRow.id)");
  });

  it("embedded: ANDs the predicate into the SQL `where`", () => {
    const all = method(file("/app/db/repositories/memo_repository.py"), "all");
    expect(all).toContain("select(MemoRow).where((MemoRow.archived == False))");
    expect(all).not.toContain("execute(select(MemoRow))).scalars()");
  });

  it("event-sourced: filters the fold, finds read the unfiltered fold", () => {
    const repo = file("/app/db/repositories/account_repository.py");
    expect(method(repo, "all")).toContain(
      "        return [a for a in await self._all_unfiltered() if a.balance > 0]",
    );
    expect(repo).toContain("    async def _all_unfiltered(self) -> list[Account]:");
    expect(method(repo, "by_owner")).toContain("await self._all_unfiltered() if a.owner == owner]");
  });
});
