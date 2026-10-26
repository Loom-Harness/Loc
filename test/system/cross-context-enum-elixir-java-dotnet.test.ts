// Claims-eval D1 (elixir / java / .NET half): a field typed by an enum declared
// in a SIBLING context (`Clm.kind: Kind`, `Kind` declared in context `A`) is a
// legal, linked reference, but these emitters resolved the name against the
// context's OWN `ctx.enums` and silently degraded:
//
//   elixir  `field :kind, :string` instead of `Ecto.Enum` (aggregate schema AND
//           saga-state schema), and the saga allocation zeroed the required
//           state field to `nil` (NOT NULL violation on the first event)
//   java    the saga allocation zeroed the state field to `null`
//   .NET    the unit-test file dropped `using …Domain.Enums` (CS0246)
//
// and, under all of them, LOWERING left a bare sibling enum VALUE (`kind: Fire`
// in a test / seed row) as an unresolved name, so every backend emitted the bare
// identifier (`Clm.Create(kind: Fire, …)`: CS0103).
//
// The invariant pinned here: the sibling placement emits what the own-context
// placement emits.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string): string => `
system R {
  subdomain S {
    context A {
      enum Kind { Fire, Theft }
      aggregate Pol with crudish { name: string derived display: string = name }
      repository Pols for Pol { }
    }
    context B {
      aggregate Clm with crudish {
        kind: Kind
        title: string
        derived display: string = title
        test "pos" { let c = Clm.create(kind: Fire, title: "abc")  expect(c.kind).toBe(Fire) }
      }
      repository Clms for Clm { find byKind(k: Kind): Clm? where this.kind == k }
      event Opened { clm: Clm id, title: string }
      workflow Track {
        clm: Clm id
        kind: Kind
        n: int
        create(e: Opened) by e.clm { n := 1 }
        on(e: Opened) by e.clm { n := n + 1 }
      }
      seed default {
        Clm { kind: Theft, title: "seeded" }
      }
    }
  }
  storage primary { type: postgres }
  resource a { for: A, kind: state, use: primary }
  resource b { for: B, kind: state, use: primary }
  deployable api { platform: ${platform}, contexts: [A, B], dataSources: [a, b], port: 3000 }
}
`;

function bySuffix(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return files.get(key)!;
}

describe("a sibling-context enum resolves on elixir / java / .NET (claims D1)", () => {
  it("elixir: the aggregate schema and the saga-state schema type it as Ecto.Enum", async () => {
    const files = await generateSystemFiles(src("elixir"));
    const schema = bySuffix(files, "lib/api/b/clm.ex");
    expect(schema).toContain("field :kind, Ecto.Enum, values: [:Fire, :Theft]");
    expect(schema).not.toContain("field :kind, :string");
    const state = bySuffix(files, "lib/api/b/workflows/track_state.ex");
    expect(state).toContain("field :kind, Ecto.Enum, values: [:Fire, :Theft]");
  });

  it("elixir: the saga allocation zeroes the enum state field to its first member", async () => {
    const files = await generateSystemFiles(src("elixir"));
    const starter = bySuffix(files, "lib/api/b/workflows/track/start_opened.ex");
    expect(starter).toContain("kind: :Fire");
    expect(starter).not.toContain("kind: nil");
  });

  it("elixir: a seed row's bare sibling value is the enum atom, not an unbound variable", async () => {
    const files = await generateSystemFiles(src("elixir"));
    const seeds = bySuffix(files, "lib/api/b/seeds.ex");
    expect(seeds).toContain("%{kind: :Theft,");
  });

  it("java: the saga-state default is the enum's first constant; the seed qualifies the value", async () => {
    const files = await generateSystemFiles(src("java"));
    const state = bySuffix(files, "/TrackState.java");
    expect(state).toContain("__s.kind = Kind.Fire;");
    const seed = bySuffix(files, "/BSeedRunner.java");
    expect(seed).toContain("Clm.create(Kind.Theft,");
  });

  it(".NET: the unit tests and the seed qualify the bare value and import the enum namespace", async () => {
    const files = await generateSystemFiles(src("dotnet"));
    const tests = bySuffix(files, "/ClmTests.cs");
    expect(tests).toContain("using Api.Domain.Enums;");
    expect(tests).toContain("Clm.Create(kind: Kind.Fire");
    const seed = bySuffix(files, "Infrastructure/Persistence/Seed.cs");
    expect(seed).toContain("using Api.Domain.Enums;");
    expect(seed).toContain("Clm.Create(kind: Kind.Theft");
  });
});
