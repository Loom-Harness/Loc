import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { isNotFoundStmt } from "../../../src/language/generated/ast.js";
import { printStmt } from "../../../src/language/print/index.js";
import { parseRaw, parseString } from "../../_helpers/parse.js";

// `notFound` placement (`src/language/validators/stmt-placement.ts`):
// workflow / handler bodies only (`loom.not-found-placement`), and last in its
// block (`loom.not-found-unreachable`).

const ctx = (members: string) => `
system S {
  subdomain Sub { context C {
    aggregate Ticket with crudish {
      customer: string
      open: bool
      operation touch() { open := true }
${members.includes("TICKET_OP") ? "      operation bad() { notFound }" : ""}
    }
    repository Tickets for Ticket { }
    criterion OpenFor(c: string) of Ticket = this.customer == c && this.open
${members.replace("TICKET_OP", "")}
  } }
}`;

async function codes(src: string): Promise<string[]> {
  const { diagnostics } = await parseString(src);
  return diagnostics
    .map((d) => String(d.code))
    .filter((c) => c.startsWith("loom.not-found-"))
    .sort();
}

describe("notFound placement", () => {
  it("is legal in commandHandler / queryHandler / workflow create / on bodies, nested in if let and for", async () => {
    const src = ctx(`
    event Opened { customer: string }
    commandHandler A(c: string) {
      if let t = Tickets.find(OpenFor(c)) { t.touch() } else { notFound "no open ticket" }
    }
    queryHandler B(c: string): bool {
      if let t = Tickets.find(OpenFor(c)) { precondition t.open } else { notFound }
      return true
    }
    workflow w {
      create(c: string) {
        if let t = Tickets.find(OpenFor(c)) { t.touch() } else { notFound }
      }
    }
    workflow r {
      customer: string
      create(e: Opened) by e.customer {
        if let t = Tickets.find(OpenFor(e.customer)) { t.touch() } else { notFound }
      }
    }`);
    expect(await codes(src)).toEqual([]);
  });

  it("is refused in an aggregate operation and in a domain-service operation", async () => {
    const src = ctx(`TICKET_OP
    domainService Probe {
      operation probe(c: string): bool {
        notFound
      }
    }`);
    expect(await codes(src)).toEqual(["loom.not-found-placement", "loom.not-found-placement"]);
  });

  it("is refused when a statement follows it in its block", async () => {
    const src = ctx(`
    commandHandler A(c: string) {
      if let t = Tickets.find(OpenFor(c)) { t.touch() } else {
        notFound
        precondition c != ""
      }
    }
    queryHandler B(c: string): bool {
      notFound
      return true
    }`);
    expect(await codes(src)).toEqual(["loom.not-found-unreachable", "loom.not-found-unreachable"]);
  });

  it("prints back to its own source", () => {
    for (const stmt of ['notFound "no open ticket"', "notFound"]) {
      const model = parseRaw(
        ctx(`
    commandHandler A(c: string) {
      ${stmt}
    }`),
      );
      const nodes = [...AstUtils.streamAst(model)].filter(isNotFoundStmt);
      expect(nodes.map((s) => printStmt(s))).toEqual([stmt]);
    }
  });
});
