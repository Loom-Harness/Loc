// A nullable `X id?` inside an owned value object (single or `VO[]`) must get
// the nullable-aware EF converter, like a root-level `X id?`: the id is a
// `readonly record struct`, so the plain `v.Value` lambda does not bind on
// `Id?`.

import { describe, expect, it } from "vitest";
import { generateDotnet } from "../../_helpers/generate.js";
import { parseValid } from "../../_helpers/parse.js";

const SRC = `
  context Rules {
    aggregate AttributeDefinition { name: string }
    repository AttributeDefinitions for AttributeDefinition { }
    valueobject Condition { attribute: AttributeDefinition id?  label: string }
    valueobject Anchor { attribute: AttributeDefinition id? }
    aggregate RuleSet {
      name: string
      conditions: Condition[]
      anchor: Anchor
    }
    repository RuleSets for RuleSet { }
  }
`;

const OPTIONAL =
  "HasConversion(v => v.HasValue ? v.Value.Value : (Guid?)null, v => v.HasValue ? (AttributeDefinitionId?)new AttributeDefinitionId(v.Value) : (AttributeDefinitionId?)null)";

describe("dotnet generator — optional id inside owned value objects", () => {
  it("uses the nullable-aware converter in OwnsMany and OwnsOne value objects", async () => {
    const model = await parseValid(SRC);
    const cfg = generateDotnet(model).get(
      "Infrastructure/Persistence/Configurations/RuleSetConfiguration.cs",
    )!;
    expect(cfg).toContain(`o.Property(x => x.Attribute).${OPTIONAL}.HasColumnName("attribute");`);
    expect(cfg).toContain(
      `o.Property(x => x.Attribute).${OPTIONAL}.HasColumnName("anchor_attribute");`,
    );
    expect(cfg).not.toContain(
      "o.Property(x => x.Attribute).HasConversion(v => v.Value, v => new AttributeDefinitionId(v))",
    );
  });
});
