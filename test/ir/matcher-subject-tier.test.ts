import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { createDddServices } from "../../src/language/ddd-module.js";
import type { Model } from "../../src/language/generated/ast.js";

// ---------------------------------------------------------------------------
// The two matcher-SUBJECT refusals that need the fully-resolved IR, because
// each has to read the asserted expression's resolved TYPE — which the AST
// validator does not have.  (Tier legality, which needs only the enclosing
// block, is checked one phase earlier in
// `test/language/validation/absence-matcher-tiers.test.ts`.)
//
//   * `loom.contain-receiver-invalid` — `toContain` has exactly TWO lowerings,
//     picked by the subject: membership for a collection, substring for a
//     string.  There is no third one, so any other subject must be refused
//     HERE or each backend invents its own answer — python would emit
//     `assert 3 in 7` (a TypeError at run time), java a `.contains` that does
//     not compile, elixir a call that raises.  One refusal at the author's own
//     span replaces five different downstream failures.
//
//   * `loom.absent-receiver-invalid` — `toBeAbsent()` rewrites its assertion
//     onto the RECEIVER (`"estimate" in read`), so it needs an object and a
//     key.  A subject that names no key would reach `renderExpectStmt`'s
//     compiler-invariant throw and kill `generate system` with a stack trace
//     instead of a message — the shape audit 2026-09-03 F6 found for locator
//     matchers: validates clean, then crashes the compiler.
// ---------------------------------------------------------------------------

async function codesFor(src: string): Promise<string[]> {
  const services = createDddServices(NodeFileSystem);
  const doc = await parseHelper<Model>(services.Ddd)(src, { validation: true });
  const diags = validateLoomModel(enrichLoomModel(lowerModel(doc.parseResult.value)));
  // `LoomDiagnostic.code` is optional, so narrow rather than declaring
  // `string[]` over a `(string | undefined)[]` — the `test/` typecheck ratchet
  // counts that as a new type error, and it only ever shrinks.
  return diags.flatMap((d) => (d.code === undefined ? [] : [d.code]));
}

const system = (opts: { unitBody?: string; e2eTest?: string }): string => `
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

  api TicketApi from D
  storage primary { type: postgres }
  resource cState { for: C, kind: state, use: primary }

  deployable api { platform: node, contexts: [C], dataSources: [cState], serves: TicketApi, port: 3000 }
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
}`;

describe("toContain — the subject's type picks the lowering, or there isn't one", () => {
  it("accepts a collection subject and a string subject", async () => {
    const codes = await codesFor(
      system({
        unitBody: `          expect(t.tags).toContain("urgent")\n          expect(t.title).toContain("Ship")`,
      }),
    );
    expect(codes).not.toContain("loom.contain-receiver-invalid");
  });

  it("refuses a subject that is neither", async () => {
    // `int?` unwraps to `int` — a scalar, with no membership and no substring.
    expect(
      await codesFor(system({ unitBody: `          expect(t.estimate).toContain("nope")` })),
    ).toContain("loom.contain-receiver-invalid");
  });

  it("sees through `.not.` to the real subject", async () => {
    // `receiverType` on a negated matcher is the synthetic `.not` member, not
    // the value under test — so a naive read would type the subject wrong and
    // the gate would pass (or fail) for the wrong reason.
    expect(
      await codesFor(system({ unitBody: `          expect(t.estimate).not.toContain("nope")` })),
    ).toContain("loom.contain-receiver-invalid");
    expect(
      await codesFor(system({ unitBody: `          expect(t.tags).not.toContain("urgent")` })),
    ).not.toContain("loom.contain-receiver-invalid");
  });
});

describe("toBeAbsent — the subject has to name a key", () => {
  it("accepts a field read", async () => {
    expect(
      await codesFor(system({ e2eTest: `    expect(read.estimate).toBeAbsent()` })),
    ).not.toContain("loom.absent-receiver-invalid");
  });

  it("refuses a bare let-bound name, which names no key", async () => {
    expect(await codesFor(system({ e2eTest: `    expect(t).toBeAbsent()` }))).toContain(
      "loom.absent-receiver-invalid",
    );
  });
});
