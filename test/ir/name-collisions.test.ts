// Models that validated clean and then broke the generated build because two
// names collided.  Each case pins one collision arm and, beside it, the
// neighbouring spelling that must stay legal (a gate that over-fires would
// pass the negative tests alone):
//
//   - one member namespace per aggregate / part / value object
//     (`loom.member-name-collision`)
//   - the same type name in two contexts one deployable hosts
//     (`loom.hosted-type-name-collision`)
//   - a `version` field that is not the concurrency counter
//     (`loom.version-field-collision`)
//   - .NET: a domain type spelled like a resource package's root namespace, and
//     two members that differ only in the first letter's case
//     (`loom.dotnet-name-collision`)
//   - .NET: a lower-case commandHandler's emitted type / file names
//   - the emission sink refusing case-only path clashes

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { EmissionClobberError, emissionSink } from "../../src/util/emission-sink.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

/** Phase ⑦ diagnostics (code + message) of a source, AST errors excluded. */
async function irDiagnostics(source: string): Promise<{ code?: string; message: string }[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

const TAIL = (platform: string, ctxs: string, ds: string) => `
  api A from O
  storage pg { type: postgres }
${ds}
  deployable d { platform: ${platform}  contexts: [${ctxs}]  serves: A  dataSources: [${ds
    .split("\n")
    .map((l) => l.trim().split(" ")[1])
    .filter(Boolean)
    .join(", ")}]  port: 8080 }`;

const oneContext = (aggregateBody: string, platform = "node"): string => `
system S {
  subdomain O { context C {
    aggregate Order with crudish {
${aggregateBody}
    }
    repository Orders for Order { }
  } }
${TAIL(platform, "C", "  resource st { for: C, kind: state, use: pg }")}
}`;

describe("loom.member-name-collision — one member namespace per aggregate", () => {
  it("refuses an operation named like a field (the node TS2300 shape)", async () => {
    const { errors } = await parseString(
      oneContext(`qty: int
      operation qty(n: int) { qty := n }`),
    );
    expect(errors.join("\n")).toMatch(
      /operation 'qty' in aggregate 'Order' reuses the name of the field/,
    );
  });

  it("refuses a value object function named like its field", async () => {
    const { errors } = await parseString(`
      system S { subdomain O { context C {
        valueobject Money { amt: int  function amt(): int = 1 }
      } } }`);
    expect(errors.join("\n")).toMatch(
      /function 'amt' in value object 'Money' reuses the name of the field/,
    );
  });

  it("refuses a function named like a derived field and an operation named like a function", async () => {
    const { errors } = await parseString(
      oneContext(`qty: int
      derived dbl: int = qty * 2
      function dbl(): int = qty
      function twice(): int = qty
      operation twice(n: int) { qty := n }`),
    );
    const joined = errors.join("\n");
    expect(joined).toMatch(
      /function 'dbl' in aggregate 'Order' reuses the name of the derived field/,
    );
    expect(joined).toMatch(
      /operation 'twice' in aggregate 'Order' reuses the name of the function/,
    );
  });

  it("refuses a callable named like a containment, and a part's function named like its field", async () => {
    const { errors } = await parseString(
      oneContext(`contains lines: Line[]
      operation lines(n: int) { }
      entity Line { x: int  function x(): int = 1 }`),
    );
    const joined = errors.join("\n");
    expect(joined).toMatch(
      /operation 'lines' in aggregate 'Order' reuses the name of the containment/,
    );
    expect(joined).toMatch(/function 'x' in entity 'Line' reuses the name of the field/);
  });

  it("NON-VACUITY: distinct names, and the canonical create / destroy, stay legal", async () => {
    const { errors } = await parseString(
      oneContext(`qty: int
      operation bump(n: int) { qty := qty + n }
      function double(): int = qty * 2`),
    );
    expect(errors).toEqual([]);
  });
});

const twoContexts = (second: string, depPlatform = "node", sameDeployable = true): string => `
system S {
  subdomain O {
    context Sales {
      enum Status { open, closed }
      valueobject Money2 { amt: int }
      event Done { n: int }
      aggregate Order with crudish { qty: int }
      repository Orders for Order { }
      workflow place { create(n: int) { precondition n > 0 } }
      commandHandler bumpIt(orderId: Order id) { let o = Orders.get(orderId) }
      payload Ping { a: int }
    }
    context Billing {
${second}
    }
  }
  api A from O
  storage pg { type: postgres }
  resource s { for: Sales, kind: state, use: pg }
  resource b { for: Billing, kind: state, use: pg }
${
  sameDeployable
    ? `  deployable d { platform: ${depPlatform}  contexts: [Sales, Billing]  serves: A  dataSources: [s, b]  port: 8080 }`
    : `  deployable d { platform: ${depPlatform}  contexts: [Sales]  serves: A  dataSources: [s]  port: 8080 }
  deployable e { platform: ${depPlatform}  contexts: [Billing]  dataSources: [b]  port: 8081 }`
}
}`;

describe("loom.hosted-type-name-collision — one deployable, one namespace per kind", () => {
  const codes = (ds: { code?: string; message: string }[]) =>
    ds.filter((d) => d.code === "loom.hosted-type-name-collision");

  for (const [label, decl] of [
    ["aggregate", "aggregate Order with crudish { amt: int }\n repository BO for Order { }"],
    ["enum", "enum Status { open, closed, paid }"],
    ["value object", "valueobject Money2 { amt: int  cur: string }"],
    ["event", "event Done { n: int  m: string }"],
    ["workflow", "workflow place { create(n: int) { precondition n > 1 } }"],
    [
      "handler",
      "aggregate Inv with crudish { z: int }\n repository Invs for Inv { }\n commandHandler bumpIt(i: Inv id) { let o = Invs.get(i) }",
    ],
    ["payload", "payload Ping { b: int }"],
  ] as const) {
    it(`refuses a ${label} declared by two contexts the deployable hosts`, async () => {
      const ds = codes(await irDiagnostics(twoContexts(decl)));
      expect(ds).toHaveLength(1);
      expect(ds[0].message).toContain(`${label} `);
      expect(ds[0].message).toContain("context 'Billing'");
      expect(ds[0].message).toContain("context 'Sales'");
    });
  }

  it("compares names case-insensitively (a case-insensitive filesystem merges the files)", async () => {
    const ds = codes(await irDiagnostics(twoContexts("enum STATUS { a, b }")));
    expect(ds).toHaveLength(1);
  });

  it("NON-VACUITY: the same names on SEPARATE deployables, and distinct names, are legal", async () => {
    const decl = "aggregate Order with crudish { amt: int }\n repository BO for Order { }";
    expect(codes(await irDiagnostics(twoContexts(decl, "node", false)))).toEqual([]);
    expect(
      codes(
        await irDiagnostics(
          twoContexts(
            "aggregate Invoice with crudish { amt: int }\n repository BI for Invoice { }",
          ),
        ),
      ),
    ).toEqual([]);
  });

  it("NON-VACUITY: a root-level value object / enum (the shared kernel) used by both contexts is one declaration", async () => {
    const src = `
valueobject Shared { amt: int }
enum Tier { a, b }
${twoContexts(
  "aggregate Invoice with crudish { s: Shared  t: Tier }\n repository BI for Invoice { }",
).replace("valueobject Money2 { amt: int }", "")}`;
    expect(codes(await irDiagnostics(src))).toEqual([]);
  });

  it("is a refusal, not a crash: generation never reaches the emitters", async () => {
    await expect(generateSystemFiles(twoContexts("enum Status { a }", "dotnet"))).rejects.toThrow(
      /hosted-type-name-collision/,
    );
  });
});

describe("loom.version-field-collision — a user `version` is the counter or an error", () => {
  const src = (field: string) => oneContext(`${field}\n      title: string`);

  it("refuses a plain `version: int` (a domain value would be bumped on every save)", async () => {
    const { errors } = await parseString(src("version: int immutable = 1"));
    const joined = errors.join("\n");
    expect(joined).toContain("optimistic-concurrency column");
    expect(joined).toContain("orderVersion");
    expect(joined).toContain("version: int token");
  });

  it("accepts `version: int token` — the counter's own spelling", async () => {
    const { errors } = await parseString(src("version: int token = 1"));
    expect(errors).toEqual([]);
  });

  it("still refuses a non-int `version`", async () => {
    const { errors } = await parseString(src("version: string"));
    expect(errors.join("\n")).toContain("which is an 'int'");
  });

  it("leaves an event-sourced aggregate's `version` alone (no state-table counter)", async () => {
    const { errors } = await parseString(
      oneContext(`version: int = 1`).replace(
        "aggregate Order with crudish",
        "aggregate Order persistedAs: eventLog with crudish",
      ),
    );
    expect(errors.filter((e) => e.includes("optimistic-concurrency"))).toEqual([]);
  });
});

const dotnetMail = (aggName: string, extra = "", platform = "dotnet"): string => `
system P {
  subdomain O {
    context C {
      aggregate ${aggName} with crudish { name: string${extra} }
      repository Rs for ${aggName} { }
      workflow remind { create(to: string) { mail.send(to, "Hi", "Hello") } }
    }
  }
  api A from O
  storage pg { type: postgres }
  storage mailServer { type: smtp, config: { from: "no-reply@p.test" } }
  resource st { for: C, kind: state, use: pg }
  resource mail { for: C, kind: mailer, use: mailServer }
  deployable d { platform: ${platform}  contexts: [C]  dataSources: [st, mail]  serves: A  port: 4000 }
}`;

describe("loom.dotnet-name-collision — package namespaces and case-only member pairs", () => {
  const dn = (ds: { code?: string; message: string }[]) =>
    ds.filter((d) => d.code === "loom.dotnet-name-collision");

  it("refuses an aggregate named after the root namespace MailKit's BouncyCastle declares", async () => {
    const ds = dn(await irDiagnostics(dotnetMail("Org")));
    expect(ds).toHaveLength(1);
    expect(ds[0].message).toContain("root namespace is 'Org'");
    expect(ds[0].message).toContain("resource 'mail'");
  });

  it("NON-VACUITY: the same name without the mailer, on node, or a near name is legal", async () => {
    expect(dn(await irDiagnostics(dotnetMail("Org", "", "node")))).toEqual([]);
    expect(dn(await irDiagnostics(dotnetMail("Organisation")))).toEqual([]);
    const noMail = dotnetMail("Org")
      .replace('workflow remind { create(to: string) { mail.send(to, "Hi", "Hello") } }', "")
      .replace("resource mail { for: C, kind: mailer, use: mailServer }", "")
      .replace("dataSources: [st, mail]", "dataSources: [st]");
    expect(dn(await irDiagnostics(noMail))).toEqual([]);
  });

  it("refuses two members C# spells identically (qty / Qty) and leaves other backends alone", async () => {
    const body = (platform: string) =>
      oneContext(
        `qty: int
      function Qty(): int = qty`,
        platform,
      );
    const ds = dn(await irDiagnostics(body("dotnet")));
    expect(ds).toHaveLength(1);
    expect(ds[0].message).toContain("both emits as the C# member 'Qty'");
    expect(dn(await irDiagnostics(body("node")))).toEqual([]);
  });
});

describe("dotnet commandHandler type and file names", () => {
  const src = (handler: string) => `
system S {
  subdomain O { context O {
    aggregate Order with crudish {
      qty: int
      operation bump(n: int) { qty := qty + n }
    }
    repository Orders for Order { }
    commandHandler ${handler}(orderId: Order id, n: int) {
      let o = Orders.get(orderId)
      o.bump(n)
    }
  } }
  api A from O { route POST "/orders/{orderId}/bump" -> O.${handler} }
  storage pg { type: postgres }
  resource s { for: O, kind: state, use: pg }
  deployable d { platform: dotnet  contexts: [O]  serves: A  dataSources: [s]  port: 8080 }
}`;

  it("PascalCases a lower-case handler, so it replaces the operation's command instead of duplicating it", async () => {
    const files = await generateSystemFiles(src("bump"));
    const commands = [...files.keys()].filter((p) =>
      /Commands\/[Bb]ump(Command|Handler)\.cs$/.test(p),
    );
    expect(commands.sort()).toEqual([
      "d/Application/Orders/Commands/BumpCommand.cs",
      "d/Application/Orders/Commands/BumpHandler.cs",
    ]);
    // The handler's record (its own `orderId` parameter), not the operation's auto command.
    expect(files.get("d/Application/Orders/Commands/BumpCommand.cs")).toContain("OrderId OrderId");
    expect(files.get("d/Application/Orders/Commands/BumpHandler.cs")).toContain(
      "class BumpHandler",
    );
  });

  it("emits byte-identical output for the PascalCase spelling", async () => {
    const lower = await generateSystemFiles(src("bump"));
    const upper = await generateSystemFiles(src("Bump"));
    expect(lower.get("d/Application/Orders/Commands/BumpCommand.cs")).toBe(
      upper.get("d/Application/Orders/Commands/BumpCommand.cs"),
    );
  });
});

describe("EmissionSink — case-only path clashes", () => {
  it("refuses two paths that differ only by case, naming both", () => {
    const out = emissionSink("probe");
    out.set("Application/BumpCommand.cs", "a");
    expect(() => out.set("Application/bumpCommand.cs", "b")).toThrow(EmissionClobberError);
    try {
      out.set("Application/bumpCommand.cs", "b");
    } catch (e) {
      expect((e as Error).message).toContain('"Application/BumpCommand.cs"');
      expect((e as Error).message).toContain("case-insensitive");
    }
  });

  it("still allows an identical re-write, a deliberate replace, and a path reused after delete", () => {
    const out = emissionSink("probe");
    out.set("a/X.cs", "1");
    expect(() => out.set("a/X.cs", "1")).not.toThrow();
    out.replace("a/X.cs", "2");
    out.delete("a/X.cs");
    expect(() => out.set("a/x.cs", "3")).not.toThrow();
  });
});
