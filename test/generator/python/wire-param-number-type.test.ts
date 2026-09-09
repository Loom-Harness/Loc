// A QUERY PARAMETER is not JSON, and the F17 numeric guard must not be applied
// to one.
//
// `?min=6` reaches FastAPI as the STRING "6" — a URL has no types — so the
// guard that refuses a `str` for a field the contract calls a number refused
// every well-formed read of a numeric find. Measured on the booted behavioral
// app, both corpus fixtures that declare one:
//
//   GET /api/articles/popular?min=6        422  "Input should be a valid number"
//   GET /api/accounts/by_min_balance?min=0 422  (same)
//
// The fast suite could not see it: it compares emitted TEXT, and `min: Int32`
// is a perfectly well-formed annotation. Only a booted app knows which pipeline
// stage the value arrives at (`experience_gathered.md` §102, §104).
//
// The fix is a direction, not a special case: `paramPyType` renders the
// path/query spelling. Everything that is not a number keeps the request
// spelling — a `MoneyStr`, a `UuidStr` and a `WireStr` all constrain a string
// that arrives as a string, and F2/F3's uuid gate lives on that very path.
//
// The BOUND survives: `Int32Param` is `Int32` minus the guard, so an `int4`
// query parameter still validates and still publishes `format: int32`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const src = `
system S {
  subdomain D {
    context C {
      aggregate Account with crudish {
        holder: string
        balance: int
        seq: long
        rate: decimal
      }
      repository Accounts for Account {
        find byMinBalance(min: int): Account[] where this.balance >= min
        find bySeq(lowest: long): Account[] where this.seq >= lowest
        find byRate(floor: decimal): Account[] where this.rate >= floor
        find byHolder(who: string): Account?
      }

      // The SECOND emitter that annotates a route signature. It reads the same
      // params off its own file template, which is how the .NET \`NoNulChar\`
      // using went missing on one of two — so the fixture reaches both.
      criterion Richer(floor: int) of Account = this.balance >= floor
      // A PAGED run — the one handler shape whose non-path params become real
      // query parameters rather than a body model. A THIRD emitter reads the
      // same params off its own template, which is how the .NET \`NoNulChar\`
      // using went missing on one of two call sites.
      queryHandler ListRicher(floor: int): Account paged {
        let r = Accounts.run(Richer(floor))
        return r
      }
    }
  }
  api A from D {
    route GET "/richer" -> C.ListRicher
  }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: python, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}
`;

async function files(): Promise<Map<string, string>> {
  return await generateSystemFiles(src);
}

async function file(suffix: string): Promise<string> {
  const all = await files();
  const key = [...all.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return all.get(key as string) as string;
}

/** The `async def …(…)` signature of one route function. */
function signature(routes: string, fn: string): string {
  const at = routes.indexOf(`async def ${fn}(`);
  expect(at, `no ${fn} route emitted`).toBeGreaterThan(-1);
  return routes.slice(at, routes.indexOf("\n", at));
}

describe("a numeric path/query parameter is not guarded as if it were JSON", () => {
  it("an int find parameter takes the unguarded bounded alias", async () => {
    const routes = await file("app/http/account_routes.py");
    expect(signature(routes, "by_min_balance_accounts")).toContain("min: Int32Param");
  });

  it("a long and a decimal parameter take the bare python types", async () => {
    const routes = await file("app/http/account_routes.py");
    expect(signature(routes, "by_seq_accounts")).toContain("lowest: int");
    expect(signature(routes, "by_rate_accounts")).toContain("floor: float");
  });

  it("Int32Param is Int32 minus the guard — the int4 bound and format stay", async () => {
    const wire = await file("app/http/wire_models.py");
    const at = wire.indexOf("Int32Param = Annotated[");
    expect(at, "Int32Param not defined").toBeGreaterThan(-1);
    const block = wire.slice(at, wire.indexOf("]", at) + 1);
    expect(block).toContain("Field(ge=-2147483648, le=2147483647)");
    expect(block).toContain('WithJsonSchema({"type": "integer", "format": "int32"})');
    expect(block).not.toContain("BeforeValidator");
  });

  it("a STRING parameter keeps every request-side narrowing", async () => {
    // The narrowing that must NOT be dropped along with the numeric one: a
    // query string arrives as a string, so `WireStr`'s NUL guard (F20) applies
    // to it exactly as it does to a body field.
    const routes = await file("app/http/account_routes.py");
    expect(signature(routes, "by_holder_accounts")).toContain("who: WireStr");
  });

  it("no route SIGNATURE anywhere annotates a guarded numeric alias", async () => {
    // The sweep, because the defect was one call site out of four and the other
    // three looked identical. A body model is indented inside a `class`; a route
    // signature starts at column 0 with `async def`.
    const offenders: string[] = [];
    for (const [path, content] of await files()) {
      if (!path.endsWith(".py")) continue;
      for (const line of content.split("\n")) {
        if (!line.startsWith("async def ")) continue;
        if (/:\s*(Int32|WireNum|WireInt)\b/.test(line)) offenders.push(`${path}: ${line.trim()}`);
      }
    }
    expect(offenders, "these route signatures carry a JSON-only numeric guard").toEqual([]);
  });

  it("the body side still DOES carry the guard — the sweep above is not vacuous", async () => {
    const routes = await file("app/http/account_routes.py");
    const create = routes.slice(routes.indexOf("class CreateAccountRequest("));
    const block = create.split("\n\n")[0];
    expect(block).toContain("balance: Int32");
    expect(block).toContain("seq: WireInt");
    expect(block).toContain("rate: WireNum");
  });
});
