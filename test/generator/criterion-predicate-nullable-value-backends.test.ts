// A `criterion` comparing a column against a NULLABLE value — a
// `currentUser.<claim>` declared `T?`, or a criterion param typed `T?` — on the
// elixir, java and .NET-dapper backends.  The semantics match node's: `==`
// against null is `IS NULL`, `!=` is `IS NOT NULL`, an ordering against null
// matches no row.
//
//  - elixir: a bare `record.col == ^v` RAISES `ArgumentError` ("comparison with
//    nil is forbidden") the moment `v` is nil — Ecto wraps every bare `^v`
//    compared with `==`/`!=`/`<`/… in a nil guard.  So a nullable operand binds
//    through `type(^v, record.col)` (no guard) plus an app-side nil test.
//  - java: JPQL `e.col = :#{…?.claim}` binds `= NULL` for a null value and
//    matches nothing, so a nullable claim carries an actor-present `IS NULL`
//    arm.
//  - dapper: the same `= @v`, plus an id-typed claim / optional id param must
//    bind the id's `.Value` (Dapper cannot bind the id STRUCT).
//
// Also dapper: a predicate over a VALUE-OBJECT LEAF names the flattened
// `<vo>_<leaf>` column the other backends store, but Dapper keeps the whole
// value object in ONE jsonb column — it must read `->>`.
//
// Each criterion is run by a `queryHandler`, which synthesises the repository's
// `findAllBy<Criterion>` read.

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
    repository Technicians for Technician
    repository WorkOrders for WorkOrder
    criterion Mine of WorkOrder = this.technicianId == currentUser.technicianId
    criterion NotMine of WorkOrder = currentUser.technicianId != this.technicianId
    criterion ByTech(t: Technician id?) of WorkOrder = this.technicianId == t
    criterion Above(p: int?) of WorkOrder = this.priority > p
    criterion Exact(t: Technician id) of WorkOrder = this.technicianId == t
    criterion BossOf of WorkOrder = this.technicianId == currentUser.boss
    criterion Pricey of WorkOrder = this.cost.amount > 100
    criterion InCur(c: string) of WorkOrder = this.cost.currency == c
    queryHandler ListMine(): WorkOrder[] { let r = WorkOrders.run(Mine) return r }
    queryHandler ListNotMine(): WorkOrder[] { let r = WorkOrders.run(NotMine) return r }
    queryHandler ListByTech(t: Technician id?): WorkOrder[] { let r = WorkOrders.run(ByTech(t)) return r }
    queryHandler ListAbove(p: int?): WorkOrder[] { let r = WorkOrders.run(Above(p)) return r }
    queryHandler ListExact(t: Technician id): WorkOrder[] { let r = WorkOrders.run(Exact(t)) return r }
    queryHandler ListBossOf(): WorkOrder[] { let r = WorkOrders.run(BossOf) return r }
    queryHandler ListPricey(): WorkOrder[] { let r = WorkOrders.run(Pricey) return r }
    queryHandler ListInCur(c: string): WorkOrder[] { let r = WorkOrders.run(InCur(c)) return r }
    policy { read WorkOrder requires true }
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

describe("elixir (Ecto) — nullable value operand", () => {
  /** The retrieval module `run(<Criterion>)` reads. */
  const retrieval = (snake: string) => file("elixir", `c/retrievals/find_all_by_${snake}.ex`);

  it("a nullable claim binds through type/2 and branches on nil (no bare ^nil comparison)", async () => {
    const r = await retrieval("mine");
    expect(r).toContain(
      "where: ((^(not is_nil(current_user) and is_nil(current_user.technician_id)) and is_nil(record.technician_id)) or record.technician_id == type(^(current_user && current_user.technician_id), record.technician_id))",
    );
    expect(r).not.toMatch(/== \^\(current_user && current_user\.technician_id\)/);
  });

  it("!= mirrors to not is_nil; an optional param is null-aware; an ordering is typed, no nil arm", async () => {
    expect(await retrieval("not_mine")).toContain(
      "((^(not is_nil(current_user) and is_nil(current_user.technician_id)) and not is_nil(record.technician_id)) or type(^(current_user && current_user.technician_id), record.technician_id) != record.technician_id)",
    );
    expect(await retrieval("by_tech")).toContain(
      "((^(is_nil(t)) and is_nil(record.technician_id)) or record.technician_id == type(^t, record.technician_id))",
    );
    expect(await retrieval("above")).toContain(
      "where: record.priority > type(^p, record.priority)",
    );
  });

  it("non-nullable values keep the plain pinned comparison", async () => {
    expect(await retrieval("exact")).toContain("where: record.technician_id == ^t)");
    expect(await retrieval("boss_of")).toContain(
      "where: record.technician_id == ^(current_user && current_user.boss))",
    );
  });
});

