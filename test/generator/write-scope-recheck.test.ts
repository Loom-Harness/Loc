// Every aggregate mutation re-checks the caller's write scope, whatever loaded
// the row (`ir/util/write-scope-guards.ts`).  A workflow / command handler that
// mutates or deletes a row it holds — one `Repo.all(<criterion>)` returned, a
// find, a loop variable — re-loads it through the backend's write-scope load
// (the load the op route uses) before the mutation, inside one transaction, so
// a row outside `deny write` answers the op route's 404 and
// rolls the whole command back.  A row the body created is exempt.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { WorkflowStmtIR } from "../../src/ir/types/loom-ir.js";
import { workflowCanAnswerNotFound } from "../../src/ir/types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../../src/ir/util/walk.js";
import {
  bodyWriteScopeGuards,
  writeScopeContext,
  writeScopeGuards,
} from "../../src/ir/util/write-scope-guards.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseValid } from "../_helpers/parse.js";

const system = (platform: string, policy = "deny write on Ledger") => `
system F3 {
  user { id: guid  tenantId: string }
  tenancy by user.tenantId of Org
  subdomain Core {
    context Books {
      aggregate Ledger with tenantOwned, crudish {
        label: string
        hits: int = 0
        operation touch() { hits := hits + 1 }
      }
      aggregate Tag with tenantOwned, crudish {
        name: string
        operation rename(n: string) { name := n }
      }
      aggregate Org with crudish { name: string  implements tenantRegistry }
      criterion AnyLedger of Ledger = hits >= 0
      criterion AnyTag of Tag = name != ""
      repository Ledgers for Ledger { }
      repository Tags for Tag { }
      repository Orgs for Org { }
      workflow touchLedgers {
        create() {
          let rows = Ledgers.all(AnyLedger, page: { offset: 0, limit: 50 })
          for l in rows { l.touch() }
        }
      }
      workflow openLedger {
        create(label: string) {
          let n = Ledger.create(label: label, hits: 0)
          n.touch()
        }
      }
      workflow renameTags {
        create(n: string) {
          let rows = Tags.all(AnyTag, page: { offset: 0, limit: 50 })
          for t in rows { t.rename(n) }
        }
      }
      domainService Bump {
        operation run(l: Ledger) { l.touch() }
      }
      workflow bumpLedgers {
        create() {
          let rows = Ledgers.all(AnyLedger, page: { offset: 0, limit: 50 })
          for l in rows { Bump.run(l) }
        }
      }
      workflow purgeLedgers {
        create() {
          let rows = Ledgers.all(AnyLedger, page: { offset: 0, limit: 50 })
          for l in rows { Ledgers.remove(l) }
        }
      }
      commandHandler TouchOne(lid: Ledger id) {
        if let l = Ledgers.find(lid) { l.touch() }
      }
      policy { ${policy} }
    }
  }
  api BooksApi from Core {
    route POST "/ledgers/{lid}/touch-one" -> Books.TouchOne
  }
  storage primary { type: postgres }
  resource booksState { for: Books, kind: state, use: primary }
  deployable d { platform: ${platform}  contexts: [Books]  dataSources: [booksState]  serves: BooksApi  port: 4000  auth: required }
}
`;

async function contextOf(platform: string, policy?: string) {
  const model = enrichLoomModel(lowerModel(await parseValid(system(platform, policy))));
  const ctx = model.systems[0]!.subdomains[0]!.contexts[0]!;
  return ctx;
}

function stmtsOf(stmts: readonly WorkflowStmtIR[]): WorkflowStmtIR[] {
  const out: WorkflowStmtIR[] = [];
  for (const s of stmts) walkWorkflowStmtsDeep(s, (n) => out.push(n));
  return out;
}

