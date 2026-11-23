// Workflow `send` and `step` (D-WORKFLOW-STEPS): the grammar, the printer,
// the lowering, the plan facts (`workflowSteps`, `sendDelivery`, `stepStores`,
// `stepsNeedingCompensation`, `sendPrincipal`) and the validators.  No backend
// renders a send yet; each refuses it as `loom.target-unsupported`.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import {
  sendDelivery,
  sendPrincipal,
  sendsIn,
  stepStores,
  stepsNeedingCompensation,
  workflowSteps,
} from "../../src/ir/plan/index.js";
import type { WorkflowStmtIR } from "../../src/ir/types/loom-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { isStepStmt } from "../../src/language/generated/ast.js";
import { printStmt } from "../../src/language/print/print-stmt.js";
import { parseString } from "../_helpers/parse.js";

/** A two-context system: `Ordering` sends to its own handlers and to
 *  `Billing`'s.  `billingHost` decides where Billing is hosted. */
const model = (body: string, opts: { billingHost?: "api" | "billing"; header?: string } = {}) => `
system S {
  subdomain M {
    context Ordering {
      command Reserve { qty: int }
      command Release { qty: int, note: string? }
      command Audit { qty: int }
      query Stock { sku: string }
      error OutOfStock { left: int }
      payload Reserved { left: int }
      commandHandler ReserveHandler(cmd: Reserve): Reserved or OutOfStock {
        return Reserved { left: cmd.qty }
      }
      commandHandler ReleaseHandler(cmd: Release) { }
      commandHandler AuditOne(cmd: Audit) { }
      commandHandler AuditTwo(cmd: Audit) { }
      queryHandler StockHandler(q: Stock): int { return 1 }
      workflow Place${opts.header ?? ""} {
        n: int
        create(qty: int) {
${body}
        }
      }
    }
    context Billing {
      command Charge { amount: int }
      commandHandler ChargeHandler(cmd: Charge) { }
    }
  }
  storage pg { type: postgres }
  resource os { for: Ordering, kind: state, use: pg }
  resource bs { for: Billing, kind: state, use: pg }
  deployable api { platform: node, contexts: [Ordering${opts.billingHost === "billing" ? "" : ", Billing"}], dataSources: [os${opts.billingHost === "billing" ? "" : ", bs"}], port: 3000 }
${opts.billingHost === "billing" ? "  deployable billing { platform: node, contexts: [Billing], dataSources: [bs], port: 3001 }" : ""}
}`;

async function load(body: string, opts?: Parameters<typeof model>[1]) {
  const parsed = await parseString(model(body, opts));
  const loom = enrichLoomModel(lowerModel(parsed.model));
  const sys = loom.systems[0]!;
  const ordering = sys.subdomains[0]!.contexts.find((c) => c.name === "Ordering")!;
  const wf = ordering.workflows[0]!;
  const ir = validateLoomModel(loom);
  return { parsed, loom, sys, ordering, wf, body: wf.creates[0]!.statements, ir };
}

const LONE = `          send Release { qty: qty }`;
const BLOCK = `          step reserve {
            let r = send Reserve { qty: qty }
          } undo {
            send Release { qty: qty }
          }
          match r {
            Reserved x => {}
            OutOfStock e => { notFound }
          }`;

describe("grammar and printer", () => {
  it("parses a step with undo, a bound send and a qualified send, and prints them back", async () => {
    const { parsed } = await load(
      `${BLOCK}\n          step bill { send Billing.Charge { amount: qty } } final`,
    );
    expect(parsed.errors.filter((e) => e.includes("Expecting"))).toEqual([]);
    const steps: string[] = [];
    for (const n of AstUtils.streamAllContents(parsed.model))
      if (isStepStmt(n)) steps.push(printStmt(n));
    expect(steps).toEqual([
      "step reserve {\n  let r = send Reserve { qty: qty }\n} undo {\n  send Release { qty: qty }\n}",
      "step bill {\n  send Billing.Charge { amount: qty }\n} final",
    ]);
  });

  it("keeps `step`, `undo` and `final` usable as names", async () => {
    const parsed = await parseString(`
system S { subdomain M { context C {
  aggregate A with crudish {
    step: int
    final: bool
    operation undo(final: int) { step := final }
  }
} } }`);
    expect(parsed.errors).toEqual([]);
  });
});

