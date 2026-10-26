// An operation that returns its `error` variant leaves no trace
// (D-FAILURE-MODEL): the loaded aggregate is not saved and the events it
// raised are not published. Each backend tests the variant between the
// operation call and its save / publish, so the check must come FIRST in
// the route or handler — a save that runs before the check commits the
// `attempts` bump the failed withdrawal made.
//
// The op raises an event and mutates state BEFORE deciding to fail, so a
// backend that saved or broadcast first would persist both.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** The `if` early return is the shape node/dotnet/java/python accept; Elixir
 *  has no early exit, so its op fails at the tail instead. */
const SOURCE = (platform: string, body: string) => `
system Demo {
  subdomain S { context C {
    error InsufficientCredit { available: money }
    event Withdrawn { amt: money }
    aggregate Account with crudish {
      balance: money
      attempts: int
      operation withdraw(amt: money): Account or InsufficientCredit {
${body}
      }
    }
    repository Accounts for Account { }
  } }
  api A from S { httpStatus InsufficientCredit -> 409 }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: ${platform}  contexts: [C]  dataSources: [st]  serves: A }
}
`;

const EARLY = `
        attempts := attempts + 1
        emit Withdrawn { amt: amt }
        if amt > balance { return InsufficientCredit { available: balance } }
        balance := balance - amt
        return this`;

const TAIL = `
        attempts := attempts + 1
        emit Withdrawn { amt: amt }
        return InsufficientCredit { available: balance }`;

async function fileOf(platform: string, body: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(SOURCE(platform, body));
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`${platform}: no file ending ${suffix}`);
  return hit[1];
}

/** The text between `start` and the next `end` after it. */
function slice(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  expect(from, `marker ${start}`).toBeGreaterThanOrEqual(0);
  const to = src.indexOf(end, from + start.length);
  return src.slice(from, to < 0 ? undefined : to);
}

function expectBefore(body: string, first: string, then: string): void {
  const a = body.indexOf(first);
  const b = body.indexOf(then);
  expect(a, `missing ${first}`).toBeGreaterThanOrEqual(0);
  expect(b, `missing ${then}`).toBeGreaterThanOrEqual(0);
  expect(a, `${first} must precede ${then}`).toBeLessThan(b);
}

describe("an error variant discards the operation's writes", () => {
  it("node answers the error before repo.save", async () => {
    const src = await fileOf("node", EARLY, "api/http/account.routes.ts");
    const route = slice(src, "aggregate.withdraw(", "return c.json(result, 200)");
    expectBefore(route, 'result.type === "InsufficientCredit"', "await repo.save(aggregate");
  });

  it("python answers the error before repo.save", async () => {
    const src = await fileOf("python", EARLY, "api/app/http/account_routes.py");
    const route = slice(src, "result = found.withdraw(", "\n\n");
    expectBefore(route, 'result["type"] == "InsufficientCredit"', "await repo.save(found");
  });

  it("dotnet's handler returns the error before SaveAsync", async () => {
    const handler = await fileOf("dotnet", EARLY, "Commands/WithdrawHandler.cs");
    expectBefore(
      handler,
      "if (result is global::Api.Domain.Accounts.AccountOrInsufficientCredit_InsufficientCredit) return result;",
      "await _repo.SaveAsync(aggregate",
    );
  });

  it("java returns the error, rollback-only, before save and publishEvents", async () => {
    const src = await fileOf("java", EARLY, "accounts/AccountService.java");
    const method = slice(src, "var result = aggregate.withdraw(", "\n    }\n");
    expectBefore(
      method,
      "result instanceof com.loom.api.features.accounts.AccountOrInsufficientCredit_InsufficientCredit",
      "repository.save(aggregate)",
    );
    expectBefore(method, "setRollbackOnly()", "return result;");
    expectBefore(method, "return result;", "publishEvents(aggregate)");
  });

  it("elixir drops the events of a body that ends in an error", async () => {
    const src = await fileOf("elixir", TAIL, "api/lib/api/c.ex");
    const fn = slice(src, "def withdraw_account(%", "\n  end\n");
    expect(fn).toContain('{:error, "InsufficientCredit"');
    expect(fn).not.toContain("broadcast");
    expect(fn).not.toContain("event_dispatched");
    expect(fn).not.toContain("persist_change");
  });
});
