// The Phoenix domain-service cross-context branch — §18's `raise "domain
// service '…': cross-context reading not yet supported"`.
//
// That `raise` was not a codegen failure.  It was emitted INTO the generated
// Elixir, as the whole body of a real `def`: the project compiles under
// `mix compile --warnings-as-errors`, ships, and dies on the first call, with
// a message no `loom.*` code indexes.  The worst shape a gap can take.
//
// It is also STRUCTURALLY UNREACHABLE, and the two facts are asserted
// separately because the second is what licenses replacing it with a
// generate-time floor:
//
//   1. `readingIsSingleContext` is a TAUTOLOGY on any lowered model.  A read
//      port comes from a `repo-read` Call, and `lowerDomainService` builds its
//      `serviceRepos` index from `env.ctx?.members` alone — so a port can never
//      name a repository outside the service's own context.  Asserted by
//      driving a two-context model that WANTS to cross the boundary and
//      checking every service operation's ports.
//   2. The body that motivated the branch — a service reading another
//      context's repository — is refused at phase ⑦ by
//      `loom.domain-service-cross-context-read`, so it never reaches an
//      emitter at all.
//
// If lowering ever widens its resolution scope, (1) starts failing here rather
// than silently re-arming a runtime landmine.

import { describe, expect, it } from "vitest";
import { readingIsSingleContext } from "../../../src/generator/elixir/domain-service-emit.js";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { allContexts } from "../../../src/ir/types/loom-ir.js";
import { readPortsForOperation } from "../../../src/ir/util/domain-service-read-ports.js";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { parseString } from "../../_helpers/parse.js";

// Two contexts.  `Naming` lives in `Ops` and reaches for `Customers`, which
// only `Sales` declares — the exact shape the removed branch was written for.
const CROSSING = `
system X {
  subdomain S {
    context Sales {
      aggregate Customer { name: string }
      repository Customers for Customer { }
    }
    context Ops {
      aggregate Job { title: string }
      repository Jobs for Job { }
      domainService Naming {
        operation isFree(r: string): bool { return Customers.byName(r) == null }
      }
    }
  }
  api XApi from S
  storage pg { type: postgres }
  resource st { for: Ops, kind: state, use: pg }
  resource st2 { for: Sales, kind: state, use: pg }
  deployable api { platform: elixir, contexts: [Ops, Sales], dataSources: [st, st2], serves: XApi, port: 4000 }
}`;

// The same service reading its OWN context's repository — the shape that works,
// and the control that keeps the tautology check from passing vacuously on a
// model with no read ports at all.
const LOCAL = CROSSING.replace("Customers.byName(r)", "Jobs.byTitle(r)").replace(
  "repository Jobs for Job { }",
  "repository Jobs for Job { find byTitle(t: string): Job? where title == t }",
);

async function ir(source: string) {
  const { model, doc } = await parseString(source, { validate: false });
  expect(
    (doc.parseResult.parserErrors ?? []).map((e) => e.message),
    "fixture parses",
  ).toEqual([]);
  return enrichLoomModel(lowerModel(model));
}

describe("the elixir cross-context reading branch is structurally dead", () => {
  it("no domain-service read port ever names a foreign repository", async () => {
    let portsSeen = 0;
    for (const source of [CROSSING, LOCAL]) {
      const loom = await ir(source);
      for (const ctx of allContexts(loom)) {
        for (const svc of ctx.domainServices) {
          for (const op of svc.operations) {
            portsSeen += readPortsForOperation(op).length;
            expect(
              readingIsSingleContext(op, ctx),
              `'${svc.name}.${op.name}' produced a read port outside context '${ctx.name}' — ` +
                "lowering has widened its resolution scope, so the emitter's generate-time " +
                "floor is now REACHABLE and needs a real emission (or a gate) instead",
            ).toBe(true);
          }
        }
      }
    }
    // Vacuity guard: the tautology is only meaningful if at least one operation
    // actually produced a port for it to be true of.
    expect(portsSeen, "no read ports at all — the check proved nothing").toBeGreaterThan(0);
  });

  it("and the body that wanted it is refused at phase ⑦", async () => {
    const loom = await ir(CROSSING);
    const codes = validateLoomModel(loom)
      .filter((d) => d.severity === "error")
      .map((d) => d.code);
    expect(codes).toContain("loom.domain-service-cross-context-read");
  });

  it("while the same service reading its OWN repository is admitted", async () => {
    const loom = await ir(LOCAL);
    const codes = validateLoomModel(loom)
      .filter((d) => d.severity === "error")
      .map((d) => d.code);
    expect(codes).not.toContain("loom.domain-service-cross-context-read");
  });
});