describe("lowering", () => {
  it("lowers a step block, its undo and a bound send with the handler's result", async () => {
    const { body } = await load(BLOCK);
    const step = body[0] as Extract<WorkflowStmtIR, { kind: "step" }>;
    expect(step.kind).toBe("step");
    expect(step.name).toBe("reserve");
    const send = step.body[0] as Extract<WorkflowStmtIR, { kind: "send" }>;
    expect(send).toMatchObject({ kind: "send", context: "Ordering", record: "Reserve" });
    expect(send.result?.name).toBe("r");
    expect(send.result?.errorVariants).toEqual(["OutOfStock"]);
    expect(step.compensation.kind).toBe("undo");
  });

  it("resolves a qualified record in its own context", async () => {
    const { body } = await load(
      `          step bill { send Billing.Charge { amount: qty } } final`,
    );
    const step = body[0] as Extract<WorkflowStmtIR, { kind: "step" }>;
    expect(step.body[0]).toMatchObject({ kind: "send", context: "Billing", record: "Charge" });
    expect(step.compensation).toEqual({ kind: "final" });
  });
});

describe("plan facts", () => {
  it("workflowSteps: a lone send and a block commit on their own; in a transactional body they join", async () => {
    const { body } = await load(`${LONE}\n${BLOCK}`);
    expect(workflowSteps(body, false).map((s) => [s.name, s.kind, s.mode, s.compensation])).toEqual(
      [
        ["Release", "send", "own-commit", "none"],
        ["reserve", "block", "own-commit", "undo"],
      ],
    );
    expect(workflowSteps(body, true).every((s) => s.mode === "joins")).toBe(true);
  });

  it("stepsNeedingCompensation: a committed step followed by anything, or by a stateful end write", async () => {
    const { body } = await load(`          step a { send Release { qty: 1 } }\n${LONE}`);
    expect(stepsNeedingCompensation(body, false, false).map((s) => s.name)).toEqual(["a"]);
    expect(stepsNeedingCompensation(body, true, true)).toEqual([]);
    const last = (await load(`          step a { send Release { qty: 1 } }`)).body;
    expect(stepsNeedingCompensation(last, false, false)).toEqual([]);
    expect(stepsNeedingCompensation(last, false, true).map((s) => s.name)).toEqual(["a"]);
  });

  it("sendDelivery: now on the deployable's storage; outbox from another deployable", async () => {
    const one = await load(`          step bill { send Billing.Charge { amount: qty } } final`);
    const [s1] = sendsIn(one.body);
    const api = one.sys.deployables.find((d) => d.name === "api")!;
    expect(sendDelivery(s1!, one.ordering, api, one.sys)).toEqual({ kind: "now", storage: "pg" });
    const remote = await load(`          step bill { send Billing.Charge { amount: qty } } final`, {
      billingHost: "billing",
    });
    const [s2] = sendsIn(remote.body);
    const api2 = remote.sys.deployables.find((d) => d.name === "api")!;
    expect(sendDelivery(s2!, remote.ordering, api2, remote.sys)).toEqual({
      kind: "outbox",
      reason: "other-deployable",
    });
  });

  it("stepStores: every reached storage with its reasons", async () => {
    const { body, sys, ordering } = await load(BLOCK);
    const api = sys.deployables.find((d) => d.name === "api")!;
    const stores = stepStores(sendsIn(body), ordering, api, sys, true);
    expect([...stores.keys()]).toEqual(["pg"]);
    expect(stores.get("pg")!.map((r) => [r.kind, r.via, r.resource])).toEqual([
      ["own-state", "Ordering", "os"],
      ["send", "Ordering.Reserve", "os"],
      ["send", "Ordering.Release", "os"],
    ]);
  });

  it("sendPrincipal: the caller for a command body, the system for a reaction", () => {
    expect(sendPrincipal({ reaction: false })).toBe("caller");
    expect(sendPrincipal({ reaction: true })).toBe("system");
  });
});

