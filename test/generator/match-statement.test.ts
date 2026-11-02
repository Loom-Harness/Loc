// The statement `match` (arms that run statements) in backend bodies: an
// aggregate operation, a workflow `create` and a `commandHandler`.  Over a
// tagged union each backend dispatches on the variant and binds the arm's
// value (a scalar variant its carrier's value); over a `T?` it is a presence
// if/else, and in a workflow / handler the arm saves what it dirtied at its own
// end.  Node is additionally compiled end to end by the corpus TS leg; these
// pins are the per-backend spelling.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SOURCE = (platform: string) => `
system Shop {
  subdomain D {
    context Sales {
      error Rejected { reason: string }
      payload Receipt { code: string }
      domainService Pricing {
        operation quote(code: string): Receipt or Rejected {
          if code.length > 0 {
            return Receipt { code: code }
          }
          return Rejected { reason: "empty" }
        }
      }
      aggregate Order with crudish {
        code: string
        note: string?
        operation probe(): string or Rejected { return code }
        operation settle() {
          let r = probe()
          match r {
            string s => { code := s }
            Rejected e => { code := e.reason }
          }
        }
        operation annotate(n: string?) {
          match n {
            string s => { note := s }
            else => { note := "none" }
          }
        }
        operation touch() { code := "t" }
      }
      repository Orders for Order
      commandHandler Close(orderId: Order id) {
        let o = Orders.findById(orderId)
        match o {
          Order x => { x.touch() }
          else => { notFound }
        }
      }
      workflow Settle {
        create(orderId: Order id, code: string) {
          let o = Orders.getById(orderId)
          let q = Pricing.quote(code)
          match q {
            Receipt rc => { o.touch() }
            Rejected e => { o.touch() }
          }
        }
      }
    }
  }
  api A from D {
    httpStatus Rejected -> 409
    route POST "/orders/{orderId}/close" -> Sales.Close
  }
  storage primary { type: postgres }
  resource st { for: Sales, kind: state, use: primary }
  deployable d { platform: ${platform}, contexts: [Sales], dataSources: [st], serves: A, port: 4000 }
}
`;

async function fileOf(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(SOURCE(platform));
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`${platform}: no file ending ${suffix}`);
  return hit[1];
}

/** `lines` appear in `src` consecutively, each trimmed of its indent. */
function expectBlock(src: string, lines: string[]): void {
  const trimmed = src.split("\n").map((l) => l.trim());
  const at = trimmed.findIndex((_, i) => lines.every((l, j) => trimmed[i + j] === l));
  expect(at, `block not found:\n${lines.join("\n")}`).toBeGreaterThan(-1);
}

describe("statement match — node", () => {
  it("an operation switches on the union's `type`, a scalar arm binding its value", async () => {
    const src = await fileOf("node", "d/domain/order.ts");
    expectBlock(src, [
      "switch (r.type) {",
      'case "string": {',
      "const s = r.value;",
      "this._code = s;",
      "break;",
      "}",
      'case "Rejected": {',
      "const e = r;",
      "this._code = e.reason;",
      "break;",
      "}",
      "}",
    ]);
  });

  it("a `T?` subject is a presence if/else reading the subject itself", async () => {
    const src = await fileOf("node", "d/domain/order.ts");
    expectBlock(src, [
      "if (n != null) {",
      "this._note = n;",
      "} else {",
      'this._note = "none";',
      "}",
    ]);
  });

  it("a handler binds the present row, saves it in the arm, and 404s the absent side", async () => {
    const src = await fileOf("node", "d/http/a-routes.ts");
    expectBlock(src, [
      "if (o != null) {",
      "const x = o;",
      "x.touch();",
      "await orders.save(x);",
      "} else {",
      'throw new AggregateNotFoundError("Order not found");',
      "}",
    ]);
  });

  it("a workflow switches on a domain-service result", async () => {
    const src = await fileOf("node", "d/http/workflows.ts");
    expectBlock(src, ["switch (q.type) {", 'case "Receipt": {', "const rc = q;", "o.touch();"]);
  });
});

describe("statement match — dotnet / java / python operation bodies", () => {
  it("dotnet: a switch statement over the carrier records", async () => {
    const src = await fileOf("dotnet", "Domain/Orders/Order.cs");
    expectBlock(src, [
      "switch (r)",
      "{",
      "case stringOrRejected_string __sCarrier:",
      "{",
      "var s = __sCarrier.Value;",
      "Code = s;",
      "break;",
      "}",
      "case stringOrRejected_Rejected e:",
    ]);
    expect(src).toContain("if (n is not null) {");
  });

  it("java: an arrow switch over the sealed union", async () => {
    const src = await fileOf("java", "features/orders/Order.java");
    expectBlock(src, [
      "switch (r) {",
      "case stringOrRejected_string sCarrier -> {",
      "var s = sCarrier.value();",
      "this.code = s;",
      "}",
      "case stringOrRejected_Rejected e -> {",
    ]);
    expect(src).toContain("if (n != null) {");
  });

  it("python: a type probe per arm, the exhaustive tail arm unconditional", async () => {
    const src = await fileOf("python", "d/app/domain/order.py");
    expectBlock(src, [
      'if r["type"] == "string":',
      's = cast(str, r["value"])',
      "self._code = s",
      "else:",
      "e = r",
    ]);
    expect(src).toContain("if n is not None:");
  });
});

describe("statement match — dotnet / java / python handler and workflow bodies", () => {
  it("dotnet: the handler saves the bound row in its arm", async () => {
    const src = await fileOf("dotnet", "Commands/CloseHandler.cs");
    expectBlock(src, [
      "if (o is not null)",
      "{",
      "var x = o;",
      "x.Touch();",
      "await _orders.SaveAsync(x, cancellationToken);",
    ]);
  });

  it("java: the workflow switches on the service result", async () => {
    const src = await fileOf("java", "application/workflows/SalesWorkflows.java");
    expectBlock(src, ["switch (q) {", "case ReceiptOrRejected_Receipt rc -> {", "o.touch();"]);
  });

  it("python: the handler binds and saves the row only on the present side", async () => {
    const src = await fileOf("python", "d/app/application/close.py");
    expectBlock(src, ["if o is not None:", "x = o", "x.touch()", "await orders.save(x)", "else:"]);
  });
});