describe("write-scope guards — derived from the body's mutate / delete effects", () => {
  it("guards the loop variable a criterion read bound, once, before its mutation", async () => {
    const ctx = await contextOf("node");
    const wf = ctx.workflows.find((w) => w.name === "touchLedgers")!;
    const cx = writeScopeContext(wf.statements, ctx);
    const guarded = stmtsOf(wf.statements).flatMap((s) =>
      writeScopeGuards(s, cx).map((g) => ({ kind: s.kind, ...g })),
    );
    expect(guarded).toEqual([
      { kind: "op-call", name: "l", aggName: "Ledger", repoName: "Ledgers" },
    ]);
  });

  it("guards a row a `mutating` domain service writes, and a row the body removes", async () => {
    const ctx = await contextOf("node");
    for (const name of ["bumpLedgers", "purgeLedgers"]) {
      const wf = ctx.workflows.find((w) => w.name === name)!;
      expect(
        bodyWriteScopeGuards(wf.statements, writeScopeContext(wf.statements, ctx)),
        name,
      ).toEqual([{ name: "l", aggName: "Ledger", repoName: "Ledgers" }]);
    }
  });

  it("exempts a row the body created", async () => {
    const ctx = await contextOf("node");
    const wf = ctx.workflows.find((w) => w.name === "openLedger")!;
    expect(bodyWriteScopeGuards(wf.statements, writeScopeContext(wf.statements, ctx))).toEqual([]);
  });

  it("guards nothing on an aggregate whose write scope is not narrowed", async () => {
    const ctx = await contextOf("node");
    const wf = ctx.workflows.find((w) => w.name === "renameTags")!;
    expect(bodyWriteScopeGuards(wf.statements, writeScopeContext(wf.statements, ctx))).toEqual([]);
  });

  it("guards the `if let` binding a command handler mutates", async () => {
    const ctx = await contextOf("node");
    const h = (ctx.commandHandlers ?? []).find((x) => x.name === "TouchOne")!;
    expect(bodyWriteScopeGuards(h.statements, writeScopeContext(h.statements, ctx))).toEqual([
      { name: "l", aggName: "Ledger", repoName: "Ledgers" },
    ]);
  });

  it("the re-check is a not-found producer, so the workflow route declares the 404", async () => {
    const ctx = await contextOf("node");
    const wf = ctx.workflows.find((w) => w.name === "touchLedgers")!;
    expect(workflowCanAnswerNotFound(wf)).toBe(false);
    expect(workflowCanAnswerNotFound(wf, ctx)).toBe(true);
  });

  // `deny write` is the one narrowing write scope (D-TENANCY-FLAT): the
  // `local` floor reads and writes the same rows, so it adds no re-check.
  it("`allow local` does not narrow the write scope, so it guards nothing", async () => {
    const ctx = await contextOf("node", "allow local on Ledger");
    const wf = ctx.workflows.find((w) => w.name === "touchLedgers")!;
    expect(bodyWriteScopeGuards(wf.statements, writeScopeContext(wf.statements, ctx))).toEqual([]);
  });
});

/** The text of the first generated file whose path ends with `suffix`. */
async function fileEnding(platform: string, suffix: string): Promise<string> {
  for (const [p, body] of await generateSystemFiles(system(platform))) {
    if (p.endsWith(suffix)) return body;
  }
  throw new Error(`no ${platform} file ending ${suffix}`);
}

/** The lines from the first one containing `start` up to the first one after
 *  it containing `end`. */
function slice(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  return text.slice(from, to < 0 ? undefined : to);
}

/** `guard` appears, and appears before `mutation`. */
function guardsBefore(text: string, guard: string, mutation: string): boolean {
  const g = text.indexOf(guard);
  const m = text.indexOf(mutation);
  expect(g, `missing guard ${guard}`).toBeGreaterThanOrEqual(0);
  expect(m, `missing mutation ${mutation}`).toBeGreaterThan(g);
  return m > g && g >= 0;
}

describe("node (Hono)", () => {
  it("re-checks before a mutating service call and before a removal", async () => {
    const text = await fileEnding("node", "http/workflows.ts");
    expect(
      guardsBefore(
        slice(text, '"/bump_ledgers"', '"/purge_ledgers"'),
        "await ledgers.getById(l.id);",
        "Bump.run(",
      ),
    ).toBe(true);
    expect(
      guardsBefore(
        slice(text, '"/purge_ledgers"', "app.onError"),
        "await ledgers.getById(l.id);",
        "await ledgers.delete(",
      ),
    ).toBe(true);
  });
  it("re-loads the loop row through getById, inside a transaction", async () => {
    const wf = slice(
      await fileEnding("node", "http/workflows.ts"),
      '"/touch_ledgers"',
      '"/open_ledger"',
    );
    expect(wf).toContain("await db.transaction(async (tx) => {");
    guardsBefore(wf, "await ledgers.getById(l.id);", "l.touch();");
    expect(wf).toContain("404:");
  });
  it("leaves a created row and an unnarrowed aggregate alone", async () => {
    const text = await fileEnding("node", "http/workflows.ts");
    expect(slice(text, '"/open_ledger"', '"/rename_tags"')).not.toContain("getById");
    expect(slice(text, '"/rename_tags"', '"/bump_ledgers"')).not.toContain("getById");
  });
  it("a command handler re-checks inside a transaction", async () => {
    const h = await fileEnding("node", "http/booksApi-routes.ts");
    expect(h).toContain("const __response = await db.transaction(async (tx) => {");
    guardsBefore(h, "await ledgers.getById(l.id);", "l.touch();");
  });
});

