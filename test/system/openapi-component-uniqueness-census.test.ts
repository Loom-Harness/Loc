// No generated OpenAPI document mints one component name twice — over the WHOLE
// tracked `.ddd` corpus, not the models someone thought to synthesise.
//
// This is the gate F-026 did not have. That finding (#3015, #3047, #3045, #3046)
// was one defect in four places: two independent naming rules —
// `<Op><Agg>Request` for an aggregate operation and `<Workflow>Request` for a
// workflow — minting the same string with nothing checking they agree, so a
// published spec documented an endpoint with ANOTHER endpoint's body. Class:
// SILENT. Valid input, `0 error(s), 0 warning(s)`, wrong output.
//
// WHY THE EXISTING GATES WERE ALL BLIND
//
// `docs/conformance.md` lists a "Request-body refs" parity dimension
// (`requestBodySchemas(spec)`) comparing which component each operation's body
// points at — ACROSS backends. It is blind by construction: node, elixir and
// java shared the defect, so all three collapsed the same pair onto one
// component and the cross-backend diff found them in perfect agreement. The
// missing check was never cross-backend; it was WITHIN one document.
//
// The per-shape tests added with the fixes pin the two collision shapes on
// hand-written models plus one shipped example. They cannot see the NEXT pair of
// rules that collide, in a model nobody wrote a fixture for — which is precisely
// how this shipped: censusing the corpus found **48** colliding contexts, three
// of them outside the eval corpora in the set CI actually builds.
//
// WHY THIS IS NOT CIRCULAR
//
// Asserting that `resolveRequestComponentNames` returns distinct names would
// prove nothing: it returns distinct names by construction. The bug that ships
// is an owner the minter NEVER SAW. #3047 was exactly that — `agg.operations`
// does not contain `create`, so `Create<Agg>Request` was not an owner and a
// `workflow create<Agg>` still collided. A forgotten owner emits a name the
// minter never resolved, so only the EMITTED OUTPUT shows it. This census reads
// the emitted output.
//
// SCOPE, STATED HONESTLY
//
// Corpus-wide for the two backends whose registry key is present in the emitted
// source (node's `.openapi("…")` literal, java's published record name). elixir,
// python and dotnet are out of this form's reach for reasons given in
// `test/_helpers/published-openapi-components.ts` — elixir's failure mode is a
// file-path clobber that leaves one legitimate-looking module, python
// auto-qualifies by module so a collision cannot form, and dotnet's Swashbuckle
// throws on a duplicate rather than silently keeping one. So this narrows the
// class substantially; it does not close it for all five.

import { describe, expect, it } from "vitest";
import { dddSourceOf, trackedDddFiles, UNPARSEABLE_DDD } from "../_helpers/ddd-corpus.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import {
  byDeployable,
  conflictingPublishedNames,
  honoPublishedComponents,
  javaPublishedRequestComponents,
} from "../_helpers/published-openapi-components.js";

/** Every tracked `.ddd` bar the one that is a design document wearing a `.ddd`
 *  extension (pinned, with the reasoning, by `ddd-source-census.test.ts`). */
const CORPUS = trackedDddFiles().filter((f) => f !== UNPARSEABLE_DDD);

/** A `.ddd` that generation legitimately refuses — a fixture written to BE
 *  invalid, or one whose `import` graph only resolves as part of a multi-file
 *  system. Those are `ddd-source-census.test.ts`'s business, not this one's; a
 *  census that fails on them would be asserting someone else's invariant. Only
 *  the count is pinned below, so this cannot quietly swallow the whole corpus. */
function isGeneratable(files: Map<string, string> | undefined): files is Map<string, string> {
  return files !== undefined && files.size > 0;
}

interface Offender {
  readonly ddd: string;
  readonly deployable: string;
  readonly name: string;
  readonly shapes: string[];
}

/** ONE pass over the corpus, extracting BOTH backends' published names.
 *
 *  Deliberately not one sweep per backend: generation dominates the cost
 *  (~500 models), so two sweeps doubled the wall-clock for no extra coverage.
 *  Sharing the pass also means the two cases below cannot end up reporting on
 *  different populations. Computed once, lazily, and awaited by each case. */
interface SweepResult {
  readonly node: Offender[];
  readonly java: Offender[];
  readonly generated: number;
  readonly nodeReached: number;
  readonly javaReached: number;
}

let SWEEP: Promise<SweepResult> | undefined;

function sweepCorpus(): Promise<SweepResult> {
  SWEEP ??= (async () => {
    const node: Offender[] = [];
    const java: Offender[] = [];
    let generated = 0;
    let nodeReached = 0;
    let javaReached = 0;

    for (const ddd of CORPUS) {
      let files: Map<string, string> | undefined;
      try {
        files = await generateSystemFiles(dddSourceOf(ddd));
      } catch {
        // Not generatable standalone — see `isGeneratable`.
        continue;
      }
      if (!isGeneratable(files)) continue;
      generated++;

      for (const [deployable, emitted] of byDeployable(files)) {
        for (const [kind, extract, sink] of [
          ["node", honoPublishedComponents, node],
          ["java", javaPublishedRequestComponents, java],
        ] as const) {
          const published = extract(emitted);
          if (published.length === 0) continue; // not a deployable of this kind
          if (kind === "node") nodeReached++;
          else javaReached++;
          for (const [name, shapes] of conflictingPublishedNames(published)) {
            sink.push({ ddd, deployable, name, shapes });
          }
        }
      }
    }
    return { node, java, generated, nodeReached, javaReached };
  })();
  return SWEEP;
}

