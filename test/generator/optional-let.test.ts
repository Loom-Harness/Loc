// The emitted null-handling form of a `let` over an optional repository read,
// and of an `if let` over `findById` or over an optional binding, on every
// backend — over the `optional-let` corpus fixture (whose compile legs prove
// the same output builds).
//
//   let c = Customers.find(ByEmail(e))   → the criterion retrieval, first row or null
//   let o = Orders.findById(oid)         → the nullable by-id read
//   if let o = x { … }                   → the binding itself, no second read

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const FIXTURE = fs.readFileSync(
  path.join(import.meta.dirname, "..", "fixtures", "corpus", "optional-let.ddd"),
  "utf8",
);

async function emitted(platform: string): Promise<string> {
  const files = await generateSystemFiles(FIXTURE.replace("__PLATFORM__", platform));
  return [...files.values()].join("\n");
}

const CASES: [string, string[]][] = [
  [
    "node",
    [
      "const c = (await customers.runFindAllByByEmail(e, { limit: 1 }))[0] ?? null;",
      "const o = await orders.findById(oid);",
      "const o = x;",
      "const p = k;",
    ],
  ],
  [
    "python",
    [
      "__c_hits = await customers.run_find_all_by_by_email(e, limit=1)",
      "c = __c_hits[0] if __c_hits else None",
      "o = await orders.find_by_id(oid)",
      "o = x",
    ],
  ],
  [
    "dotnet",
    [
      "var __cHits = await _customers.RunFindAllByByEmailAsync(command.E, (null, 1), cancellationToken: cancellationToken);",
      "var c = __cHits.Count > 0 ? __cHits[0] : null;",
      "var o = await _orders.GetByIdAsync(command.Oid, cancellationToken);",
      "var o = x;",
      // The domain-service read of `findById`: `GetByIdAsync`, not a
      // `FindById` no .NET repository declares.
      "var o = (await _orders.GetByIdAsync(oid, cancellationToken));",
    ],
  ],
  [
    "dotnet { persistence: dapper }",
    [
      "var c = __cHits.Count > 0 ? __cHits[0] : null;",
      "var o = await _orders.GetByIdAsync(command.Oid, cancellationToken);",
    ],
  ],
  [
    "java",
    [
      "var c = customersRepository.runFindAllByByEmail(e, null, 1).stream().findFirst().orElse(null);",
      // `findById` answers `Optional<Order>` — in a workflow `let`, an
      // `if let` source and a domain-service read alike.
      "var again = ordersRepository.findById(c.oid()).orElse(null);",
      "var o = ordersRepository.findById(c.oid()).orElse(null);",
      "var o = ordersRepository.findById(oid).orElse(null);",
      "var o = x;",
    ],
  ],
  [
    "elixir",
    [
      "with c <- (case Context.run_find_all_by_by_email_customer(e, limit: 1) do",
      "o = case Context.get_order(oid) do",
      "o = x",
      // The reactor (dispatcher) body: each source but a criterion read
      // answers the row or nil, so the then-arm is guarded on presence.
      "(case D.Sales.get_order(event.order) do",
      "{:ok, o} when not is_nil(o) ->",
      "{:ok, q} when not is_nil(q) ->",
      "k <- (case D.Sales.find_by_code_order(event.code) do",
      "(case k do",
      "p when not is_nil(p) ->",
    ],
  ],
];

describe("optional reads bound by `let` / narrowed by `if let` — every backend", () => {
  it.each(CASES)("%s", async (platform, needles) => {
    const out = await emitted(platform);
    for (const n of needles) expect(out, n).toContain(n);
  });
});
