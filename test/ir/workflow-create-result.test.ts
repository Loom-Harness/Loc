// `create(…): T { … return <expr> }` — a command-triggered workflow starter
// that answers its caller (banking eval B-03; docs/language-reference/
// 13-workflows.md § "Returning a result").
//
// Pins every phase the feature crosses:
//   parse + print  — the `: T` slot round-trips through the structural printer;
//   lower          — the terminal `return` is held apart as `CreateIR.returnValue`
//                    (the workflow statement vocabulary has no return arm);
//   validate       — the phase-⑦ "routed create" rule (a NAMED command create
//                    beside the unnamed one has no route, so no caller);
//   generate       — each of the five backends answers 200 with the value on the
//                    declaring workflow, and a result-less sibling keeps its 204.
// The phase-④ pairing rules (`loom.workflow-return-*`) are proven by their
// FIRING_FIXTURES entries in test/system/diagnostic-firing-census.test.ts.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import { commandCreateResult } from "../../src/ir/util/workflow-command-route.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { isWorkflow } from "../../src/language/generated/ast.js";
import { printStructural } from "../../src/language/print/index.js";
import { parseString } from "../_helpers/index.js";
import type { Backend } from "../fixtures/corpus/backends.js";
import { generateCorpusCase } from "../fixtures/corpus/harness.js";

const FEATURE = "workflow-create-result";

const src = (members: string) => `
system S {
  subdomain D { context Bank {
    aggregate Account with crudish { number: string  balance: int }
    repository Accounts for Account { }
    workflow open {
      ${members}
    }
  } }
  api A from D
  storage pg { type: postgres }
  resource st { for: Bank, kind: state, use: pg }
  deployable d { platform: node, contexts: [Bank], dataSources: [st], serves: A, port: 4000 }
}`;

const OPEN = `
      create(n: string): Account id {
        let a = Account.create({ number: n, balance: 0 })
        return a.id
      }`;

describe("workflow create(…): T — parse, print, lower", () => {
  it("parses clean and prints the result type back", async () => {
    const { model, errors } = await parseString(src(OPEN));
    expect(errors).toEqual([]);
    const wf = AstUtils.streamAst(model).find(isWorkflow);
    expect(wf).toBeDefined();
    const printed = printStructural(wf!);
    expect(printed).toContain("create(n: string): Account id {");
    expect(printed).toContain("return a.id");
  });

  it("lowers the terminal return apart from the body", async () => {
    const { model } = await parseString(src(OPEN));
    const wf = allContexts(lowerModel(model))[0]!.workflows[0]!;
    const create = wf.creates[0]!;
    expect(create.returnType).toMatchObject({ kind: "id", targetName: "Account" });
    expect(create.returnValue).toMatchObject({ kind: "member", member: "id" });
    // The body keeps only the factory — no `__bad__` sentinel for the return.
    expect(create.statements.map((s) => s.kind)).toEqual(["factory-let"]);
    expect(commandCreateResult(wf)?.type.kind).toBe("id");
  });

  it("a create without `: T` carries no result (the 204 path)", async () => {
    const { model } = await parseString(
      src(`create(n: string) { let a = Account.create({ number: n, balance: 0 }) }`),
    );
    const wf = allContexts(lowerModel(model))[0]!.workflows[0]!;
    expect(commandCreateResult(wf)).toBeUndefined();
  });
});

describe("workflow create(…): T — the routed-create rule (phase ⑦)", () => {
  async function irCodes(members: string): Promise<(string | undefined)[]> {
    const { model } = await parseString(src(members), { validate: false });
    return validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => d.code);
  }

  it("refuses a result on a NAMED command create beside the unnamed one", async () => {
    const codes = await irCodes(`
      create(n: string) { let a = Account.create({ number: n, balance: 0 }) }
      create other(n: string): Account id {
        let a = Account.create({ number: n, balance: 1 })
        return a.id
      }`);
    expect(codes).toContain("loom.workflow-return-no-caller");
  });

  it("accepts a result on the routed (unnamed) create", async () => {
    expect(await irCodes(OPEN)).not.toContain("loom.workflow-return-no-caller");
  });
});

describe("workflow create(…): T — every backend answers 200 with the value", () => {
  const all = (files: Map<string, string>) => [...files.values()].join("\n");
  const cases: Record<Backend, (text: string) => void> = {
    node: (t) => {
      expect(t).toContain(
        `200: { description: "OK", content: { "application/json": { schema: z.string() } } },`,
      );
      expect(t).toContain("workflowResult = account.id;");
      expect(t).toContain("return httpCtx.json(workflowResult, 200);");
      // transactional: the value is read INSIDE the tx callback.
      expect(t).toMatch(/workflowResult = source\.balance;\n\s+\}\);/);
      // the result-less sibling keeps its 204.
      expect(t).toContain("return httpCtx.body(null, 204);");
    },
    dotnet: (t) => {
      expect(t).toContain(": ICommand<AccountId>;");
      expect(t).toContain("ICommandHandler<OpenAccountCommand, AccountId>");
      expect(t).toContain("[ProducesResponseType(typeof(Guid), 200)]");
      expect(t).toContain("return Ok(result.Value);");
      expect(t).toContain(
        "public sealed record TopUpCommand(AccountId Acct, int Amount) : ICommand;",
      );
      // transactional: assigned before CommitAsync, returned after it.
      expect(t).toMatch(/workflowResult = source\.Balance;\n\s+await tx\.CommitAsync/);
    },
    java: (t) => {
      expect(t).toContain(
        "public UUID openAccount(@Valid @RequestBody OpenAccountRequest request) {",
      );
      expect(t).toContain("var workflowResult = account.id().value();");
      expect(t).toContain("public int transfer(TransferRequest request) {");
      expect(t).toContain("@ResponseStatus(HttpStatus.NO_CONTENT)\n    public void topUp(");
    },
    python: (t) => {
      expect(t).toContain(
        "async def open_account_workflow(body: OpenAccountRequest, session: SessionDep) -> str:",
      );
      expect(t).toMatch(/@router\.post\("\/open_account", status_code=200,/);
      expect(t).toContain("        return workflow_result");
      expect(t).toMatch(/@router\.post\("\/top_up", status_code=204,/);
    },
    vanilla: (t) => {
      expect(t).toContain("{:ok, account.id}");
      // the op target the result reads is rebound to the updated struct…
      expect(t).toContain("{:ok, source} <- Context.withdraw_account(source,");
      // …and one it does not read keeps the discard.
      expect(t).toContain("{:ok, _} <- Context.deposit_account(target,");
      expect(t).toContain("respond_result(conn, D.Banking.Workflows.OpenAccount.run(params))");
      expect(t).toContain("def respond_result(conn, other), do: respond(conn, other)");
      expect(t).toContain("respond(conn, D.Banking.Workflows.TopUp.run(params))");
    },
  };
  for (const [backend, check] of Object.entries(cases) as [Backend, (t: string) => void][]) {
    it(backend, async () => {
      const text = all(await generateCorpusCase(FEATURE, backend));
      expect(text.length).toBeGreaterThan(0);
      check(text);
    });
  }
});
