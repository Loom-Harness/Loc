import { describe, expect, it } from "vitest";
import type { EnrichedLoomModel, TestOutcome } from "../../src/ir/types/loom-ir.js";
import { fromVitestReport } from "../../src/verify/from-vitest.js";
import { computeVerification } from "../../src/verify/verification.js";
import { buildLoomModel as build } from "../_helpers/index.js";

// ---------------------------------------------------------------------------
// The reported-title → declared-test join (F8).
//
// `ddd verify` matched the declared DSL name exactly, but two emitters
// deliberately report a DIFFERENT title:
//
//   • `src/system/e2e-render.ts` replays one `test e2e` block against every
//     compatible backend deployable and suffixes the vitest title with
//     ` against <serviceSlug>` (so a multi-backend failure names the
//     diverging backend).  The declared name therefore NEVER appears
//     verbatim in an api-e2e report — so every `verifies` on a `test e2e`
//     block was dead: the test passed, the requirement stayed UNVERIFIED,
//     and the gate exited 1 on "no matching result".
//   • the generated `.ui.spec.ts` carries no `describe`, so Playwright
//     reports the SPEC FILE as the top-level suite while `collectExecTests`
//     recorded `"<System> e2e"`.
//
// Both are undone on the RESULT side; the emitters keep their titles.  The
// negative cases below are the point of the suite: normalization must not
// become a loose prefix match that invents an attribution.
// ---------------------------------------------------------------------------

/** One requirement, one testCase, one passing e2e test — the smallest model
 *  that shows the join. */
const API = `
  requirement R-001 { type: UserStory  title: "A widget can be created" }

  system VerifyProbe {
    subdomain Core { context Core {
      aggregate Widget { operation touch() {} }
    } }
    deployable api { platform: node  contexts: [Core] }
    test e2e "creates a widget" against api verifies TC-001 {}
  }

  testCase TC-001 verifies R-001 { covers [ Core.Core.Widget.touch ] }
`;

function verify(loom: EnrichedLoomModel, results: TestOutcome[], serviceSlugs?: readonly string[]) {
  return computeVerification(
    loom.traceability!,
    loom.requirements.map((r) => r.id),
    results,
    serviceSlugs ? { serviceSlugs } : undefined,
  );
}

