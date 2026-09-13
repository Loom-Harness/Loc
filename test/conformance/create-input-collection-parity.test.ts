// A COLLECTION create-input field may be omitted — audit #2864 G4.
//
// `legs: Leg[]` used to be a REQUIRED create input while the other spelling of
// the same modelling intent — an entity containment, `contains legs: Leg[]` —
// was not a create input at all.  So re-spelling `entity Leg` as `valueobject
// Leg`, which changes where the rows live and not what the model means, turned a
// clean model into `loom.workflow-create-missing-field … missing required field
// 'legs'`, fixed only by writing `legs: []` at every call site.
//
// `hasImplicitDefault` (src/ir/enrich/wire-projection.ts) now admits `array`
// alongside `bool`, which moves the contract on ALL FIVE backends at once,
// because every backend's required-set derivation reads that one seam.  This
// asserts the resulting contract per backend MECHANISM rather than five
// spellings of one string match — the shape `create-input-default-parity`
// established for the `= default` seam next door.
//
// Three things have to hold together, and each has its own failure mode:
//
//   1. a non-nullable collection is OMITTABLE, and materializes as EMPTY;
//   2. a NULLABLE collection (`legs: Leg[]?`) still omits to NULL — otherwise
//      "not supplied" and "supplied empty" stop being distinguishable;
//   3. the UPDATE side is UNCHANGED.  Loom's update contract is full
//      replacement, so an absent collection there is a missing required field,
//      not an empty one (RS-26).  A fix that relaxed `isRequiredUpdateInput`
//      too would pass (1) and silently let a PUT blank a stored collection.

import { describe, expect, it } from "vitest";
import {
  createOmissionValue,
  isRequiredCreateInput,
  isRequiredUpdateInput,
  omittableCreateInputs,
} from "../../src/ir/enrich/wire-projection.js";
import { allAggregates } from "../../src/ir/types/loom-ir.js";
import { buildLoomModel, generateSystemFiles } from "../_helpers/index.js";

/** `legs` is a value-object collection, `tags` a scalar one — the relaxation is
 *  deliberately about COLLECTIONS, not about value objects, so both must land
 *  on the omittable side.  `maybeLegs` is the nullable control, `code` the
 *  required one that must NOT move. */
const FIXTURE = (platform: string) => `system S {
  subdomain D {
    context C {
      valueobject Leg { origin: string  dest: string }
      aggregate Voyage with crudish {
        code: string
        legs: Leg[]
        tags: string[]
        maybeLegs: Leg[]?
      }
      repository Voyages for Voyage { }
    }
  }
  api A from D
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable d { platform: ${platform}, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}`;

async function voyage() {
  const model = await buildLoomModel(FIXTURE("node"));
  const agg = allAggregates(model).find((a) => a.name === "Voyage");
  if (!agg) throw new Error("fixture lost its Voyage aggregate");
  return agg;
}

/** The emitted file whose path ends with `suffix`, asserted present so a
 *  renamed emission fails loudly instead of yielding an empty string that every
 *  `not.toMatch` below would pass against. */
async function emitted(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(FIXTURE(platform));
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  expect(hit, `${platform} emitted a file ending ${suffix}`).toBeTruthy();
  return hit![1];
}

