// ---------------------------------------------------------------------------
// Java — two remaining local-collision shapes javac rejects:
//
//   * A lambda NESTED in another lambda that reuses the enclosing lambda's
//     param (`lines.any(x => x.tags.any(x => …))` — legal Loom, the inner
//     binder shadows).  Java forbids a lambda param shadowing an enclosing
//     lambda's ("variable x is already defined").  The dispatcher now renders
//     a lambda's body under `lambdaBodyCtx`, which threads the binder, so the
//     inner one moves to `x_` and each ref names its own (innermost) binder.
//   * A JPA retrieval / reified-criterion param named `offset` / `limit`
//     redeclared the paged overload's own `Integer offset, Integer limit`.
//     The param moves to `<name>_` in the port + impl; the JPA `@Param` key
//     and JPQL `:name` binding keep the declared spelling.
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
        name: string
        region: string
        qty: int
        tags: string[]
        lines: Line[]
        entity Line { tags: string[] }
        create(name: string, region: string, qty: int) {
          name := name
          region := region
          qty := qty
        }
        function nested(): bool = lines.any(x => x.tags.any(x => x == "a"))
        function mixed(): bool = lines.any(x => x.tags.any(y => lines.any(x => x.tags.count > 0) && y == name && x.tags.count > 1))
        function siblings(): bool = tags.any(t => t == "a") && tags.any(t => t == "b")
      }
      repository Orders for Order {}
      retrieval ByOff(offset: string) of Order { where: region == offset }
      retrieval ByLim(limit: int, offset: string) of Order {
        where: qty == limit && region == offset
        sort: [qty asc]
      }
      retrieval Plain(r: string) of Order { where: region == r }
      criterion InReg(limit: string) of Order = region == limit
      retrieval Reified(offset: string) of Order = InReg(offset)
    }
  }
  api A from O
  storage pg { type: postgres }
  resource oState { for: O, kind: state, use: pg }
  deployable d { platform: java  contexts: [O]  serves: A  dataSources: [oState]  port: 8080 }
}`;

let cache: Promise<Map<string, string>> | undefined;
async function file(suffix: string): Promise<string> {
  cache ??= generateSystemFiles(SOURCE);
  const files = await cache;
  const hit = [...files.entries()].find(([k]) => k.endsWith(`/${suffix}`));
  expect(hit, `${suffix} was not emitted`).toBeTruthy();
  return hit![1];
}

describe("java — a nested lambda reusing an enclosing lambda's param is renamed", () => {
  it("the inner binder and its refs move; the outer keeps its name", async () => {
    const o = await file("Order.java");
    expect(o).toContain(
      'this.lines.stream().anyMatch(x -> x.tags().stream().anyMatch(x_ -> Objects.equals(x_, "a")))',
    );
  });

  it("an outer ref after a nested shadow still names the outer binder", async () => {
    const o = await file("Order.java");
    expect(o).toContain(
      "this.lines.stream().anyMatch(x -> x.tags().stream().anyMatch(y -> this.lines.stream().anyMatch(x_ -> x_.tags().size() > 0) && Objects.equals(y, this.name) && x.tags().size() > 1))",
    );
  });

  it("sibling lambdas sharing a name are untouched", async () => {
    const o = await file("Order.java");
    expect(o).toContain(
      'this.tags.stream().anyMatch(t -> Objects.equals(t, "a")) && this.tags.stream().anyMatch(t -> Objects.equals(t, "b"))',
    );
  });
});

describe("java — a JPA retrieval param named `offset` / `limit` clears the paged overload's", () => {
  it("port declares the moved names", async () => {
    const r = await file("OrderRepository.java");
    expect(r).toContain("List<Order> runByOff(String offset_);");
    expect(r).toContain("List<Order> runByOff(String offset_, Integer offset, Integer limit);");
    expect(r).toContain(
      "List<Order> runByLim(int limit_, String offset_, Integer offset, Integer limit);",
    );
    expect(r).toContain("List<Order> runReified(String offset_, Integer offset, Integer limit);");
    // No collision — untouched.
    expect(r).toContain("List<Order> runPlain(String r, Integer offset, Integer limit);");
  });

  it("impl passes the moved locals; the JPA @Param keys keep the declared spelling", async () => {
    const i = await file("OrderRepositoryImpl.java");
    expect(i).toContain(
      "public List<Order> runByLim(int limit_, String offset_, Integer offset, Integer limit) {",
    );
    expect(i).toContain(
      "return jpa.runByLim(limit_, offset_, new OffsetLimitPageRequest(offset, limit, Sort.unsorted()));",
    );
    expect(i).toContain("return jpa.runByOff(offset_, Pageable.unpaged());");
    expect(i).toContain(
      "return jpa.findAll(OrderCriteria.InReg(offset_), new OffsetLimitPageRequest(offset, limit, Sort.unsorted())).getContent();",
    );
    const j = await file("OrderJpaRepository.java");
    expect(j).toContain(
      'List<Order> runByLim(@Param("limit") int limit, @Param("offset") String offset, Pageable pageable);',
    );
  });
});