describe(".NET", () => {
  it("re-loads the loop row through GetByIdForWriteAsync, inside a transaction", async () => {
    const wf = await fileEnding("dotnet", "Workflows/TouchLedgersHandler.cs");
    expect(wf).toContain("_uow.BeginTransactionAsync(cancellationToken)");
    guardsBefore(
      wf,
      "_ = await _ledgers.GetByIdForWriteAsync(l.Id, cancellationToken) ?? throw new AggregateNotFoundException(",
      "l.Touch();",
    );
    expect(await fileEnding("dotnet", "Workflows/OpenLedgerHandler.cs")).not.toContain("ForWrite");
  });
  it("a command handler re-checks inside a transaction", async () => {
    const h = await fileEnding("dotnet", "Commands/TouchOneHandler.cs");
    expect(h).toContain("_uow.BeginTransactionAsync(cancellationToken)");
    expect(h).toContain("await tx.RollbackAsync(cancellationToken);");
    guardsBefore(
      h,
      "_ = await _ledgers.GetByIdForWriteAsync(l.Id, cancellationToken)",
      "l.Touch();",
    );
  });
});

describe("python", () => {
  it("re-loads the loop row through get_by_id_for_write", async () => {
    const wf = slice(
      await fileEnding("python", "http/workflows_routes.py"),
      "async def touch_ledgers_workflow",
      "async def open_ledger_workflow",
    );
    guardsBefore(wf, "await ledgers.get_by_id_for_write(l.id)", "l.touch()");
    expect(
      slice(
        await fileEnding("python", "http/workflows_routes.py"),
        "async def open_ledger_workflow",
        "async def rename_tags_workflow",
      ),
    ).not.toContain("for_write");
  });
  it("a command handler re-checks", async () => {
    expect(
      guardsBefore(
        await fileEnding("python", "application/touch_one.py"),
        "await ledgers.get_by_id_for_write(l.id)",
        "l.touch()",
      ),
    ).toBe(true);
  });
});

describe("java", () => {
  it("re-loads the loop row through getById in the @Transactional service", async () => {
    const wf = await fileEnding("java", "application/workflows/BooksWorkflows.java");
    expect(wf).toContain("@Transactional");
    guardsBefore(
      slice(wf, "void touchLedgers(", "void openLedger("),
      "ledgersRepository.getById(l.id());",
      "l.touch();",
    );
    expect(slice(wf, "void openLedger(", "void renameTags(")).not.toContain("getById");
  });
  it("a command handler re-checks", async () => {
    expect(
      guardsBefore(
        await fileEnding("java", "application/workflows/TouchOneHandler.java"),
        "ledgersRepository.getById(l.id());",
        "l.touch();",
      ),
    ).toBe(true);
  });
});

describe("elixir", () => {
  it("guards the op-call with get_<agg>_for_write, inside Repo.transaction", async () => {
    const wf = await fileEnding("elixir", "books/workflows/touch_ledgers.ex");
    expect(wf).toContain("Repo.transaction(fn ->");
    expect(wf).toContain(
      "(with {:ok, _} <- Context.get_ledger_for_write(l.id, current_user), do: Context.touch_ledger(l, %{}))",
    );
    expect(await fileEnding("elixir", "books/workflows/open_ledger.ex")).not.toContain(
      "_for_write",
    );
  });
  it("a command handler re-checks inside Repo.transaction and takes the actor", async () => {
    const h = await fileEnding("elixir", "books/handlers/touch_one.ex");
    expect(h).toContain("def run(params, current_user \\\\ nil)");
    expect(h).toContain("D.Repo.transaction(fn ->");
    expect(h).toContain("{:error, reason} -> D.Repo.rollback(reason)");
    expect(h).toContain("Context.get_ledger_for_write(l.id, current_user)");
  });
});