describe("a collection create-input field may be omitted (#2864 G4)", () => {
  it("the IR seam: collections are omittable, the nullable one still omits to null", async () => {
    const agg = await voyage();
    const byName = new Map(agg.fields.map((f) => [f.name, f]));

    // Non-vacuity: all four fields really are in the create input, so the
    // assertions below are about required-ness and not about absence.
    const inputNames = (agg.createInput ?? []).map((c) => c.field.name);
    expect(inputNames).toEqual(expect.arrayContaining(["code", "legs", "tags", "maybeLegs"]));

    expect(isRequiredCreateInput(byName.get("code")!), "a scalar stays required").toBe(true);
    expect(isRequiredCreateInput(byName.get("legs")!), "a VO collection is omittable").toBe(false);
    expect(isRequiredCreateInput(byName.get("tags")!), "a scalar collection too").toBe(false);

    expect([...omittableCreateInputs(agg)].sort()).toEqual(["legs", "maybeLegs", "tags"]);

    // The empty-collection arm, and the nullable field NOT taking it.
    expect(createOmissionValue(byName.get("legs")!)).toEqual({ kind: "empty-collection" });
    expect(createOmissionValue(byName.get("tags")!)).toEqual({ kind: "empty-collection" });
    expect(createOmissionValue(byName.get("maybeLegs")!)).toEqual({ kind: "null" });
  });

  it("RS-26: the UPDATE side does not move", async () => {
    const byName = new Map((await voyage()).fields.map((f) => [f.name, f]));
    // Full-replacement update: only nullability relaxes it, never a default.
    expect(isRequiredUpdateInput(byName.get("legs")!)).toBe(true);
    expect(isRequiredUpdateInput(byName.get("tags")!)).toBe(true);
    expect(isRequiredUpdateInput(byName.get("maybeLegs")!)).toBe(false);
  });

  it("node: zod `.default([])` on the create body only, and the factory fills []", async () => {
    const routes = await emitted("node", "voyage.routes.ts");
    expect(routes).toContain("legs: z.array(LegSchema).default([])");
    expect(routes).toContain("tags: z.array(z.string()).default([])");
    // The nullable collection keeps omit -> null and must NOT gain a default,
    // or "not supplied" and "supplied empty" stop being distinguishable.
    expect(routes).toContain("maybeLegs: z.array(LegSchema).nullish()");
    expect(routes).not.toContain("nullish().default([])");
    expect(routes).not.toContain("default([]).nullish()");
    // Exactly ONE slot carries it — the create body.  The update body and the
    // response schema still name the bare array: were the default to leak into
    // the update slot, a PUT omitting `legs` would blank the stored rows.
    expect(routes.match(/legs: z\.array\(LegSchema\)\.default\(\[\]\)/g)).toHaveLength(1);
    expect(routes).toMatch(/legs: z\.array\(LegSchema\),/);

    const domain = await emitted("node", "domain/voyage.ts");
    expect(domain).toContain("legs: input.legs ?? []");
    expect(domain).toContain("tags: input.tags ?? []");
    expect(domain, "the nullable collection still coalesces to null").toContain(
      "maybeLegs: input.maybeLegs ?? null",
    );
  });

  it("python: a `| None = None` create param, filled in the body (never a shared mutable default)", async () => {
    const src = await emitted("python", "app/domain/voyage.py");
    expect(src).toMatch(/def create\(cls, \*, code: str, legs: list\[Leg\] \| None = None/);
    expect(src).toContain("legs=legs if legs is not None else []");
    expect(src).toContain("tags=tags if tags is not None else []");
    // The default must never be a `= []` DEFAULT ARGUMENT — Python would share
    // one list across every call.
    expect(src, "no mutable default argument").not.toMatch(
      /def create\([^)]*legs: list\[Leg\] = \[\]/,
    );
  });

  it("java: a null-coalesce to an empty MUTABLE list", async () => {
    const src = await emitted("java", "features/voyages/Voyage.java");
    expect(src).toContain("e.legs = legs != null ? legs : new ArrayList<>()");
    expect(src).toContain("e.tags = tags != null ? tags : new ArrayList<>()");
    // `List.of()` is immutable and Hibernate manages these fields after
    // construction, so an @ElementCollection it adds into would throw at flush.
    expect(src, "not the immutable List.of()").not.toContain("legs : List.of()");
    expect(src).toContain("import java.util.ArrayList;");
  });

  it("dotnet: an optional positional plus a collection-expression coalesce", async () => {
    const src = await emitted("dotnet", "Domain/Voyages/Voyage.cs");
    expect(src).toMatch(/public static Voyage Create\([^)]*List<Leg>\? legs = null/);
    expect(src).toContain("e.Legs = legs ?? []");
    expect(src).toContain("e.Tags = tags ?? []");
  });

  it("elixir: cast_assoc for the VO collection, a changeset default for the scalar one", async () => {
    const src = await emitted("elixir", "voyage_changeset.ex");
    // Elixir reaches the same contract by two different mechanisms, which is
    // why this asserts both rather than one spelling.  A VO collection is a
    // separate `has_many` schema, and `cast_assoc` over an ABSENT key casts no
    // children — so omission already means "empty" without a default.
    expect(src).toContain("cast_assoc(:legs");
    // A scalar array IS a cast field on the row, so it takes the default.
    expect(src).toContain("__default(:tags, [])");
  });
});
