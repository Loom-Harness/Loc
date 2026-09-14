// ---------------------------------------------------------------------------
// `loom.ui-read-unresolved#unbound` — the FIRST question the `of:` slot has to
// answer, and the one nothing asked.
//
// `checkOfReadResolves` has always answered the second one: "the read names an
// aggregate; does that aggregate expose this operation?"  `resolveOfRead`'s own
// doc claimed every other shape — "a projection read, a workflow-instance read,
// a bare ref" — "has its own gate".  A bare ref did not.
//
// So `QueryView { of: Nonsense }` reported `0 error(s), 0 warning(s)` and
// reached the shared walker's last-resort ref arm, which wrote
// `/* unresolved: Nonsense */ undefined` into the page FIVE times and still
// exited 0.  On a typed client that is `TS18050`; where inference is weaker it
// is a blank region and no report anywhere.
//
// The gate is the POSITIVE form — an `of:` read must match one of the shapes
// the walker's detector recognises — because the negative form is what left
// the hole: every shape nobody enumerated fell through to the emitter's
// fail-open default.  The acceptance cases below are therefore the load-bearing
// half: each is a spelling the walker DOES bind, and a gate that rejected any
// of them would break shipped output.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.ui-read-unresolved";

const wrap = (uiBody: string) => `
system Demo {
  subdomain S {
    context C {
      aggregate Customer { name: string  derived display: string = name }
      repository Customers for Customer { }
      projection CustomerTotals {
        rowCount: int
        from Customer as c
        select rowCount = count()
      }
      workflow onboard { create(name: string) { let c = Customers.findAll() } }
    }
  }
  api A from S
  ui Web {
    framework: react
    api Shop: A
    ${uiBody}
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node  contexts: [C]  dataSources: [st]  serves: A  port: 3000 }
  deployable web { platform: static  targets: api  port: 3001  ui: Web { Shop: api } }
}`;

async function codes(uiBody: string): Promise<string[]> {
  const { model, errors } = await parseString(wrap(uiBody));
  if (errors.length) throw new Error(`unexpected parse/validation errors:\n${errors.join("\n")}`);
  return validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => d.code);
}

const page = (body: string) => `page X { route: "/x"  body: ${body} }`;

describe("loom.ui-read-unresolved#unbound — refusal", () => {
  it("flags a QueryView reading a name that is nothing at all", async () => {
    expect(
      await codes(page(`QueryView { of: Nonsense, data: t => Text { t.rowCount } }`)),
    ).toContain(CODE);
  });

  it("flags the same name on a Chart", async () => {
    expect(
      await codes(page(`Chart { of: Nonsense, x: r => r.day, y: r => r.rowCount }`)),
    ).toContain(CODE);
  });

  it("flags a handle-prefixed name that is neither aggregate nor projection", async () => {
    expect(
      await codes(page(`QueryView { of: Shop.Nonsense, data: t => Text { t.rowCount } }`)),
    ).toContain(CODE);
  });

  it("names the offending read in the message, not just the page", async () => {
    const { model, errors } = await parseString(
      wrap(page(`QueryView { of: Nonsense, data: t => Text { t.rowCount } }`)),
    );
    if (errors.length) throw new Error(errors.join("\n"));
    const d = validateLoomModel(enrichLoomModel(lowerModel(model))).find((x) => x.code === CODE);
    expect(d?.message).toContain("QueryView { of: Nonsense }");
    expect(d?.source).toContain("X");
  });

  it("reports ONE verdict per spelling, however many primitives read it", async () => {
    const body = `Stack {
      QueryView { of: Nonsense, data: t => Text { t.rowCount } },
      Chart { of: Nonsense, x: r => r.day, y: r => r.rowCount }
    }`;
    expect((await codes(page(body))).filter((c) => c === CODE)).toHaveLength(1);
  });
});

describe("loom.ui-read-unresolved#unbound — acceptance (every shape the walker binds)", () => {
  it.each([
    ["bare aggregate read (Pattern D)", `QueryView { of: Customer.all, data: r => Text { "x" } }`],
    [
      "handle-prefixed aggregate read (Pattern A)",
      `QueryView { of: Shop.Customer.all, data: r => Text { "x" } }`,
    ],
    [
      "bare projection read (Pattern I)",
      `QueryView { of: CustomerTotals, data: t => Text { t.rowCount } }`,
    ],
    [
      "handle-prefixed projection read (Pattern H)",
      `QueryView { of: Shop.CustomerTotals, data: t => Text { t.rowCount } }`,
    ],
    [
      "workflow-instance read (Pattern F)",
      `QueryView { of: onboard.instances.all, data: r => Text { "x" } }`,
    ],
  ])("accepts a %s", async (_label, body) => {
    expect(await codes(page(body))).not.toContain(CODE);
  });

  it("accepts an of: bound to an in-scope lambda param, not a declaration", async () => {
    // `rows` resolves through lowering, so its `refKind` is not `unknown` and
    // the detector never has to match it.  A gate that keyed on "is this a
    // declared name?" instead of "did lowering resolve it?" would reject this.
    const body = `QueryView { of: Customer.all, data: rows => QueryView {
      of: rows, data: r => Text { "x" }
    } }`;
    expect(await codes(page(body))).not.toContain(CODE);
  });
});
