// Default-deny enforcement (auth.md / quickstart §4.3).  Under
// `auth { enforcement: denyByDefault }`, every public aggregate action
// reachable on an `auth: required` backend must declare a `requires` gate;
// `requires true` is the explicit "intentionally public" escape.
// `enforcement: opt` (the default) preserves the per-`requires` opt-in.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

async function denyErrors(source: string): Promise<string[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error" && d.code === "loom.default-deny-ungated")
    .map((d) => d.message);
}

/** Every diagnostic, any severity and any code — the deadlock cases below turn
 *  on what does NOT fire as an error as much as on what does, and on the code
 *  that replaces it. */
async function allDiags(
  source: string,
): Promise<{ severity: string; code: string; message: string }[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => ({
    severity: d.severity,
    code: d.code ?? "",
    message: d.message,
  }));
}

function sys(opts: { enforcement: string; authRequired: boolean; gate: string }): string {
  return `
system Helpdesk {
  user { id: string role: string }
  auth { enforcement: ${opts.enforcement} }
  subdomain S {
    context Tickets {
      aggregate Ticket {
        open: bool
        operation close() { ${opts.gate}open := false }
      }
      repository Tickets for Ticket { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SupportApi from S
  deployable api { platform: node contexts: [Tickets] serves: SupportApi dataSources: [st] port: 8080${opts.authRequired ? " auth: required" : ""} }
}
`;
}