describe("api-e2e replay-suffix normalization", () => {
  it("the emitter really does suffix the title it reports", async () => {
    // Pins the premise of the whole suite against `e2e-render.ts`: if the
    // suffix ever stops being emitted, this fails rather than leaving the
    // normalization below silently testing nothing.
    const loom = await build(API);
    const ref = loom.traceability!.execTests.find((t) => t.kind === "api")!;
    expect(ref).toMatchObject({ name: "creates a widget", suite: "VerifyProbe e2e", kind: "api" });
    // `serviceSlug("api")` === "api", so the reported title is:
    expect(`${ref.name} against api`).toBe("creates a widget against api");
  });

  it("`<declared name> against <slug>` attributes to the declared test", async () => {
    const loom = await build(API);
    const v = verify(
      loom,
      [{ name: "creates a widget against api", suite: "VerifyProbe e2e", status: "pass" }],
      ["api"],
    );
    expect(v.testCases["TC-001"].status).toBe("VERIFIED");
    expect(v.requirements["R-001"].verdict).toBe("VERIFIED");
    expect(v.diagnostics.unknownTests).toEqual([]);
    // The declared name is what the backing list reports, not the replay title.
    expect(v.testCases["TC-001"].backing).toEqual([{ name: "creates a widget", status: "pass" }]);
  });

  it("carries the FAIL through the suffix too, not just the pass", async () => {
    const loom = await build(API);
    const v = verify(
      loom,
      [{ name: "creates a widget against api", suite: "VerifyProbe e2e", status: "fail" }],
      ["api"],
    );
    expect(v.testCases["TC-001"].status).toBe("FAILING");
    expect(v.requirements["R-001"].verdict).toBe("FAILING");
  });

  it("still joins the declared name verbatim (a hand-written results file)", async () => {
    const loom = await build(API);
    const v = verify(
      loom,
      [{ name: "creates a widget", suite: "VerifyProbe e2e", status: "pass" }],
      ["api"],
    );
    expect(v.requirements["R-001"].verdict).toBe("VERIFIED");
  });

  it("normalizes without a slug set too (the playground has no deployable list)", async () => {
    const loom = await build(API);
    const v = verify(loom, [
      { name: "creates a widget against api", suite: "VerifyProbe e2e", status: "pass" },
    ]);
    expect(v.requirements["R-001"].verdict).toBe("VERIFIED");
  });

  it("joins a real `--from-vitest` report, the primary CI surface", async () => {
    // `ddd verify --from-vitest` is how the generated project's own suite
    // reaches the gate, so pin the whole path — reporter document in,
    // verdict out — not just the join in isolation.  The titles here are
    // exactly what `describe("VerifyProbe e2e") { it("… against api") }`
    // produces in a vitest `--reporter=json` document.
    const loom = await build(API);
    const outcomes = fromVitestReport({
      testResults: [
        {
          name: "/gen/e2e/VerifyProbe.e2e.test.ts",
          assertionResults: [
            {
              ancestorTitles: ["VerifyProbe e2e"],
              title: "creates a widget against api",
              fullName: "VerifyProbe e2e > creates a widget against api",
              status: "passed",
            },
          ],
        },
      ],
    });
    expect(outcomes).toEqual([
      { name: "creates a widget against api", suite: "VerifyProbe e2e", status: "pass" },
    ]);
    const v = verify(loom, outcomes, ["api"]);
    expect(v.requirements["R-001"].verdict).toBe("VERIFIED");
    expect(v.diagnostics.unknownTests).toEqual([]);
  });

  it("attributes one replay per compatible backend to the same declared test", async () => {
    // Two backend deployables over the same context: `e2e-render.ts` emits
    // one `it(...)` per backend, so one declared test gets TWO results.
    const loom = await build(`
      requirement R-001 { type: UserStory  title: "A widget can be created" }
      system VerifyProbe {
        subdomain Core { context Core {
          aggregate Widget { operation touch() {} }
        } }
        deployable honoApi   { platform: node    contexts: [Core] }
        deployable dotnetApi { platform: dotnet  contexts: [Core] }
        test e2e "creates a widget" against honoApi verifies TC-001 {}
      }
      testCase TC-001 verifies R-001 { covers [ Core.Core.Widget.touch ] }
    `);
    const slugs = ["hono_api", "dotnet_api"];
    // Both green → VERIFIED.
    expect(
      verify(
        loom,
        [
          { name: "creates a widget against hono_api", suite: "VerifyProbe e2e", status: "pass" },
          { name: "creates a widget against dotnet_api", suite: "VerifyProbe e2e", status: "pass" },
        ],
        slugs,
      ).requirements["R-001"].verdict,
    ).toBe("VERIFIED");
    // One backend diverges → the worst outcome wins, which is the entire
    // point of replaying the block per backend.
    expect(
      verify(
        loom,
        [
          { name: "creates a widget against hono_api", suite: "VerifyProbe e2e", status: "pass" },
          { name: "creates a widget against dotnet_api", suite: "VerifyProbe e2e", status: "fail" },
        ],
        slugs,
      ).requirements["R-001"].verdict,
    ).toBe("FAILING");
  });
});

