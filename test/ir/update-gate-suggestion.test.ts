// Update-gate bypass lint (audit D3, `docs/audits/2026-09-10-claimshub-dev-
// experience.md`; helpdesk eval H-01).  A field that a GATED operation —
// `requires`, a `when` state gate, or a `precondition` reading the field —
// assigns AND `crudish`'s generic `update` mass-assigns earns a counted
// warning `loom.update-gate-suggestion` naming `immutable` (and `managed` for
// the create half) as the remedy — never an auto-exclusion (that would add an
// invisible seventh access state; see the check's header).
//
// The negatives are the substance: `immutable` / `managed` (the remedies
// actually work), a field only the update writes, a `precondition` over a
// DIFFERENT field, a private operation, and a hand-written `update`.

import { describe, expect, it } from "vitest";
import { isAdvisoryCode } from "../../src/diagnostics/advisory.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { type LoomDiagnostic, validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

async function suggestions(source: string): Promise<LoomDiagnostic[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
    (d) => d.code === "loom.update-gate-suggestion",
  );
}

/** The ClaimsHub shape the audit filed D3 against, parameterised on the
 *  `status` field's modifier and on the guarded operation's body. */
const sys = (statusField: string, op: string) => `
  system ClaimsHub {
    user { id: string  role: string  permissions: string[] }
    subdomain Claims {
      permissions { claimsApprove }
      context Core {
        enum ClaimStatus { Submitted, UnderReview, Approved, Denied }
        aggregate Claim with crudish {
          ${statusField}
          description: string
          derived display: string = description
          ${op}
        }
        repository Claims for Claim { }
      }
    }
    api ClaimsApi from Claims
    storage pg { type: postgres }
    resource st { for: Core, kind: state, use: pg }
    deployable api { platform: node  contexts: [Core]  dataSources: [st]  serves: ClaimsApi  port: 3000  auth: required }
  }
`;

const GATED_APPROVE = `
  operation approve() {
    requires currentUser.permissions.contains(permissions.claimsApprove)
    precondition status == UnderReview
    status := Approved
  }`;

describe("loom.update-gate-suggestion", () => {
  it("fires on a field a `requires`-gated operation assigns that crudish's update also writes", async () => {
    const d = await suggestions(sys("status: ClaimStatus", GATED_APPROVE));
    expect(d).toHaveLength(1);
    expect(d[0]!.severity).toBe("warning");
    expect(d[0]!.message).toContain("Claim.status");
    expect(d[0]!.message).toContain("approve"); // names the gated operation
    expect(d[0]!.message).toContain("immutable"); // names the remedy
    expect(d[0]!.source).toBe("Core/Claim");
  });

  it("does NOT fire once the field is marked `immutable` — the remedy works", async () => {
    const d = await suggestions(sys("status: ClaimStatus immutable", GATED_APPROVE));
    expect(d).toEqual([]);
  });

  it("fires on a `precondition` that reads the field it assigns (the body-spelled state machine)", async () => {
    const d = await suggestions(
      sys(
        "status: ClaimStatus",
        `
  operation approve() {
    precondition status == UnderReview
    status := Approved
  }`,
      ),
    );
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toContain("a 'precondition' on 'status'");
  });

  it("does NOT fire on a `precondition` over a DIFFERENT field only (input validation, not a transition gate)", async () => {
    const d = await suggestions(
      sys(
        "status: ClaimStatus",
        `
  operation approve() {
    precondition description != ""
    status := Approved
  }`,
      ),
    );
    expect(d).toEqual([]);
  });

  it("does NOT fire on a `precondition` that compares the field with an ARGUMENT (input validation)", async () => {
    const d = await suggestions(
      sys(
        "status: ClaimStatus",
        `
  operation approve(expected: ClaimStatus) {
    precondition status == expected
    status := Approved
  }`,
      ),
    );
    expect(d).toEqual([]);
  });

  it("does NOT fire on a PRIVATE gated operation (no route, so nothing to bypass)", async () => {
    const d = await suggestions(
      sys(
        "status: ClaimStatus",
        `
  private operation approve() {
    requires currentUser.role == "admin"
    status := Approved
  }`,
      ),
    );
    expect(d).toEqual([]);
  });

  it("does NOT fire when `update` is HAND-WRITTEN rather than crudish's mass-assigning one", async () => {
    const d = await suggestions(`
  system ClaimsHub {
    user { id: string  role: string }
    subdomain Claims {
      context Core {
        enum ClaimStatus { Submitted, UnderReview, Approved, Denied }
        aggregate Claim {
          status: ClaimStatus
          description: string
          derived display: string = description
          operation update(status: ClaimStatus) {
            requires currentUser.role == "admin"
            status := status
          }
          operation approve() {
            requires currentUser.role == "admin"
            status := Approved
          }
        }
        repository Claims for Claim { }
      }
    }
    api ClaimsApi from Claims
    storage pg { type: postgres }
    resource st { for: Core, kind: state, use: pg }
    deployable api { platform: node  contexts: [Core]  dataSources: [st]  serves: ClaimsApi  port: 3000  auth: required }
  }
`);
    expect(d).toEqual([]);
  });

  it("fires per FIELD, in declared order, when a gated operation writes several", async () => {
    const d = await suggestions(
      sys(
        "status: ClaimStatus",
        `
  outcome: string
  operation approve() {
    requires currentUser.permissions.contains(permissions.claimsApprove)
    status := Approved
    outcome := "approved"
  }`,
      ),
    );
    expect(d.map((x) => x.message.split("'")[1])).toEqual(["Claim.status", "Claim.outcome"]);
  });

  it("is a counted WARNING, not an advisory hint — and never an error", async () => {
    const { model } = await parseString(sys("status: ClaimStatus", GATED_APPROVE), {
      validate: false,
    });
    const all = validateLoomModel(enrichLoomModel(lowerModel(model)));
    expect(all.filter((d) => d.severity === "error")).toEqual([]);
    expect(isAdvisoryCode("loom.update-gate-suggestion")).toBe(false);
  });
});

