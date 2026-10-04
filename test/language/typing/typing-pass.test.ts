// Unit tests for the single typing pass (M-T5.44, `src/language/typing/`):
// one rule per case, read back through `typeAt`. The fleet-wide comparison
// against the two old checkers is `test/system/typing-differential.test.ts`.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { isExpression, type Model } from "../../../src/language/generated/ast.js";
import { tyKey, typingSession } from "../../../src/language/typing/index.js";
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

const ctx = (body: string) => `system S { subdomain D { context C {\n${body}\n} } }`;

describe("single typing pass", () => {
  it("joins ternary branches and types null as an optional", async () => {
    const src = ctx(`aggregate A { n: int  m: long?
      derived j: long = true ? n : 2
      derived k: long? = n > 0 ? m : null }`);
    expect(await typeOfText(src, "true ? n : 2")).toBe("p:int");
    expect(await typeOfText(src, "null")).toBe("never?");
    expect(await typeOfText(src, "n > 0 ? m : null")).toBe("p:long?");
  });

  it("strips the optional through `??` and joins with the fallback", async () => {
    const src = ctx(`aggregate A { n: int?  derived d: long = n ?? 5 }`);
    expect(await typeOfText(src, "n ?? 5")).toBe("p:int");
  });

  it("resolves members inherited through `extends`", async () => {
    const src = ctx(`abstract aggregate Base { code: string }
      aggregate Sub extends Base { derived c: string = this.code }`);
    expect(await typeOfText(src, "this.code")).toBe("p:string");
  });

  it("keeps an exception-less operation's union return", async () => {
    const src = ctx(`error NotFound { resource: string }
      aggregate A { n: int
        operation probe(): int or NotFound { return n }
        operation touch() { let r = probe() } }`);
    expect(await typeOfText(src, "probe()")).toBe("union(p:int|rec:NotFound)");
  });

  it("types repository reads by verb, findById as optional", async () => {
    const src = ctx(`aggregate O { n: int }
      repository Os for O { }
      workflow W { create(id: O id) { let a = Os.findById(id)  let b = Os.getById(id)  let c = Os.findAll() } }`);
    expect(await typeOfText(src, "Os.findById(id)")).toBe("rec:O?");
    expect(await typeOfText(src, "Os.getById(id)")).toBe("rec:O");
    expect(await typeOfText(src, "Os.findAll()")).toBe("[rec:O]");
  });

  it("binds a collection-op lambda parameter to the element type", async () => {
    const src = ctx(`aggregate A { xs: int[]  derived s: int = xs.sum(x => x * 2) }`);
    expect(await typeOfText(src, "x * 2")).toBe("p:int");
    expect(await typeOfText(src, "xs.sum(x => x * 2)")).toBe("p:int");
  });

  it("threads lets only forward, and scopes if-let bindings to the then-branch", async () => {
    const src = ctx(`aggregate O { n: int }
      repository Os for O { }
      workflow W { create(id: O id) {
        let o = Os.findById(id)
        if let found = Os.findById(id) { let k = found.n }
      } }`);
    expect(await typeOfText(src, "found.n")).toBe("p:int");
  });

  it("names every unknown's cause", async () => {
    const src = ctx(
      `aggregate A { n: int  derived d: int = nope + 1  derived e: int = this.missing }`,
    );
    expect(await typeOfText(src, "nope")).toBe("unknown:unresolved-name");
    expect(await typeOfText(src, "this.missing")).toBe("unknown:unresolved-member");
  });
});
