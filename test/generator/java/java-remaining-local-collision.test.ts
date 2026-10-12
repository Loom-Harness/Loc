// ---------------------------------------------------------------------------
// The remaining `.ddd`-name / generated-Java-local collisions (after the
// service / validator / find-route / workflow-param fixes): each `.ddd` name
// below lands on a name the generated METHOD spells itself.
//
//   * explicit `route` actions — a path / query param named `result`, `body`,
//     or the injected `<handler>Handler` field.  (A paged-run param named
//     `page` / `sort` collided too; it is now refused up front by
//     `loom.paged-param-reserved`, so only `result` is exercised here.)
//     `@PathVariable UUID body, @RequestBody BumpBBody body` → javac "variable
//     body is already defined"; `bumpHHandler.handle(...)` on a UUID.
//   * an extern handler — a param named like the injected `<x>Port` field
//     (`chargePort.handle(chargePort)` on an `int`).
//   * `let` (and repo / for-each) BINDINGS in workflow / handler / reactor /
//     projection-fold bodies — the earlier fix moved params only, so
//     `let request = Orders.getById(id)` still redeclared the `request`
//     parameter and `let ordersRepository = …` shadowed the field the exit
//     save dereferences (`ordersRepository.save(ordersRepository)`).
//   * a reading domain service — a param / `let` named like its injected
//     repository field.
//   * a query-time projection — a param named like the service's repository
//     field or the controller's injected `queryProjections`.
//
// Every fix moves ONLY the colliding Java local to `<name>_` (`javaLocals`);
// URI-template / query keys are named explicitly (`@PathVariable("result")`),
// and record components / port signatures keep the `.ddd` spelling.  The
// generated project compiles (`gradle testClasses`, verified out of band);
// these assertions pin the shapes.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SOURCE = `
system Probe {
  subdomain O {
    context O {
      aggregate Order {
        status: string
        qty: int
        region: string
        create(status: string, qty: int, region: string) {
          status := status
          qty := qty
          region := region
        }
        operation bump(n: int) {
          qty := qty + n
        }
      }
      repository Orders for Order {
        find byRegion(rgn: string): Order? where this.region == rgn
        find allByRegion(rgn: string): Order[] where this.region == rgn
      }
      domainService Lookup {
        operation isFree(ordersRepository: string): bool {
          return Orders.byRegion(ordersRepository) == null
        }
        operation isFree2(rgn: string): bool {
          let ordersRepository = Orders.allByRegion(rgn)
          return ordersRepository.count == 0
        }
      }
      projection InReg(ordersRepository: string, x: string, queryProjections: string) {
        status: string
        qty: int
        from Order where region == ordersRepository && status == x && status != queryProjections
        select status = status, qty = qty
      }
      criterion InRegion(rgn: string) of Order = region == rgn
      event OrderBumped { order: Order id, amount: int }
      channel L { carries: OrderBumped  delivery: broadcast  retention: ephemeral }

      commandHandler BumpR(result: Order id, n: int): Order id {
        let o = Orders.getById(result)
        o.bump(n)
        return o.id
      }
      commandHandler BumpB(body: Order id, n: int): Order id {
        let o = Orders.getById(body)
        o.bump(n)
        return o.id
      }
      commandHandler BumpH(bumpHHandler: Order id, n: int): Order id {
        let o = Orders.getById(bumpHHandler)
        o.bump(n)
        return o.id
      }
      commandHandler BumpV(result: Order id) {
        let o = Orders.getById(result)
        o.bump(1)
      }
      queryHandler ListQ(result: string): Order paged {
        let r = Orders.run(InRegion(result))
        return r
      }
      extern commandHandler Charge(chargePort: int): int;

      commandHandler LetH(orderId: Order id): Order id {
        let ordersRepository = Orders.getById(orderId)
        ordersRepository.bump(1)
        return ordersRepository.id
      }
      workflow LetW {
        create(orderId: Order id) {
          let request = Orders.getById(orderId)
          let ordersRepository = 2
          request.bump(ordersRepository)
        }
      }
      workflow NoParam {
        create() {
          let request = 1
          precondition request > 0
        }
      }
      workflow Saga {
        orderId: Order id
        note: int
        create(orderId: Order id) {
          let sagaStateRepository = 3
          let ordersRepository = Orders.getById(orderId)
          note := sagaStateRepository
          ordersRepository.bump(note)
        }
        on(e: OrderBumped) by e.order {
          let events = e.amount
          let sagaStateRepository = 1
          note := events + sagaStateRepository
        }
      }
      projection Board keyed by order {
        order: Order id
        total: int
        on(e: OrderBumped) {
          let boardRowRepository = e.amount
          order := e.order
          total := boardRowRepository
        }
      }
    }
  }
  api A from O {
    route POST "/a/{result}" -> O.BumpR
    route POST "/b/{body}" -> O.BumpB
    route POST "/h/{bumpHHandler}" -> O.BumpH
    route POST "/v/{result}" -> O.BumpV
    route GET "/q" -> O.ListQ
    route POST "/charge" -> O.Charge
    route POST "/leth/{orderId}" -> O.LetH
  }
  storage pg { type: postgres }
  resource oState { for: O, kind: state, use: pg }
  deployable d { platform: java  contexts: [O]  serves: A  dataSources: [oState]  port: 8080 }
}`;

let cached: Map<string, string> | undefined;
async function file(suffix: string): Promise<string> {
  cached ??= await generateSystemFiles(SOURCE);
  const hit = [...cached.entries()].find(([k]) => k.endsWith(`/${suffix}`));
  expect(hit, `${suffix} was not emitted`).toBeTruthy();
  return hit![1];
}

describe("java — explicit route actions: path/query params vs the action's own names", () => {
  it("a path param named `result` moves off the `var result` local, keeping its URI key", async () => {
    const c = await file("ARoutesController.java");
    expect(c).toContain('bumpR(@PathVariable("result") UUID result_, @RequestBody BumpRBody body)');
    expect(c).toContain("var result = bumpRHandler.handle(new OrderId(result_), body.n());");
  });

  it("a path param named `body` moves off the @RequestBody record param", async () => {
    const c = await file("ARoutesController.java");
    expect(c).toContain('bumpB(@PathVariable("body") UUID body_, @RequestBody BumpBBody body)');
    expect(c).toContain("bumpBHandler.handle(new OrderId(body_), body.n())");
  });

  it("a path param named like the injected handler field no longer shadows it", async () => {
    const c = await file("ARoutesController.java");
    expect(c).toContain('@PathVariable("bumpHHandler") UUID bumpHHandler_');
    expect(c).toContain("var result = bumpHHandler.handle(new OrderId(bumpHHandler_), body.n());");
  });

  it("a void route has no `result` local, so its `result` path param keeps its name", async () => {
    const c = await file("ARoutesController.java");
    expect(c).toContain("bumpV(@PathVariable UUID result)");
    expect(c).toContain("bumpVHandler.handle(new OrderId(result));");
  });

  it("paged-run: a query param named `result` moves off the action's `result` local", async () => {
    const c = await file("ARoutesController.java");
    expect(c).toContain('listQ(@RequestParam("result") String result_,');
    expect(c).toContain("var result = listQHandler.handle(result_, page, pageSize, sort, dir);");
  });

  it("paged-run handler bean: `result` is no name of the bean's — it stays", async () => {
    expect(await file("ListQHandler.java")).toContain(
      "public Paged<Order> handle(String result, int page, int pageSize, String sort, String dir) {\n" +
        "        return ordersRepository.findAllByInRegion(result, page, pageSize, sort, dir);",
    );
  });
});

describe("java — extern handler param vs the injected port field", () => {
  it("the generated handler renames the param; port and impl keep the .ddd name", async () => {
    const h = await file("ChargeHandler.java");
    expect(h).toContain("public int handle(int chargePort_) {");
    expect(h).toContain("return chargePort.handle(chargePort_);");
    expect(await file("ChargePort.java")).toContain("int handle(int chargePort);");
    expect(await file("ChargeHandlerImpl.java")).toContain("public int handle(int chargePort) {");
  });
});

describe("java — body `let` bindings vs the enclosing method's names", () => {
  it("command workflow: `let request` / `let ordersRepository` move; the exit save follows", async () => {
    const w = await file("OWorkflows.java");
    expect(w).toContain("var request_ = ordersRepository.getById(orderId);");
    expect(w).toContain("var ordersRepository_ = 2;");
    expect(w).toContain("request_.bump(ordersRepository_);");
    expect(w).toContain("ordersRepository.save(request_);");
  });

  it("command workflow with a correlation row: `let ordersRepository` / `let sagaStateRepository` move", async () => {
    const w = await file("OWorkflows.java");
    expect(w).toContain("var sagaStateRepository_ = 3;");
    expect(w).toContain("var ordersRepository_ = ordersRepository.getById(orderId);");
    expect(w).toContain("ordersRepository_.bump(state.note());");
    expect(w).toContain("ordersRepository.save(ordersRepository_);");
    expect(w).toContain("sagaStateRepository.save(state);");
  });

  it("a param-less workflow method has no `request` param, so `let request` keeps its name", async () => {
    expect(await file("OWorkflows.java")).toContain("var request = 1;");
  });

  it("command handler: `let ordersRepository` moves off the repository field", async () => {
    const h = await file("LetHHandler.java");
    expect(h).toContain("var ordersRepository_ = ordersRepository.getById(orderId);");
    expect(h).toContain("ordersRepository.save(ordersRepository_);");
    expect(h).toContain("return ordersRepository_.id();");
  });

  it("saga reactor and projection fold: lets move off the injected repositories / `events`", async () => {
    const d = await file("ODispatcher.java");
    expect(d).toContain("var events_ = e.amount();");
    expect(d).toContain("var sagaStateRepository_ = 1;");
    expect(d).toContain("state.setNote(events_ + sagaStateRepository_);");
    expect(d).toContain("var boardRowRepository_ = e.amount();");
    expect(d).toContain("state.setTotal(boardRowRepository_);");
    expect(d).toContain("boardRowRepository.save(state);");
  });

  it("non-colliding bindings keep the .ddd spelling", async () => {
    expect(await file("BumpRHandler.java")).toContain(
      "public OrderId handle(OrderId result, int n) {\n        var o = ordersRepository.getById(result);",
    );
  });
});

describe("java — reading domain service / query projection params vs injected fields", () => {
  it("a reading service param or let named like its repository field moves", async () => {
    const s = await file("Lookup.java");
    expect(s).toContain("public boolean isFree(String ordersRepository_) {");
    expect(s).toContain("return ordersRepository.byRegion(ordersRepository_) == null;");
    expect(s).toContain("var ordersRepository_ = ordersRepository.allByRegion(rgn);");
    expect(s).toContain("return ordersRepository_.size() == 0;");
  });

  it("a query-projection param moves off the service field / controller field, keeping its key", async () => {
    const svc = await file("OQueryProjections.java");
    expect(svc).toContain("inReg(String ordersRepository_, String x, String queryProjections) {");
    expect(svc).toContain("return ordersRepository.inReg(ordersRepository_, x, queryProjections)");
    const ctl = await file("OQueryProjectionsController.java");
    expect(ctl).toContain(
      'inReg(@RequestParam String ordersRepository, @RequestParam String x, @RequestParam("queryProjections") String queryProjections_) {',
    );
    expect(ctl).toContain("return queryProjections.inReg(ordersRepository, x, queryProjections_);");
  });
});
