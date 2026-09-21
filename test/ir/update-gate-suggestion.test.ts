// Update-gate advisory lint (audit D3, `docs/audits/2026-09-10-claimshub-dev-
// experience.md`).  A field that a `requires`-gated operation assigns AND
// `crudish`'s generic `update` mass-assigns earns a warning-severity
// `loom.update-gate-suggestion` naming `immutable` as the remedy — never an
// auto-exclusion (that would add an invisible seventh access state; see the
// check's header).
//
// The three negatives are the substance: `immutable` (the remedy actually
// works), an UNGATED operation (a bare `precondition` is the deliberately
// deferred second axis), and a hand-written `update` (not the mass-assigning
// one).

import { describe, expect, it } from "vitest";
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

  it("does NOT fire on an UNGATED operation (the deferred `precondition`-only axis)", async () => {
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

  it("is ADVISORY — it never contributes an error, so the model still validates", async () => {
    const { model } = await parseString(sys("status: ClaimStatus", GATED_APPROVE), {
      validate: false,
    });
    const all = validateLoomModel(enrichLoomModel(lowerModel(model)));
    expect(all.filter((d) => d.severity === "error")).toEqual([]);
  });
});
