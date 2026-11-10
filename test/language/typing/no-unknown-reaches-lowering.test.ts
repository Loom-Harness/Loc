// The non-test expressions lowering reads are typed or refused — never left
// `unknown` for lowering to fill in as `string` (#4115).  Each case below was
// one of the shapes a fleet-wide measurement found reaching lowering untyped:
// symbolic walker-primitive arguments, the ui effects, page names, a page
// gate's `permissions.<p>`, click-handler lambdas, a shorthand projection's
// rows, and a `currentUser.<claim>` with no `user { }` block to declare it.

import { readFileSync } from "node:fs";
import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { isExpression, type Model } from "../../../src/language/generated/ast.js";
import { tyKey, typingSession } from "../../../src/language/typing/index.js";
import { lspCodes } from "../../_helpers/diagnostics.js";
import { parseString } from "../../_helpers/index.js";

/** The type of the first expression whose source text is exactly `text`. */
async function typeOfText(src: string, text: string): Promise<string> {
  const model = (await parseString(src, { validate: false })).model as Model;
  const s = typingSession([model]);
  for (const n of AstUtils.streamAst(model)) {
    if (isExpression(n) && n.$cstNode?.text === text) {
      const t = s.typeAt(n);
      return t ? (t.kind === "unknown" ? `unknown:${t.cause}` : tyKey(t)) : "(unreached)";
    }
  }
  throw new Error(`no expression \`${text}\``);
}

const system = (ui: string, extra = "") => `system S {
  user { id: string  permissions: string[] }
  auth { enforcement: opt, oidc { issuer: env("I") clientId: env("C") } }
  subdomain D {
    permissions { read }
    context C {
      aggregate Order with crudish {
        code: string
        total: int
        operation close() { code := "closed" }
      }
      repository Orders for Order { }
      projection Big { from Order as o where o.total > 10 }
      ${extra}
    }
  }
  api A from D
  ui Web {
    api Api: A
    ${ui}
  }
}`;

describe("ui expressions lowering reads are typed", () => {
  it("a closed-vocabulary walker argument is its string; `op:` names an operation", async () => {
    const src = system(`page Home { route: "/" body: Stack {
      Button { "Go", variant: primary },
      OperationForm { of: Order, op: close }
    } }`);
    expect(await typeOfText(src, "primary")).toBe("p:string");
    expect(await typeOfText(src, "close")).toBe("unknown:not-a-value");
  });

  it("the ui effects yield nothing, and a page is named, not a value", async () => {
    const src = system(`page Home { route: "/" body: Stack {
      Action { then: toast("Saved") },
      Action { then: navigate(Home) }
    } }`);
    expect(await typeOfText(src, `toast("Saved")`)).toBe("never");
    expect(await typeOfText(src, "navigate(Home)")).toBe("never");
    expect(await typeOfText(src, "Home")).toBe("unknown:not-a-value");
  });

  it("a page gate reads a subdomain's permission catalogue", async () => {
    const src = system(`page Secret { route: "/s"
      requires currentUser.permissions.contains(permissions.read)
      body: Heading { "x" } }`);
    expect(await typeOfText(src, "permissions.read")).toBe("p:string");
  });

  it("a store action named as a handler is an action", async () => {
    const src = system(`store Basket { state { n: int = 0 } action clear() { n := 0 } }
      page Home { route: "/" body: Button { "x", onClick: Basket.clear } }`);
    expect(await typeOfText(src, "Basket.clear")).toBe("action");
  });

  it("a ui's own extern function answers its declared result", async () => {
    const src = system(`function initials(name: string): string extern from "./initials"
      page Home { route: "/" body: Heading { initials("Ada") } }`);
    expect(await typeOfText(src, `initials("Ada")`)).toBe("p:string");
  });

  it("a page reads its route's id as a string, whatever its route declares", async () => {
    const src = system(
      `page Detail { route: "/orders" derived key: string = id body: Heading { key } }`,
    );
    expect(await typeOfText(src, "id")).toBe("p:string");
  });

  it("navigation state is a record of the target page's params", async () => {
    const src = system(`page Target(code: string) { route: "/t" body: Heading { code } }
      page Home { route: "/" body: Action { then: navigate(Target, { code: "a" }) } }`);
    expect(await typeOfText(src, `{ code: "a" }`)).toBe("rec:TargetState");
  });

  it("a create mutation's body is the create's request; a query handle's error a message", async () => {
    const src = system(`page Home { route: "/" state { c: string = "" }
      body: Stack {
        Button { "Save", onClick: e => { Api.Order.create.mutate({ code: c, total: 1 }) } },
        Text { Api.Order.all.error }
      } }`);
    expect(await typeOfText(src, "{ code: c, total: 1 }")).toBe("rec:__Request__");
    expect(await typeOfText(src, "Api.Order.all.error")).toBe("p:string?");
  });

  it("a component's lambda prop takes its declared action's parameter; a context names a read", async () => {
    const src =
      system(`component OrderGrid(rows: Order[], onPick: action(Order)) extern from "w/grid"
      page Home { route: "/" state { note: string = "" }
        body: OrderGrid { rows: C.Order.all, onPick: o => { note := o.code } } }`);
    expect(await typeOfText(src, "o.code")).toBe("p:string");
    expect(await typeOfText(src, "C.Order.all")).toMatch(/^\[rec:Order\]/);
  });

  it("a click handler is an action", async () => {
    const src = system(
      `page Home { route: "/" body: Button { "x", onClick: e => { precondition 1 > 0 } } }`,
    );
    expect(await typeOfText(src, "e => { precondition 1 > 0 }")).toBe("action");
  });

  it("a shorthand projection's rows are its source aggregate's", async () => {
    const src = system(`page Home { route: "/" body: QueryView {
      of: Api.Big,
      data: rows => Table { rows: rows, Column { "Code", o => o.code } }
    } }`);
    expect(await typeOfText(src, "o.code")).toBe("p:string");
  });

  it("an invented member on a shorthand projection's row is now reported", async () => {
    const src = system(`page Home { route: "/" body: QueryView {
      of: Api.Big,
      data: rows => Table { rows: rows, Column { "Code", o => o.nope } }
    } }`);
    const { diagnostics } = await parseString(src, { validate: true });
    expect(lspCodes(diagnostics)).toContain("loom.unknown-member");
  });
});

