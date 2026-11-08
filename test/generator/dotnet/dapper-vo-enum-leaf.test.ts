// Dapper: a criterion comparing a VALUE-OBJECT ENUM LEAF (`this.meta.kind == k`)
// renders real SQL, and no validated predicate leaves a stub body.
//
// Dapper keeps a value object in ONE jsonb column written by System.Text.Json.
// With default options an enum property is written as its ORDINAL, which neither
// an enum literal (`'A'`) nor an enum parameter (bound by name) compares
// against, so `voLeafSql` refused the leaf and the repository caught the
// refusal into `throw new NotImplementedException(...)` — a method that
// compiled, shipped, and threw on its first call.  The value object's enum
// properties now carry a `JsonStringEnumConverter`, the leaf reads
// `meta->>'Kind'` as text, and the catch-to-stub blocks are gone: a predicate
// the queryable gate admits but this adapter cannot render fails generation as
// `loom.query-emission-invalid` instead.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system O {
  subdomain S {
    context C {
      enum Kind { A, B }
      valueobject Meta { kind: Kind  label: string  maybe: Kind?  due: date  ok: bool }
      aggregate Req with crudish { note: string  meta: Meta }
      criterion OfKind(k: Kind) of Req = this.meta.kind == k
      criterion OfKindLit of Req = this.meta.kind == Kind.A
      criterion NotKind(k: Kind) of Req = this.meta.kind != k
      criterion MaybeKind(k: Kind) of Req = this.meta.maybe == k
      criterion DueBy(d: date) of Req = this.meta.due <= d
      criterion IsOk of Req = this.meta.ok
      repository Reqs for Req
      queryHandler C1(k: Kind): int { let m = Reqs.all(OfKind(k)) return m.count }
      queryHandler C2(): int { let m = Reqs.all(OfKindLit) return m.count }
      queryHandler C3(k: Kind): int { let m = Reqs.all(NotKind(k)) return m.count }
      queryHandler C4(k: Kind): int { let m = Reqs.all(MaybeKind(k)) return m.count }
      queryHandler C5(d: date): int { let m = Reqs.all(DueBy(d)) return m.count }
      queryHandler C6(): int { let m = Reqs.all(IsOk) return m.count }
      queryHandler First(k: Kind): string { let r = Reqs.find(OfKind(k))  return r != null ? r.note : "none" }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: dotnet { persistence: dapper } contexts: [C] dataSources: [st] serves: A port: 4000 }
}
`;

async function files(): Promise<Map<string, string>> {
  return generateSystemFiles(SRC);
}

function fileEnding(out: Map<string, string>, suffix: string): string {
  const hit = [...out.entries()].find(([k]) => k.endsWith(suffix));
  expect(hit, `no file ending ${suffix}`).toBeDefined();
  return hit![1];
}

describe("dapper — value-object enum leaf in a predicate", () => {
  it("compares the jsonb leaf as text against a parameter and a literal", async () => {
    const repo = fileEnding(await files(), "Infrastructure/Repositories/ReqRepository.cs");
    expect(repo).toContain("WHERE ((meta->>'Kind') = @k)");
    expect(repo).toContain("WHERE ((meta->>'Kind') = 'A')");
    expect(repo).toContain("WHERE ((meta->>'Kind') <> @k)");
    expect(repo).toContain("WHERE ((meta->>'Maybe') = @k)");
  });

  it("emits no NotImplementedException stub for any validated predicate", async () => {
    const out = await files();
    for (const [path, body] of out) {
      if (!path.endsWith(".cs")) continue;
      expect(body, path).not.toContain("NotImplementedException");
    }
  });

  it("the value object writes its enum leaves as names (non-null and optional)", async () => {
    const vo = fileEnding(await files(), "Domain/ValueObjects/Meta.cs");
    const attr =
      "[System.Text.Json.Serialization.JsonConverter(typeof(System.Text.Json.Serialization.JsonStringEnumConverter<Kind>))]";
    expect(vo).toContain(`${attr}\n    public Kind Kind { get; init; }`);
    expect(vo).toContain(`${attr}\n    public Kind? Maybe { get; init; }`);
    // Non-enum leaves carry no converter.
    expect(vo).toMatch(/\n {4}public string Label \{ get; init; \}/);
    expect(vo.split("JsonStringEnumConverter").length - 1).toBe(2);
  });
});
