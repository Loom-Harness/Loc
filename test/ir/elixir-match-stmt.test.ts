// `loom.elixir-match-stmt-unsupported` refuses only the statement-`match`
// sub-shapes the Phoenix emitters cannot render — one case per `#slug`, plus
// the renderable shapes it must leave alone.

import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";

const CODE = "loom.elixir-match-stmt-unsupported";

const shop = (members: string, platform = "elixir") => `
system Shop {
  subdomain D {
    context Sales {
      error Rejected { reason: string }
      payload Receipt { code: string }
      payload Paid { amount: int }
      event Settled { orderId: Order id }
      domainService Pricing {
        operation quote(code: string): Receipt or Rejected {
          if code.length > 0 {
            return Receipt { code: code }
          } else {
            return Rejected { reason: "empty" }
          }
        }
        operation two(code: string): Receipt or Paid {
          if code.length > 0 {
            return Receipt { code: code }
          } else {
            return Paid { amount: 1 }
          }
        }
      }
      aggregate Order with crudish {
        code: string
        note: string?
        operation touch() { code := "t" }
      }
      repository Orders for Order
      ${members}
    }
  }
  api A from D { httpStatus Rejected -> 409 }
  storage primary { type: postgres }
  resource st { for: Sales, kind: state, use: primary }
  deployable d { platform: ${platform}, contexts: [Sales], dataSources: [st], serves: A, port: 4000 }
}`;

/** The `#slug`-identifying first words of each refusal the source draws. */
async function refusals(src: string): Promise<string[]> {
  const report = await validate(src);
  return report.diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => {
      expect(d.code).toBe(CODE);
      return d.message;
    });
}

const domainService = (body: string) => `
      domainService Ops {
        operation run(n: string?): string {
          ${body}
        }
      }`;

describe("loom.elixir-match-stmt-unsupported — what renders", () => {
  it("leaves an operation, domain service, workflow and handler match alone", async () => {
    const src = shop(`
      domainService Ops {
        operation run(n: string?): string {
          match n {
            string s => { return s }
            else => { return "none" }
          }
        }
      }
      commandHandler Close(orderId: Order id) {
        let o = Orders.find(orderId)
        match o {
          Order x => { x.touch() }
          else => { notFound }
        }
      }
      workflow Settle {
        create(orderId: Order id, code: string) {
          let o = Orders.get(orderId)
          let q = Pricing.quote(code)
          match q {
            Receipt rc => { o.touch() }
            Rejected e => { precondition e.reason.length > 0 }
          }
        }
      }`);
    expect(await refusals(src)).toEqual([]);
  });
});

describe("loom.elixir-match-stmt-unsupported — the refused sub-shapes", () => {
  it("#return-in-arm: a non-tail `return` in a domain-service arm", async () => {
    const src = shop(
      domainService(`match n {
            string s => { return s }
            else => { }
          }
          return "x"`),
    );
    const [msg, ...rest] = await refusals(src);
    expect(rest).toEqual([]);
    expect(msg).toContain("A `return` appears inside a `match` arm");
  });

  it("#guard-in-arm: a guard in an operation arm", async () => {
    const src = shop(`
      aggregate Note with crudish {
        text: string
        operation set(n: string?) {
          match n {
            string s => { precondition s.length > 0  text := s }
            else => { }
          }
        }
      }`);
    const [msg, ...rest] = await refusals(src);
    expect(rest).toEqual([]);
    expect(msg).toContain("guard appears inside a `match` arm");
  });

  it("#arm-statement: an `emit` in an operation arm", async () => {
    const src = shop(`
      event Noted { noteId: Note id }
      aggregate Note with crudish {
        text: string
        operation set(n: string?) {
          match n {
            string s => { emit Noted { noteId: id } }
            else => { }
          }
        }
      }`);
    const [msg, ...rest] = await refusals(src);
    expect(rest).toEqual([]);
    expect(msg).toContain("cannot render THERE");
  });

  it("#multi-success: a union of two success variants", async () => {
    const src = shop(`
      aggregate Note with crudish {
        text: string
        operation set(c: string) {
          let q = Pricing.two(c)
          match q {
            Receipt rc => { text := rc.code }
            Paid p => { text := "paid" }
          }
        }
      }`);
    const [msg, ...rest] = await refusals(src);
    expect(rest).toEqual([]);
    expect(msg).toContain("more than one non-error variant");
  });

  it("admits a match in an eventSourced workflow handler (it renders on the reactor chain)", async () => {
    const src = shop(`
      event Tick { orderId: Order id, note: string? }
      event Ran { orderId: Order id }
      workflow Run eventSourced {
        orderId: Order id
        count: int
        create(t: Tick) by t.orderId {
          let nn = t.note
          match nn {
            string s => { emit Ran { orderId: t.orderId } }
            else => { }
          }
        }
        apply(r: Ran) { count := 1 }
      }`);
    expect(await refusals(src)).toEqual([]);
  });

  it("is elixir-only: node renders every one of those shapes' hosts", async () => {
    const src = shop(
      domainService(`match n {
            string s => { return s }
            else => { }
          }
          return "x"`),
      "node",
    );
    expect(await refusals(src)).toEqual([]);
  });
});
