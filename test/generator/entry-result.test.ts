// A routed workflow `create` / `commandHandler` answering `T or E`, on the
// four backends that render it.  Each runs the command in one transaction and
// rolls the WHOLE command back when the answer is an `error` variant — the
// saves before it, the error arm's own writes and every event — then answers
// the error at its mapped status as problem+json; a success commits, then
// dispatches, then answers 200 with the tagged success variant.  The
// behavioural witness is corpus `workflow-expected-failure`.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SOURCE = (platform: string) =>
  readFileSync("test/fixtures/corpus/workflow-expected-failure.ddd", "utf8").replace(
    "__PLATFORM__",
    platform,
  );

const cache = new Map<string, Promise<Map<string, string>>>();
const files = (platform: string) => {
  let hit = cache.get(platform);
  if (!hit) {
    hit = generateSystemFiles(SOURCE(platform));
    cache.set(platform, hit);
  }
  return hit;
};
const fileEnding = async (platform: string, suffix: string): Promise<string> => {
  const all = await files(platform);
  const key = [...all.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no ${suffix} among ${[...all.keys()].join(", ")}`);
  return all.get(key)!;
};
const section = (text: string, start: string, end: string): string => {
  const i = text.indexOf(start);
  expect(i).toBeGreaterThanOrEqual(0);
  const j = text.indexOf(end, i + start.length);
  return text.slice(i, j < 0 ? undefined : j);
};

describe("expected-failure entry result — node", () => {
  it("rolls the transaction back on the error, answers 409 and dispatches only on success", async () => {
    const wf = await fileEnding("node", "http/workflows.ts");
    const pay = section(wf, 'path: "/pay"', 'path: "/hold"');
    expect(pay).toContain("schema: z.union([ProblemDetails, PaymentDeclinedProblem])");
    expect(pay).toContain('if (workflowResult.type === "PaymentDeclined") throw __rollback;');
    expect(pay).toContain(
      'if (!(workflowResult.type === "PaymentDeclined")) await __deferred.flush();',
    );
    const answer = pay.indexOf("status: 409");
    const dispatch = pay.indexOf("for (const ev of workflowEvents)");
    expect(answer).toBeGreaterThan(0);
    expect(dispatch).toBeGreaterThan(answer);
    expect(pay).toContain('workflowResult = { type: "Receipt", ...');
  });

  it("answers the correlated workflow's instance state for `return this`", async () => {
    const wf = await fileEnding("node", "http/workflows.ts");
    const hold = section(wf, 'path: "/hold"', "app.openapi(");
    expect(hold).toMatch(/type: "Hold", \.\.\.\(/);
  });

  it("a commandHandler answers the aggregate arm through toWire", async () => {
    const routes = await fileEnding("node", "http/bankApi-routes.ts");
    expect(routes).toContain('handlerResult = { type: "Account", ...(accounts.toWire(');
    expect(routes).toContain("throw __rollback;");
  });
});

describe("expected-failure entry result — .NET", () => {
  it("rolls back on the error and drops the deferred events", async () => {
    const h = await fileEnding("dotnet", "Application/Workflows/PayHandler.cs");
    expect(h).toMatch(
      /if \(workflowResult is global::D\.Application\.EntryResults\.ReceiptOrPaymentDeclined_PaymentDeclined\) await tx\.RollbackAsync\(cancellationToken\);/,
    );
    const ret = h.indexOf("_PaymentDeclined) return workflowResult;");
    expect(ret).toBeGreaterThan(0);
    expect(h.indexOf("await __deferral.FlushAsync")).toBeGreaterThan(ret);
  });

  it("the controller answers the error arm at 409 as problem+json", async () => {
    const c = await fileEnding("dotnet", "Api/LedgerWorkflowsController.cs");
    expect(c).toContain('StatusCode = 409, ContentTypes = { "application/problem+json" }');
    expect(c).toContain('problem.Extensions["available"]');
  });
});

describe("expected-failure entry result — Java", () => {
  it("marks the transaction rollback-only before answering the error", async () => {
    const s = await fileEnding("java", "application/workflows/LedgerWorkflows.java");
    const pay = section(s, "public ReceiptOrPaymentDeclinedResponse pay(", "    public ");
    expect(pay).toContain(
      "if (workflowResult instanceof ReceiptOrPaymentDeclinedResponse_PaymentDeclined) {",
    );
    expect(pay).toContain("TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();");
    expect(pay.indexOf("setRollbackOnly")).toBeLessThan(pay.indexOf("for (var __ev : __events)"));
  });

  it("the controller answers the error arm at 409", async () => {
    const c = await fileEnding("java", "api/LedgerWorkflowsController.java");
    expect(c).toContain("ProblemDetail.forStatus(409)");
  });
});

describe("expected-failure entry result — Python", () => {
  it("answers the error at 409 (the 4xx rolls the request back) before dispatching", async () => {
    const r = await fileEnding("python", "app/http/workflows_routes.py");
    const pay = section(r, "async def pay_workflow(", "async def ");
    const answer = pay.indexOf("status_code=409");
    expect(answer).toBeGreaterThan(0);
    expect(pay.indexOf("await dispatcher.dispatch(ev)")).toBeGreaterThan(answer);
  });
});
