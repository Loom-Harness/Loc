// The statement `match` in backend bodies — lowering and the phase-⑦ shape
// gates.  An operation body lowers it to the `variant-match` StmtIR; a workflow
// / handler body to the `variant-match` WorkflowStmtIR, whose arms carry their
// own saves.  A `T?` subject is a presence check (`subjectShape: "absence"`).

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts, type StmtIR, type WorkflowStmtIR } from "../../src/ir/types/loom-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const SYS = (members: string) => `
  system Shop {
    subdomain Sales {
      context Shop {
        error NF { detail: string }
        aggregate A {
          code: string
          note: string?
          operation reserve(): string or NF { return code }
          operation touch() { code := "t" }
          ${members}
        }
        repository As for A { }
      }
    }
  }
`;

const CTX = (members: string) => `
  system Shop {
    subdomain Sales {
      context Shop {
        error NF { detail: string }
        aggregate A {
          code: string
          operation touch() { code := "t" }
        }
        repository As for A { }
        ${members}
      }
    }
  }
`;

async function context(src: string) {
  const { model } = await parseString(src, { validate: false });
  return allContexts(lowerModel(model))[0]!;
}

async function matchDiags(src: string): Promise<string[]> {
  const { model } = await parseString(src, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.code?.startsWith("loom.match-"))
    .map((d) => `${d.severity} ${d.code}`);
}

describe("statement match — lowering", () => {
  it("an operation body lowers a `T?` subject to a presence match aliasing the binding", async () => {
    const ctx = await context(
      SYS(`operation annotate() { match note { string s => { code := s } else => { } } }`),
    );
    const op = ctx.aggregates[0]!.operations.find((o) => o.name === "annotate")!;
    const m = op.statements[0] as Extract<StmtIR, { kind: "variant-match" }>;
    expect(m.kind).toBe("variant-match");
    expect(m.subjectShape).toBe("absence");
    // The binding is the subject itself, read at the narrowed type — no local.
    const assign = m.arms[0]!.body[0] as Extract<StmtIR, { kind: "assign" }>;
    expect(assign.value).toMatchObject({
      kind: "ref",
      name: "note",
      type: { kind: "primitive", name: "string" },
    });
  });

  it("a tagged subject keeps its arms' match-binding locals and no absence shape", async () => {
    const ctx = await context(
      SYS(`operation settle() {
             let r = reserve()
             match r { string s => { code := s } NF e => { code := e.detail } }
           }`),
    );
    const op = ctx.aggregates[0]!.operations.find((o) => o.name === "settle")!;
    const m = op.statements[1] as Extract<StmtIR, { kind: "variant-match" }>;
    expect(m.subjectShape).toBeUndefined();
    expect(m.arms.map((a) => [a.binding, a.isError])).toEqual([
      ["s", false],
      ["e", true],
    ]);
  });

  it("a handler arm that mutates its binding saves it at the arm's end, not at exit", async () => {
    const ctx = await context(
      CTX(`commandHandler Close(aId: A id) {
             let found = As.findById(aId)
             match found {
               A x => { x.touch() }
               else => { notFound }
             }
           }`),
    );
    const h = ctx.commandHandlers![0]!;
    const m = h.statements[1] as Extract<WorkflowStmtIR, { kind: "variant-match" }>;
    expect(m.kind).toBe("variant-match");
    expect(m.subjectShape).toBe("absence");
    expect(m.arms[0]!.savesInArm).toEqual([{ name: "x", aggName: "A", repoName: "As" }]);
    expect(h.savesAtExit).toEqual([]);
    // The `else` of a `T?` aggregate read names the aggregate it missed.
    expect(m.elseBody).toEqual([expect.objectContaining({ kind: "not-found", subject: "A" })]);
  });

  it("an arm that mutates an OUTER binding leaves it to the exit save", async () => {
    const ctx = await context(
      CTX(`domainService Vet {
             operation judge(code: string): string or NF { return code }
           }
           commandHandler Mark(aId: A id, code: string) {
             let a = As.getById(aId)
             let v = Vet.judge(code)
             match v {
               string s => { a.touch() }
               NF e => { }
             }
           }`),
    );
    const h = ctx.commandHandlers![0]!;
    expect(h.savesAtExit.map((s) => s.name)).toEqual(["a"]);
  });
});

describe("statement match — phase-⑦ shape gates in backend bodies", () => {
  it("refuses a non-union subject in an operation", async () => {
    expect(
      await matchDiags(SYS(`operation bad() { match code { string s => { code := s } } }`)),
    ).toContain("error loom.match-non-union-subject");
  });

  it("warns on a non-exhaustive match in a workflow body", async () => {
    expect(
      await matchDiags(
        CTX(`domainService Vet {
               operation judge(code: string): string or NF { return code }
             }
             workflow W {
               create(code: string) {
                 let v = Vet.judge(code)
                 match v { string s => { } }
               }
             }`),
      ),
    ).toEqual(["warning loom.match-non-exhaustive"]);
  });

  it("accepts a `T?` subject with an `else`", async () => {
    expect(
      await matchDiags(
        SYS(`operation annotate() { match note { string s => { code := s } else => { } } }`),
      ),
    ).toEqual([]);
  });
});