describe("a principal claim with no `user { }` block", () => {
  it("is refused, naming the missing block", async () => {
    const src = `context C {
      aggregate Post { author: string }
      repository Posts for Post
      criterion Mine of Post = author == currentUser.id
    }`;
    const { diagnostics } = await parseString(src, { validate: true });
    const d = diagnostics.find((x) => x.code === "loom.unknown-user-claim");
    expect(d?.message).toContain("declares no 'user { }' block");
  });

  it("a declared claim still reads clean", async () => {
    const src = `system S {
      user { id: string }
      subdomain D { context C {
        aggregate Post { author: string }
        repository Posts for Post
        criterion Mine of Post = author == currentUser.id
      } }
    }`;
    const { diagnostics } = await parseString(src, { validate: true });
    expect(lspCodes(diagnostics)).not.toContain("loom.unknown-user-claim");
  });
});

describe("domain expressions lowering reads are typed", () => {
  it("`Vo.create({ … })` builds the value object from a record of its fields", async () => {
    const src = system(
      "",
      `valueobject Zip { code: string }
      valueobject Addr { zip: Zip  city: string }
      test "made" { let a = Addr.create({ zip: Zip.create({ code: "1" }), city: "Oslo" })  expect(a.city).toBe("Oslo") }`,
    );
    expect(await typeOfText(src, `{ zip: Zip.create({ code: "1" }), city: "Oslo" }`)).toBe(
      "vo:Addr",
    );
    expect(await typeOfText(src, `{ code: "1" }`)).toBe("vo:Zip");
    expect(await typeOfText(src, `Zip.create({ code: "1" })`)).toBe("vo:Zip");
  });

  it("a record literal for a value-object param of `Agg.create(…)` is that value object", async () => {
    const src = system(
      "",
      `valueobject Price { amount: decimal  currency: string }
      aggregate Item with crudish { price: Price }
      repository Items for Item { }
      test "made" { let i = Item.create(price: { amount: 1.0, currency: "EUR" })  expect(i.price.currency).toBe("EUR") }`,
    );
    expect(await typeOfText(src, `{ amount: 1.0, currency: "EUR" }`)).toBe("vo:Price");
  });

  it("a bound api call's body is the request of the operation it calls", async () => {
    const src = readFileSync("test/fixtures/corpus/api-call.ddd", "utf8").replaceAll(
      "__PLATFORM__",
      "node",
    );
    expect(await typeOfText(src, `{ code: code, status: "Draft" }`)).toBe("rec:__Request__");
  });
});
