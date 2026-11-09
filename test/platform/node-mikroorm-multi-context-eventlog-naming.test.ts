// Multi-context event-log naming (node / MikroORM).
//
// `renderMikroEntities` receives the MERGED union of every context a node
// deployable hosts. Its `<Ctx>EventRow` stream entity has to be named after the
// stream's OWNING context, because that is the name the event-sourced
// repository and the event-sourced workflow fold helpers import. Named after
// the merge (the first context), the generated server dies at import
// (`The requested module '../entities' does not provide an export named
// 'BetaEventRow'`).
//
// The streams live in the SECOND context (`Beta`), so the merge name (`Alpha`)
// differs from the owner. Python pins the same rule in
// python-multi-context-eventlog-naming.test.ts.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = `
system MC {
  subdomain S {
    context Alpha {
      aggregate Widget { name: string  operation rename(n: string) { name := n } }
      repository Widgets for Widget { }
    }
    context Beta {
      aggregate Job persistedAs: eventLog {
        label: string
        create start() { emit Started { job: id } }
        apply(e: Started) { label := "" }
      }
      repository Jobs for Job { }
      event Started { job: Job id }
      event Ticked { job: Job id, by: int }
      channel L { carries: Started, Ticked  delivery: broadcast  retention: ephemeral }
      workflow Counter eventSourced {
        jobId: Job id
        total: int
        create(s: Started) by s.job { emit Ticked { job: s.job, by: 1 } }
        on(t: Ticked) by t.job { emit Ticked { job: t.job, by: total } }
        apply(t: Ticked) { total := total + t.by }
      }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource alphaState { for: Alpha, kind: state, use: pg }
  resource betaLog { for: Beta, kind: eventLog, use: pg }
  deployable api { platform: node { persistence: mikroorm } contexts: [Alpha, Beta] serves: A dataSources: [alphaState, betaLog] port: 3000 }
}`;

describe("multi-context event-log naming (node/mikroorm, merged contexts)", () => {
  it("names the <Ctx>EventRow entity + table by the stream's OWNING context, not the merge", async () => {
    const files = await generateSystemFiles(SRC);
    const get = (suffix: string): string =>
      [...files.entries()].find(([k]) => k.endsWith(suffix))?.[1] ?? "";

    const entities = get("api/db/entities.ts");
    expect(entities, "entities.ts generated").not.toBe("");
    expect(entities).toContain("export class BetaEventRow");
    expect(entities).toContain('tableName: "beta_events"');
    expect(entities).not.toContain("AlphaEventRow");

    const repo = get("api/db/repositories/job-repository.ts");
    expect(repo).toContain('import { BetaEventRow } from "../entities"');

    const workflows = get("api/http/workflows.ts");
    expect(workflows).toMatch(/import \{[^}]*\bBetaEventRow\b[^}]*\} from "\.\.\/db\/entities/);
    expect(workflows).not.toContain("AlphaEventRow");
  });
});
