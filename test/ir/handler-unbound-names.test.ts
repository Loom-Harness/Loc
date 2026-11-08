// Unbound names in a `commandHandler` / `queryHandler` body —
// `loom.handler-unknown-name`, and the repository reads that are NOT unbound.
//
// A handler body lowers through the workflow statement lowering, so a name that
// binds to nothing stays a `ref` with `refKind: "unknown"` and every expression
// renderer prints it verbatim.  A repository of this context reached inside an
// expression is not such a name: lowering hoists the read into a `let` ahead of
// its statement, so it reads exactly like its let-bound twin (a read that runs
// only on some paths is refused instead — `handler-inline-repository-call.test.ts`).
//
// Each refusal has a clean twin, so the gate is shown to separate the
// spellings rather than to reject any mention of a name.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

const INLINE = "loom.workflow-inline-repository-call";
const UNKNOWN = "loom.handler-unknown-name";

const src = (handlers: string, extra = "") => `
  system S { subdomain M {
    context C {
      aggregate Asset {
        requiredSkill: string
        operation retire() { requiredSkill := "" }
      }
      repository Assets for Asset { }
      aggregate Job {
        assetId: Asset id
        skill: string
        operation assign(s: string) { skill := s }
      }
      repository Jobs for Job { }
      projection Seen keyed by jobId {
        jobId: Job id
        n: int
        on(e: Assigned) { n := n + 1 }
      }
      event Assigned { jobId: Job id }
      ${handlers}
    }
    ${extra}
  }}`;

async function diags(handlers: string, extra = ""): Promise<{ code: string; message: string }[]> {
  const { model } = await parseString(src(handlers, extra), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => ({
    code: d.code ?? "",
    message: d.message,
  }));
}

const codes = async (handlers: string, extra = ""): Promise<string[]> =>
  (await diags(handlers, extra)).map((d) => d.code);

describe("a repository read inside a handler expression", () => {
  it("hoists a read in an operation-call argument instead of refusing it", async () => {
    const got = await codes(`commandHandler AssignJob(jobId: Job id) {
        let job = Jobs.get(jobId)
        job.assign(Assets.get(job.assetId).requiredSkill)
      }`);
    expect(got).not.toContain(INLINE);
    expect(got).not.toContain(UNKNOWN);
  });

  it("hoists one in a queryHandler's answered value", async () => {
    const got = await codes(`queryHandler SkillOf(jobId: Job id): string {
        let job = Jobs.get(jobId)
        return Assets.get(job.assetId).requiredSkill
      }`);
    expect(got).not.toContain(INLINE);
    expect(got).not.toContain(UNKNOWN);
  });

  it("accepts the same reads bound to their own let", async () => {
    const got = await codes(`
      commandHandler AssignJob(jobId: Job id) {
        let job = Jobs.get(jobId)
        let asset = Assets.get(job.assetId)
        job.assign(asset.requiredSkill)
      }
      queryHandler SkillOf(jobId: Job id): string {
        let job = Jobs.get(jobId)
        let asset = Assets.get(job.assetId)
        return asset.requiredSkill
      }`);
    expect(got).not.toContain(INLINE);
    expect(got).not.toContain(UNKNOWN);
  });
});

describe("loom.handler-unknown-name", () => {
  it("flags a name declared nowhere", async () => {
    const got = await diags(`commandHandler AssignJob(jobId: Job id) {
        let job = Jobs.get(jobId)
        job.assign(Bogus.thing)
      }`);
    const hit = got.filter((d) => d.code === UNKNOWN);
    expect(hit).toHaveLength(1);
    expect(hit[0]?.message).toContain("commandHandler 'AssignJob'");
    expect(hit[0]?.message).toContain("'Bogus'");
    expect(hit[0]?.message).toContain("not declared anywhere");
  });

  it("names a projection receiver as one", async () => {
    const got = await diags(`queryHandler Count(jobId: Job id): int {
        return Seen.byKey(jobId).n
      }`);
    const hit = got.filter((d) => d.code === UNKNOWN);
    expect(hit).toHaveLength(1);
    expect(hit[0]?.message).toContain("a projection");
  });

  it("names a repository of another context as one", async () => {
    const got = await diags(
      `commandHandler AssignJob(jobId: Job id) {
        let job = Jobs.get(jobId)
        job.assign(Gadgets.get(job.assetId).label)
      }`,
      `context Other {
        aggregate Gadget { label: string  operation x() { label := "" } }
        repository Gadgets for Gadget { }
      }`,
    );
    const hit = got.filter((d) => d.code === UNKNOWN);
    expect(hit).toHaveLength(1);
    expect(hit[0]?.message).toContain("context 'Other'");
  });

  it("NON-VACUITY: params, lets, enums and declared types read clean", async () => {
    expect(
      await codes(
        `commandHandler AssignJob(jobId: Job id, s: string) {
        let job = Jobs.get(jobId)
        job.assign(s)
      }`,
      ),
    ).not.toContain(UNKNOWN);
  });

  it("NON-VACUITY: an extern handler has no body to judge", async () => {
    expect(await codes(`extern commandHandler AssignJob(jobId: Job id);`)).toEqual(
      expect.not.arrayContaining([UNKNOWN, INLINE]),
    );
  });
});