describe("default-deny enforcement", () => {
  it("rejects an ungated public operation under denyByDefault", async () => {
    const errs = await denyErrors(
      sys({ enforcement: "denyByDefault", authRequired: true, gate: "" }),
    );
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain("Ticket.close");
    expect(errs[0]).toContain("requires");
  });

  it("accepts a real requires gate", async () => {
    const errs = await denyErrors(
      sys({
        enforcement: "denyByDefault",
        authRequired: true,
        gate: 'requires currentUser.role == "agent"\n        ',
      }),
    );
    expect(errs).toEqual([]);
  });

  it("accepts `requires true` as the intentionally-public escape", async () => {
    const errs = await denyErrors(
      sys({ enforcement: "denyByDefault", authRequired: true, gate: "requires true\n        " }),
    );
    expect(errs).toEqual([]);
  });

  it("does not enforce under the default `enforcement: opt`", async () => {
    const errs = await denyErrors(sys({ enforcement: "opt", authRequired: true, gate: "" }));
    expect(errs).toEqual([]);
  });

  it("does not enforce when the deployable is not auth: required", async () => {
    const errs = await denyErrors(
      sys({ enforcement: "denyByDefault", authRequired: false, gate: "" }),
    );
    expect(errs).toEqual([]);
  });

  // --- Creates + workflows (the command surface beyond operations/destroys) ---

  /** A system with an aggregate `create`, a command-triggered `workflow`, and a
   *  read `find` — commands gated by `gate`, the find by `findGate` (each a
   *  `requires …` clause, or "" for ungated). */
  function commandSys(gate: string, findGate = ""): string {
    return `
system Helpdesk {
  user { id: string role: string }
  auth { enforcement: denyByDefault }
  subdomain S {
    context Tickets {
      aggregate Ticket {
        subject: string
        open: bool
        create register(s: string) { ${gate}subject := s open := true }
      }
      repository Tickets for Ticket {
        find openOnes(): Ticket[] ${findGate}where open == true
      }
      workflow openTicket {
        create(s: string) { ${gate}let t = Ticket.register(s) }
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SupportApi from S
  deployable api { platform: node contexts: [Tickets] serves: SupportApi dataSources: [st] port: 8080 auth: required }
}
`;
  }

  const OP_GATE = 'requires currentUser.role == "agent"\n        ';
  const FIND_GATE = 'requires currentUser.role == "agent" ';

  it("rejects an ungated public create under denyByDefault", async () => {
    const errs = await denyErrors(commandSys(""));
    expect(errs.some((m) => m.includes("Ticket.register"))).toBe(true);
  });

  it("rejects an ungated command-triggered workflow under denyByDefault", async () => {
    const errs = await denyErrors(commandSys(""));
    expect(errs.some((m) => m.includes("workflow 'openTicket'"))).toBe(true);
  });

  it("rejects an ungated repository find under denyByDefault", async () => {
    const errs = await denyErrors(commandSys(""));
    expect(errs.some((m) => m.includes("find 'Tickets.openOnes'"))).toBe(true);
  });

  it("accepts gated creates + workflows + finds (requires on every reachable endpoint)", async () => {
    const errs = await denyErrors(commandSys(OP_GATE, FIND_GATE));
    expect(errs).toEqual([]);
  });

  it("accepts `requires true` on a find as the intentionally-public escape", async () => {
    const errs = await denyErrors(commandSys(OP_GATE, "requires true "));
    expect(errs).toEqual([]);
  });

  it("does not flag the auto-`findAll` (no author gate surface)", async () => {
    // The synthesized `find all` list route has no source line to gate; only
    // author-declared named finds are in scope.  A system whose only read is the
    // auto-findAll must pass once its commands are gated.
    const src = `
system Helpdesk {
  user { id: string role: string }
  auth { enforcement: denyByDefault }
  subdomain S {
    context Tickets {
      aggregate Ticket {
        subject: string
        create register(s: string) { requires true subject := s }
      }
      repository Tickets for Ticket { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SupportApi from S
  deployable api { platform: node contexts: [Tickets] serves: SupportApi dataSources: [st] port: 8080 auth: required }
}
`;
    expect(await denyErrors(src)).toEqual([]);
  });

  // --- Projections (the last read surface default-deny walked past) ---

  /** A system with one FOLDED and one QUERY-TIME projection, each gated by the
   *  matching argument (a `requires …` clause, or "" for ungated). */
  function projectionSys(foldedGate: string, queryGate: string): string {
    return `
system Helpdesk {
  user { id: string role: string }
  auth { enforcement: denyByDefault }
  subdomain S {
    context Tickets {
      aggregate Ticket { subject: string  open: bool }
      repository Tickets for Ticket { }
      event Opened { ticket: Ticket id  subject: string }
      projection TicketBook keyed by ticket ${foldedGate}{
        ticket: Ticket id
        subject: string
        on(e: Opened) { ticket := e.ticket  subject := e.subject }
      }
      projection OpenTickets ${queryGate}{
        subject: string
        from Ticket as t
        where t.open == true
        select subject = t.subject
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SupportApi from S
  deployable api { platform: node contexts: [Tickets] serves: SupportApi dataSources: [st] port: 8080 auth: required }
}
`;
  }

  const PROJ_GATE = 'requires currentUser.role == "agent" ';

  it("rejects an ungated FOLDED projection under denyByDefault", async () => {
    // `/projections/ticket_book` and `/projections/ticket_book/{key}` publish
    // the read model's rows to any caller — the same hole as an ungated find,
    // and the one default-deny could not close until a folded projection could
    // both spell and enforce a gate.
    const errs = await denyErrors(projectionSys("", PROJ_GATE));
    expect(errs.some((m) => m.includes("projection 'TicketBook'"))).toBe(true);
    expect(errs.some((m) => m.includes("OpenTickets"))).toBe(false);
  });

  it("rejects an ungated QUERY-TIME projection under denyByDefault", async () => {
    const errs = await denyErrors(projectionSys(PROJ_GATE, ""));
    expect(errs.some((m) => m.includes("projection 'OpenTickets'"))).toBe(true);
    expect(errs.some((m) => m.includes("TicketBook"))).toBe(false);
  });

  it("accepts both projection kinds once gated", async () => {
    expect(await denyErrors(projectionSys(PROJ_GATE, PROJ_GATE))).toEqual([]);
  });

  it("`requires true` is the intentionally-public escape for a projection too", async () => {
    expect(await denyErrors(projectionSys("requires true ", "requires true "))).toEqual([]);
  });

  it("does not enforce projections under `enforcement: opt`", async () => {
    const opt = projectionSys("", "").replace(
      "auth { enforcement: denyByDefault }",
      "auth { enforcement: opt }",
    );
    expect(await denyErrors(opt)).toEqual([]);
  });
});