describe("java (JPQL) — nullable value operand", () => {
  const repo = () => file("java", "workorders/WorkOrderJpaRepository.java");
  const criteria = () => file("java", "domain/criteria/WorkOrderCriteria.java");

  it("a nullable claim gets an actor-present IS NULL arm", async () => {
    const r = await repo();
    expect(r).toContain(
      '@Query("select e from WorkOrder e where (e.technicianId = :#{@currentUserAccessor.user()?.technicianId()} or (:#{@currentUserAccessor.user() != null and @currentUserAccessor.user().technicianId() == null} = true and e.technicianId is null))")',
    );
    expect(r).toContain(
      '@Query("select e from WorkOrder e where (:#{@currentUserAccessor.user()?.technicianId()} <> e.technicianId or (:#{@currentUserAccessor.user() != null and @currentUserAccessor.user().technicianId() == null} = true and e.technicianId is not null))")',
    );
  });

  it("orderings and non-nullable values stay plain", async () => {
    const c = await criteria();
    expect(c).toContain('cb.greaterThan(root.<Integer>get("priority"), p)');
    const exact = c.slice(c.indexOf("Specification<WorkOrder> Exact("));
    expect(exact.split("\n")[1]).toContain('cb.equal(root.<TechnicianId>get("technicianId"), t)');
    expect(await repo()).toContain(
      '@Query("select e from WorkOrder e where e.technicianId = :#{@currentUserAccessor.user()?.boss()}")',
    );
  });

  // KNOWN DEFECT: a criterion over an OPTIONAL param renders a JPA
  // `Specification` whose `cb.equal(<col>, t)` has no null arm, so a null `t`
  // binds `= NULL` and matches nothing instead of `IS NULL`.  `it.fails` keeps
  // the expectation on record; it turns red once the emitter is null-aware, at
  // which point drop the `.fails`.
  it.fails("an optional param tests null in the Specification", async () => {
    const c = await criteria();
    const byTech = c.slice(c.indexOf("Specification<WorkOrder> ByTech("));
    expect(byTech.split("\n").slice(0, 3).join("\n")).toContain("isNull");
  });
});

describe(".NET dapper — nullable value operand + value-object leaf", () => {
  const repo = () =>
    file("dotnet { persistence: dapper }", "Infrastructure/Repositories/WorkOrderRepository.cs");

  it("a nullable claim / optional param compares null-aware and binds the id's .Value", async () => {
    const r = await repo();
    expect(r).toContain(
      "WHERE (technician_id = @__cu_technicianId OR (@__cu_technicianId IS NULL AND technician_id IS NULL))",
    );
    expect(r).toContain(
      'p.Add("__cu_technicianId", RequestContext.Current!.CurrentUser!.TechnicianId?.Value);',
    );
    expect(r).toContain(
      "WHERE (@__cu_technicianId <> technician_id OR (@__cu_technicianId IS NULL AND technician_id IS NOT NULL))",
    );
    expect(r).toContain("WHERE (technician_id = @t OR (@t IS NULL AND technician_id IS NULL))");
    expect(r).toContain('p.Add("t", t?.Value);');
    expect(r).toContain('WHERE (priority > @p)";');
    expect(r).toContain('__p.Add("p", p);');
  });

  it("non-nullable values stay plain; a non-optional id claim binds .Value", async () => {
    const r = await repo();
    expect(r).toContain('WHERE (technician_id = @t)";');
    expect(r).toContain('p.Add("t", t.Value);');
    expect(r).toContain('WHERE (technician_id = @__cu_boss)";');
    expect(r).toContain('p.Add("__cu_boss", RequestContext.Current!.CurrentUser!.Boss.Value);');
  });

  it("a value-object leaf reads the jsonb column, never a flattened <vo>_<leaf> column", async () => {
    const r = await repo();
    expect(r).toContain("WHERE ((cost->>'Amount')::numeric > 100)");
    expect(r).toContain("WHERE ((cost->>'Currency') = @c)");
    expect(r).not.toMatch(/cost_amount|cost_currency/);
  });
});
