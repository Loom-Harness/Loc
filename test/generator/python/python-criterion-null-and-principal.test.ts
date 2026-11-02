// Two changes to the Python/FastAPI read path, both in a `criterion` a
// `retrieval` runs — one a real defect, one a cleanup.  Kept in one file
// because they are one emission path, but they are NOT the same severity and
// the file says which is which.
//
// F-013 — THE DEFECT.  Invisible to `python -m compileall`, because Python
// binds names at execution: an unbound name is a valid module that raises
// `NameError` on the first request.
//
// `criterion Mine() of WorkOrder = this.technicianUserId == currentUser.id`
//   emitted, inside `run_my_work_orders(self, offset, limit)`:
//
//     query = select(WorkOrderRow).where((WorkOrderRow.technician_user_id == current_user.id))
//                                                                            ^^^^^^^^^^^^ unbound
//
//   The SAME line is correct for the compiler-generated tenancy filter, which
//   lowers with `require_current_user()`, and wrong here.  A retrieval's
//   signature is fixed by the DSL and gains no principal parameter, so the name
//   is simply free.  `ruff check` → `F821 Undefined name 'current_user'`; at
//   runtime, `NameError` on the first request.
//
// F-007 (python half) — THE CLEANUP, and it is honest about being one.
//   `this.technicianId != null` emitted `(WorkOrderRow.technician_id != None)`.
//   SQLAlchemy overloads `__ne__`, so that SQL is right (`IS NOT NULL`), and the
//   emitted `pyproject.toml` already waives the style rule that would flag it —
//   `ignore = ["E711", …]`, with a comment saying exactly why ("in SQLAlchemy
//   predicates `== True` / `!= None` are the operator-overloaded forms, not
//   style slips").  Nothing was red.  Unlike the node half, where `ne(col,
//   null)` was a hard TS2769.
//
//   `.is_not(None)` is pinned anyway: same SQL, same shape as the node fix, and
//   it removes the predicate side of the reason the waiver exists.  Measured:
//   with the waiver dropped (`ruff --isolated --select E4,E7,E9,F`), E711 no
//   longer fires on the showcase python deployable at all — only E712
//   (`== True`), which is a different shape and a different slice.
//
// NON-VACUITY: an ordinary comparison in the same system must still render
// `==`/`!=` against a bind value.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const REPO = "ops_svc/app/db/repositories/work_order_repository.py";

function system(body: string): string {
  return `system Acme {
  user { id: string }
  subdomain Core {
    context Ops {
      aggregate Tech with crudish { name: string }
      repository Techs for Tech
      aggregate WorkOrder with crudish {
        title: string
        technicianId: Tech id?
        technicianUserId: string
      }
${body}
    }
  }
  api OpsApi from Core
  storage primary { type: postgres }
  resource opsState { for: Ops, kind: state, use: primary }
  deployable opsSvc {
    platform: python  contexts: [Ops]  dataSources: [opsState]  serves: OpsApi  auth: required  port: 3000
  }
}`;
}

async function repo(body: string): Promise<string> {
  const files = await generateSystemFiles(system(body));
  const src = files.get(REPO);
  expect(src, `${REPO} was not emitted — the fixture, not the assertion, is broken`).toBeDefined();
  return src!;
}

describe("python retrieval reads the principal through require_current_user() (F-013)", () => {
  it("a currentUser-scoped criterion in a retrieval binds no free name", async () => {
    const src =
      await repo(`      criterion MineAsTechnician() of WorkOrder = this.technicianUserId == currentUser.id
      retrieval MyWorkOrders() of WorkOrder { where: MineAsTechnician()  sort: [title desc] }
      repository WorkOrders for WorkOrder`);

    // The F821 shape itself, asserted FIRST so a regression fails on the
    // defect rather than on the replacement spelling: the retrieval method
    // declares no `current_user` parameter, so it must not mention the bare
    // name at all.  (`require_current_user()` is excluded by the leading
    // `[^_.]`, which the `_` in `require_current_user` fails.)
    const run = src.slice(src.indexOf("    async def run_my_work_orders"));
    const next = run.indexOf("\n    async def", 1);
    const body = next === -1 ? run : run.slice(0, next);
    expect(body, "run_my_work_orders must exist for this assertion to mean anything").toContain(
      "select(WorkOrderRow)",
    );
    expect(body).not.toMatch(/[^_.]\bcurrent_user\b/);

    expect(src).toContain(
      "query = select(WorkOrderRow).where((WorkOrderRow.technician_user_id == require_current_user().id))",
    );
    // …and the accessor has to be imported, or F821 is merely traded for F821.
    expect(src).toMatch(/^from app\.auth\.user import .*\brequire_current_user\b/m);
  });
});

describe("python lowers a null comparison to is_() / is_not() (F-007 cleanup)", () => {
  it("`!= null` becomes .is_not(None) and `== null` becomes .is_(None)", async () => {
    const src = await repo(`      criterion Assigned() of WorkOrder = this.technicianId != null
      criterion Unassigned() of WorkOrder = null == this.technicianId
      retrieval AssignedOrders() of WorkOrder { where: Assigned() }
      retrieval UnassignedOrders() of WorkOrder { where: Unassigned() }
      repository WorkOrders for WorkOrder`);

    expect(src).toContain("select(WorkOrderRow).where(WorkOrderRow.technician_id.is_not(None))");
    expect(src).toContain("select(WorkOrderRow).where(WorkOrderRow.technician_id.is_(None))");
    // The E711 shape itself — no `== None` / `!= None` anywhere in the file.
    expect(src).not.toMatch(/[!=]= None\b/);
  });

  it("NON-VACUITY: an ordinary comparison still renders as == / != on a bind", async () => {
    const src = await repo(`      criterion Titled(t: string) of WorkOrder = this.title == t
      criterion NotTitled(t: string) of WorkOrder = this.title != t
      criterion Assigned() of WorkOrder = this.technicianId != null
      retrieval TitledOrders(t: string) of WorkOrder { where: Titled(t) }
      retrieval NotTitledOrders(t: string) of WorkOrder { where: NotTitled(t) }
      retrieval AssignedOrders() of WorkOrder { where: Assigned() }
      repository WorkOrders for WorkOrder`);

    expect(src).toContain("(WorkOrderRow.title == t)");
    expect(src).toContain("(WorkOrderRow.title != t)");
    // …and the null one in the same file still took the IS NULL path.
    expect(src).toContain("WorkOrderRow.technician_id.is_not(None)");
    expect(src).not.toContain("WorkOrderRow.title.is_(None)");
  });
});