// An explicit `commandHandler` / `queryHandler` bound through an
// `api { route <M> "<path>" -> <Ctx>.<Handler> }` is a real HTTP endpoint on
// all five backends, but `validateDefaultDeny` used to walk right past it —
// it enumerated aggregate actions, workflow command entries, finds and
// history, and never touched `ctx.commandHandlers` / `ctx.queryHandlers`.
function handlerSys(opts: { gate: string; extern: boolean }): string {
  const handler = opts.extern
    ? `      extern commandHandler CancelOrder(orderId: Order id): Order id;`
    : `      commandHandler CancelOrder(orderId: Order id): Order id {
        ${opts.gate}
        let o = Orders.getById(orderId)
        o.cancel()
        return o.id
      }`;
  return `
system Shop {
  auth { enforcement: denyByDefault }
  user { id: string  role: string }
  subdomain Sales {
    context Ordering {
      aggregate Order {
        code: string
        status: string
        operation cancel() requires currentUser.role == "agent" { status := "cancelled" }
      }
      repository Orders for Order { }
${handler}
    }
  }
  api ShopApi from Sales {
    route POST "/orders/cancel" -> Ordering.CancelOrder
  }
  storage pg { type: postgres }
  resource st { for: Ordering, kind: state, use: pg }
  deployable d {
    platform: node
    contexts: [Ordering]
    dataSources: [st]
    serves: ShopApi
    port: 4000
    auth: required
  }
}`;
}

describe("default-deny — route-bound explicit handlers", () => {
  it("flags an ungated route-bound commandHandler", async () => {
    const errs = await denyErrors(handlerSys({ gate: "", extern: false }));
    expect(errs.join("\n")).toContain("commandHandler 'Ordering.CancelOrder'");
    expect(errs.join("\n")).toContain('route POST "/orders/cancel"');
  });

  it("accepts a route-bound commandHandler whose body declares a gate", async () => {
    const errs = await denyErrors(
      handlerSys({ gate: 'requires currentUser.role == "agent"', extern: false }),
    );
    expect(errs.join("\n")).not.toContain("CancelOrder");
  });

  it("`requires true` is the intentionally-public escape here too", async () => {
    const errs = await denyErrors(handlerSys({ gate: "requires true", extern: false }));
    expect(errs.join("\n")).not.toContain("CancelOrder");
  });

  // An `extern` handler has NO body, so "add a `requires`" would be an
  // instruction it is impossible to follow.  The diagnostic has to name what
  // is actually actionable instead, or it is the audit-history trap again.
  it("tells an `extern` handler something it can actually act on", async () => {
    const errs = await denyErrors(handlerSys({ gate: "", extern: true }));
    const msg = errs.find((m) => m.includes("CancelOrder"))!;
    expect(msg).toContain("has no body");
    expect(msg).toContain("drop `extern`");
    expect(msg).not.toContain("Add a `requires <expr>` to its body");
  });
});

