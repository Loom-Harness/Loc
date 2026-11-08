import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { createDddServices } from "../../src/language/ddd-module.js";
import type { Model } from "../../src/language/generated/ast.js";
import { printStructural } from "../../src/language/print/print-structural.js";

// ---------------------------------------------------------------------------
// The `as { … }` test principal (#3759 / #3469): a context integration `test`
// and a `test e2e` block — as a head clause and as a body line — run as the
// dev-stub principal with these claims set.  Parsing, printing, lowering, and
// every negative gate.
// ---------------------------------------------------------------------------

/** A deployed system with a `user` block; `ctxTest` lands in the context,
 *  `e2e` / `extra` at system scope. */
export const principalSys = (opts: {
  user?: string;
  ctxTest?: string;
  e2e?: string;
  extra?: string;
}): string => `
system P {
${opts.user ?? "  user { id: guid  role: string  tags: string[]  level: int  nick: string?  org: Org id }"}
${opts.extra ?? ""}
  subdomain D { context C {
    aggregate Org with crudish { name: string }
    aggregate Note with crudish { text: string }
    repository Notes for Note
${opts.ctxTest ?? ""}
  } }
  api A from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: node contexts: [C] dataSources: [st] serves: A port: 3000 auth: required }
${opts.e2e ?? ""}
}`;

async function codesOf(src: string): Promise<string[]> {
  const r = await validate(src);
  return r.diagnostics.filter((d) => d.severity === "error").map((d) => d.code ?? "");
}

async function lowered(src: string) {
  const services = createDddServices(NodeFileSystem);
  const doc = await parseHelper<Model>(services.Ddd)(src, { validation: true });
  return { doc, loom: lowerModel(doc.parseResult.value) };
}

const VALID = principalSys({
  ctxTest: `    test "isolation" as { role: "agent", tags: ["a", "b"], org: "00000000-0000-0000-0000-000000000001" } {
      let n = Note.create(text: "x")
      as { role: "viewer" }
      let r = Note.find(n.id)
      expect(r).toBeNull()
    }`,
  e2e: `  test e2e "second principal" against d as { role: "agent" } {
    let n = api.notes.create({ text: "a" })
    as { role: "viewer", tags: [] }
    let r = api.notes.getById(n)
    expect(r.text).toBe("a")
  }`,
});

describe("test principal: parse, lower, print", () => {
  it("a valid clause and body line validate clean", async () => {
    expect(await codesOf(VALID)).toEqual([]);
  });

  it("lowers the head clause and the body line to a resolved claim map", async () => {
    const { loom } = await lowered(VALID);
    const ctx = loom.systems[0]!.subdomains[0]!.contexts[0]!;
    const t = ctx.tests[0]!;
    expect(t.principal?.claims.map((c) => [c.name, c.value])).toEqual([
      ["role", "agent"],
      ["tags", ["a", "b"]],
      ["org", "00000000-0000-0000-0000-000000000001"],
    ]);
    const line = t.statements.find((s) => s.kind === "principal");
    expect(line?.kind === "principal" && line.principal.claims).toEqual([
      expect.objectContaining({ name: "role", value: "viewer" }),
    ]);
    const e2e = loom.systems[0]!.e2eTests[0]!;
    expect(e2e.principal?.claims.map((c) => [c.name, c.value])).toEqual([["role", "agent"]]);
    expect(e2e.statements.some((s) => s.kind === "principal")).toBe(true);
  });

  it("a test without a clause carries no principal", async () => {
    const { loom } = await lowered(
      principalSys({ ctxTest: `    test "plain" { let n = Note.create(text: "x") }` }),
    );
    expect(loom.systems[0]!.subdomains[0]!.contexts[0]!.tests[0]!.principal).toBeUndefined();
  });

  it("prints the head clause and the body line back to source", async () => {
    const { doc } = await lowered(VALID);
    const out = printStructural(doc.parseResult.value.members[0]!);
    expect(out).toContain(
      `test "isolation" as { role: "agent", tags: ["a", "b"], org: "00000000-0000-0000-0000-000000000001" } {`,
    );
    expect(out).toContain(`as { role: "viewer" }`);
    expect(out).toContain(`test e2e "second principal" against d as { role: "agent" } {`);
    // Round trip: the printed source parses, and lowers to the same claims.
    // (The printer emits the macro-expanded members, so re-validating would
    // re-expand them; parsing and lowering is the round trip that matters.)
    const again = await lowered(out);
    expect(again.doc.parseResult.parserErrors).toEqual([]);
    const ctx = again.loom.systems[0]!.subdomains[0]!.contexts[0]!;
    expect(ctx.tests[0]!.principal?.claims.map((c) => c.value)).toEqual([
      "agent",
      ["a", "b"],
      "00000000-0000-0000-0000-000000000001",
    ]);
  });
});

