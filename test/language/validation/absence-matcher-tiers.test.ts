import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

// ---------------------------------------------------------------------------
// `toBeNull()` / `toBeAbsent()` / `toContain()` — the TIER MATRIX.
//
// Loom has ONE absence value; the wire has TWO spellings of it.  The pair lets
// an author pin a spelling deliberately, which is only coherent where a
// spelling EXISTS — so the two absence matchers are not uniformly legal, and
// the refusals are what keep one name from carrying two strengths of claim
// (the #2959 defect, and the F7 ruling for `toThrow` on the ui side).
//
// Three tiers, three different questions:
//
//   unit `test`          — an in-memory aggregate.  A declared field ALWAYS
//                          exists (C# `int?`, Java `Integer`, an Elixir
//                          struct's nil default have no absent form at all),
//                          so `toBeAbsent()` has no subject: refused
//                          (`loom.unit-absent-invalid`).  `toBeNull()` is the
//                          whole of in-process absence and is legal.
//   api `test e2e`       — a real payload, so BOTH spellings are real and both
//                          are legal.  `toBeAbsent()` has no PASSING subject
//                          today (every backend sends explicit null, RS-35) —
//                          deliberately, so a backend that starts omitting a
//                          key turns a test red.
//   ui  `test e2e`       — rendered text off a Playwright locator, always a
//                          string.  `toBeNull()` can never hold and
//                          `toBeAbsent()` is not a runtime matcher at all, so
//                          both are refused (`loom.e2e-ui-absence-invalid`).
//
// `toContain` is legal in ALL THREE: a substring of rendered text is a real
// claim, so the ui tier keeps it.
//
// The two SUBJECT refusals (`loom.absent-receiver-invalid`,
// `loom.contain-receiver-invalid`) need the fully-resolved IR — they read the
// asserted expression's resolved type — so they live one phase later, in
// `test/ir/matcher-subject-tier.test.ts`.  Same split as
// `throw-kind-matcher.test.ts` / `throw-kind-tier.test.ts`.
// ---------------------------------------------------------------------------

/** One system carrying whichever tier's body the case under test needs. */
const system = (opts: { unitBody?: string; e2eTest?: string; uiTest?: string }): string => `
system Probe {
  subdomain D {
    context C {
      aggregate Ticket with crudish {
        title: string
        estimate: int?
        tags: string[]
${
  opts.unitBody
    ? `
        test "probe" {
          let t = Ticket.create({ title: "Ship it" })
${opts.unitBody}
        }`
    : ""
}
      }
      repository Tickets for Ticket { }
    }
  }

  ui WebApp with scaffold(subdomains: [D]) { }
  api TicketApi from D
  storage primary { type: postgres }
  resource cState { for: C, kind: state, use: primary }

  deployable api { platform: node, contexts: [C], dataSources: [cState], serves: TicketApi, port: 3000 }
  deployable webApp { platform: react, targets: api, ui: WebApp, port: 3001 }
${
  opts.e2eTest
    ? `
  test e2e "wire" against api {
    let t = api.tickets.create({ title: "Ship it" })
    let read = api.tickets.getById(t)
${opts.e2eTest}
  }`
    : ""
}
${
  opts.uiTest
    ? `
  test e2e "screen" against webApp {
    let t = ui.tickets.create({ title: "Ship it" })
    let read = ui.tickets.getById(t)
${opts.uiTest}
  }`
    : ""
}
}`;

const codes = async (src: string): Promise<string[]> => {
  const { diagnostics } = await parseString(src);
  return diagnostics.map((d) => String(d.code ?? ""));
};

describe("the absence pair — tier matrix", () => {
  it("accepts toBeNull() in a unit test, and refuses toBeAbsent() there", async () => {
    const ok = await parseString(system({ unitBody: `          expect(t.estimate).toBeNull()` }));
    expect(ok.errors).toEqual([]);

    // The refusal that matters: in-process there is no key set to ask about,
    // and degrading it to a null check would make it a silent synonym for the
    // matcher above.
    expect(
      await codes(system({ unitBody: `          expect(t.estimate).toBeAbsent()` })),
    ).toContain("loom.unit-absent-invalid");
  });

  it("accepts BOTH spellings in an api e2e body", async () => {
    const { errors } = await parseString(
      system({
        e2eTest: `    expect(read.estimate).toBeNull()\n    expect(read.estimate).toBeAbsent()`,
      }),
    );
    expect(errors).toEqual([]);
  });

  it("refuses BOTH spellings in a ui e2e body", async () => {
    // A ui body asserts rendered text, which is always a string — so one
    // matcher can never hold and the other does not exist at run time.  Same
    // ruling as `loom.e2e-ui-throw-invalid`, for the same reason.
    expect(await codes(system({ uiTest: `    expect(read.title).toBeNull()` }))).toContain(
      "loom.e2e-ui-absence-invalid",
    );
    expect(await codes(system({ uiTest: `    expect(read.title).toBeAbsent()` }))).toContain(
      "loom.e2e-ui-absence-invalid",
    );
  });
});

describe("toContain — legal in every tier, refused on a subject with no lowering", () => {
  it("accepts both receiver kinds in a unit test", async () => {
    const { errors } = await parseString(
      system({
        unitBody: `          expect(t.title).toContain("Ship")\n          expect(t.tags).toContain("urgent")`,
      }),
    );
    expect(errors).toEqual([]);
  });

  it("stays legal in a ui e2e body", async () => {
    // Deliberately NOT swept up by the absence refusal above: a substring of
    // the text the page actually rendered is a real, useful claim.
    const { errors } = await parseString(
      system({ uiTest: `    expect(read.title).toContain("Ship")` }),
    );
    expect(errors).toEqual([]);
  });
});
