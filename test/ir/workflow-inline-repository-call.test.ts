// `loom.workflow-inline-repository-call` — a repository read a workflow body
// runs only on some paths (a lambda, the right of `&&` / `||` / `??`, a `?:`
// branch, a `match` arm).
//
// A read inside an expression is lowered as a `let` hoisted ahead of its
// statement (`src/ir/lower/hoist-reads.ts`), so it reaches the backends as the
// same `repo-let` / `repo-run` the `let` spelling does — and the backends
// instantiate the repository from that statement.  Hoisting a read the source
// evaluates conditionally would run it where the source does not, so such a
// read is left in the expression, where the repository name resolves to
// nothing (`ref` with `refKind: "unknown"`): nothing is constructed and the
// unresolved receiver renders verbatim.  That is what this gate refuses.
//
// The pairs below are the point: each "flags" case has an "accepts" twin that
// is the SAME read in an unconditional position, so the gate is shown to
// separate the two rather than to reject any mention of a repository.

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
  it("flags a repository read on the right of `||` inside a precondition", async () => {
    const body = `let job = Jobs.get(jobId)
        precondition job.skill == "" || job.skill == Assets.get(job.assetId).requiredSkill`;
    expect(await codes(body)).toContain(CODE);
  });

  it("accepts the same read where the precondition always evaluates it (hoisted)", async () => {
    const body = `let job = Jobs.get(jobId)
        precondition job.skill == Assets.get(job.assetId).requiredSkill`;
    expect(await codes(body)).not.toContain(CODE);
  });

  it("accepts the same read bound to its own let", async () => {
    const body = `let job = Jobs.get(jobId)
        let asset = Assets.get(job.assetId)
        precondition job.skill == asset.requiredSkill`;
    expect(await codes(body)).not.toContain(CODE);
  });

  it("names the repository and spells out the let-bound rewrite", async () => {
    const body = `let job = Jobs.get(jobId)
        precondition job.skill == "" || job.skill == Assets.get(job.assetId).requiredSkill`;
    const msg = (await diags(body)).find((d) => d.code === CODE)?.message ?? "";
    expect(msg).toContain("'Assets'");
    // The suggested rewrite is the exact shape that DOES compile — echoing the
    // method the author wrote, not a generic placeholder.
    expect(msg).toContain("let asset = Assets.get(…)");
  });

  it("flags a read in a `?:` branch of a requires gate", async () => {
    const body = `let job = Jobs.get(jobId)
        requires job.skill == "" ? true : Assets.get(job.assetId).requiredSkill != ""`;
    expect(await codes(body)).toContain(CODE);
  });

  it("flags a read on the right of `??` in an emit field", async () => {
    const body = `let job = Jobs.get(jobId)
        emit Assigned { skill: job.skill ?? Assets.get(job.assetId).requiredSkill }`;
    expect(await codes(body)).toContain(CODE);
  });

  it("flags an inline read nested inside a for-each body", async () => {
    // The nesting is the point: a shallow scan of `wf.statements` would miss
    // this, which is exactly the dead-zone `walkWorkflowStmtExprsDeep` closes.
    const body = `let jobs = Jobs.all(AnyJob)
        for j in jobs { precondition j.skill == "" || j.skill == Assets.get(j.assetId).requiredSkill }`;
    expect(await codes(body)).toContain(CODE);
  });

  it("flags a criterion-shaped read the same way", async () => {
    const body = `let job = Jobs.get(jobId)
        precondition job.skill == "" || Assets.all(AnySkill).count > 0`;
    expect(await codes(body)).toContain(CODE);
  });

  it("reports one diagnostic per repository per body, not one per mention", async () => {
    const body = `let job = Jobs.get(jobId)
        precondition job.skill == "" || Assets.get(job.assetId).requiredSkill != ""
        precondition job.skill == "" || Assets.get(job.assetId).requiredSkill != "n/a"`;
    expect((await codes(body)).filter((c) => c === CODE)).toHaveLength(1);
  });

  it("never flags a workflow whose repository reads are all let-bound", async () => {
    const body = `let job = Jobs.get(jobId)
        let asset = Assets.get(job.assetId)
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
        let Assets = Jobs.get(jobId)
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
