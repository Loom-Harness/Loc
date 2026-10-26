// A `let` bound to an optional repository read binds `T?`, and `if let`
// narrows it — in workflow, handler and domain-service bodies.
//
//   let c = Customers.find(ByEmail(e))     // Customer?  (select-one)
//   let o = Orders.findById(oid)           // Order?     (load-optional)
//   if let o = Orders.findById(oid) { … }  // findById as an `if let` source
//   if let o = x { … }                     // narrowing a binding in scope
//
// A member read of the binding before it is narrowed is refused at phase ④
// (`loom.nullable-receiver`); an op-call statement or a repository delete on
// it is refused at phase ⑦ under the same code (`optional-binding-checks.ts`).

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import {
  allContexts,
  type WorkflowStmtIR,
  workflowCanAnswerNotFound,
} from "../../src/ir/types/loom-ir.js";
import { bodyEffects } from "../../src/ir/util/effects.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const sys = (body: { handler?: string; workflow?: string; service?: string }): string => `
system S {
  subdomain D {
    context Sales {
      aggregate Customer with crudish { email: string  name: string }
      aggregate Order with crudish {
        code: string  qty: int
        unique (code)
        operation touch() { qty := qty + 1 }
      }
      criterion ByEmail(e: string) of Customer = email == e
      repository Customers for Customer { }
      repository Orders for Order {
        find byCode(c: string): Order? where this.code == c
      }
      command C { e: string  oid: Order id  code: string }
      commandHandler H(e: string, oid: Order id, code: string) {
        ${body.handler ?? "let c = Customers.find(ByEmail(e))\n        precondition c != null"}
      }
      domainService Svc {
        operation q(e: string, oid: Order id): bool {
          ${body.service ?? "let c = Customers.find(ByEmail(e))\n          return c != null"}
        }
      }
      workflow W {
        create(c: C) {
          ${body.workflow ?? "let x = Orders.findById(c.oid)\n          if let o = x { o.touch() }"}
        }
      }
    }
  }
  api A from D { route POST "/h/{e}/{oid}/{code}" -> Sales.H }
  storage pg { type: postgres }
  resource s { for: Sales, kind: state, use: pg }
  deployable d { platform: node  contexts: [Sales]  dataSources: [s]  serves: A  port: 3000 }
}
`;

/** Every error code, phase ④ (the AST validators) and phase ⑦ (the IR). */
async function errorCodes(source: string): Promise<string[]> {
  const { model, diagnostics } = await parseString(source, { validate: true });
  const ast = diagnostics.filter((d) => d.severity === 1).map((d) => String(d.code ?? d.message));
  const ir = validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "");
  return [...ast, ...ir];
}

async function ctxOf(source: string) {
  const { model } = await parseString(source, { validate: false });
  return allContexts(enrichLoomModel(lowerModel(model)))[0]!;
}

function first<K extends WorkflowStmtIR["kind"]>(
  stmts: readonly WorkflowStmtIR[],
  kind: K,
): Extract<WorkflowStmtIR, { kind: K }> {
  const hit = stmts.find((s) => s.kind === kind);
  if (hit?.kind !== kind) throw new Error(`expected a '${kind}' statement`);
  return hit as Extract<WorkflowStmtIR, { kind: K }>;
}

describe("lowering", () => {
  it("a `let` over `Repo.find(<Criterion>)` is a select-one repo-let binding `T?`", async () => {
    const ctx = await ctxOf(sys({}));
    const let_ = first(ctx.commandHandlers![0]!.statements, "repo-let");
    expect(let_).toMatchObject({
      name: "c",
      op: "select-one",
      repoName: "Customers",
      aggName: "Customer",
      retrievalName: "findAllByByEmail",
      synthCriterion: { name: "ByEmail" },
      returnType: { kind: "optional", inner: { kind: "entity", name: "Customer" } },
    });
    // The criterion's argument, not the criterion's own body.
    expect(let_.args).toEqual([expect.objectContaining({ kind: "ref", name: "e" })]);
    // Enrichment materialises the retrieval the read runs.
    expect(ctx.retrievals.map((r) => r.name)).toContain("findAllByByEmail");
  });

  it("`findById` is an `if let` source", async () => {
    const ctx = await ctxOf(sys({ workflow: "if let o = Orders.findById(c.oid) { o.touch() }" }));
    const il = first(ctx.workflows[0]!.creates[0]!.statements, "if-let");
    expect(il).toMatchObject({ op: "load-optional", repoName: "Orders", aggName: "Order" });
    expect(il.retrievalArgs).toHaveLength(1);
    expect(il.savesInThen).toEqual([{ name: "o", aggName: "Order", repoName: "Orders" }]);
  });

  it("an `if let` over an optional binding narrows it without a second read", async () => {
    const ctx = await ctxOf(sys({}));
    const create = ctx.workflows[0]!.creates[0]!;
    const il = first(create.statements, "if-let");
    expect(il).toMatchObject({ op: "bound", var: "o", aggName: "Order", repoName: "Orders" });
    // The binding is the source, as an ordinary ref — every expression walk
    // (liveness, unused-name checks) sees the read of `x`.
    expect(il.retrievalArgs).toEqual([expect.objectContaining({ kind: "ref", name: "x" })]);
    // One load (the `let`), not two.
    const loads = bodyEffects(create, undefined).filter((e) => e.kind === "load");
    expect(loads).toHaveLength(1);
  });

  it("a body whose only reads are optional cannot answer not-found", async () => {
    const ctx = await ctxOf(sys({}));
    expect(workflowCanAnswerNotFound(ctx.workflows[0]!, ctx.repositories)).toBe(false);
    const must = await ctxOf(
      sys({ workflow: "let o = Orders.getById(c.oid)\n          o.touch()" }),
    );
    expect(workflowCanAnswerNotFound(must.workflows[0]!, must.repositories)).toBe(true);
  });
});

describe("a guarded optional binding is clean in every body", () => {
  it("handler, domain service, workflow", async () => {
    expect(await errorCodes(sys({}))).toEqual([]);
  });

  it("every optional read, each guarded", async () => {
    const src = sys({
      handler: `let b = Orders.findById(oid)
        let k = Orders.findBy(code: code)
        let d = Orders.byCode(code)
        precondition b == null
        if let o = k { o.touch() } else { if let p = d { p.touch() } }`,
      service: "let o = Orders.findById(oid)\n          return o != null ? o.qty > 0 : false",
      workflow: `let a = Customers.find(ByEmail(c.e))
          precondition a != null
          let x = Orders.findById(c.oid)
          if let x = x { x.touch() }`,
    });
    expect(await errorCodes(src)).toEqual([]);
  });
});

describe("an un-narrowed optional binding is refused when dereferenced", () => {
  const NULLABLE = "loom.nullable-receiver";

  it("a member read in a handler (phase ④)", async () => {
    const src = sys({
      handler: "let o = Orders.findById(oid)\n        precondition o.qty > 0",
    });
    expect(await errorCodes(src)).toContain(NULLABLE);
  });

  it("a member read in a domain service (phase ④)", async () => {
    const src = sys({ service: "let o = Orders.findById(oid)\n          return o.qty > 0" });
    expect(await errorCodes(src)).toContain(NULLABLE);
  });

  it("an op-call statement in a workflow (phase ⑦), naming the binding", async () => {
    const src = sys({ workflow: "let x = Orders.findById(c.oid)\n          x.touch()" });
    const { model } = await parseString(src, { validate: false });
    const hits = validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
      (d) => d.code === NULLABLE,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain("'x' may be null");
    expect(hits[0]!.message).toContain("if let x = x");
    // Not ALSO an unknown binding: the binding exists, it is just optional.
    expect(await errorCodes(src)).not.toContain("loom.workflow-unknown-binding");
  });

  it("an op-call in a handler, and in the else branch of an `if let`", async () => {
    for (const handler of [
      "let x = Customers.find(ByEmail(e))\n        x.touch()",
      "let x = Orders.byCode(code)\n        if let y = Orders.findById(oid) { y.touch() } else { x.touch() }",
    ]) {
      expect(await errorCodes(sys({ handler })), handler).toContain(NULLABLE);
    }
  });

  it("a repository delete of the binding", async () => {
    const src = sys({ handler: "let x = Orders.findById(oid)\n        Orders.delete(x)" });
    expect(await errorCodes(src)).toContain(NULLABLE);
  });

  it("CONTROL — `getById` binds the row, which an op-call may use", async () => {
    const src = sys({ handler: "let x = Orders.getById(oid)\n        x.touch()" });
    expect(await errorCodes(src)).not.toContain(NULLABLE);
  });
});

describe("`if let` sources that are not optional reads", () => {
  it("`getById` and a non-optional binding stay bad sources", async () => {
    for (const workflow of [
      "if let o = Orders.getById(c.oid) { o.touch() }",
      "let g = Orders.getById(c.oid)\n          if let o = g { o.touch() }",
    ]) {
      expect(await errorCodes(sys({ workflow })), workflow).toContain("loom.iflet-bad-source");
    }
  });
});
