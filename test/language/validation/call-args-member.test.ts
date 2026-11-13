// `loom.call-arg-count` / `loom.call-arg-type` for MEMBER calls in EXPRESSION
// position (M-T6.18 gap #2, slice B tail) — `recv.method(args)` where `method`
// is a user function/operation on the receiver type is arity/type-checked via a
// running-receiver-type walk.  Collection ops (`.sum`/`.count` on arrays) and
// scalar intrinsics resolve to no member node, so they're never flagged.

import { describe, expect, it } from "vitest";
import { lspCodes } from "../../_helpers/diagnostics.js";
import { parseString } from "../../_helpers/parse.js";

const sys = (members: string) => `
system Demo {
  subdomain S {
    context C {
      valueobject Coin {
        amount: decimal
        currency: string
        function scaled(f: int): decimal = amount * f
      }
      aggregate Order with crudish {
        price: Coin
        qty: int
        contains lines: Line[]
        entity Line { n: int }
        ${members}
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] port: 3000 }
}`;

async function codes(members: string): Promise<string[]> {
  const { diagnostics } = await parseString(sys(members), { validate: true });
  return lspCodes(diagnostics);
}

const COUNT = "loom.call-arg-count";
const TYPE = "loom.call-arg-type";

describe("expression-position member-call args (M-T6.18 gap #2)", () => {
  it("flags a wrong-typed arg to a VO-function member call", async () => {
    expect(await codes('derived bad: decimal = price.scaled("x")')).toContain(TYPE);
  });

  it("flags a wrong arg count to a member call", async () => {
    expect(await codes("derived bad: decimal = price.scaled()")).toContain(COUNT);
  });

  it("is CLEAN for a correctly-typed member call", async () => {
    const c = await codes("derived ok: decimal = price.scaled(2)");
    expect(c).not.toContain(TYPE);
    expect(c).not.toContain(COUNT);
  });

  it("does not flag a collection op (.sum with a lambda) on an array receiver", async () => {
    const c = await codes("derived total: int = lines.sum(l => l.n)");
    expect(c).not.toContain(TYPE);
    expect(c).not.toContain(COUNT);
  });

  it("flags a wrong-typed member call in a let value inside an operation body", async () => {
    expect(await codes('operation go() { let d = price.scaled("x")  qty := qty }')).toContain(TYPE);
  });
});

// A domain-service call's head names a declaration, not a value, so the
// running-receiver walk had nothing to step into and its arguments went
// unchecked: a `Speciality id[]` reached a `guid[]` param and every typed
// backend failed to compile the call (`List<SpecialityId>` → `List<Guid>`).
describe("domain-service call args", () => {
  const svc = (body: string) => `
system Demo {
  subdomain S {
    context C {
      aggregate Spec with crudish { name: string }
      aggregate Prov with crudish { specs: Spec id[] }
      domainService Scoring {
        operation overlapOf(wanted: guid[], has: guid[]): int { return 1 }
        operation byId(s: Spec id[]): int { return 1 }
        operation f(p: Prov): int { return ${body} }
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] port: 3000 }
}`;
  const svcCodes = async (body: string) =>
    lspCodes((await parseString(svc(body), { validate: true })).diagnostics);

  it("refuses an `X id[]` argument for a `guid[]` param", async () => {
    expect(await svcCodes("Scoring.overlapOf(p.specs, p.specs)")).toContain(TYPE);
  });

  it("is CLEAN when the param declares the id type", async () => {
    const c = await svcCodes("Scoring.byId(p.specs)");
    expect(c).not.toContain(TYPE);
    expect(c).not.toContain(COUNT);
  });

  it("flags a wrong arg count", async () => {
    expect(await svcCodes("Scoring.byId()")).toContain(COUNT);
  });
});
