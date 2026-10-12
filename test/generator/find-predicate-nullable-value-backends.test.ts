// A repository `find` comparing a column against a NULLABLE value — a
// `currentUser.<claim>` declared `T?`, or a find param typed `T?` — on the
// elixir, java and .NET-dapper backends (eval B-A6a / B-A6b; the node twin is
// #3085, whose semantics these match: `==` against null is `IS NULL`, `!=` is
// `IS NOT NULL`, an ordering against null matches no row).
//
//  - elixir: `record.col == ^(current_user && current_user.claim)` RAISED
//    `ArgumentError` ("comparison with nil is forbidden") the moment the claim
//    was nil — Ecto wraps every bare `^v` compared with `==`/`!=`/`<`/… in a
//    nil guard.  Now `type(^v, record.col)` (no guard) + an app-side nil test.
//  - java: JPQL `e.col = :#{…?.claim}` / `= :t` bound `= NULL` for a null
//    value and matched nothing.
//  - dapper: the same `= @v`, plus the id-typed claim / optional id param was
//    bound as the id STRUCT (`currentUser.TechnicianId`, `t.Value` on a
//    `TechnicianId?`), which Dapper cannot bind.
//
// Also the #3080 dapper follow-up: a find predicate over a VALUE-OBJECT LEAF
// named the flattened `<vo>_<leaf>` column the other backends store, but Dapper
// keeps the whole value object in ONE jsonb column — it must read `->>`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string) => `
system X {
  user { id: string  technicianId: Technician id?  boss: Technician id }
  auth { enforcement: opt, oidc { issuer: env("I") clientId: env("C") } }
  subdomain S { context C {
    valueobject Price { amount: decimal  currency: string }
    aggregate Technician with crudish { fullName: string  derived display: string = fullName }
    aggregate WorkOrder with crudish { technicianId: Technician id?  priority: int  cost: Price  derived display: string = "wo" }
    repository Technicians for Technician { }
    repository WorkOrders for WorkOrder {
      find mine(): WorkOrder[] requires true where this.technicianId == currentUser.technicianId
      find notMine(): WorkOrder[] requires true where currentUser.technicianId != this.technicianId
      find byTech(t: Technician id?): WorkOrder[] where this.technicianId == t
      find above(p: int?): WorkOrder[] where this.priority > p
      find exact(t: Technician id): WorkOrder[] where this.technicianId == t
      find bossOf(): WorkOrder[] requires true where this.technicianId == currentUser.boss
      find pricey(): WorkOrder[] where this.cost.amount > 100
      find inCur(c: string): WorkOrder[] where this.cost.currency == c
    }
  } }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  deployable api { platform: ${platform}, contexts: [C], dataSources: [r], auth: required, port: 3000 }
}
`;

async function file(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(src(platform));
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key!)!;
}

/** The line of `text` carrying `needle`. */
function lineWith(text: string, needle: string): string {
  const line = text.split("\n").find((l) => l.includes(needle));
  expect(line, `no line containing ${needle}`).toBeDefined();
  return line!;
}

describe("elixir (Ecto) — nullable value operand", () => {
  const repo = () => file("elixir", "c/work_order_repository.ex");

  it("a nullable claim binds through type/2 and branches on nil (no bare ^nil comparison)", async () => {
    const r = await repo();
    const mine = lineWith(r, "def mine(");
    const where = r.split("\n")[r.split("\n").indexOf(mine) + 1]!;
    expect(where).toContain(
      "where: ((^(not is_nil(current_user) and is_nil(current_user.technician_id)) and is_nil(record.technician_id)) or record.technician_id == type(^(current_user && current_user.technician_id), record.technician_id))",
    );
    expect(r).not.toMatch(/== \^\(current_user && current_user\.technician_id\)/);
  });

  it("!= mirrors to not is_nil; an optional param is null-aware; an ordering is typed, no nil arm", async () => {
    const r = await repo();
    expect(r).toContain(
      "((^(not is_nil(current_user) and is_nil(current_user.technician_id)) and not is_nil(record.technician_id)) or type(^(current_user && current_user.technician_id), record.technician_id) != record.technician_id)",
    );
    expect(r).toContain(
      "((^(is_nil(t)) and is_nil(record.technician_id)) or record.technician_id == type(^t, record.technician_id))",
    );
    expect(r).toContain("where: record.priority > type(^p, record.priority)");
  });

  it("non-nullable values keep the plain pinned comparison", async () => {
    const r = await repo();
    const exact = r.split("\n");
    const i = exact.findIndex((l) => l.includes("def exact("));
    expect(exact[i + 1]).toContain("where: record.technician_id == ^t)");
    expect(r).toContain("record.technician_id == ^(current_user && current_user.boss)");
  });
});

describe("java (JPQL) — nullable value operand", () => {
  const repo = () => file("java", "workorders/WorkOrderJpaRepository.java");

  it("a nullable claim gets an actor-present IS NULL arm", async () => {
    const r = await repo();
    expect(r).toContain(
      '@Query("select e from WorkOrder e where (e.technicianId = :#{@currentUserAccessor.user()?.technicianId()} or (:#{@currentUserAccessor.user() != null and @currentUserAccessor.user().technicianId() == null} = true and e.technicianId is null))")',
    );
    expect(r).toContain(
      '@Query("select e from WorkOrder e where (:#{@currentUserAccessor.user()?.technicianId()} <> e.technicianId or (:#{@currentUserAccessor.user() != null and @currentUserAccessor.user().technicianId() == null} = true and e.technicianId is not null))")',
    );
  });

  it("an optional param tests null in SpEL; orderings and non-nullable values stay plain", async () => {
    const r = await repo();
    expect(r).toContain(
      '@Query("select e from WorkOrder e where (e.technicianId = :t or (:#{#t == null} = true and e.technicianId is null))")',
    );
    expect(r).toContain('@Query("select e from WorkOrder e where e.priority > :p")');
    const exact = r.split("\n");
    const i = exact.findIndex((l) => l.includes("List<WorkOrder> exact("));
    expect(exact[i - 1]).toContain('where e.technicianId = :t")');
  });
});

describe(".NET dapper — nullable value operand + value-object leaf", () => {
  const repo = () =>
    file("dotnet { persistence: dapper }", "Infrastructure/Repositories/WorkOrderRepository.cs");

  it("a nullable claim / optional param compares null-aware and binds the id's .Value", async () => {
    const r = await repo();
    expect(r).toContain(
      'WHERE (technician_id = @__cu_technicianId OR (@__cu_technicianId IS NULL AND technician_id IS NULL))", new { __cu_technicianId = currentUser.TechnicianId?.Value }',
    );
    expect(r).toContain(
      "WHERE (@__cu_technicianId <> technician_id OR (@__cu_technicianId IS NULL AND technician_id IS NOT NULL))",
    );
    expect(r).toContain(
      'WHERE (technician_id = @t OR (@t IS NULL AND technician_id IS NULL))", new { t = t?.Value }',
    );
    expect(r).toContain('WHERE (priority > @p)", new { p }');
  });

  it("non-nullable values stay plain; a non-optional id claim binds .Value", async () => {
    const r = await repo();
    expect(r).toContain('WHERE (technician_id = @t)", new { t = t.Value }');
    expect(r).toContain(
      'WHERE (technician_id = @__cu_boss)", new { __cu_boss = currentUser.Boss.Value }',
    );
  });

  it("a value-object leaf reads the jsonb column, never a flattened <vo>_<leaf> column", async () => {
    const r = await repo();
    expect(r).toContain("WHERE ((cost->>'Amount')::numeric > 100)");
    expect(r).toContain("WHERE ((cost->>'Currency') = @c)");
    expect(r).not.toMatch(/cost_amount|cost_currency/);
  });
});