// Helpdesk eval H-01: the canonical `when`-gated state machine, no auth at
// all.  `POST /tickets/{id}/update {"status":"New"}` skipped every gate and
// `ddd parse` said nothing.
const helpdesk = (statusField: string, extra = "") => `
  system Helpdesk {
    subdomain Support {
      context Core {
        enum TicketStatus { New, Open, Resolved, Closed }
        aggregate Ticket with crudish {
          title: string
          ${statusField}
          operation resolve() when status == Open { status := Resolved }
          operation close() when status == Resolved { status := Closed }
          ${extra}
        }
        repository Tickets for Ticket { }
      }
    }
    api HelpdeskApi from Support
    storage pg { type: postgres }
    resource st { for: Core, kind: state, use: pg }
    deployable api { platform: node  contexts: [Core]  dataSources: [st]  serves: HelpdeskApi  port: 3000 }
  }
`;

describe("loom.update-gate-suggestion — `when`-gated state machine (H-01)", () => {
  it("fires on a field a `when`-gated operation assigns, naming the gate and the create half", async () => {
    const d = await suggestions(helpdesk("status: TicketStatus = New"));
    expect(d).toHaveLength(1); // once per field, not once per operation
    expect(d[0]!.severity).toBe("warning");
    expect(d[0]!.source).toBe("Core/Ticket");
    expect(d[0]!.message).toContain("'Ticket.status' is assigned by 'resolve'");
    expect(d[0]!.message).toContain("'when' state gate");
    expect(d[0]!.message).toContain("immutable");
    // the field has a default, so `managed` closes the create half too
    expect(d[0]!.message).toContain("'create' still accepts it");
    expect(d[0]!.message).toContain("mark it 'managed' instead");
  });

  it("without a default, the create half says to add one before `managed`", async () => {
    const d = await suggestions(helpdesk("status: TicketStatus"));
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toContain("give it a default and mark it 'managed'");
  });

  it("does NOT fire once the field is `immutable` or `managed`", async () => {
    expect(await suggestions(helpdesk("status: TicketStatus immutable = New"))).toEqual([]);
    expect(await suggestions(helpdesk("status: TicketStatus managed = New"))).toEqual([]);
  });

  it("does NOT fire on a field only the generic update writes (`title`), nor on one an ungated operation writes", async () => {
    const d = await suggestions(
      helpdesk("status: TicketStatus = New", `operation retitle(t: string) { title := t }`),
    );
    expect(d.map((x) => x.message.split("'")[1])).toEqual(["Ticket.status"]);
  });
});
