// `let r = a.withdraw(x)` matched in a workflow, a reactor and a command
// handler, on the four backends that render it.  The call binds its result;
// the success arm saves the mutated aggregate at its end (publishing what it
// drained, as every save does) and the error arm saves nothing.  EF Core and
// JPA track the loaded entity, so their error arm detaches it through the
// repository's `Discard` / `discard`, which exists only for an aggregate some
// body drops; node and python write only on an explicit save.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SOURCE = (platform: string) => `
system Bank {
  subdomain D {
    context Ledger {
      error Insufficient { needed: int }
      event Paid { accountId: Account id }
      aggregate Account with crudish {
        owner: string
        balance: int
        operation withdraw(amt: int): int or Insufficient {
          balance := balance - amt
          return balance
        }
      }
      aggregate Note with crudish { text: string }
      repository Accounts for Account
      repository Notes for Note
      workflow Pay {
        create(id: Account id, amt: int) {
          let a = Accounts.get(id)
          let r = a.withdraw(amt)
          match r {
            int left => { }
            Insufficient e => { notFound }
          }
        }
      }
      workflow TryPay {
        create(id: Account id, amt: int) {
          let a = Accounts.get(id)
          let r = a.withdraw(amt)
          match r {
            int left => { }
            Insufficient e => { let n = Note.create(text: "declined") }
          }
        }
      }
      workflow Announce {
        create(id: Account id) { emit Paid { accountId: id } }
      }
      workflow Audit {
        accountId: Account id
        create(e: Paid) by e.accountId { }
        on(e: Paid) {
          let a = Accounts.get(e.accountId)
          let r = a.withdraw(1)
          match r {
            int left => { }
            Insufficient e2 => { }
          }
        }
      }
      commandHandler Charge(accountId: Account id, amt: int) {
        let a = Accounts.get(accountId)
        let r = a.withdraw(amt)
        match r {
          Insufficient e => { notFound }
          else => { }
        }
      }
    }
  }
  api A from D {
    httpStatus Insufficient -> 409
    route POST "/accounts/{accountId}/charge" -> Ledger.Charge
  }
  storage primary { type: postgres }
  resource st { for: Ledger, kind: state, use: primary }
  deployable d { platform: ${platform}, contexts: [Ledger], dataSources: [st], serves: A, port: 4000 }
}
`;

const cache = new Map<string, Promise<Map<string, string>>>();
function filesOf(platform: string): Promise<Map<string, string>> {
  let hit = cache.get(platform);
  if (!hit) {
    hit = generateSystemFiles(SOURCE(platform));
    cache.set(platform, hit);
  }
  return hit;
}

async function fileOf(platform: string, suffix: string): Promise<string> {
  const files = await filesOf(platform);
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`${platform}: no file ending ${suffix}`);
  return hit[1];
}

/** `lines` appear in `src` consecutively, each trimmed of its indent. */
function expectBlock(src: string, lines: string[]): void {
  const trimmed = src.split("\n").map((l) => l.trim());
  const at = trimmed.findIndex((_, i) => lines.every((l, j) => trimmed[i + j] === l));
  expect(at, `block not found:\n${lines.join("\n")}`).toBeGreaterThan(-1);
}

describe("matched op result — node", () => {
  it("the workflow binds the result, saves in the success arm, nothing in the error arm", async () => {
    const src = await fileOf("node", "d/http/workflows.ts");
    expectBlock(src, [
      "const r = a.withdraw(amt);",
      "switch (r.type) {",
      'case "int": {',
      "const left = r.value;",
      "await accounts.save(a);",
      "break;",
      "}",
      'case "Insufficient": {',
      "const e = r;",
      'throw new AggregateNotFoundError("Resource not found");',
    ]);
    expect(src).not.toMatch(/case "Insufficient": \{[^}]*save\(a\)/);
  });

  it("the command handler saves in the success-only `else`", async () => {
    const src = await fileOf("node", "d/http/a-routes.ts");
    expectBlock(src, ["default: {", "await accounts.save(a);", "break;", "}"]);
  });
});

describe("matched op result — dotnet", () => {
  it("the workflow saves in the success arm and detaches in the error arm", async () => {
    const src = await fileOf("dotnet", "Application/Workflows/PayHandler.cs");
    expectBlock(src, ["var r = a.Withdraw(command.Amt);", "switch (r)", "{"]);
    expectBlock(src, ["case intOrInsufficient_Insufficient e:", "{", "_accounts.Discard(a);"]);
    expectBlock(src, ["await _accounts.SaveAsync(a, cancellationToken);", "break;"]);
  });

  it("the repository of a dropped aggregate carries Discard; another does not", async () => {
    const iface = await fileOf("dotnet", "Domain/Accounts/IAccountRepository.cs");
    expect(iface).toContain("void Discard(Account aggregate) { }");
    const impl = await fileOf("dotnet", "Infrastructure/Repositories/AccountRepository.cs");
    expectBlock(impl, [
      "public void Discard(Account aggregate)",
      "{",
      "var __db = _db.TrackerOf(aggregate);",
    ]);
    expect(impl).toContain("__entry.State = EntityState.Detached;");
    const notes = await fileOf("dotnet", "Domain/Notes/INoteRepository.cs");
    expect(notes).not.toContain("Discard");
  });
});

describe("matched op result — java", () => {
  it("the workflow saves and publishes in the success arm, detaches in the error arm", async () => {
    const src = await fileOf("java", "application/workflows/LedgerWorkflows.java");
    expectBlock(src, ["var r = a.withdraw(amt);", "switch (r) {"]);
    expectBlock(src, [
      "accountsRepository.save(a);",
      "for (var __e : a.pullEvents()) eventPublisher.publishEvent(__e);",
    ]);
    expectBlock(src, [
      "case intOrInsufficient_Insufficient e -> {",
      "accountsRepository.discard(a);",
    ]);
  });

  it("the repository of a dropped aggregate carries discard; another does not", async () => {
    const iface = await fileOf("java", "features/accounts/AccountRepository.java");
    expect(iface).toContain("default void discard(Account aggregate) { }");
    const impl = await fileOf("java", "features/accounts/AccountRepositoryImpl.java");
    expectBlock(impl, ["public void discard(Account aggregate) {", "em.detach(aggregate);", "}"]);
    const notes = await fileOf("java", "features/notes/NoteRepository.java");
    expect(notes).not.toContain("discard");
  });

  it("every body imports the operation union's carriers from the aggregate's package", async () => {
    const files = await filesOf("java");
    const bodies = [...files.entries()].filter(
      ([p, c]) => p.includes("/application/") && c.includes("case intOrInsufficient_Insufficient"),
    );
    expect(bodies.map(([p]) => p.split("/").pop()).sort()).toStrictEqual([
      "ChargeHandler.java",
      "LedgerDispatcher.java",
      "LedgerWorkflows.java",
    ]);
    for (const [p, c] of bodies) {
      expect(c, p).toContain("import com.loom.d.features.accounts.intOrInsufficient_Insufficient;");
    }
  });

  it("the reactor dispatch detaches in its error arm too", async () => {
    const files = await filesOf("java");
    const reactor = [...files.entries()].find(
      ([p, c]) => p.endsWith(".java") && c.includes("a.withdraw(1)"),
    );
    expect(reactor, "no java file renders the reactor body").toBeDefined();
    expect(reactor![1]).toContain("accountsRepository.discard(a);");
  });
});

describe("matched op result — python", () => {
  it("the workflow saves in the success arm only", async () => {
    const src = await fileOf("python", "app/http/workflows_routes.py");
    expectBlock(src, ["r = a.withdraw(amt)", 'if r["type"] == "int":']);
    expectBlock(src, ["await accounts.save(a)", 'elif r["type"] == "Insufficient":']);
  });

  it("builds the repository an arm saves a created aggregate through", async () => {
    const src = await fileOf("python", "app/http/workflows_routes.py");
    expectBlock(src, [
      "accounts = AccountRepository(session, make_dispatcher(session))",
      "notes = NoteRepository(session, make_dispatcher(session))",
      "a = await accounts.get_by_id(id)",
    ]);
    expectBlock(src, ['n = Note.create(text="declined")', "await notes.save(n)"]);
  });
});
