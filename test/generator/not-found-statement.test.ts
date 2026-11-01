import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { notFoundStmtDetail } from "../../src/ir/enrich/wire-policy.js";
import type { WorkflowStmtIR } from "../../src/ir/types/loom-ir.js";
import { workflowCanAnswerNotFound } from "../../src/ir/types/loom-ir.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel, enrichedContexts } from "../_helpers/ir.js";

// `notFound` / `notFound "detail"` — the statement that lets an `else` answer
// the not-found ProblemDetails.  Each backend raises the SAME error its by-id
// read raises on a miss, so the router's existing not-found arm renders the
// identical envelope; the booted proof is the `not-found-statement` corpus
// case's wire golden.  These pin the emission per backend.

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/corpus/not-found-statement.ddd"),
  "utf8",
);
const on = (platform: string) => FIXTURE.replace("__PLATFORM__", platform);

function fileWith(files: Map<string, string>, needle: string): string {
  const hit = [...files.entries()].filter(([, c]) => c.includes(needle));
  expect(
    hit.map(([p]) => p),
    `no emitted file contains ${needle}`,
  ).not.toHaveLength(0);
  return hit.map(([, c]) => c).join("\n");
}

describe("notFound — lowering", () => {
  it("lowers to a `not-found` statement; a bare one in an `if let` else names the lookup's aggregate", async () => {
    const ctx = enrichedContexts(await buildLoomModel(on("node"))).find((c) => c.name === "Desk")!;
    const elseOf = (stmts: readonly WorkflowStmtIR[]) => {
      const iflet = stmts.find((s) => s.kind === "if-let");
      return iflet?.kind === "if-let" ? iflet.elseBody : undefined;
    };
    const handler = (name: string) => (ctx.commandHandlers ?? []).find((h) => h.name === name)!;
    expect(elseOf(handler("EscalateOpen").statements)).toEqual([
      expect.objectContaining({ kind: "not-found", detail: "no open ticket", subject: "Ticket" }),
    ]);
    const bare = elseOf(handler("CloseOpen").statements)?.[0];
    expect(bare).toMatchObject({ kind: "not-found", subject: "Ticket" });
    expect(bare && "detail" in bare ? bare.detail : undefined).toBeUndefined();
    expect(notFoundStmtDetail({ subject: "Ticket" })).toBe("Ticket not found");
    expect(notFoundStmtDetail({ detail: "no open ticket", subject: "Ticket" })).toBe(
      "no open ticket",
    );
    expect(notFoundStmtDetail({})).toBe("Resource not found");
  });

  it("makes a workflow that says it declare the not-found rung", async () => {
    const ctx = enrichedContexts(await buildLoomModel(on("node"))).find((c) => c.name === "Desk")!;
    const wf = ctx.workflows.find((w) => w.name === "escalateFirst")!;
    expect(workflowCanAnswerNotFound(wf, ctx.repositories)).toBe(true);
  });
});

describe("notFound — per-backend emission raises the by-id miss's own error", () => {
  it("node: AggregateNotFoundError, answered by the router's not-found arm", async () => {
    const files = await generateSystemFiles(on("node"));
    const handlers = fileWith(files, 'throw new AggregateNotFoundError("no open ticket");');
    expect(handlers).toContain('throw new AggregateNotFoundError("Ticket not found");');
    expect(handlers).toMatch(
      /import \{[^}]*AggregateNotFoundError[^}]*\} from "\.\.\/domain\/errors"/,
    );
    expect(handlers).toContain("if (err instanceof AggregateNotFoundError) return problem(404");
    const wf = [...files.entries()].find(([p]) => p.endsWith("d/http/workflows.ts"))?.[1];
    expect(wf).toContain('throw new AggregateNotFoundError("Ticket not found");');
  });

  it("dotnet: AggregateNotFoundException", async () => {
    const files = await generateSystemFiles(on("dotnet"));
    for (const line of [
      'throw new AggregateNotFoundException("no open ticket");',
      'throw new AggregateNotFoundException("Ticket not found");',
    ])
      expect(fileWith(files, line)).toContain(line);
  });

  it("java: AggregateNotFoundException", async () => {
    const files = await generateSystemFiles(on("java"));
    for (const line of [
      'throw new AggregateNotFoundException("no open ticket");',
      'throw new AggregateNotFoundException("Ticket not found");',
    ])
      expect(fileWith(files, line)).toContain(line);
  });

  it("python: AggregateNotFoundError, imported", async () => {
    const files = await generateSystemFiles(on("python"));
    const handler = fileWith(files, 'raise AggregateNotFoundError("no open ticket")');
    expect(handler).toContain("from app.domain.errors import AggregateNotFoundError");
    fileWith(files, 'raise AggregateNotFoundError("Ticket not found")');
  });

  it("elixir: the branch evaluates to the tagged miss, and the dispatcher answers it", async () => {
    const files = await generateSystemFiles(on("elixir"));
    fileWith(files, '{:error, {:not_found, "no open ticket"}}');
    const wf = fileWith(files, "Workflows.EscalateFirst");
    expect(wf).toContain('{:error, {:not_found, "Ticket not found"}}');
    // Both dispatchers carry the detail-carrying arm the term needs.
    const arms = [...files.entries()].filter(
      ([p, c]) => p.endsWith("_controller.ex") && c.includes("{:error, {:not_found, detail}}"),
    );
    expect(arms.map(([p]) => p.split("/").pop()).sort()).toEqual([
      "desk_api_routes_controller.ex",
      "workflows_controller.ex",
    ]);
  });
});
