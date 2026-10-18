// ---------------------------------------------------------------------------
// Java — `.ddd` param / binding names that are Java reserved words, and Loom
// lambda parameters that shadow a local of the enclosing Java method.
//
//   * Keyword names (`case`, `do`, `final`, `new`, `default` — all legal Loom
//     identifiers) were declared RAW at several sites while every use went
//     through the `jid()` keyword escape: extern port / handler params,
//     explicit-route body records + path params, domain-service params,
//     criterion factory params, document / event-store find params, the
//     JPA retrieval delegate's argument list, workflow request components and
//     the spine's repo / factory / for-each / if-let bindings.  Declaration
//     and use now share one spelling (`jid`, or a `javaLocals` collision
//     rename of it).
//   * `x -> …` in a collection op whose param names a local of the host
//     method (a param, a `let`) — legal Loom shadowing, javac "variable x is
//     already defined".  The lambda param (and its body refs) move to `x_`.
//
// The generated project compiles (`gradle testClasses`, verified out of
// band); these assertions pin the shapes.
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
        tags: string[]
        create(status: string, qty: int, region: string) {
          status := status
          qty := qty
          region := region
        }
        operation bump(final: int) {
          qty := qty + final
        }
        operation tagCount(x: string): int {
          return tags.where(x => x == "a").count
        }
        operation poke(case: int) extern { precondition case > 0 }
        function hits(do: string): int = tags.where(t => t == do).count
      }
      repository Orders for Order {
        find byRegion(case: string): Order? where this.region == case
      }
      domainService Lookup {
        operation isFree(case: string): bool {
          return Orders.byRegion(case) == null
        }
        operation pure(do: int, x: int): int {
          let y = [1, 2].where(y => y > do).count
          return y + x
        }
      }
      domainService Calc {
        operation inc(do: int): int {
          let z = [1, 2].where(do => do > 0).count
          return do + z
        }
      }
      retrieval ByReg(case: string) of Order { where: region == case }
      criterion InRegion(case: string) of Order = region == case

      commandHandler BumpR(case: Order id, final: int): Order id {
        let o = Orders.getById(case)
        let k = [1, 2].where(final => final > 0).count
        o.bump(final + k)
        return o.id
      }
      extern commandHandler Charge(case: int, do: string): int;

      workflow LetW {
        create(do: Order id, final: int) {
          let n = [1, 2].where(final => final > 0).count
          let case = Orders.getById(do)
          case.bump(final + n)
          let new = Order.create({ status: "s", qty: final, region: "r" })
          let default = Orders.run(ByReg("r"))
          for final in default {
            final.bump(1)
          }
        }
        function twice(case: int): int = [case, 2].where(x => x > case).count
      }
    }
  }
  api A from O {
    route POST "/a/{case}" -> O.BumpR
    route POST "/charge" -> O.Charge
  }
  storage pg { type: postgres }
  resource oState { for: O, kind: state, use: pg }
  deployable d { platform: java  contexts: [O]  serves: A  dataSources: [oState]  port: 8080 }
}`;

const DOC_SOURCE = `
system Probe2 {
  subdomain Core {
    context Catalog {
      aggregate Product shape: document {
        name: string
        category: string
        price: int
      }
      repository Products for Product {
        find byCategory(case: string): Product? where this.category == case
        find byPrice(x: int): Product? where this.price == x
      }
      retrieval Cheap(case: string, x: int) of Product {
        where: category == case && price <= x
        sort:  [price asc]
      }
      event Opened { account: Account id, owner: string }
      aggregate Account persistedAs: eventLog {
        owner: string
        create open(owner: string) {
          emit Opened { account: id, owner: owner }
        }
        apply(e: Opened) { owner := e.owner }
      }
      repository Accounts for Account {
        find byOwner(final: string): Account? where this.owner == final
      }
    }
  }
  api CatalogApi from Core
  storage primary { type: postgres }
  resource productState { for: Catalog, kind: state, use: primary }
  resource accountEvents { for: Catalog, kind: eventLog, use: primary }
  deployable catalogApi { platform: java  contexts: [Catalog]  dataSources: [productState, accountEvents]  serves: CatalogApi  port: 8080 }
}`;

const caches = new Map<string, Promise<Map<string, string>>>();
async function file(src: string, suffix: string): Promise<string> {
  if (!caches.has(src)) caches.set(src, generateSystemFiles(src));
  const files = await caches.get(src)!;
  const hit = [...files.entries()].find(([k]) => k.endsWith(`/${suffix}`));
  expect(hit, `${suffix} was not emitted`).toBeTruthy();
  return hit![1];
}

describe("java — reserved-word param / binding names: declaration and use agree", () => {
  it("explicit route: a `{case}` path param and a `final` body component mangle", async () => {
    const c = await file(SOURCE, "ARoutesController.java");
    expect(c).toContain('bumpR(@PathVariable("case") UUID case_, @RequestBody BumpRBody body)');
    expect(c).toContain("bumpRHandler.handle(new OrderId(case_), body.final_())");
    expect(c).toContain('record BumpRBody(@JsonProperty("final") int final_) {}');
    expect(c).toContain("chargeHandler.handle(body.case_(), body.do_())");
  });

  it("extern handler port / impl / dispatch signatures mangle", async () => {
    expect(await file(SOURCE, "ChargePort.java")).toContain("int handle(int case_, String do_);");
    expect(await file(SOURCE, "ChargeHandlerImpl.java")).toContain(
      "public int handle(int case_, String do_) {",
    );
  });

  it("aggregate extern-operation hook params mangle", async () => {
    expect(await file(SOURCE, "OrderExtern.java")).toContain(
      "static void poke(Order order, int case_) {",
    );
  });

  it("domain-service params mangle", async () => {
    const s = await file(SOURCE, "Lookup.java");
    expect(s).toMatch(/public (static )?boolean isFree\(String case_\)/);
    expect(s).toContain("byRegion(case_)");
    expect(s).toContain("public int pure(int do_, int x) {");
    // A pure (static-utility) service too — its lambda moves off the param.
    const c = await file(SOURCE, "Calc.java");
    expect(c).toContain("public static int inc(int do_) {");
    expect(c).toContain("filter(do__ -> do__ > 0)");
    expect(c).toContain("return do_ + z;");
  });

  it("criterion factory params mangle", async () => {
    const c = await file(SOURCE, "OrderCriteria.java");
    expect(c).toContain("public static Specification<Order> InRegion(String case_) {");
    expect(c).toContain('cb.equal(root.<String>get("region"), case_)');
  });

  it("the JPA retrieval delegate passes the mangled param", async () => {
    const r = await file(SOURCE, "OrderRepositoryImpl.java");
    expect(r).toContain("public List<Order> runByReg(String case_) {");
    expect(r).toContain("return jpa.runByReg(case_, Pageable.unpaged());");
  });

  it("workflow request components and spine bindings mangle", async () => {
    expect(await file(SOURCE, "LetWRequest.java")).toContain('@JsonProperty("final")');
    const w = await file(SOURCE, "OWorkflows.java");
    expect(w).toContain("var case_ = ordersRepository.getById(do_);");
    expect(w).toContain("case_.bump(final_ + n);");
    expect(w).toContain('var new_ = Order.create("s", final_, "r", null);');
    expect(w).toContain('var default_ = ordersRepository.runByReg("r");');
    expect(w).toContain("for (var final__ : default_) {");
    expect(w).toContain("ordersRepository.save(case_);");
    expect(w).toContain("ordersRepository.save(new_);");
    expect(w).toContain("private int letWTwice(int case_) {");
  });

  it("document / event-store find and in-memory retrieval params mangle (and `x` moves off the predicate lambda)", async () => {
    const p = await file(DOC_SOURCE, "ProductRepositoryImpl.java");
    expect(p).toContain("public Product byCategory(String case_) {");
    expect(p).toContain("Objects.equals(x.category(), case_)");
    expect(p).toContain("public List<Product> runCheap(String case_, int x_) {");
    expect(p).toContain("x.price() <= x_");
    expect(p).toContain("public Product byPrice(int x_) {");
    expect(p).toContain("filter(x -> x.price() == x_)");
    const a = await file(DOC_SOURCE, "AccountRepositoryImpl.java");
    expect(a).toContain("public Account byOwner(String final_) {");
    expect(a).toContain("Objects.equals(x.owner(), final_)");
  });
});

describe("java — a lambda param named like a local of the host method is renamed", () => {
  it("aggregate operation / function params", async () => {
    const o = await file(SOURCE, "Order.java");
    expect(o).toContain('filter(x_ -> Objects.equals(x_, "a"))');
    // `t` collides with nothing — untouched.
    expect(o).toContain("filter(t -> Objects.equals(t, do_))");
  });

  it("domain-service `let` (the lambda sits in its own initializer)", async () => {
    expect(await file(SOURCE, "Lookup.java")).toContain(
      "var y = List.of(1, 2).stream().filter(y_ -> y_ > do_).toList().size();",
    );
  });

  it("workflow spine param, workflow function param, handler param", async () => {
    const w = await file(SOURCE, "OWorkflows.java");
    // Clears `final_` (the param) AND `final__` (the for-each binding).
    expect(w).toContain("var n = List.of(1, 2).stream().filter(final___ -> final___ > 0)");
    // `x` is not a param of the function — untouched; `case_` is a param.
    expect(w).toContain("return List.of(case_, 2).stream().filter(x -> x > case_)");
    const h = await file(SOURCE, "BumpRHandler.java");
    expect(h).toContain("filter(final__ -> final__ > 0)");
  });
});
