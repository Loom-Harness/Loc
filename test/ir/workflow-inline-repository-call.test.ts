// `loom.workflow-inline-repository-call` — a repository reached INLINE, inside
// an expression, rather than bound to its own `let` statement.
//
// Repository access from a workflow IS supported, but only in one spelling.
// `lowerWorkflowStatement` recognises a repository read exclusively in its
// `isLetStmt` arm and lowers it to a `repo-let` / `repo-run` `WorkflowStmtIR`
// carrying the repository as a STRING field (`repoName`).  The same call inside
// a `precondition` / `requires` / `assign` RHS / `emit` field / `for-each`
// iterable goes through `lowerExpr` instead, where the repository name resolves
// to nothing (`ref` with `refKind: "unknown"`) — and since every backend derives
// the repositories to instantiate from the STATEMENT KINDS, the read is dropped:
// nothing is constructed and the unresolved receiver renders verbatim.  Measured
// on node before the gate existed: `ddd parse` and `generate system` both
// reported ZERO diagnostics while `api/http/workflows.ts` emitted
// `Assets.getById(job.assetId)` with no `AssetRepository` in the transaction →
// `Cannot find name 'Assets'` under `tsc`.
//
// The pairs below are the point: each "flags" case has an "accepts" twin that
// is the SAME read bound to a `let`, so the gate is shown to separate the two
// spellings rather than to reject any mention of a repository.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

const CODE = "loom.workflow-inline-repository-call";

/** A two-aggregate context: `Job` (loadable by the workflow's own param) and
 *  `Asset` (the one the body reaches for a second read). */
const src = (body: string) => `
  system S { subdomain M { context C {
    event Assigned { skill: string }
    aggregate Asset {
      requiredSkill: string
      operation retire() { requiredSkill := "" }
    }
    repository Assets for Asset { }
    criterion AnySkill of Asset = requiredSkill != ""
    aggregate Job {
      assetId: Asset id
      skill: string
      operation assign() { skill := "x" }
    }
    repository Jobs for Job { }
    criterion AnyJob of Job = skill != ""
    workflow W {
      create(jobId: Job id) {
        ${body}
      }
    }
  }}}`;

async function diags(body: string): Promise<{ code: string; message: string }[]> {
  const { model } = await parseString(src(body), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => ({
    code: d.code ?? "",
    message: d.message,
  }));
}

const codes = async (body: string): Promise<string[]> => (await diags(body)).map((d) => d.code);

describe("loom.workflow-inline-repository-call (IR, phase ⑦)", () => {
  it("flags a repository read inline inside a precondition", async () => {
    const body = `let job = Jobs.getById(jobId)
        precondition job.skill == Assets.getById(job.assetId).requiredSkill`;
    expect(await codes(body)).toContain(CODE);
  });

  it("accepts the same read bound to its own let", async () => {
    const body = `let job = Jobs.getById(jobId)
        let asset = Assets.getById(job.assetId)
        precondition job.skill == asset.requiredSkill`;
    expect(await codes(body)).not.toContain(CODE);
  });

  it("names the repository and spells out the let-bound rewrite", async () => {
    const body = `let job = Jobs.getById(jobId)
        precondition job.skill == Assets.getById(job.assetId).requiredSkill`;
    const msg = (await diags(body)).find((d) => d.code === CODE)?.message ?? "";
    expect(msg).toContain("'Assets'");
    // The suggested rewrite is the exact shape that DOES compile — echoing the
    // method the author wrote, not a generic placeholder.
    expect(msg).toContain("let asset = Assets.getById(…)");
  });

  it("flags an inline read in a requires gate", async () => {
    const body = `let job = Jobs.getById(jobId)
        requires Assets.getById(job.assetId).requiredSkill != ""`;
    expect(await codes(body)).toContain(CODE);
  });

  it("flags an inline read in an emit field", async () => {
    const body = `let job = Jobs.getById(jobId)
        emit Assigned { skill: Assets.getById(job.assetId).requiredSkill }`;
    expect(await codes(body)).toContain(CODE);
  });

  it("flags an inline read nested inside a for-each body", async () => {
    // The nesting is the point: a shallow scan of `wf.statements` would miss
    // this, which is exactly the dead-zone `walkWorkflowStmtExprsDeep` closes.
    const body = `let jobs = Jobs.findAll(AnyJob)
        for j in jobs { precondition j.skill == Assets.getById(j.assetId).requiredSkill }`;
    expect(await codes(body)).toContain(CODE);
  });

  it("flags a criterion-shaped inline read the same way", async () => {
    const body = `let job = Jobs.getById(jobId)
        precondition Assets.find(AnySkill).requiredSkill != ""`;
    expect(await codes(body)).toContain(CODE);
  });

  it("reports one diagnostic per repository per body, not one per mention", async () => {
    const body = `let job = Jobs.getById(jobId)
        precondition Assets.getById(job.assetId).requiredSkill != ""
        precondition Assets.getById(job.assetId).requiredSkill != "n/a"`;
    expect((await codes(body)).filter((c) => c === CODE)).toHaveLength(1);
  });

  it("never flags a workflow whose repository reads are all let-bound", async () => {
    const body = `let job = Jobs.getById(jobId)
        let asset = Assets.getById(job.assetId)
        job.assign()
        asset.retire()`;
    expect(await codes(body)).not.toContain(CODE);
  });

  it("does not flag a let / param that merely shares a repository's name", async () => {
    // `refKind` is the discriminator: a bound name resolves, so it is never
    // `unknown` and can never reach the gate.
    const { model } = await parseString(
      `
  system S { subdomain M { context C {
    aggregate Asset { requiredSkill: string }
    repository Assets for Asset { }
    aggregate Job { skill: string }
    repository Jobs for Job { }
    workflow W {
      create(jobId: Job id) {
        let Assets = Jobs.getById(jobId)
        precondition Assets.skill != ""
      }
    }
  }}}`,
      { validate: false },
    );
    const found = validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => d.code ?? "");
    expect(found).not.toContain(CODE);
  });
});
