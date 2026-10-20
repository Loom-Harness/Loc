// `if let <var> = Repo.<find>(args) { … } else { … }` over a DECLARED optional
// find (`find byCode(c: string): Order?`) — the second `if let` source form
// beside `Repo.find(<Criterion>)`.
//
// The lowerer records the find on the `if-let` (`findMethod` + its args in
// `retrievalArgs`) and binds the var as the repository's aggregate, so the
// branch op-calls resolve and the handler gates see `Order`, not a phantom
// `Unknown`.  Every backend calls the repository's own nullable find and
// branches on presence; no retrieval is synthesised.
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts, type WorkflowStmtIR } from "../../src/ir/types/loom-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const HANDLER = `
        let first = Orders.getById(oid)
        let step = n
        if let hit = Orders.byCode(code) { hit.bump(step) } else { first.bump(step) }`;
const WORKFLOW = `if let o = Orders.byCode(c.code) { o.cancel() }`;

const SYS = (o: { handler?: string; workflow?: string; platform?: string }): string => `
system S {
  subdomain Sales {
    context Orders {
      enum Status { Draft, Cancelled }
      aggregate Order {
        code: string  qty: int  status: Status
        operation bump(n: int) { qty := qty + n }
        operation cancel() { status := Cancelled }
      }
      repository Orders for Order {
        find byCode(c: string): Order? where this.code == c
        find mustByCode(c: string): Order where this.code == c
      }
      command C { code: string }
      commandHandler BumpByCode(code: string, n: int, oid: Order id) { ${o.handler ?? HANDLER} }
      workflow W { create(c: C) { ${o.workflow ?? WORKFLOW} } }
    }
  }
  api A from Sales { route POST "/bump" -> Orders.BumpByCode }
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d { platform: ${o.platform ?? "node"}  contexts: [Orders]  dataSources: [s]  serves: A  port: 3000 }
}`;

async function ctxOf(src: string) {
  const { model } = await parseString(src, { validate: false });
  return allContexts(enrichLoomModel(lowerModel(model)))[0]!;
}

async function irDiags(src: string) {
  const { model } = await parseString(src, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

function ifLetOf(stmts: readonly WorkflowStmtIR[]): Extract<WorkflowStmtIR, { kind: "if-let" }> {
  const il = stmts.find((s) => s.kind === "if-let");
  if (il?.kind !== "if-let") throw new Error("expected an if-let statement");
  return il;
}

describe("if let over a declared optional find — IR", () => {
  it("records the find and types the binder in a commandHandler", async () => {
    const ctx = await ctxOf(SYS({}));
    const il = ifLetOf(ctx.commandHandlers![0]!.statements);
    expect(il).toMatchObject({
      var: "hit",
      repoName: "Orders",
      aggName: "Order",
      findMethod: "byCode",
      retrievalName: "",
      synthCriterion: { name: "" },
    });
    expect(il.retrievalArgs).toEqual([expect.objectContaining({ kind: "ref", name: "code" })]);
    expect(il.thenBody).toEqual([expect.objectContaining({ kind: "op-call", aggName: "Order" })]);
    expect(il.savesInThen).toEqual([{ name: "hit", aggName: "Order", repoName: "Orders" }]);
    // No retrieval is synthesised for a declared-find source.
    expect(ctx.retrievals.map((r) => r.name)).toEqual([]);
  });

  it("records the find in a workflow body too", async () => {
    const ctx = await ctxOf(SYS({}));
    const il = ifLetOf(ctx.workflows[0]!.creates[0]!.statements);
    expect(il).toMatchObject({ aggName: "Order", findMethod: "byCode" });
  });

  it("raises no source or multi-aggregate diagnostic", async () => {
    const codes = (await irDiags(SYS({}))).map((d) => d.code);
    expect(codes).not.toContain("loom.iflet-bad-source");
    expect(codes).not.toContain("loom.command-handler-multi-aggregate");
  });

  it("refuses a getById or non-optional find source in a handler, naming the aggregate", async () => {
    for (const source of ["Orders.getById(oid)", "Orders.mustByCode(code)"]) {
      // The sibling `getById` load makes a phantom `Unknown` binder aggregate
      // visible as a second aggregate to the single-aggregate gate.
      const handler = `let first = Orders.getById(oid)  first.bump(n)
        if let hit = ${source} { hit.bump(n) }`;
      const il = ifLetOf((await ctxOf(SYS({ handler }))).commandHandlers![0]!.statements);
      expect(il, source).toMatchObject({ aggName: "Order", repoName: "Orders" });
      expect(il.findMethod, source).toBeUndefined();
      const diags = await irDiags(SYS({ handler }));
      const bad = diags.filter((d) => d.code === "loom.iflet-bad-source");
      expect(bad, source).toHaveLength(1);
      expect(bad[0]!.message).toContain("commandHandler 'BumpByCode'");
      expect(diags.map((d) => d.code)).not.toContain("loom.command-handler-multi-aggregate");
    }
  });

  it("refuses the same sources in a workflow", async () => {
    const codes = (
      await irDiags(SYS({ workflow: `if let o = Orders.mustByCode(c.code) { o.cancel() }` }))
    ).map((d) => d.code);
    expect(codes).toContain("loom.iflet-bad-source");
  });
});

describe("if let over a declared optional find — every backend calls the find", () => {
  const cases: [string, RegExp, string[]][] = [
    [
      "node",
      /a-routes\.ts$/,
      ["const hit = await orders.byCode(code);", "if (hit !== null) {", "await orders.save(hit);"],
    ],
    ["python", /bump_by_code\.py$/, ["hit = await orders.by_code(code)", "if hit is not None:"]],
    [
      "dotnet",
      /BumpByCodeHandler\.cs$/,
      ["var hit = await _orders.ByCode(command.Code, cancellationToken);", "if (hit is not null)"],
    ],
    [
      "dotnet { persistence: dapper }",
      /BumpByCodeHandler\.cs$/,
      ["var hit = await _orders.ByCode(command.Code, cancellationToken);", "if (hit is not null)"],
    ],
    [
      "java",
      /BumpByCodeHandler\.java$/,
      ["var hit = ordersRepository.byCode(code);", "if (hit != null) {"],
    ],
    [
      "elixir",
      /handlers\/bump_by_code\.ex$/,
      ["hit = case Context.by_code_order(code) do", "{:ok, hit} -> hit", "if hit != nil do"],
    ],
  ];
  it.each(cases)("%s", async (platform, file, needles) => {
    const files = await generateSystemFiles(SYS({ platform }));
    const hits = [...files].filter(([k]) => file.test(k));
    expect(hits.map(([k]) => k)).toHaveLength(1);
    const body = hits[0]![1];
    for (const n of needles) expect(body).toContain(n);
    // The criterion-retrieval path must not leak in (it rendered an empty
    // receiver / an `Unknown` aggregate for this source).
    expect(body).not.toMatch(/run_?_|\.run\(|RunAsync|unknown/i);
  });
});
