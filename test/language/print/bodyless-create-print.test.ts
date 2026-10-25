// A `create` may omit its body: params that name fields populate them without
// one, so `create(title: string)` is the same AST as `create(title: string) { }`
// — on an aggregate and on a workflow starter.  Pinned here: it parses, it
// validates, it prints as the braced form, and the printed form re-parses to
// the same create.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import type { Model } from "../../../src/language/generated/ast.js";
import { printStructural } from "../../../src/language/print/index.js";
import { extractErrors, parseRawResult, parseString } from "../../_helpers/index.js";

const SRC = (aggCreate: string, wfCreate: string): string => `system S {
  subdomain M {
    context C {
      aggregate Ticket {
        title: string
        ${aggCreate}
        operation rename(t: string) { title := t }
      }
      repository Tickets for Ticket { }
      event Opened { ticket: Ticket id }
      workflow track {
        ticket: Ticket id
        ${wfCreate}
      }
    }
  }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}
`;

const BODYLESS = SRC("create(title: string)", "create(e: Opened) by e.ticket");
const BRACED = SRC("create(title: string) { }", "create(e: Opened) by e.ticket { }");

function creates(model: Model): { $type: string; body: unknown[] }[] {
  const out: { $type: string; body: unknown[] }[] = [];
  for (const n of AstUtils.streamAllContents(model)) {
    if (n.$type === "Create" || n.$type === "WorkflowCreateDecl") {
      out.push(n as unknown as { $type: string; body: unknown[] });
    }
  }
  return out.sort((a, b) => a.$type.localeCompare(b.$type));
}

describe("bodyless create", () => {
  it("parses on an aggregate and on a workflow starter, as an empty body", () => {
    const res = parseRawResult(BODYLESS);
    expect(res.parserErrors).toEqual([]);
    const cs = creates(res.value as Model);
    expect(cs.map((c) => c.$type)).toEqual(["Create", "WorkflowCreateDecl"]);
    for (const c of cs) expect(c.body).toEqual([]);
  });

  it("validates exactly like the braced form", async () => {
    const bodyless = extractErrors((await parseString(BODYLESS)).doc.diagnostics);
    const braced = extractErrors((await parseString(BRACED)).doc.diagnostics);
    expect(bodyless).toEqual(braced);
  });

  it("prints as the braced form, and the print re-parses to the same creates", () => {
    const res = parseRawResult(BODYLESS);
    const printed = printStructural((res.value as Model).members[0]!);
    expect(printed).toMatch(/create\(title: string\)\s*\{\s*\}/);
    const again = parseRawResult(printed);
    expect(again.parserErrors).toEqual([]);
    expect(creates(again.value as Model).map((c) => [c.$type, c.body.length])).toEqual([
      ["Create", 0],
      ["WorkflowCreateDecl", 0],
    ]);
  });
});
