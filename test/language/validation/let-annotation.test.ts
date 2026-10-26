// `let x: T = e`: the value is checked against the declared type, the binding
// takes that type, a bare literal promotes to it, a narrower numeric value is
// widened explicitly in the IR, and the printer keeps the annotation.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import type { ExprIR, StmtIR } from "../../../src/ir/types/loom-ir.js";
import { isLetStmt, type Model } from "../../../src/language/generated/ast.js";
import { printStmt } from "../../../src/language/print/index.js";
import { tyKey, typingSession } from "../../../src/language/typing/index.js";
import { lspCodes } from "../../_helpers/diagnostics.js";
import { parseRawResult } from "../../_helpers/index.js";
import { toLoomModel } from "../../_helpers/ir.js";
import { parseString, parseValid } from "../../_helpers/parse.js";

const sys = (body: string) => `
system Demo {
  subdomain S {
    context C {
      aggregate Account with crudish {
        balance: money
        count: long
        operation op(n: int) {
          ${body}
        }
      }
    }
  }
}`;

async function codes(body: string): Promise<string[]> {
  const { diagnostics } = await parseString(sys(body), { validate: true });
  return lspCodes(diagnostics);
}

const MISMATCH = "loom.let-type-mismatch";

describe("let annotations — validation", () => {
  it("refuses a value that does not fit the declared type", async () => {
    expect(await codes('let z: int = "s"')).toContain(MISMATCH);
    expect(await codes("let w: long = 1.5")).toContain(MISMATCH);
  });

  it("admits promotion, widening and an exact fit", async () => {
    const c = await codes(`
      let step: long = 1
      let fee: money = 5
      let total: decimal = n
      let name: string = "x"
      count := count + step
      balance := balance + fee`);
    expect(c).not.toContain(MISMATCH);
    expect(c).toEqual([]);
  });

  it("types later uses of the binding by its declared type", async () => {
    // `step` is `long`, so it fits a `long` field even though `1` alone is `int`.
    expect(await codes("let step: long = 1  count := step")).toEqual([]);
    // …and a declared `decimal` does not fit a `long` field.
    expect(await codes("let d: decimal = n  count := d")).toContain("loom.assign-type-mismatch");
  });
});

describe("let annotations — typing and lowering", () => {
  it("the typing pass binds the declared type", async () => {
    const model = (await parseString(sys("let step: long = 1  count := step"), { validate: false }))
      .model as Model;
    const s = typingSession([model]);
    const ref = AstUtils.streamAst(model).find(
      (n) => n.$type === "NameRef" && (n as { name?: string }).name === "step",
    );
    expect(ref && tyKey(s.typeAt(ref)!)).toBe("p:long");
  });

  it("lowers a promoted literal and an explicit widening", async () => {
    const m = toLoomModel(await parseValid(sys("let step: long = 1  let total: decimal = n")));
    const agg = m.systems[0]!.subdomains[0]!.contexts[0]!.aggregates[0]!;
    const body = agg.operations.find((o) => o.name === "op")!.statements as StmtIR[];
    const lets = body.filter((s): s is Extract<StmtIR, { kind: "let" }> => s.kind === "let");
    const byName = new Map(lets.map((l) => [l.name, l]));
    expect(byName.get("step")!.type).toEqual({ kind: "primitive", name: "long" });
    expect(byName.get("step")!.expr).toMatchObject({ kind: "literal" });
    const total = byName.get("total")!;
    expect(total.type).toEqual({ kind: "primitive", name: "decimal" });
    expect(total.expr).toMatchObject({
      kind: "convert",
      target: "decimal",
      from: "int",
    } satisfies Partial<ExprIR>);
  });
});

describe("let annotations — printer", () => {
  it("round-trips the annotation", () => {
    const r = parseRawResult(sys("let step: long = 1"));
    expect(r.parserErrors).toEqual([]);
    const stmt = AstUtils.streamAst(r.value as Model).find(isLetStmt)!;
    expect(printStmt(stmt)).toBe("let step: long = 1");
  });
});
