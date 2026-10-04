// `loom.create-field-type` — nullability (H-24, helpdesk eval).  A `T?` value
// into a non-optional `Agg.create({ … })` field: the factory check compared
// wire FAMILIES with the optional stripped, so `requester: currentUser.customerId`
// (a `Customer id?` claim into a `Customer id` field) validated with 0 errors
// and the generated .NET failed CS1503 `CustomerId?` → `CustomerId`.  A
// `requires currentUser.customerId != null` does not narrow (docs/language.md
// "Null narrowing"); the ternary / `??` on the same path does.

import { describe, expect, it } from "vitest";
import { diagText, lspCodes } from "../../_helpers/diagnostics.js";
import { parseString } from "../../_helpers/parse.js";

const sys = (wf: string) => `
system Demo {
  user { id: string  customerId: Customer id?  nick: string? }
  subdomain S {
    context C {
      aggregate Customer with crudish { name: string }
      aggregate Ticket with crudish {
        subject: string
        requester: Customer id immutable
        watcher: Customer id?
        qty: int = 1
      }
      repository Tickets for Ticket { }
      workflow open {
        ${wf}
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] port: 3000 }
}`;

async function errors(wf: string): Promise<{ codes: string[]; messages: string[] }> {
  const { diagnostics } = await parseString(sys(wf), { validate: true });
  const errs = diagnostics.filter((d) => d.severity === 1);
  return { codes: lspCodes(errs), messages: errs.map(diagText) };
}

const TYPE = "loom.create-field-type";
const create = (fields: string, params = "s: string", gate = "requires true") =>
  `create(${params}) { ${gate}\n let t = Ticket.create({ subject: s, ${fields} }) }`;

describe("loom.create-field-type — nullable value into a non-optional create field (H-24)", () => {
  it("rejects a `currentUser.<T? claim>` even behind a `requires … != null` gate", async () => {
    const { codes, messages } = await errors(
      create(
        "requester: currentUser.customerId",
        "s: string",
        "requires currentUser.customerId != null",
      ),
    );
    expect(codes).toContain(TYPE);
    const msg = messages.find((m) => m.includes("'Ticket.create' field 'requester'"));
    expect(msg).toContain("expects 'Customer id' but got 'Customer id?'");
    // Points at the narrowing idioms, spelled with the author's own path.
    expect(msg).toContain("currentUser.customerId != null ? currentUser.customerId : <fallback>");
    expect(msg).toContain("currentUser.customerId ?? <fallback>");
  });

  it("rejects an optional param into a non-optional field with a default", async () => {
    const { codes } = await errors(
      create("requester: c, qty: n", "s: string, c: Customer id, n: int?"),
    );
    expect(codes).toContain(TYPE);
  });

  it("rejects the `null` literal into a non-optional field", async () => {
    const { codes, messages } = await errors(create("requester: null"));
    expect(codes).toContain(TYPE);
    expect(
      messages.some((m) => /field 'requester' expects 'Customer id' but got 'null'/.test(m)),
    ).toBe(true);
  });

  it("admits a nullable value into an OPTIONAL field", async () => {
    const { codes } = await errors(
      create("requester: c, watcher: currentUser.customerId", "s: string, c: Customer id"),
    );
    expect(codes).not.toContain(TYPE);
  });

  it("admits the ternary narrowed on the same path", async () => {
    const { codes } = await errors(
      create(
        "requester: currentUser.customerId != null ? currentUser.customerId : c",
        "s: string, c: Customer id",
      ),
    );
    expect(codes).not.toContain(TYPE);
  });

  it("admits `??` with a non-null fallback", async () => {
    const { codes } = await errors(
      create("requester: currentUser.customerId ?? c", "s: string, c: Customer id"),
    );
    expect(codes).not.toContain(TYPE);
  });

  it("still rejects a ternary whose fallback is itself nullable", async () => {
    const { codes } = await errors(
      create(
        "requester: currentUser.customerId != null ? currentUser.customerId : currentUser.customerId",
      ),
    );
    expect(codes).toContain(TYPE);
  });

  it("quotes `x`, not a compound expression, in the suggested fix", async () => {
    const { messages } = await errors(
      create(
        "requester: currentUser.customerId != null ? currentUser.customerId : currentUser.customerId",
      ),
    );
    const msg = messages.find((m) => m.includes("field 'requester'"));
    expect(msg).toContain("x ?? <fallback>");
  });
});
