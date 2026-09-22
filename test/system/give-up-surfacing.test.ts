// The walkers' give-ups reach the operator, instead of only the output file.
//
// `src/generator/_walker/give-up.ts` made every unrenderable construct carry a
// sentinel AND a `loom.*` code, and its own header named the half it could not
// do from inside an emitter: *"SURFACING those codes as `ddd generate`
// warnings lives outside this tree (`src/system/`)"*.  Until that landed, the
// information was written INTO THE OUTPUT and reported nowhere.
//
// The cost was not theoretical.  A `ui` scaffolding a subdomain its target
// backend does not host emitted a page whose body is
//
//     { /* loom:unrendered [loom.method-call-unresolved-receiver] … */ undefined.data.items.map(…) }
//
// — a `TypeError` on first render — while `ddd parse` AND `ddd generate system`
// both answered `0 error(s), 0 warning(s)` (F-019).  The generator knew, named
// the condition, and wrote the code three characters from the defect.
//
// Two severities, and the split is measured rather than assumed — see
// `NON_RUNNING_GIVE_UPS`.
import { describe, expect, it } from "vitest";
import {
  collectGiveUps,
  NON_RUNNING_GIVE_UPS,
  partitionGiveUps,
} from "../../src/system/give-up-report.js";
import { generateSystemFiles } from "../_helpers/generate.js";

/** `ui Web with scaffold(subdomains: [A, B])` where the target backend hosts
 *  only `A` — so every `B` page is emitted against a receiver that resolves to
 *  nothing. */
const UNSERVED = `
system X {
  subdomain A { context CA { aggregate Foo with crudish { name: string  derived display: string = name }
                             repository Foos for Foo { } } }
  subdomain B { context CB { aggregate Bar with crudish { tag: string  derived display: string = tag }
                             repository Bars for Bar { } } }
  ui Web with scaffold(subdomains: [A, B]) { framework: react }
  storage p { type: postgres }
  resource ra { for: CA, kind: state, use: p }
  resource rb { for: CB, kind: state, use: p }
  deployable api { platform: node, contexts: [CA], dataSources: [ra], port: 3000 }
  deployable web { platform: react, targets: api, ui: Web, port: 3001 }
}
`;

/** The same system with the ui scaffolding only what the backend hosts. */
const SERVED = UNSERVED.replace("scaffold(subdomains: [A, B])", "scaffold(subdomains: [A])");

describe("a walker give-up becomes a reported diagnostic", () => {
  it("the unserved-subdomain scaffold is reported, not silent", async () => {
    const files = await generateSystemFiles(UNSERVED);
    const reports = collectGiveUps(files);
    expect(reports.length, "no give-ups collected from a model that emits them").toBeGreaterThan(0);
    expect(reports.map((r) => r.code)).toContain("loom.method-call-unresolved-receiver");
    // Each report has to be actionable on its own: a code, the emitted file,
    // and the line.  A bare count would be no better than the comment.
    const first = reports.find((r) => r.code === "loom.method-call-unresolved-receiver")!;
    expect(first.path).toMatch(/pages\/bars\//);
    expect(first.line).toBeGreaterThan(0);
  }, 60_000);

  it("the reported text is the compiler's sentence, not the code beside it", async () => {
    const files = await generateSystemFiles(UNSERVED);
    const r = collectGiveUps(files).find((x) => x.code === "loom.method-call-unresolved-receiver")!;
    // The walkers inline these comments MID-EXPRESSION, so a capture that runs
    // to end of line drags the emitted code along and the reader cannot tell
    // the diagnostic from the output.
    expect(r.text).toContain("receiver did not resolve");
    expect(r.text).not.toContain("undefined.");
    expect(r.text).not.toContain("*/");
  }, 60_000);

  it("a non-running give-up is an ERROR; a degraded one is a warning", async () => {
    const files = await generateSystemFiles(UNSERVED);
    const { errors, warnings } = partitionGiveUps(collectGiveUps(files));
    // `undefined.data.items.map(…)` throws on render — the page is broken, not
    // degraded.
    expect(errors.map((e) => e.code)).toContain("loom.method-call-unresolved-receiver");
    // `CreateForm(of: Bar)` renders a COMMENT where the form would be: the page
    // mounts and is merely missing that form.  Honest degradation.
    expect(warnings.map((w) => w.code)).toContain("loom.page-ref-unreachable");
    expect(errors.map((e) => e.code)).not.toContain("loom.page-ref-unreachable");
  }, 60_000);

  it("a well-formed system emits NO give-ups", async () => {
    // Without this the assertions above would pass on a scanner that reported
    // every page, and the whole feature would be noise.
    const files = await generateSystemFiles(SERVED);
    expect(collectGiveUps(files)).toEqual([]);
  }, 60_000);

  it("the non-running set is deliberate, not empty and not everything", async () => {
    // An empty set would make `partitionGiveUps` a no-op; putting every code in
    // it would refuse projects that generate and run today (most of the 36
    // give-up conditions are honest degradation that still compiles).
    expect(NON_RUNNING_GIVE_UPS.size).toBeGreaterThan(0);
    expect(NON_RUNNING_GIVE_UPS.has("loom.page-ref-unreachable")).toBe(false);
  });
});
