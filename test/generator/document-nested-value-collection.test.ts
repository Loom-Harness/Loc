// ---------------------------------------------------------------------------
// A `shape: document` aggregate holding a value-object collection NESTED in a
// value object (`rules: Rule[]` with `Rule { thresholds: Threshold[] }`, and
// `box: RuleBox` with `RuleBox { primary: Rule }`).
//
// A relational aggregate refuses that position
// (`loom.collection-field-unpersisted#nested-in-value-object`) because a value
// object flattens into scalar columns.  A document stores the whole tree as
// one jsonb blob, so the nested array is a JSON array inside it — every
// backend's document (de)serializer must write AND read it at each depth.
// The fixture is the corpus `document` case, whose `test e2e` round-trips it.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";
import type { Backend } from "../fixtures/corpus/backends.js";
import { corpusSourceFor } from "../fixtures/corpus/harness.js";

async function emitted(backend: Backend, suffix: string, persistence?: string): Promise<string> {
  const files = await generateSystemFiles(corpusSourceFor("document", backend, persistence));
  const hits = [...files.keys()].filter((p) => p.endsWith(suffix));
  expect(hits, `one emitted path ending in ${suffix}`).toHaveLength(1);
  return files.get(hits[0]!)!;
}

describe("shape: document — a value-object collection nested in a value object", () => {
  for (const persistence of [undefined, "mikroorm"]) {
    it(`node${persistence ? ` (${persistence})` : ""}: the doc mapper writes and reads the nested array`, async () => {
      const repo = await emitted("node", "db/repositories/policy-repository.ts", persistence);
      expect(repo).toContain("thresholds: x.thresholds.map((x) => ({ minValue: x.minValue }))");
      expect(repo).toContain(
        "thresholds: a.box.primary.thresholds.map((x) => ({ minValue: x.minValue }))",
      );
      expect(repo).toContain(
        "new Rule(x.ruleKey, (x.thresholds ?? []).map((x) => new Threshold(x.minValue)))",
      );
    });
  }

  it("python: the doc mapper writes and reads the nested array", async () => {
    const repo = await emitted("python", "app/db/repositories/policy_repository.py");
    expect(repo).toContain('"thresholds": [{"min_value": x.min_value} for x in x.thresholds]');
    expect(repo).toContain(
      'Threshold(cast(int, cast(dict[str, object], x)["min_value"])) for x in cast(list[object], cast(dict[str, object], x)["thresholds"])',
    );
  });

  for (const persistence of [undefined, "dapper"]) {
    it(`dotnet${persistence ? ` (${persistence})` : ""}: the snapshot carries the value objects whole`, async () => {
      // The snapshot serializes `Rule` itself (System.Text.Json binds its one
      // public constructor), so the nested list rides inside it.
      const rule = await emitted("dotnet", "Domain/ValueObjects/Rule.cs", persistence);
      expect(rule).toContain("public List<Threshold> Thresholds { get; init; }");
      expect(rule).toContain("public Rule(string ruleKey, List<Threshold> thresholds)");
      const snap = await emitted("dotnet", "Domain/Policies/PolicySnapshots.cs", persistence);
      expect(snap).toContain("public List<Rule> Rules { get; init; } = new();");
      expect(snap).toContain("public RuleBox Box { get; init; } = default!;");
    });
  }

  it("java: the Jackson-serialized aggregate holds the nested list in the record", async () => {
    const rule = await emitted("java", "domain/valueobjects/Rule.java");
    expect(rule).toContain("public record Rule(String ruleKey, List<Threshold> thresholds)");
  });

  it("elixir: the embed stores the value objects as maps and the serializer reads the nested array", async () => {
    const schema = await emitted("vanilla", "lib/d/cms/policy.ex");
    expect(schema).toContain("field :rules, {:array, :map}");
    expect(schema).toContain("field :box, :map");
    const controller = await emitted("vanilla", "controllers/policy_controller.ex");
    expect(controller).toContain(
      '"thresholds" => Enum.map(Map.get(record, :thresholds, Map.get(record, "thresholds")) || [], &serialize_threshold/1)',
    );
    // No child-table schema: the arrays live in the embed and the migration
    // creates no `policy_rules` table for one to map.
    const files = await generateSystemFiles(corpusSourceFor("document", "vanilla"));
    expect([...files.keys()].filter((p) => p.endsWith("/policy_rules.ex"))).toEqual([]);
  });
});