describe("validators", () => {
  const codesFor = async (body: string, opts?: Parameters<typeof model>[1]) =>
    (await load(body, opts)).ir;

  it("accepts a well-formed body: only the backend refusal remains", async () => {
    const diags = await codesFor(BLOCK);
    const errors = diags.filter((d) => d.severity === "error");
    expect(errors.map((d) => d.code)).toEqual(["loom.target-unsupported"]);
    expect(errors[0]!.message).toContain("can't run a workflow `send` or `step` yet");
  });

  it("refuses an unknown record, an unknown field and a missing field", async () => {
    const diags = await codesFor(
      `          step a { send Nope { } } final\n          step b { send Reserve { qty: 1, extra: 2 } } final\n          step c { send Reserve { } } final`,
    );
    const msgs = diags.filter((d) => d.code === "loom.workflow-send-record").map((d) => d.message);
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toContain("declares no `command` or `query` record 'Nope'");
    expect(msgs[1]).toContain("sets 'extra'");
    expect(msgs[2]).toContain("leaves out 'qty'");
  });

  it("refuses a record caught by several handlers, and a bound send of a handler without a result", async () => {
    const diags = await codesFor(
      `          step a { send Audit { qty: 1 } } final\n          step b { let x = send Release { qty: 1 } } final`,
    );
    const msgs = diags.filter((d) => d.code === "loom.workflow-send-handler").map((d) => d.message);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toContain("'AuditOne', 'AuditTwo' all catch 'Audit'");
    expect(msgs[1]).toContain("handler 'ReleaseHandler' declares none");
  });

  it("refuses an unmatched value-or-error result", async () => {
    const diags = await codesFor(`          step a { let r = send Reserve { qty: 1 } } final`);
    const hits = diags.filter((d) => d.code === "loom.workflow-send-result-unmatched");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain("can answer 'OutOfStock'");
  });

  it("requires undo or final on a committed step that something follows", async () => {
    const diags = await codesFor(`          step a { send Release { qty: 1 } }\n${LONE}`);
    const hits = diags.filter((d) => d.code === "loom.workflow-step-undo-required");
    expect(hits.map((d) => d.message)).toEqual([
      expect.stringContaining("step 'a' commits on its own"),
    ]);
    // In a transactional workflow the step joins the body's transaction.
    const joined = await codesFor(`          step a { send Release { qty: 1 } }\n${LONE}`, {
      header: " transactional",
    });
    expect(joined.map((d) => d.code)).not.toContain("loom.workflow-step-undo-required");
  });

  it("refuses a step outside the top level, a non-send in a step, and a repeated step name", async () => {
    const diags = await codesFor(
      `          step a { let y = 1 } final\n          step a { send Release { qty: 1 } } final\n          if qty > 1 { send Release { qty: 1 } }`,
    );
    const msgs = diags
      .filter((d) => d.code === "loom.workflow-send-placement")
      .map((d) => d.message);
    expect(msgs).toEqual([
      expect.stringContaining("step 'a' holds a statement that is not a `send`"),
      expect.stringContaining("two steps are named 'a'"),
      expect.stringContaining("`send Release` sits inside a loop, a branch or a match arm"),
    ]);
  });

  it("refuses a send to another deployable: in a step it cannot join, alone it needs the outbox", async () => {
    const inStep = await codesFor(
      `          step bill { send Billing.Charge { amount: 1 } } final`,
      {
        billingHost: "billing",
      },
    );
    expect(inStep.map((d) => d.code)).toContain("loom.workflow-step-cross-storage");
    expect(inStep.map((d) => d.code)).not.toContain("loom.workflow-send-outbox-unsupported");
    const alone = await codesFor(`          send Billing.Charge { amount: 1 }`, {
      billingHost: "billing",
    });
    const hit = alone.find((d) => d.code === "loom.workflow-send-outbox-unsupported");
    expect(hit?.message).toContain("'api' does not host context 'Billing'");
  });

  it("refuses a send in a handler body and in an operation body", async () => {
    const src = model(LONE).replace(
      "commandHandler ReleaseHandler(cmd: Release) { }",
      "commandHandler ReleaseHandler(cmd: Release) { send Audit { qty: 1 } }",
    );
    const handler = {
      ir: validateLoomModel(enrichLoomModel(lowerModel((await parseString(src)).model))),
    };
    expect(
      handler.ir.filter((d) => d.code === "loom.workflow-send-placement").map((d) => d.message),
    ).toEqual([expect.stringContaining("handler 'ReleaseHandler': `send Audit`")]);
    const op = await parseString(`
system S { subdomain M { context C {
  command Go { n: int }
  commandHandler GoHandler(cmd: Go) { }
  aggregate A with crudish { n: int  operation bump() { send Go { n: 1 } } }
} } }`);
    expect(op.errors.join("\n")).toContain("a `send` or `step` sits in operation 'bump'");
  });
});
