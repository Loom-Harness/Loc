import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// T2.i — per-field constraint validators in the vanilla Ecto changeset.  The
// single-field-invariant classifier (`singleFieldConstraints`, shared with
// Zod / FluentValidation / the Java validator) drives idiomatic Ecto
// `validate_number` / `validate_length` / `validate_format` calls.
// ---------------------------------------------------------------------------

const SRC = `
system S {
  subdomain Core {
    context Shop {
      aggregate Product with crudish {
        name: string
        price: int
        sku: string
        invariant price >= 0
        invariant name.length <= 50
        invariant sku.matches("[A-Z]{3}")
      }
      repository Products for Product { }
    }
  }
  api A from Core
  storage pg { type: postgres }
  resource st { for: Shop, kind: state, use: pg }
  deployable api { platform: elixir contexts: [Shop] dataSources: [st] serves: A port: 4000 }
}
`;

describe("vanilla — T2.i changeset field-constraint validators", () => {
  it("maps single-field invariants to one coded check per side of each limit", async () => {
    const files = await generateSystemFiles(SRC);
    const cs = files.get([...files.keys()].find((k) => k.endsWith("/shop/product_changeset.ex"))!)!;
    // Each side of a declared limit is a `validate_change` closure whose error
    // carries its `field.<limit>` code and bound — Ecto's `validate_number` /
    // `validate_format` cannot attach either.
    expect(cs).toContain("|> validate_change(:price, fn _, value ->");
    expect(cs).toContain(
      '{"Price must be at least 0", validation: :number, loom_code: "field.min", loom_params: %{min: 0}}',
    );
    // Length is the one pattern that is NOT a native Ecto validator: Ecto counts
    // GRAPHEMES and has no `:codepoints` option, so a length bound rides a
    // `validate_change/3` closure over the shared code-point count (RS-31).
    expect(cs).toContain("|> validate_change(:name, fn _, value ->");
    expect(cs).toContain("length(String.to_charlist(value)) <= 50");
    expect(cs).toContain("if value =~ ~r/[A-Z]{3}/,");
    expect(cs).toContain(
      '{"Sku is not in the expected format", validation: :format, loom_code: "field.pattern"}',
    );
  });

  it("applies the field validators on the UPDATE path too (SYS-1 parity)", async () => {
    // M-T6.8/SYS-1: Phoenix reaches update-path parity BY CONSTRUCTION — the
    // crudish `update` routes through `update_changeset`, which carries the SAME
    // single-field validators as `base_changeset`, so an invalid update is
    // rejected by the changeset (no emitter change needed, unlike the other four
    // backends).  Since versioning is default-on (M-T3.4) the update seam pipes
    // through the optimistic-lock-guarded `update_changeset` rather than
    // `base_changeset`; this pins that it still carries the field validators.
    const files = await generateSystemFiles(SRC);
    const repo = files.get(
      [...files.keys()].find((k) => k.endsWith("/shop/product_repository.ex"))!,
    )!;
    expect(repo).toMatch(/def update\([\s\S]*?update_changeset\(/);
    const cs = files.get([...files.keys()].find((k) => k.endsWith("/shop/product_changeset.ex"))!)!;
    expect(cs).toMatch(
      /def update_changeset\([\s\S]*?validate_change\(:price, fn _, value ->[\s\S]*?loom_code: "field\.min"/,
    );
  });

  it("keeps base_changeset validator-free when the aggregate has no field invariants", async () => {
    const plain = `
system P {
  subdomain Core {
    context Tracker {
      aggregate Task with crudish { title: string }
      repository Tasks for Task { }
    }
  }
  api A from Core
  storage pg { type: postgres }
  resource st { for: Tracker, kind: state, use: pg }
  deployable api { platform: elixir contexts: [Tracker] dataSources: [st] serves: A port: 4000 }
}
`;
    const f = await generateSystemFiles(plain);
    const cs = f.get([...f.keys()].find((k) => k.endsWith("/tracker/task_changeset.ex"))!)!;
    // No INVARIANT-derived validator: nothing on `title`, no `validate_change`,
    // no `validate_format`.
    expect(cs).not.toContain("validate_format");
    expect(cs).not.toContain("validate_change(:title");
    expect(cs).not.toContain("validate_number(:title");
    // The one `validate_number` that IS here is type-derived, not
    // invariant-derived: the default-on `version` token is an `int`, so it is a
    // Postgres `integer` column, and since Schemathesis F11 (wave C2 packet 2m)
    // every `int` column carries its declared int32 bound — otherwise a
    // client-supplied version past 2147483647 reaches the column and the
    // DATABASE answers 500 for what is a client fault.  Asserted exactly, so
    // an invariant leaking in here would still fail this test.
    // …carried by a `validate_change` closure rather than `validate_number`, so
    // the error can name its catalog code and bounds (`field.integer-range`).
    const VERSION_BOUND = "|> validate_change(:version, &__loom_int32_range/2)";
    const numberLines = cs.split("\n").filter((l) => l.includes("__loom_int32_range/2"));
    // Once per changeset that casts the column — this aggregate emits the base
    // one and the versioned update one, and both take client attrs.
    expect(numberLines.map((l) => l.trim())).toEqual([VERSION_BOUND, VERSION_BOUND]);
  });
});
