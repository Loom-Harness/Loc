// `loom.reserved-type-name` (D-RESERVED-GENERATED-NAMES) — a declaration that becomes a generated type may
// not take a name the generated code binds (src/util/reserved-type-names.ts).
// Every kind is refused alike, on every platform, and a near-miss name the
// table does not hold is admitted.

import { describe, expect, it } from "vitest";
import {
  RESERVED_CONTEXT_NAMES,
  RESERVED_TYPE_NAMES,
} from "../../../src/util/reserved-type-names.js";
import { diagText } from "../../_helpers/diagnostics.js";
import { parseString } from "../../_helpers/index.js";

const inContext = (members: string, platform = "node") => `
system S {
  subdomain Sub { context C {
    aggregate Holder with crudish { label: string }
    repository Holders for Holder
${members}
  } }
  api A from Sub
  deployable d { platform: ${platform} contexts: [C] serves: A port: 4000 }
}`;

const reservedCodes = async (source: string): Promise<string[]> => {
  const { diagnostics } = await parseString(source);
  return diagnostics.filter((d) => d.code === "loom.reserved-type-name").map(diagText);
};

describe("validator: loom.reserved-type-name", () => {
  const KINDS: readonly [string, (n: string) => string][] = [
    [
      "aggregate",
      (n) => `    aggregate ${n} with crudish { label: string }\n    repository ${n}Repo for ${n}`,
    ],
    [
      "entity",
      (n) =>
        `    aggregate Owner { label: string\n      entity ${n} { v: string }\n      contains parts: ${n}[] }`,
    ],
    ["valueobject", (n) => `    valueobject ${n} { v: string }`],
    ["enum", (n) => `    enum ${n} { A, B }`],
    ["event", (n) => `    event ${n} { v: string }`],
    ["payload", (n) => `    payload ${n} { v: string }`],
    ["command", (n) => `    command ${n} { v: string }`],
    ["query", (n) => `    query ${n} { v: string }`],
    ["response", (n) => `    response ${n} { v: string }`],
    ["error", (n) => `    error ${n} { v: string }`],
    [
      "domainService",
      (n) => `    domainService ${n} { operation twice(x: int): int { return x * 2 } }`,
    ],
  ];

  for (const [keyword, decl] of KINDS) {
    it(`refuses ${keyword} Request (FastAPI's fastapi.Request)`, async () => {
      const msgs = await reservedCodes(inContext(decl("Request")));
      expect(msgs, msgs.join("\n")).toHaveLength(1);
      expect(msgs[0]).toContain(`${keyword} 'Request'`);
      expect(msgs[0]).toContain("fastapi.Request (python)");
    });
  }

  it("refuses a root-level value object, payload and enum too", async () => {
    const msgs = await reservedCodes(`
valueobject Promise { v: string }
payload Depends { v: string }
enum Record { A }
${inContext("")}`);
    expect(msgs.map((m) => m.split(" is named")[0]).sort()).toEqual([
      "enum 'Record'",
      "payload 'Depends'",
      "valueobject 'Promise'",
    ]);
  });

  it("refuses identically on every platform — the model stays portable", async () => {
    for (const platform of ["node", "dotnet", "java", "python", "elixir"]) {
      const msgs = await reservedCodes(
        inContext("    valueobject Request { v: string }", platform),
      );
      expect(msgs, platform).toHaveLength(1);
    }
  });

  it("names every target and binder of the entry", async () => {
    const entry = RESERVED_TYPE_NAMES.find((e) => e.name === "ProblemDetails");
    expect(entry?.bindings.length).toBeGreaterThan(1);
    const [msg] = await reservedCodes(inContext("    valueobject ProblemDetails { v: string }"));
    for (const b of entry!.bindings) expect(msg).toContain(`${b.binder} (${b.target})`);
  });

  it("admits the near-miss names the table leaves out, and the names only Java bound", async () => {
    const msgs = await reservedCodes(
      inContext(
        [
          "    valueobject Map { v: string }",
          "    valueobject Kernel { v: string }",
          "    valueobject Column { v: string }",
          "    enum Optional { Yes, No }",
          "    aggregate Page with crudish { label: string }",
          "    repository PageRepo for Page",
          "    enum TaskStatus { Open, Done }",
          "    aggregate Pages with crudish { label: string }",
          "    repository PagesRepo for Pages",
        ].join("\n"),
      ),
    );
    expect(msgs).toEqual([]);
  });

  it("refuses a context named `permissions` (ambiguous with `Ctx.permissions.x`)", async () => {
    const msgs = await reservedCodes(`
system S {
  subdomain Sub { context permissions {
    aggregate Holder with crudish { label: string }
    repository Holders for Holder
  } }
}`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("context 'permissions' takes a reserved name");
    expect(msgs[0]).toContain(RESERVED_CONTEXT_NAMES.find((e) => e.name === "permissions")!.reason);
  });

  it("does not refuse a field, operation or context of a reserved name", async () => {
    const msgs = await reservedCodes(`
system S {
  subdomain Sub { context Page {
    aggregate Holder with crudish {
      Promise: string
      operation Request(Record: int) { label := "x" }
      label: string
    }
    repository Holders for Holder
  } }
}`);
    expect(msgs).toEqual([]);
  });
});
