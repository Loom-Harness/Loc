// Cross-backend regression for `loom.repository-access-outside-workflow`
// (the emitted-output half; the validator half is
// `test/ir/member-repository-access.test.ts`).
//
// THE SHAPE.  A plain aggregate `operation` that reads ANOTHER aggregate
// through its repository — the exact spelling that is legal inside a
// `workflow`, where a repository genuinely is in scope.  `lower-expr.ts`'s
// repo-read probe fires only for a `domainService` body (`env.serviceRepos`)
// and `lower-workflow.ts` recognises the shape only inside a workflow, so in
// an aggregate member body the receiver never resolves: it stays a `ref` with
// `refKind: "unknown"`, and every backend renders it VERBATIM into the domain
// class, which binds no repository.
//
// This test does two things, in this order:
//
//   1. proves the emission is genuinely broken on ALL FIVE backends (the
//      evidence that made this a model-level gate rather than five per-backend
//      fixes), and
//   2. proves phase ⑦ rejects the model, so no user reaches that emission.
//
// `generateSystemFiles` asserts phase ⑦ too (M-T9.34), so the emission legs go
// through `generateSystemFilesUnchecked`: emitting from the model the gate
// rejects IS their subject.
//
// NOTE ON THE FIXTURE BODY.  The operation ASSIGNS from the repository read
// rather than `precondition`-ing on it, deliberately: a `precondition` echoes
// its `.ddd` source text into the thrown error message, so `toContain("…")`
// would pass on the ECHO even if the guard itself rendered correctly.  An
// assignment renders the call and nothing else, so what these assertions match
// is real emitted CODE.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFilesUnchecked } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const SRC = (platform: string) => `
system FieldOps {
  subdomain Core {
    context Ops {
      aggregate Technician {
        name: string
      }
      repository Technicians for Technician { }

      aggregate Job {
        technicianId: Technician id
        assignedName: string

        operation assign(assignTo: Technician id) {
          technicianId := assignTo
          assignedName := Technicians.getById(assignTo).name
        }
      }
      repository Jobs for Job { }
    }
  }
  storage primary { type: postgres }
  resource opsState { for: Ops, kind: state, use: primary }
  deployable api {
    platform: ${platform}
    contexts: [Ops]
    dataSources: [opsState]
    port: 3000
  }
}
`;

/**
 * Per backend: the generated file carrying the aggregate's operation, and the
 * DANGLING IDENTIFIER it renders for the unresolved repository receiver.
 * Captured 2026-09-13 by generating this exact system on each backend:
 *
 *   TS      `Technicians.getById(assignTo).name` in `domain/job.ts`, a file
 *           that defines/imports no `Technicians`      → TS2304.
 *   .NET    `Technicians.GetById(assignTo).Name` in `Domain/Jobs/Job.cs`
 *                                                      → CS0103.
 *   Java    `Technicians.getById(assignTo).name()`     → "cannot find symbol".
 *   Python  `Technicians.get_by_id(assign_to).name`    → NameError (F821).
 *   Phoenix `technicians.get_by_id(assign_to).name` — the ref is snake-cased
 *           into a LOCAL that was never bound          → "undefined variable".
 *
 * If a backend ever learns to bind a repository inside a domain method, the
 * gate is what has to change first — this table is the evidence it rests on.
 */
const BACKENDS: { platform: string; file: string; dangling: string }[] = [
  { platform: "node", file: "domain/job.ts", dangling: "Technicians.getById(assignTo)" },
  { platform: "dotnet", file: "Domain/Jobs/Job.cs", dangling: "Technicians.GetById(assignTo)" },
  { platform: "java", file: "jobs/Job.java", dangling: "Technicians.getById(assignTo)" },
  { platform: "python", file: "domain/job.py", dangling: "Technicians.get_by_id(assign_to)" },
  { platform: "elixir", file: "lib/api/ops.ex", dangling: "technicians.get_by_id(assign_to)" },
];

function bySuffix(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) {
    throw new Error(`no generated file ending in ${suffix}; got:\n${[...files.keys()].join("\n")}`);
  }
  return files.get(key)!;
}

describe("a repository read in an aggregate operation — the emission the gate stands in front of", () => {
  for (const { platform, file, dangling } of BACKENDS) {
    it(`${platform} emits a dangling identifier for the repository receiver`, async () => {
      const out = bySuffix(
        await generateSystemFilesUnchecked(
          SRC(platform),
          "the dangling repository emission loom.repository-access-outside-workflow stands in front of is the subject; the gate rejects this model by design",
        ),
        file,
      );
      expect(out).toContain(dangling);
      // Nothing in the file defines or imports the receiver — that is what
      // makes it dangling rather than merely oddly named.
      const definitions = out
        .split("\n")
        .filter((l) => /import|using|defmodule|require|from /.test(l) && /Technicians/i.test(l));
      expect(definitions).toEqual([]);
    });
  }

  it("phase ⑦ rejects the model, so none of that emission is reachable", async () => {
    const { model, errors } = await parseString(SRC("node"));
    expect(errors).toEqual([]); // phases ① + ④ are clean — this was the SILENT part
    const diags = validateLoomModel(enrichLoomModel(lowerModel(model)));
    const hit = diags.find((d) => d.code === "loom.repository-access-outside-workflow");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("error");
    expect(hit?.source).toBe("Ops/Job.assign");
    // The message has to be actionable: it names the member, the repository,
    // and the construct that may do this instead.
    expect(hit?.message).toContain("operation 'assign' on aggregate 'Job'");
    expect(hit?.message).toContain("Technicians");
    expect(hit?.message).toContain("workflow");
  });

  it("the gate is platform-independent — it fires for every backend's system", async () => {
    for (const { platform } of BACKENDS) {
      const { model } = await parseString(SRC(platform));
      const diags = validateLoomModel(enrichLoomModel(lowerModel(model)));
      expect(
        diags.filter((d) => d.code === "loom.repository-access-outside-workflow"),
        `expected the repository-access gate to fire on platform ${platform}`,
      ).toHaveLength(1);
    }
  });
});