describe("api-e2e replay-suffix normalization — what it must NOT match", () => {
  it("a result whose name matches nothing is still reported as unmatched", async () => {
    // THE negative case: normalization must not turn an unknown result into
    // an attribution.  "creates a widgit" is a typo — no declared test has
    // that name, with or without the suffix.
    const loom = await build(API);
    const v = verify(
      loom,
      [{ name: "creates a widgit against api", suite: "VerifyProbe e2e", status: "pass" }],
      ["api"],
    );
    expect(v.diagnostics.unknownTests.map((r) => r.name)).toEqual(["creates a widgit against api"]);
    expect(v.testCases["TC-001"].status).toBe("UNVERIFIED");
    expect(v.testCases["TC-001"].backing).toEqual([
      { name: "creates a widget", status: "missing" },
    ]);
    expect(v.requirements["R-001"].verdict).toBe("UNVERIFIED");
  });

  it("does not strip a suffix whose slug is not a deployable of the model", async () => {
    // Supplying the slug set closes the suffix set: ` against nosuchbackend`
    // is not a replay this model can produce, so the result stays unknown
    // rather than crediting the declared test.
    const loom = await build(API);
    const v = verify(
      loom,
      [
        {
          name: "creates a widget against nosuchbackend",
          suite: "VerifyProbe e2e",
          status: "pass",
        },
      ],
      ["api"],
    );
    expect(v.diagnostics.unknownTests).toHaveLength(1);
    expect(v.requirements["R-001"].verdict).toBe("UNVERIFIED");
  });

  it("does not strip a remainder that is not a single slug token", async () => {
    // Without a slug set the suffix is bounded by SHAPE — one
    // `[a-z0-9](_[a-z0-9])*` token, which is all `serviceSlug()` can emit.
    // A sentence after ` against ` is prose, not a replay suffix.
    const loom = await build(API);
    const v = verify(loom, [
      { name: "creates a widget against the odds", suite: "VerifyProbe e2e", status: "pass" },
    ]);
    expect(v.diagnostics.unknownTests).toHaveLength(1);
    expect(v.requirements["R-001"].verdict).toBe("UNVERIFIED");
  });

  it("never attributes one result to two different declared tests", async () => {
    // The adversarial model: one declared name is another's name plus a
    // replay suffix.  A single reported title must feed exactly ONE of them
    // — the verbatim declared name wins — so the other stays UNVERIFIED
    // instead of both going green off one run.
    const loom = await build(`
      requirement R1 { type: UserStory  title: "a" }
      requirement R2 { type: UserStory  title: "b" }
      system VerifyProbe {
        subdomain Core { context Core {
          aggregate Widget { operation touch() {} }
        } }
        deployable api { platform: node  contexts: [Core] }
        test e2e "creates a widget" against api verifies T1 {}
        test e2e "creates a widget against api" against api verifies T2 {}
      }
      testCase T1 verifies R1 { covers [ Core.Core.Widget.touch ] }
      testCase T2 verifies R2 { covers [ Core.Core.Widget.touch ] }
    `);
    const v = verify(
      loom,
      [{ name: "creates a widget against api", suite: "VerifyProbe e2e", status: "pass" }],
      ["api"],
    );
    const verified = ["T1", "T2"].filter((id) => v.testCases[id].status === "VERIFIED");
    expect(verified).toHaveLength(1);
    expect(v.summary.verified).toBe(1);
  });

  it("does not suffix-strip a unit test's title", async () => {
    // Only an api-e2e emitter appends the suffix.  A unit test called
    // "x against api" is reported verbatim, and must not be read as a
    // replay of a (non-existent) declared "x".
    const loom = await build(`
      requirement R-001 { type: UserStory  title: "a" }
      system VerifyProbe {
        subdomain Core { context Core {
          aggregate Widget {
            operation touch() {}
            test "compares against api" verifies TC-001 {}
          }
        } }
        deployable api { platform: node  contexts: [Core] }
      }
      testCase TC-001 verifies R-001 { covers [ Core.Core.Widget.touch ] }
    `);
    const v = verify(
      loom,
      [{ name: "compares against api", suite: "Widget", status: "pass" }],
      ["api"],
    );
    expect(v.requirements["R-001"].verdict).toBe("VERIFIED");
    expect(v.diagnostics.unknownTests).toEqual([]);
  });
});

describe("ui-e2e spec-file suite normalization", () => {
  const UI = `
    requirement R-001 { type: UserStory  title: "A widget can be created in the UI" }

    system VerifyProbe {
      subdomain Core { context Core {
        aggregate Widget { operation touch() {} }
      } }
      ui WebApp with scaffold(subdomains: [Core]) {}
      deployable api    { platform: node   contexts: [Core] }
      deployable webApp { platform: react  targets: api  ui: WebApp }
      test e2e "creates a widget in the UI" against webApp verifies TC-001 {}
    }

    testCase TC-001 verifies R-001 { covers [ Core.Core.Widget.touch ] }
  `;

  it("a Playwright result whose suite is the spec FILE joins", async () => {
    // `collectExecTests` records suite `"VerifyProbe e2e"`, but the emitted
    // `.ui.spec.ts` has no `describe`, so Playwright's top-level suite title
    // is the spec file.  Both spellings a reporter can produce must join.
    const loom = await build(UI);
    const ref = loom.traceability!.execTests.find((t) => t.kind === "ui")!;
    expect(ref).toMatchObject({ suite: "VerifyProbe e2e", kind: "ui" });

    for (const suite of ["VerifyProbe.ui.spec.ts", "e2e/VerifyProbe.ui.spec.ts"]) {
      const v = verify(
        loom,
        [{ name: "creates a widget in the UI", suite, status: "pass" }],
        ["api", "web_app"],
      );
      expect(v.requirements["R-001"].verdict, `suite ${suite}`).toBe("VERIFIED");
      expect(v.diagnostics.unknownTests, `suite ${suite}`).toEqual([]);
    }
  });

  it("a ui title is NOT suffix-stripped — the ui emitter appends nothing", async () => {
    const loom = await build(UI);
    const v = verify(
      loom,
      [
        {
          name: "creates a widget in the UI against web_app",
          suite: "VerifyProbe.ui.spec.ts",
          status: "pass",
        },
      ],
      ["api", "web_app"],
    );
    expect(v.diagnostics.unknownTests).toHaveLength(1);
    expect(v.requirements["R-001"].verdict).toBe("UNVERIFIED");
  });

  it("an unrelated spec file's suite does not join", async () => {
    const loom = await build(UI);
    const v = verify(
      loom,
      [{ name: "creates a widget in the UI", suite: "SomethingElse.ui.spec.ts", status: "pass" }],
      ["api", "web_app"],
    );
    expect(v.diagnostics.unknownTests).toHaveLength(1);
    expect(v.requirements["R-001"].verdict).toBe("UNVERIFIED");
  });
});
