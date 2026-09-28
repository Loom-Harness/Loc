import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// F-014 (S1) — an enum COLLECTION field (`skills: Skill[]`) must emit a VALID
// Ecto field declaration.
//
// `Ecto.Enum` carries its `values:` as an OPTION OF `field/3`, never as a third
// element of the type tuple.  The emitter used to fuse the two into one string
// ("Ecto.Enum, values: [...]"), so wrapping it for a collection produced
//
//     field :skills, {:array, Ecto.Enum, values: [:Electrical, :Plumbing, :HVAC]}
//
// which Ecto rejects at COMPILE time:
//
//     ** (ArgumentError) invalid type {:array, Ecto.Enum, [values: [...]]}
//        for field :skills
//        (ecto 3.14.2) lib/ecto/schema.ex:2623: Ecto.Schema.check_field_type!/4
//
// The valid form keeps the option outside the tuple:
//
//     field :skills, {:array, Ecto.Enum}, values: [:Electrical, :Plumbing, :HVAC]
//
// The SCALAR enum form (already correct) is pinned alongside it, so a fix that
// simply stopped emitting `values:` for the array would fail here rather than
// pass vacuously — and so would one that broke the scalar case.
// ---------------------------------------------------------------------------

const SOURCE = `
system L {
  subdomain S {
    context C {
      enum Skill { Electrical, Plumbing, HVAC }
      enum Grade { Junior, Senior }
      aggregate Tech with crudish {
        name: string
        grade: Grade
        skills: Skill[]
      }
      repository Techs for Tech { }
    }
  }
  api TechApi from S
  storage primary { type: postgres }
  resource techState { for: C, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [C]
    dataSources: [techState]
    serves: TechApi
    port: 4000
  }
}
`;

async function schema(): Promise<string> {
  const files = await generateSystemFiles(SOURCE);
  const key = [...files.keys()].find((k) => k.endsWith("/lib/api/c/tech.ex"));
  expect(key, `no tech.ex among ${[...files.keys()].length} files`).toBeDefined();
  return files.get(key!)!;
}

describe("vanilla — an enum collection field emits a valid Ecto type (F-014)", () => {
  it("renders `values:` as a field/3 OPTION, outside the {:array, …} tuple", async () => {
    expect(await schema()).toContain(
      "field :skills, {:array, Ecto.Enum}, values: [:Electrical, :Plumbing, :HVAC]",
    );
  });

  it("never fuses `values:` INTO the array type tuple (the Ecto ArgumentError shape)", async () => {
    expect(await schema()).not.toContain("{:array, Ecto.Enum,");
  });

  it("still renders the SCALAR enum field in its (already valid) 3-arg form", async () => {
    expect(await schema()).toContain("field :grade, Ecto.Enum, values: [:Junior, :Senior]");
  });

  it("keeps the DECLARED value casing in the collection's atom list", async () => {
    const body = await schema();
    // Snake-casing the atoms would break the wire contract (`"HVAC"` casts and
    // round-trips as the declared string) — see mapTypeToEctoParts.
    expect(body).toContain(":HVAC");
    expect(body).not.toContain(":hvac");
  });

  it("the changeset casts the collection field like any other column", async () => {
    const files = await generateSystemFiles(SOURCE);
    const key = [...files.keys()].find((k) => k.endsWith("/lib/api/c/tech_changeset.ex"))!;
    expect(files.get(key)!).toContain(":skills");
  });

  it("the migration backs it with an array column (Ecto.Enum dumps atoms to strings)", async () => {
    const files = await generateSystemFiles(SOURCE);
    const key = [...files.keys()].find((k) => k.includes("/priv/repo/migrations/"))!;
    expect(files.get(key)!).toMatch(/add :skills, \{:array, :(text|string)\}/);
  });
});
