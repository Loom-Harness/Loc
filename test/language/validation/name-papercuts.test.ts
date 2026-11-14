// Three name-resolution papercuts from the insurance eval:
//
//   1. a user function / operation named `matches` on a record is an ordinary
//      call — the string `matches` intrinsic's checks apply to a string
//      receiver only;
//   2. a channel's `key:` names an event field, so it takes any name a field
//      can have (`provider`, a soft keyword, included);
//   3. `loom.transactional-no-effect` stays silent on a workflow whose body
//      holds a refused statement — its effect is unknowable.

import { describe, expect, it } from "vitest";
import { validate } from "../../../src/api/index.js";

async function codes(src: string): Promise<string[]> {
  const r = await validate(src);
  return r.diagnostics.map((d) => String(d.code ?? d.message));
}

const ctx = (members: string) => `system R { subdomain S { context C {
${members}
} } }`;

describe("`matches` on a non-string receiver is the user's member", () => {
  const model = (call: string) =>
    ctx(`
  enum Kind { Tow, Glass }
  aggregate Rule with crudish {
    kind: Kind
    city: string
    function matches(k: Kind, c: string): bool = kind == k && city == c
  }
  repository Rules for Rule { }
  workflow pick {
    create(rid: Rule id, city: string): bool {
      let r = Rules.get(rid)
      ${call}
    }
  }`);

  it("calls a record's own `matches(…)` with its declared arity", async () => {
    const c = await codes(model("let ok = r.matches(Tow, city)\n      return ok"));
    expect(c.filter((x) => x.startsWith("loom.matches"))).toEqual([]);
    expect(c.filter((x) => x.startsWith("loom.") && x !== "loom.findall-no-page")).toEqual([]);
  });

  it("still applies the intrinsic's arity rule to a string receiver", async () => {
    const c = await codes(model('let ok = city.matches("a", "b")\n      return ok'));
    expect(c).toContain("loom.matches-arity");
  });
});

describe("a channel `key:` takes any event-field name", () => {
  it("accepts a field named like a soft keyword (`provider`)", async () => {
    const c = await codes(
      ctx(`
  aggregate Claim with crudish { city: string }
  event ProviderActivated { provider: Claim id  at: datetime }
  channel X { carries: ProviderActivated  key: provider }`),
    );
    expect(c.filter((x) => x === "loom.parse-error" || /keyword/.test(x))).toEqual([]);
  });
});

describe("`transactional-no-effect` and a refused statement", () => {
  const model = (body: string) =>
    ctx(`
  aggregate Claim with crudish { city: string  n: int  operation bump() { n := n + 1 } }
  repository Claims for Claim { }
  criterion InCity(c: string) of Claim = this.city == c
  workflow sweep transactional {
    create(c: string) {
      ${body}
    }
  }`);

  it("is silent when the body holds a refused statement", async () => {
    const c = await codes(
      model(`let xs = Claims.all(InCity(c))
      for x in xs {
        x.n := 5
      }`),
    );
    expect(c).toContain("loom.workflow-unrecognised-statement");
    expect(c).not.toContain("loom.transactional-no-effect");
  });

  it("still fires on a body that genuinely changes nothing", async () => {
    const c = await codes(model(`precondition c != ""`));
    expect(c).toContain("loom.transactional-no-effect");
  });
});
