// `loom.persisted-table-reserved`: table names starting with `_` belong to the
// generated runtime (D-NO-TOOL-NAME).  The DSL reaches that namespace two ways —
// an identifier may start with `_` (the `ID` terminal admits it and `snake`
// keeps it), and a `tablePrefix:` is prepended to every table of its context —
// and each is refused.  The negative cases pin that an ordinary model, and a
// `_` that only appears INSIDE a name, are not.

import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";

const system = (body: string, binding = "") => `
system R {
  subdomain S { context C {
${body}
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg${binding} }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}`;

async function reserved(source: string): Promise<string[]> {
  const res = await validate(source);
  return res.diagnostics
    .filter((d) => d.code === "loom.persisted-table-reserved")
    .map((d) => d.message);
}

describe("loom.persisted-table-reserved", () => {
  it("refuses an aggregate whose table would start with '_'", async () => {
    const msgs = await reserved(
      system(`aggregate _Ledger with crudish { label: string }
      repository Ledgers for _Ledger { }`),
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("aggregate '_Ledger' persists to table '_ledgers'");
  });

  it("refuses an entity part whose table would start with '_'", async () => {
    const msgs = await reserved(
      system(`aggregate Cart with crudish { label: string  contains lines: _Line[]  entity _Line { qty: int } }
      repository Carts for Cart { }`),
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("entity '_Line' of aggregate 'Cart' persists to table '_lines'");
  });

  it("refuses a tablePrefix starting with '_'", async () => {
    const msgs = await reserved(
      system(
        `aggregate Ledger with crudish { label: string }
      repository Ledgers for Ledger { }`,
        `, tablePrefix: "_b"`,
      ),
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain(`resource 'st': tablePrefix "_b" starts with '_'`);
  });

  it("accepts an ordinary model and a '_' inside a name or prefix", async () => {
    expect(
      await reserved(
        system(
          `aggregate Ledger_Entry with crudish { label: string }
      repository Entries for Ledger_Entry { }`,
          `, tablePrefix: "b_"`,
        ),
      ),
    ).toEqual([]);
  });
});
