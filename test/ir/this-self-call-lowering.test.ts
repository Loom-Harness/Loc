// `this.<fn>(x)` and `<fn>(x)` are ONE call — the two spellings must lower to
// the same IR node.
//
// The bare spelling (`strictfp(x)`) has always lowered to a `call` with
// `callKind: "function"` / `"private-operation"`, which every backend renders
// against the helper's DEF-SITE name (python `self._strictfp`, java
// `this.strictfp_`, elixir `strictfp(record, …)`).  The explicit-receiver
// spelling fell through to a generic `method-call` on a `this` receiver — so
// the backends whose def-site name differs from the declared one rendered a
// member that does not exist.  Found by the `java-reserved-words` corpus
// fixture's e2e leg on python (`POST …/bump → 500`, `AttributeError: 'Ticket'
// object has no attribute 'strictfp'. Did you mean: '_strictfp'?`); elixir
// emitted `record.strictfp(x)` — a function call on a struct field — on the
// same line.  Node / java / .NET happened to spell the self-call identically
// on both paths and are pinned byte-identical here for that reason.
//
// Pinned at both ends: the IR shape (for a `function` AND a `private
// operation` — the two callKinds the bare form produces; `this` is not an
// LValue head, so there is no statement-position twin to pin), and the
// python + elixir source that reads it.

import { describe, expect, it } from "vitest";
import type { AggregateIR, ExprIR, StmtIR } from "../../src/ir/types/loom-ir.js";
import { allAggregates } from "../../src/ir/types/loom-ir.js";
import { generateSystemFiles, generateSystemFilesUnchecked } from "../_helpers/generate.js";
import { buildLoomModel } from "../_helpers/index.js";

const CTX = `
  context Orders {
    aggregate Ticket {
      total: int
      function bump(by: int): int = by + this.total
      operation recalc(by: int) {
        total := this.bump(by)
      }
      private operation half(): int {
        return total / 2
      }
      operation shrink() {
        total := this.half()
      }
    }
    repository Tickets for Ticket { }
  }
`;

const SYSTEM = (platform: string) => `
system S {
  subdomain Sales {
    ${CTX}
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource ticketState { for: Orders, kind: state, use: pg }
  deployable d {
    platform: ${platform}
    contexts: [Orders]
    dataSources: [ticketState]
    serves: SalesApi
    port: 4000
  }
}
`;

async function ticket(): Promise<AggregateIR> {
  const loom = await buildLoomModel(CTX);
  return allAggregates(loom).find((a) => a.name === "Ticket") as AggregateIR;
}

describe("`this.<member>(…)` self-calls lower to the bare-call IR", () => {
  it("expression position: `this.<function>(x)` is a `call` with callKind function", async () => {
    const t = await ticket();
    const op = t.operations.find((o) => o.name === "recalc")!;
    const assign = op.statements.find((s: StmtIR) => s.kind === "assign") as Extract<
      StmtIR,
      { kind: "assign" }
    >;
    expect(assign.value).toMatchObject({
      kind: "call",
      callKind: "function",
      name: "bump",
      args: [{ kind: "ref", name: "by", refKind: "param" }],
    } satisfies Partial<ExprIR>);
    // The function's declared return type, not the string placeholder.
    expect(assign.targetType).toEqual({ kind: "primitive", name: "int" });
  });

  it("`this.<private operation>()` is a `call` with callKind private-operation + targetPrivate", async () => {
    const t = await ticket();
    const op = t.operations.find((o) => o.name === "shrink")!;
    const assign = op.statements.find((s: StmtIR) => s.kind === "assign") as Extract<
      StmtIR,
      { kind: "assign" }
    >;
    expect(assign.value).toMatchObject({
      kind: "call",
      callKind: "private-operation",
      name: "half",
      args: [],
      // Carried so python renders `self._half` (the private def-site name).
      targetPrivate: true,
    } satisfies Partial<ExprIR>);
  });

  it("python renders the def-site (underscore) name for the explicit self-call", async () => {
    const files = await generateSystemFiles(SYSTEM("python"));
    const src = files.get("d/app/domain/ticket.py")!;
    expect(src).toBeDefined();
    expect(src).toContain("def _bump(self, by: int) -> int:");
    expect(src).toContain("self._total = self._bump(by)");
    expect(src).not.toContain("self.bump(by)");
    expect(src).toContain("self._total = self._half()");
    expect(src).not.toContain("self.half()");
  });

  it("elixir renders the module-function form for the explicit self-call", async () => {
    // Unchecked on purpose: `total := this.half()` is REFUSED on elixir by
    // `loom.vanilla-op-call-position` (an op self-call outside `return` tail
    // position) — and that refusal is itself part of the proof, since the gate
    // scans for `callKind: "private-operation"` and the old `method-call`
    // shape sailed past it into `record.half()`.  The function-form render is
    // what this test reads.
    const files = await generateSystemFilesUnchecked(
      SYSTEM("elixir"),
      "the op self-call is refused on elixir by loom.vanilla-op-call-position; the function-form line is the subject",
    );
    const src = files.get("d/lib/d/orders.ex")!;
    expect(src).toBeDefined();
    expect(src).toContain("bump(record, by)");
    expect(src).not.toContain("record.bump(by)");
    expect(src).not.toContain("record.half()");
  });

  it("node / java / .NET spell the self-call the same as the bare form", async () => {
    const node = (await generateSystemFiles(SYSTEM("node"))).get("d/domain/ticket.ts")!;
    expect(node).toContain("this.bump(by)");
    const java = (await generateSystemFiles(SYSTEM("java"))).get(
      "d/src/main/java/com/loom/d/features/tickets/Ticket.java",
    )!;
    expect(java).toContain("this.bump(by)");
    const dotnet = [...(await generateSystemFiles(SYSTEM("dotnet"))).entries()].find(([p]) =>
      p.endsWith("/Ticket.cs"),
    )?.[1];
    expect(dotnet).toBeDefined();
    expect(dotnet).toContain("this.Bump(by)");
  });
});
