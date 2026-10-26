// A workflow factory call in its two spellings — positional
// `Survey.create(a, b)` and named `Survey.create(ticket: a, note: b)` — is ONE
// create: the same saved `factory-let`, so byte-identical generated output on
// every backend.  Positions bind to a declared `create(…)` signature, so each
// aggregate here declares one.  The positional one is the reported shape (an
// event-triggered starter that built a `Survey` nobody ever saved, and that did
// not typecheck on node).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";
import { extractErrors, parseString } from "../_helpers/index.js";

const sys = (platform: string, call: string, poll = "") => `
system S {
  subdomain Core {
    context Desk {
      aggregate Ticket with crudish {
        subject: string
        operation resolve() { emit TicketResolved { ticket: id, subject: subject } }
      }
      repository Tickets for Ticket { }
      event TicketResolved { ticket: Ticket id, subject: string }
      aggregate Survey {
        ticket: Ticket id
        note: string
        create(ticket: Ticket id, note: string) { }
      }
      repository Surveys for Survey { }
      aggregate Poll {
        ticket: Ticket id
        label: string
        create(label: string, ticket: Ticket id) { }
      }
      repository Polls for Poll { }
      workflow askForRating {
        ticket: Ticket id
        create(e: TicketResolved) by e.ticket {
          let s = ${call}
          ${poll}
        }
      }
    }
  }
  api DeskApi from Core
  storage primary { type: postgres }
  resource st { for: Desk, kind: state, use: primary }
  deployable api { platform: ${platform}, contexts: [Desk], dataSources: [st], serves: DeskApi, port: 3000 }
}`;

const NAMED = "Survey.create(ticket: e.ticket, note: e.subject)";
const BACKENDS = ["node", "dotnet", "java", "python", "elixir"] as const;

/** The files that differ between two generations. */
function differing(a: Map<string, string>, b: Map<string, string>): string[] {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].filter((k) => a.get(k) !== b.get(k)).sort();
}

describe("workflow factory call — positional and named are one create", () => {
  for (const platform of BACKENDS) {
    it(`${platform}: the two spellings generate byte-identical output`, async () => {
      const named = await generateSystemFiles(sys(platform, NAMED));
      const positional = await generateSystemFiles(
        sys(platform, "Survey.create(e.ticket, e.subject)"),
      );
      expect(differing(named, positional)).toStrictEqual([]);
    });
  }

  it("node: the positional create is constructed from a record and saved", async () => {
    const files = await generateSystemFiles(sys("node", "Survey.create(e.ticket, e.subject)"));
    const wf = files.get("api/http/workflows.ts") ?? "";
    expect(wf).toContain("const s = Survey.create({ ticket: e.ticket, note: e.subject });");
    expect(wf).toContain("await surveys.save(s);");
  });

  it("maps positions onto a declared create's parameters, not the property order", async () => {
    const declared = await generateSystemFiles(
      sys("node", NAMED, `let p = Poll.create(e.subject, e.ticket)`),
    );
    const named = await generateSystemFiles(
      sys("node", NAMED, `let p = Poll.create(label: e.subject, ticket: e.ticket)`),
    );
    expect(differing(named, declared)).toStrictEqual([]);
    const wf = declared.get("api/http/workflows.ts") ?? "";
    expect(wf).toContain("const p = Poll.create({ label: e.subject, ticket: e.ticket });");
    expect(wf).toContain("await polls.save(p);");
  });
});

// The same call outside a workflow: a unit test (and any domain body) lowers
// `Agg.create(a, b)` / `Agg.create(x: a, y: b)` to the factory's one input
// record too, not to a plain method call that hands the factory two loose
// arguments (`Order.create("a", 2)` against `static create(input: { … })`).
const unit = (platform: string, call: string) => `
system S {
  subdomain Core {
    context Desk {
      aggregate Order {
        code: string
        qty: int
        create(code: string, qty: int) { }
        test "builds" {
          let o = ${call}
          expect(o.qty).toBe(2)
        }
      }
      repository Orders for Order { }
    }
  }
  api DeskApi from Core
  storage primary { type: postgres }
  resource st { for: Desk, kind: state, use: primary }
  deployable api { platform: ${platform}, contexts: [Desk], dataSources: [st], serves: DeskApi, port: 3000 }
}`;

describe("unit-test factory call — positional and named are one create", () => {
  for (const platform of BACKENDS) {
    it(`${platform}: the two spellings generate byte-identical output`, async () => {
      const named = await generateSystemFiles(unit(platform, `Order.create(code: "a", qty: 2)`));
      const positional = await generateSystemFiles(unit(platform, `Order.create("a", 2)`));
      expect(differing(named, positional)).toStrictEqual([]);
    });
  }

  it("refuses positions in a unit test when the aggregate declares no create", async () => {
    const undeclared = unit("node", `Order.create("a", 2)`).replace(
      "create(code: string, qty: int) { }",
      "",
    );
    const { diagnostics } = await parseString(undeclared, { validate: true });
    const hit = diagnostics.filter((d) => d.code === "loom.create-args");
    expect(hit.map((d) => d.message)).toStrictEqual([
      expect.stringContaining("Name each argument, 'Order.create(code: …, qty: …)'"),
    ]);
    const named = unit("node", `Order.create(code: "a", qty: 2)`).replace(
      "create(code: string, qty: int) { }",
      "",
    );
    const ok = await parseString(named, { validate: true });
    expect(extractErrors(ok.diagnostics)).toStrictEqual([]);
  });

  it("node: the test builds the factory's input record", async () => {
    const files = await generateSystemFiles(unit("node", `Order.create("a", 2)`));
    expect(files.get("api/domain/order.test.ts")).toContain(
      'const o = Order.create({ code: "a", qty: 2 });',
    );
  });
});