describe("test principal: negative gates", () => {
  const cases: [string, string][] = [
    [
      "loom.test-principal-placement",
      principalSys({
        ctxTest: `    aggregate Pin { label: string  test "unit" as { role: "x" } { expect(1).toBe(1) } }`,
      }),
    ],
    [
      "loom.test-principal-placement",
      principalSys({
        ctxTest: `    aggregate Pin { label: string  test "unit" { as { role: "x" }  expect(1).toBe(1) } }`,
      }),
    ],
    [
      "loom.test-principal-value",
      principalSys({
        ctxTest: `    test "t" as { role: 1 + 2 } { let n = Note.create(text: "a") }`,
      }),
    ],
    [
      "loom.test-principal-duplicate-claim",
      principalSys({
        ctxTest: `    test "t" as { role: "a", role: "b" } { let n = Note.create(text: "a") }`,
      }),
    ],
    [
      "loom.test-principal-no-user",
      principalSys({
        user: "",
        ctxTest: `    test "t" as { role: "a" } { let n = Note.create(text: "a") }`,
      }).replace(" auth: required", ""),
    ],
    [
      "loom.test-principal-unknown-claim",
      principalSys({ ctxTest: `    test "t" as { nope: "a" } { let n = Note.create(text: "a") }` }),
    ],
    [
      "loom.test-principal-claim-type",
      principalSys({
        ctxTest: `    test "t" as { level: "3" } { let n = Note.create(text: "a") }`,
      }),
    ],
    [
      "loom.test-principal-claim-type",
      principalSys({
        ctxTest: `    test "t" as { role: ["a"] } { let n = Note.create(text: "a") }`,
      }),
    ],
    [
      "loom.test-principal-claim-type",
      principalSys({ ctxTest: `    test "t" as { tags: "a" } { let n = Note.create(text: "a") }` }),
    ],
    [
      "loom.test-principal-claim-type",
      principalSys({
        ctxTest: `    test "t" as { org: "not-a-uuid" } { let n = Note.create(text: "a") }`,
      }),
    ],
    [
      "loom.e2e-principal-claim-not-carried",
      principalSys({
        e2e: `  test e2e "e" against d as { nick: "bob" } { let n = api.notes.create({ text: "a" }) }`,
      }),
    ],
    [
      "loom.e2e-principal-claim-not-carried",
      principalSys({
        e2e: `  test e2e "e" against d { let n = api.notes.create({ text: "a" })  as { org: "00000000-0000-0000-0000-000000000001" } }`,
      }),
    ],
    [
      "loom.e2e-principal-oidc",
      principalSys({
        extra: `  auth { oidc { issuer: "https://idp.example.com/realms/x"  clientId: "web" } }`,
        e2e: `  test e2e "e" against d as { role: "agent" } { let n = api.notes.create({ text: "a" }) }`,
      }),
    ],
    [
      "loom.e2e-principal-ui",
      principalSys({
        extra: `  ui WebApp {
    api Core: A
    page Home { route: "/"  body: Stack { } }
  }`,
        e2e: `  deployable web { platform: static targets: d ui: WebApp { Core: d } port: 3001 }
  test e2e "e" against web as { role: "agent" } { expect(1).toBe(1) }`,
      }),
    ],
  ];
  for (const [code, src] of cases) {
    it(`${code} fires`, async () => {
      expect(await codesOf(src)).toContain(code);
    });
  }

  it("a context test principal does not require dev-stub carriage (optional / id claims are settable)", async () => {
    const codes = await codesOf(
      principalSys({
        ctxTest: `    test "t" as { nick: "bob", org: "00000000-0000-0000-0000-000000000001" } { let n = Note.create(text: "a") }`,
      }),
    );
    expect(codes).toEqual([]);
  });
});
