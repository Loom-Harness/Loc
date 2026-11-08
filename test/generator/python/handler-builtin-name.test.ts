// A handler named like a python builtin (`All` → `all`) was emitted as a
// module-level `async def all(...)`, which rebinds `all` for its whole module:
// the body's own `all(...)` (`xs.all(x => x > 0)`) then called the handler,
// not the builtin, and the router's `from … import all` shadowed it there too.
// The handler's function — and the module that defines it — takes the escaped
// spelling (`all_`); its route path and operationId keep the declared name.

import { beforeAll, describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system S {
  subdomain D { context Shop {
    aggregate Item with crudish { sku: string }
    repository Items for Item { }
    queryHandler All(xs: int[]): bool { return xs.all(x => x > 0) }
    queryHandler Sum(xs: int[]): int { return xs.sum(x => x) }
  }}
  api A from D {
    route POST "/all" -> Shop.All
    route POST "/sum" -> Shop.Sum
  }
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable api { platform: python, contexts: [Shop], dataSources: [st], serves: A, port: 3000 }
}
`;

let files: Map<string, string>;
beforeAll(async () => {
  files = await generateSystemFiles(SRC);
}, 120_000);

describe("python: a handler named like a builtin does not shadow it", () => {
  it("defines the escaped function, whose body still calls the builtin", () => {
    const mod = files.get("api/app/application/all_.py") ?? "";
    expect(mod).toContain("async def all_(");
    expect(mod).not.toMatch(/def all\(/);
    expect(mod).toMatch(/return all\(/);
    expect(files.get("api/app/application/sum_.py") ?? "").toContain("async def sum_(");
    expect(files.has("api/app/application/all.py")).toBe(false);
  });

  it("the router imports and calls the escaped name, on the declared route", () => {
    const routes = [...files.entries()].find(
      ([p, c]) => p.startsWith("api/app/") && c.includes('"/all"'),
    )?.[1];
    expect(routes, "router serving /all").toBeDefined();
    expect(routes).toContain("from app.application.all_ import all_");
    expect(routes).not.toMatch(/import all$/m);
    expect(routes).toContain('operation_id="all"');
  });
});
