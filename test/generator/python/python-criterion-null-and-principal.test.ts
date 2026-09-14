// Two defects in the Python/FastAPI read path, both in a `criterion` a
// `retrieval` runs, and both invisible to `python -m compileall` (Python binds
// names at execution, and `x == None` is perfectly legal syntax).  The
// generated project's OWN linter is what sees them — `pyproject.toml` declares
// `ruff>=0.8,<1`, and ruff's default rule set (`E4`, `E7`, `E9`, `F`) carries
// both codes.
//
// F-013 — `criterion Mine() of WorkOrder = this.technicianUserId == currentUser.id`
//   emitted, inside `run_my_work_orders(self, offset, limit)`:
//
//     query = select(WorkOrderRow).where((WorkOrderRow.technician_user_id == current_user.id))
//                                                                            ^^^^^^^^^^^^ unbound
//
//   The SAME line is correct for the compiler-generated tenancy filter, which
//   lowers with `require_current_user()`, and wrong here.  A `find` gets away
//   with the bare name because `relationalFindMethod` appends a
//   `current_user: User` parameter; a retrieval's signature is fixed by the DSL
//   and gains none, so the name is simply free.  `ruff check` → `F821 Undefined
//   name 'current_user'`; at runtime, `NameError` on the first request.
//
// F-007 (python half) — `this.technicianId != null` emitted
//   `(WorkOrderRow.technician_id != None)`.  SQLAlchemy overloads `__ne__`, so
//   the SQL is right (`IS NOT NULL`) — but the LINE is `E711 comparison to
//   None`.  `.is_not(None)` is the same SQL and the lint-clean spelling.
//
// NON-VACUITY is asserted in both directions: an ordinary comparison in the
// same system must still render `==`/`!=` against a bind value, and a find (the
// path that DOES take a principal parameter) must keep the bare `current_user`
// it binds — a fix that rewrote every principal read to the ambient accessor
// would leave the find's parameter unused, which is ruff `ARG002`/dead weight.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const REPO = "ops_svc/app/db/repositories/work_order_repository.py";

function system(body: string): string {
  return `system Acme {
  user { id: string }
  subdomain Core {
    context Ops {
      aggregate Tech with crudish { name: string }
      repository Techs for Tech { }
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
      repository WorkOrders for WorkOrder { }`);

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

  it("NON-VACUITY: a `find` still threads the principal as its own parameter", async () => {
    const src = await repo(`      repository WorkOrders for WorkOrder {
        find mine(): WorkOrder[] where technicianUserId == currentUser.id
      }`);

    // The find DECLARES the principal, so the bare name is bound here and the
    // ambient accessor would make the parameter dead.
    expect(src).toContain("async def mine(self, current_user: User)");
    expect(src).toContain("WorkOrderRow.technician_user_id == current_user.id");
    expect(src).not.toContain("require_current_user().id");
  });
});

describe("python lowers a null comparison to is_() / is_not() (F-007, E711)", () => {
  it("`!= null` becomes .is_not(None) and `== null` becomes .is_(None)", async () => {
    const src = await repo(`      criterion Assigned() of WorkOrder = this.technicianId != null
      criterion Unassigned() of WorkOrder = null == this.technicianId
      retrieval AssignedOrders() of WorkOrder { where: Assigned() }
      retrieval UnassignedOrders() of WorkOrder { where: Unassigned() }
      repository WorkOrders for WorkOrder { }`);

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
      repository WorkOrders for WorkOrder { }`);

    expect(src).toContain("(WorkOrderRow.title == t)");
    expect(src).toContain("(WorkOrderRow.title != t)");
    // …and the null one in the same file still took the IS NULL path.
    expect(src).toContain("WorkOrderRow.technician_id.is_not(None)");
    expect(src).not.toContain("WorkOrderRow.title.is_(None)");
  });
});
