// A criterion read comparing a column against a NULLABLE value — a
// `currentUser.<claim>` declared `T?`, or an optional criterion param.
//
// Drizzle types `eq`/`ne`/`lt`/… as `(column, column | value)` with no `null`
// in the value union, so the old emission `eq(col, currentUser.technicianId)`
// (claim typed `Ids.TechnicianId | null`) fails the generated project's
// `tsc --noEmit` with TS2769 — on a model that validates clean.  So the
// predicate branches on the runtime value: null → IS [NOT] NULL (Loom's
// `null == null` is true), otherwise the ordinary comparison with the value
// narrowed to non-null.
//
// Also pins eval item #19: the generated node Dockerfile type-checks before
// it bundles (tsup strips types without checking them).

import { describe, expect, it } from "vitest";
import { DOCKERFILE_TS } from "../../../src/platform/hono/v4/emit.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

const src = `
system X {
  user { id: string  technicianId: Technician id? }
  auth { enforcement: opt, oidc { issuer: env("I") clientId: env("C") } }
  subdomain S { context C {
    aggregate Technician with crudish { fullName: string  derived display: string = fullName }
    aggregate WorkOrder with crudish { technicianId: Technician id?  priority: int  derived display: string = "wo" }
    repository Technicians for Technician { }
    repository WorkOrders for WorkOrder
    criterion Mine of WorkOrder = this.technicianId == currentUser.technicianId
    criterion NotMine of WorkOrder = currentUser.technicianId != this.technicianId
    criterion ByTech(t: Technician id?) of WorkOrder = this.technicianId == t
    criterion Above(p: int?) of WorkOrder = this.priority > p
    criterion Exact(t: Technician id) of WorkOrder = this.technicianId == t
    queryHandler ListMine(): WorkOrder[] {
      let r = WorkOrders.all(Mine())
      return r
    }
    queryHandler ListNotMine(): WorkOrder[] {
      let r = WorkOrders.all(NotMine())
      return r
    }
    queryHandler ListByTech(t: Technician id?): WorkOrder[] {
      let r = WorkOrders.all(ByTech(t))
      return r
    }
    queryHandler ListAbove(p: int?): WorkOrder[] {
      let r = WorkOrders.all(Above(p))
      return r
    }
    queryHandler ListExact(t: Technician id): WorkOrder[] {
      let r = WorkOrders.all(Exact(t))
      return r
    }
    policy { read WorkOrder requires true }
  } }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], auth: required, port: 3000 }
}
`;

async function repo(): Promise<string> {
  const files = await generateSystemFiles(src);
  const key = [...files.keys()].find((k) => k.endsWith("db/repositories/workOrder-repository.ts"));
  expect(key, "workOrder-repository.ts not emitted").toBeDefined();
  return files.get(key!)!;
}

/** The predicate of criterion `crit` (its reified `<crit>Criterion` fn), after
 *  checking that its read narrows by exactly that fn. */
function readLine(text: string, crit: string): string {
  const fn = `${crit[0]!.toLowerCase()}${crit.slice(1)}Criterion`;
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.includes(`async runFindAllBy${crit}(`));
  expect(idx, `read of ${crit} not emitted`).toBeGreaterThan(-1);
  const select = lines.slice(idx + 1, idx + 6).find((l) => l.includes("this.db.select()"));
  expect(select, `no select emitted for ${crit}`).toMatch(new RegExp(`\\.where\\(${fn}\\(`));
  const line = lines.find((l) => l.startsWith(`const ${fn} = `));
  expect(line, `no ${fn} emitted`).toBeDefined();
  return line!.trim();
}

describe("drizzle criterion read — nullable value operand", () => {
  it("a nullable claim compares null-aware, never binding null into eq()", async () => {
    const r = await repo();
    const line = readLine(r, "Mine");
    expect(line).toContain(
      "(requireCurrentUser().technicianId == null ? isNull(schema.workOrders.technicianId) : eq(schema.workOrders.technicianId, requireCurrentUser().technicianId!))",
    );
    expect(line).not.toMatch(/=> eq\(schema\.workOrders\.technicianId, requireCurrentUser\(\)/);
  });

  it("!= with the column on the right mirrors to isNotNull / ne", async () => {
    const line = readLine(await repo(), "NotMine");
    expect(line).toContain(
      "(requireCurrentUser().technicianId == null ? isNotNull(schema.workOrders.technicianId) : ne(schema.workOrders.technicianId, requireCurrentUser().technicianId!))",
    );
  });

  it("an optional param is null-aware too; an ordering against null matches no row", async () => {
    const r = await repo();
    expect(readLine(r, "ByTech")).toContain(
      "(t == null ? isNull(schema.workOrders.technicianId) : eq(schema.workOrders.technicianId, t))",
    );
    expect(readLine(r, "Above")).toContain(
      "(p == null ? and(isNull(schema.workOrders.priority), isNotNull(schema.workOrders.priority)) : gt(schema.workOrders.priority, p))",
    );
  });

  it("a non-nullable value keeps the plain comparison (byte-identical)", async () => {
    expect(readLine(await repo(), "Exact")).toBe(
      "const exactCriterion = (t: Ids.TechnicianId) => eq(schema.workOrders.technicianId, t);",
    );
  });

  it("imports every drizzle operator the null-aware branches use", async () => {
    const r = await repo();
    const imp = r.split("\n").find((l) => l.includes('from "drizzle-orm"') && l.includes("eq"));
    expect(imp, "drizzle-orm operator import").toBeDefined();
    for (const op of ["isNull", "isNotNull", "ne", "gt", "and"]) {
      expect(imp).toMatch(new RegExp(`\\b${op}\\b`));
    }
  });
});

describe("generated node Dockerfile (eval #19)", () => {
  it("runs the typecheck before the tsup build", () => {
    const tc = DOCKERFILE_TS.indexOf("RUN npm run typecheck");
    const build = DOCKERFILE_TS.indexOf("RUN npm run build");
    expect(tc, "Dockerfile never runs `npm run typecheck`").toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(tc);
  });
});
