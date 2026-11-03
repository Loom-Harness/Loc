// `loom.loop-gate-not-implied` — a loop over a `let`-bound list read calls a
// `when`-gated operation on each row, and the read's predicate does not carry
// every `&&` conjunct of the gate.  Advisory: it fires on the uncovered gate,
// stays silent when the criterion or retrieval conjoins it, and never counts
// as a warning.

import { describe, expect, it } from "vitest";
import { isAdvisoryCode } from "../../src/diagnostics/advisory.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseErrorsOf, parseString } from "../_helpers/parse.js";

const CODE = "loom.loop-gate-not-implied";

const sys = (members: string) => `
system S {
  subdomain D { context C {
    enum Status { Open, Resolved, Closed }
    aggregate Ticket with crudish {
      status: Status immutable
      age: int
      operation close() when status == Resolved { status := Closed }
      operation bump() { age := age + 1 }
    }
    repository Tickets for Ticket
    criterion Stale() of Ticket = this.age > 30
    criterion StaleResolved() of Ticket = this.age > 30 && this.status == Resolved
    retrieval ResolvedOld() of Ticket { where: this.status == Resolved && this.age > 90 }
    ${members}
  }}
  storage pg { type: postgres }
  resource cState { for: C, kind: state, use: pg }
  deployable api { platform: node  contexts: [C]  dataSources: [cState]  port: 3000 }
}`;

async function hits(source: string): Promise<string[]> {
  const parseErrors = parseErrorsOf(source);
  if (parseErrors.length > 0)
    throw new Error(`fixture has parse errors:\n${parseErrors.join("\n")}`);
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.code === CODE)
    .map((d) => d.message);
}

const handler = (read: string, loopBody = "t.close()") => `
    commandHandler Sweep(): int {
      let ts = Tickets.all(${read})
      for t in ts { ${loopBody} }
      return 0
    }`;

describe("loom.loop-gate-not-implied", () => {
  it("fires when the criterion does not carry the gate", async () => {
    const msgs = await hits(sys(handler("Stale()")));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain(
      "commandHandler 'Sweep' calls 'Ticket.close' on every 't' in 'ts', but the read's predicate does not include the operation's gate 'status == Resolved'",
    );
  });

  it("fires in a workflow body over a paged read", async () => {
    const msgs = await hits(
      sys(`workflow W { create(n: int) {
        let ts = Tickets.all(Stale(), page: { offset: n, limit: 10 })
        for t in ts { t.close() }
      } }`),
    );
    expect(msgs).toEqual([expect.stringContaining("workflow 'W' calls 'Ticket.close'")]);
  });

  it("is silent when the criterion conjoins the gate (`this.status` ≡ `status`)", async () => {
    expect(await hits(sys(handler("StaleResolved()")))).toEqual([]);
  });

  it("is silent when a declared retrieval's where carries the gate", async () => {
    expect(await hits(sys(handler("ResolvedOld()")))).toEqual([]);
  });

  it("is silent for an ungated operation", async () => {
    expect(await hits(sys(handler("Stale()", "t.bump()")))).toEqual([]);
  });

  it("rides the advisory channel", () => {
    expect(isAdvisoryCode(CODE)).toBe(true);
  });
});