function render(offenders: readonly Offender[]): string {
  return offenders
    .map(
      (o) =>
        `${o.ddd} → ${o.deployable}: "${o.name}" registered with ${o.shapes.length} different shapes\n` +
        o.shapes.map((sh) => `      ${sh}`).join("\n"),
    )
    .join("\n");
}

describe("no generated OpenAPI document mints one component name twice (F-026, the class)", () => {
  it("node: every Hono deployable in the corpus publishes each request component once", async () => {
    const { node, generated, nodeReached } = await sweepCorpus();

    // DENOMINATOR FLOOR. A census whose population silently collapsed to zero
    // reports "no offenders" and reads as a pass — `experience_gathered.md`
    // §59/§63's shape, a check that never reaches the thing it names. These are
    // floors, not equalities, so the corpus can grow freely.
    expect(generated, "the corpus stopped generating — this census is vacuous").toBeGreaterThan(
      200,
    );
    expect(nodeReached, "no Hono deployable published a request component").toBeGreaterThan(100);

    expect(
      render(node),
      "two request components share one registry key, so the document describes one of " +
        "them with the other's body (F-026's class)",
    ).toBe("");
  }, 600_000);

  it("java: every Spring Boot deployable publishes each request component once", async () => {
    const { java, javaReached } = await sweepCorpus();

    expect(javaReached, "no java deployable emitted a request record").toBeGreaterThan(10);

    expect(
      render(java),
      "two request records publish under one springdoc component name, so one endpoint's " +
        "body documents the other's (F-026's class)",
    ).toBe("");
  }, 600_000);

  // NON-VACUITY, asserted against the exact shape the finding was about.
  //
  // Both cases above would stay green if the extractors silently matched
  // nothing, or if the corpus happened to contain no model with an operation
  // beside a same-named workflow. This anchors them: the collision shape must be
  // reachable, the extractor must see both halves of it, and the resolved names
  // must differ. If someone reverts the minter, THIS fails even if the corpus
  // sweep somehow does not.
  it("the collision shape is reachable and both halves are seen (else the sweep is vacuous)", async () => {
    const colliding = `system Probe {
  subdomain Ops {
    context Work {
      aggregate WorkOrder with crudish {
        title: string
        scheduled: bool
        operation schedule(at: string) { this.scheduled := true }
      }
      repository WorkOrders for WorkOrder { }
      workflow scheduleWorkOrder {
        create(note: string) { let w = WorkOrder.create({ title: note, scheduled: false }) }
      }
    }
  }
  storage p { type: postgres }
  resource r { for: Work, kind: state, use: p }
  deployable api { platform: node, contexts: [Work], dataSources: [r], port: 3000 }
}`;
    const files = await generateSystemFiles(colliding);
    const published = honoPublishedComponents(files);
    const names = published.map((p) => p.name);

    // The two halves the two rules mint — owner-qualified by the shared minter.
    expect(names).toContain("WorkOrdersScheduleWorkOrderRequest");
    expect(names).toContain("WorkflowsScheduleWorkOrderRequest");
    // And the short name they used to collide on is gone, not merely joined.
    expect(names).not.toContain("ScheduleWorkOrderRequest");
    expect(conflictingPublishedNames(published).size).toBe(0);
  }, 120_000);

  // The duplicate detector must be able to FAIL. A predicate that always returns
  // "clean" would make every case above green regardless of the emitters.
  it("the conflict detector fires on differing shapes and stays quiet on identical ones", () => {
    // Differing shapes under one name — the defect.
    const conflicts = conflictingPublishedNames([
      { name: "ScheduleWorkOrderRequest", file: "api/http/workOrder.routes.ts", shape: "{ at }" },
      { name: "ScheduleWorkOrderRequest", file: "api/http/workflows.ts", shape: "{ note }" },
      { name: "CreateWorkOrderRequest", file: "api/http/workOrder.routes.ts", shape: "{ title }" },
    ]);
    expect([...conflicts.keys()]).toEqual(["ScheduleWorkOrderRequest"]);

    // The SAME shape under one name, reached from two files — a shared value
    // object or enum. Legitimate, and the reason this detector compares shapes
    // rather than counting registrations.
    expect(
      conflictingPublishedNames([
        { name: "Money", file: "api/http/order.routes.ts", shape: "{ amount, currency }" },
        { name: "Money", file: "api/http/product.routes.ts", shape: "{ amount, currency }" },
      ]).size,
    ).toBe(0);
  });
});
