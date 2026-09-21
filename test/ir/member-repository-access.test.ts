// IR-validator coverage for `loom.repository-access-outside-workflow` — a
// repository named from an aggregate / part / value-object member body, where
// no backend binds one (`src/ir/validate/checks/repo-access-checks.ts`).  The
// emitted-output half — the dangling identifier all five backends render for
// the unresolved receiver — is
// `test/generator/operation-repository-access.test.ts`.
//
// The FIRING cases below are the member surfaces that validated clean before
// this gate; the NON-FIRING ones are the sites where a repository read is
// legitimate (a workflow, a command handler, a `domainService` reading its own
// context) plus the two shapes a name-based gate must not catch: a local that
// shadows a repository name, and a system with no repository at all.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.repository-access-outside-workflow";

/** One context carrying a second aggregate (`Technician`) with a repository,
 *  so a member of `Job` has something cross-aggregate to reach for. */
async function diags(jobMembers: string, extra = "") {
  const { model, errors } = await parseString(`
    context Ops {
      aggregate Technician {
        name: string
        skills: string[]
      }
      repository Technicians for Technician { }

      aggregate Job {
        technicianId: Technician id
        requiredSkill: string
        assignedName: string
        ${jobMembers}
      }
      repository Jobs for Job { }
      ${extra}
    }
  `);
  expect(errors).toEqual([]); // phases ① + ④ stay clean — this is the SILENT class
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

const hits = (d: Awaited<ReturnType<typeof diags>>) => d.filter((x) => x.code === CODE);

describe("IR validator — a repository named from a domain member body", () => {
  it("rejects a repository read in an aggregate `operation` (the reported shape)", async () => {
    const d = await diags(`
      operation assign(assignTo: Technician id) {
        precondition Technicians.getById(assignTo).skills.contains(requiredSkill)
        technicianId := assignTo
      }
    `);
    const hit = hits(d)[0];
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(hit?.source).toBe("Ops/Job.assign");
    expect(hit?.message).toContain("operation 'assign' on aggregate 'Job'");
    expect(hit?.message).toContain("Technicians");
  });

  it("rejects it in an EXPRESSION-body `function` — the form the purity gate lets through", async () => {
    // A block-body `function` already trips `loom.function-block-impure` on the
    // method call; the expression form is pure by construction and had no gate
    // at all, so it emitted the same dangling receiver in silence.
    const d = await diags(`
      function skilled(who: Technician id): bool = Technicians.getById(who).skills.count > 0
    `);
    expect(hits(d)).toHaveLength(1);
    expect(hits(d)[0]?.source).toBe("Ops/Job.function[skilled]");
    expect(hits(d)[0]?.message).toContain("function 'skilled' on aggregate 'Job'");
  });

  it("rejects it in an `invariant` and in a `derived`", async () => {
    const d = await diags(`
      derived skillCount: int = Technicians.getById(technicianId).skills.count
      invariant Technicians.getById(technicianId).skills.contains(requiredSkill)
    `);
    expect(
      hits(d)
        .map((h) => h.source)
        .sort(),
    ).toEqual(["Ops/Job.derived[skillCount]", "Ops/Job.invariant"]);
  });

  it("reports a member ONCE per repository, however many times it is read", async () => {
    const d = await diags(`
      operation assign(assignTo: Technician id) {
        precondition Technicians.getById(assignTo).skills.count > 0
        assignedName := Technicians.getById(assignTo).name
        technicianId := assignTo
      }
    `);
    expect(hits(d)).toHaveLength(1);
  });

  it("catches a CROSS-CONTEXT repository too — equally unbound in a domain class", async () => {
    const { model, errors } = await parseString(`
      context Billing {
        aggregate Customer { name: string }
        repository Customers for Customer { }
      }
      context Ops {
        aggregate Job {
          customerId: Customer id
          label: string
          operation relabel() { label := Customers.getById(customerId).name }
        }
        repository Jobs for Job { }
      }
    `);
    expect(errors).toEqual([]);
    const d = validateLoomModel(enrichLoomModel(lowerModel(model)));
    expect(hits(d)).toHaveLength(1);
    expect(hits(d)[0]?.message).toContain("Customers");
  });

  // --- the legitimate sites: these must stay silent ------------------------

  it("does NOT fire for the same read inside a `workflow` — where a repository IS in scope", async () => {
    const d = await diags(
      `
      operation assign(assignTo: Technician id, skilled: bool) {
        precondition skilled
        technicianId := assignTo
      }
    `,
      `
      workflow assignJob {
        create(jobId: Job id, techId: Technician id) {
          let tech = Technicians.getById(techId)
          let job = Jobs.getById(jobId)
          job.assign(techId, tech.skills.contains(job.requiredSkill))
        }
      }
    `,
    );
    expect(hits(d)).toEqual([]);
    // Not vacuous: the workflow fixture is accepted OUTRIGHT, so the reads it
    // performs are the real, resolved ones — not a body that failed elsewhere.
    expect(d.filter((x) => x.severity === "error")).toEqual([]);
  });

  it("does NOT fire for a `domainService` reading its OWN context's repository", async () => {
    // The `reading` tier (domain-services.md rev. 4): this lowers to a resolved
    // `repo-read` Call, so there is no unresolved ref for the gate to see.
    const d = await diags(
      "",
      `
      domainService Staffing {
        operation anyTechnician(): bool { return Technicians.findAll().count > 0 }
      }
    `,
    );
    expect(hits(d)).toEqual([]);
  });

  it("does NOT fire when a LOCAL shadows the repository name", async () => {
    // The gate keys on `refKind: "unknown"`; a parameter (or a `let`) binding
    // that name resolves, so the reference is not the dangling shape.
    const d = await diags(`
      operation rename(Technicians: string) {
        assignedName := Technicians
      }
    `);
    expect(hits(d)).toEqual([]);
  });

  it("does NOT fire on a body that names no repository at all", async () => {
    const d = await diags(`
      operation rename(to: string) {
        assignedName := to
      }
    `);
    expect(hits(d)).toEqual([]);
  });
});
