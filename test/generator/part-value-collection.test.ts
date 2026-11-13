// ---------------------------------------------------------------------------
// A value-object collection on an ENTITY PART (`Rule.conditions: Cond[]`).
//
// The shared migration gives the part's list its own id-less child table,
// `rule_conditions` (FK `rule_id`, keyed by ordinal).  Every child-table
// adapter reads and writes that table — none maps a `conditions` column on the
// part row, which the migration never creates.  On a `shape: document`
// aggregate the list lives inside the part's entry in the jsonb blob instead.
// The fixtures are the corpus `part-value-collection` cases, whose `test e2e`
// round-trips the list on every backend's behavioural leg.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";
import type { Backend } from "../fixtures/corpus/backends.js";
import { corpusSourceFor } from "../fixtures/corpus/harness.js";

async function emitted(
  feature: string,
  backend: Backend,
  suffix: string,
  persistence?: string,
): Promise<string> {
  const files = await generateSystemFiles(corpusSourceFor(feature, backend, persistence));
  const hits = [...files.keys()].filter((p) => p.endsWith(suffix));
  expect(hits, `one emitted path ending in ${suffix}`).toHaveLength(1);
  return files.get(hits[0]!)!;
}

const RELATIONAL = "part-value-collection";
const DOCUMENT = "part-value-collection-document";

describe("a part's value-object collection — the part's child table", () => {
  it("node drizzle loads it per part row and replaces it under each part on save", async () => {
    const repo = await emitted(RELATIONAL, "node", "db/repositories/ruleSet-repository.ts");
    expect(repo).toContain(
      "const ruleConditionsRows = await tx.select().from(schema.ruleConditions).where(inArray(schema.ruleConditions.parentId, rulesRows.map((r) => r.id))).orderBy(schema.ruleConditions.ordinal);",
    );
    expect(repo).toContain("conditions: ruleConditionsByPart.get(r.id) ?? []");
    expect(repo).toContain(
      "await tx.delete(schema.ruleConditions).where(eq(schema.ruleConditions.parentId, child.id));",
    );
    expect(repo).toContain(
      "await tx.insert(schema.ruleConditions).values({ parentId: child.id as string, ordinal: i, attr: e.attr, min: e.min });",
    );
    // The part row itself carries no `conditions` column.
    expect(repo).not.toContain("conditions: child.conditions");
  });

  it("python loads it in the part hydrate and replaces it under each part on save", async () => {
    const repo = await emitted(RELATIONAL, "python", "db/repositories/rule_set_repository.py");
    expect(repo).toContain("async def _hydrate_rule(self, row: RuleRow) -> Rule:");
    expect(repo).toContain(".where(RuleConditionsRow.rule_id == row.id)");
    expect(repo).toContain("conditions=[Cond(__r.attr, __r.min) for __r in conditions_rows],");
    expect(repo).toContain(
      "delete(RuleConditionsRow).where(RuleConditionsRow.rule_id == child.id)",
    );
    expect(repo).toContain(
      "for __i_rule_conditions, __e_rule_conditions in enumerate(child.conditions or []):",
    );
  });

  it(".NET EF maps it as an owned collection over the part's child table", async () => {
    const cfg = await emitted(RELATIONAL, "dotnet", "Configurations/RuleSetConfiguration.cs");
    expect(cfg).toContain("o.OwnsMany<Cond>(x => x.Conditions, ov => {");
    expect(cfg).toContain('ov.ToTable("rule_conditions", "matching");');
    expect(cfg).toContain('ov.WithOwner().HasForeignKey("rule_id");');
    expect(cfg).toContain('ov.HasKey("rule_id", "ordinal");');
    expect(cfg).not.toContain('HasColumnName("conditions")');
    // The ordinal generator the owned collection's key needs is emitted even
    // though no aggregate ROOT holds a value-object array.
    await emitted(RELATIONAL, "dotnet", "OwnedCollectionOrdinalGenerator.cs");
  });

  it("elixir has_many's a child schema the part changeset casts with ordinals", async () => {
    const part = await emitted(RELATIONAL, "vanilla", "matching/rule.ex");
    expect(part).toContain(
      "has_many :conditions, D.Matching.RuleConditions, foreign_key: :rule_id, on_replace: :delete, preload_order: [asc: :ordinal]",
    );
    expect(part).toContain("attrs = __stamp_ordinals(attrs, [:conditions])");
    expect(part).toContain("|> cast(attrs, [:key])");
    expect(part).toContain(
      "|> cast_assoc(:conditions, with: &D.Matching.RuleConditions.changeset/2)",
    );
    const child = await emitted(RELATIONAL, "vanilla", "matching/rule_conditions.ex");
    expect(child).toContain(
      "belongs_to :rule, D.Matching.Rule, foreign_key: :rule_id, type: :binary_id",
    );
    const repo = await emitted(RELATIONAL, "vanilla", "matching/rule_set_repository.ex");
    expect(repo).toContain("Repo.preload([rules: :conditions])");
    const context = await emitted(RELATIONAL, "vanilla", "lib/d/matching.ex");
    expect(context).toContain(
      "defp __put_assoc_field(D.Matching.Rule, :conditions, v), do: __put_value_rows(v, D.Matching.Rule, :conditions)",
    );
  });

  it("java maps it as an element collection over the part's child table", async () => {
    const part = await emitted(RELATIONAL, "java", "features/rulesets/Rule.java");
    expect(part).toContain(
      '@CollectionTable(name = "rule_conditions", schema = "matching", joinColumns = @JoinColumn(name = "rule_id"))',
    );
  });
});

describe("a part's value-object collection on a `shape: document` aggregate", () => {
  it("elixir's part embed declares the list it casts", async () => {
    const part = await emitted(DOCUMENT, "vanilla", "matching/rule.ex");
    expect(part).toContain("embedded_schema do");
    expect(part).toContain("    field :conditions, {:array, :map}");
    expect(part).toContain("|> cast(attrs, [:key, :conditions])");
  });
});