// ---------------------------------------------------------------------------
// F-004 — `denyByDefault` × `persistedAs: eventLog`, and where a lifecycle
// gate actually goes.
//
// Both halves of this block are regressions against a REPORTED conclusion, not
// against a hypothetical.  A platform evaluation read the `default-deny-ungated`
// remedy ("Add a `requires <expr>`"), tried it in the header position every
// SIBLING declaration uses, hit `Expecting token of type '{' but found
// \`requires\``, and concluded that `enforcement: denyByDefault` and
// `persistedAs: eventLog` are mutually exclusive — "an event-sourced aggregate
// may have a creation endpoint, or the recommended security posture, not both."
//
// For a STATE-BASED aggregate that was never true: the gate is a body statement
// and always satisfied the check (the suites above have asserted exactly that
// since #2519).  For an EVENT-SOURCED one it was true, for a reason the report
// never reached — two validators demanding contradictory things.
// ---------------------------------------------------------------------------
describe("an event-sourced create under denyByDefault", () => {
  /** `persistedAs: eventLog` + `denyByDefault`, create gated by `gate`. */
  function esSys(gate: string): string {
    return `
system Ledger {
  user { id: string role: string }
  auth { enforcement: denyByDefault }
  subdomain S {
    context Accounts {
      event Opened { account: Account id, owner: string }
      aggregate Account persistedAs: eventLog {
        owner: string
        create(owner: string) { ${gate}emit Opened { account: id, owner: owner } }
        apply(e: Opened) { owner := e.owner }
      }
      repository Accounts for Account { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Accounts, kind: state, use: primary }
  resource el { for: Accounts, kind: eventLog, use: primary }
  api LedgerApi from S
  deployable api { platform: node contexts: [Accounts] serves: LedgerApi dataSources: [st, el] port: 8080 auth: required }
}
`;
  }

  it("is BUILDABLE ungated — the deadlock, and the finding's headline claim", async () => {
    // Before: gate absent → `loom.default-deny-ungated` (error), gate present →
    // `loom.lifecycle-guard-event-sourced` (error).  Every option errored, so the
    // two settings really were mutually exclusive for any event-sourced
    // aggregate with a creation endpoint.  The exit is the RECOURSE rule
    // `default-deny-checks.ts` already states for the by-id read: an arm the
    // author cannot satisfy is a warning with its own code, never an error.
    const diags = await allDiags(esSys(""));
    expect(diags.filter((x) => x.severity === "error")).toEqual([]);
    const warn = diags.find((x) => x.code === "loom.default-deny-es-create-ungateable");
    expect(warn).toBeDefined();
    // The warning has to carry the security consequence AND a remedy that
    // exists — the failure mode of the error it replaces was naming one that
    // does not.
    expect(warn!.message).toContain("ANY authenticated caller");
    expect(warn!.message).toContain("persistedAs: eventLog");
    expect(warn!.message).toContain("operation");
  });

  it("still refuses a gate written in the create body", async () => {
    // The other side of the vice, unchanged: the refusal is right — the ES
    // create body renders into a domain `_init` with no principal in scope.
    // Downgrading the default-deny arm must not have downgraded THIS.
    const diags = await allDiags(esSys('requires currentUser.role == "admin" '));
    const codes = diags.filter((x) => x.severity === "error").map((x) => x.code);
    expect(codes).toContain("loom.lifecycle-guard-event-sourced");
  });

  it("does not hand the ungateable warning to a STATE-BASED create", async () => {
    // The over-fire guard.  A state-based create HAS a gate surface, so it must
    // keep the hard error — the exemption is scoped to "no recourse exists",
    // not to "a create".
    const diags = await allDiags(`
system Ledger {
  user { id: string role: string }
  auth { enforcement: denyByDefault }
  subdomain S {
    context Accounts {
      aggregate Account {
        owner: string
        create(o: string) { owner := o }
      }
      repository Accounts for Account { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Accounts, kind: state, use: primary }
  api LedgerApi from S
  deployable api { platform: node contexts: [Accounts] serves: LedgerApi dataSources: [st] port: 8080 auth: required }
}
`);
    const codes = diags.map((x) => x.code);
    expect(codes).not.toContain("loom.default-deny-es-create-ungateable");
    expect(codes).toContain("loom.default-deny-ungated");
  });
});

describe("the lifecycle arm of `loom.default-deny-ungated` names the POSITION", () => {
  it("sends a hand-written create to the BODY, not the header", async () => {
    // The whole cost of F-004 was one missing clause in this message.  "Add a
    // `requires <expr>`" is true of an `operation`, whose header takes one; on a
    // `create` it routes the reader straight into a parse error, and from there
    // to "the posture is unsatisfiable".
    const errs = await denyErrors(`
system Helpdesk {
  user { id: string role: string }
  auth { enforcement: denyByDefault }
  subdomain S {
    context Tickets {
      aggregate Ticket {
        subject: string
        create(s: string) { subject := s }
      }
      repository Tickets for Ticket { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Tickets, kind: state, use: primary }
  api SupportApi from S
  deployable api { platform: node contexts: [Tickets] serves: SupportApi dataSources: [st] port: 8080 auth: required }
}
`);
    const msg = errs.find((m) => m.includes("Ticket.create"))!;
    expect(msg).toContain("FIRST STATEMENT of the body");
    expect(msg).toContain("create(...) { requires <expr>");
    // and it must SAY the header form does not parse, so nobody tries it twice
    expect(msg).toContain("is a parse error");
  });
});
