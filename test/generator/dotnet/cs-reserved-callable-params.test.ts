// A `.ddd` parameter named after a C# keyword is spelled as a verbatim
// identifier (`@event`) on every .NET callable that takes the declaration's
// params verbatim — not only on aggregate operations.  The three signatures
// pinned here are a domain-service operation, a workflow `function`, and the
// partial hook an `extern` operation scaffolds: each rendered `string event`
// bare, which is CS1001 / CS1041 under `dotnet build` while `generate`
// reports zero diagnostics.  The body's use already escapes through the
// expression renderer, so declaration and use must agree.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
  system S {
    subdomain D { context C {
      aggregate Order with crudish {
        tally: int
        operation settle(base: int) extern { precondition base > 0 }
      }
      repository Orders for Order { }
      domainService Pricing {
        operation quote(event: int, base: int): int { return event + base }
      }
      workflow Fulfil {
        size: int
        create(qty: int) { }
        function score(event: int, base: int): int = event + base
      }
    }}
    api A from D
    storage pg { type: postgres }
    resource cState { for: C, kind: state, use: pg }
    deployable d { platform: dotnet  contexts: [C]  dataSources: [cState]  serves: A  port: 3000 }
  }
`;

let cached: Map<string, string> | undefined;
async function file(suffix: string): Promise<string> {
  cached ??= await generateSystemFiles(SRC);
  const key = [...cached.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return cached.get(key!)!;
}

describe(".NET: C#-keyword parameter names on non-aggregate callables", () => {
  it("a domain-service operation declares `@event` / `@base` and reads them back", async () => {
    const svc = await file("Domain/Services/Pricing.cs");
    expect(svc).toMatch(/public static int Quote\(int @event, int @base\)/);
    expect(svc).toMatch(/return @event \+ @base;/);
  });

  it("a workflow function declares `@event` / `@base` and reads them back", async () => {
    const all = [...cached!.entries()].filter(([, c]) => /\bScore\(/.test(c));
    const fn = all.map(([, c]) => c).find((c) => /public static int Score\(/.test(c));
    expect(fn, "workflow function Score not emitted").toBeDefined();
    expect(fn!).toMatch(/public static int Score\(int @event, int @base\) => @event \+ @base;/);
  });

  it("an extern operation's scaffolded hook matches the defining partial (`int @base`)", async () => {
    const hook = await file("Domain/Orders/Order.Extern.cs");
    expect(hook).toMatch(/private partial \w+ SettleCore\(int @base\)/);
  });
});
