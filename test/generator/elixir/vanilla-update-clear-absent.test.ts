// ---------------------------------------------------------------------------
// RS-26's OPTIONAL twin on the RELATIONAL write seam.
//
// Loom's update contract is full-replacement, and `changeset-emit.ts` already
// enforces half of that: `__require_keys/3` rejects an ABSENT REQUIRED key with
// 422, because `validate_required/2` reads through `get_field/2` and would see
// the stored value instead.  The other half had no enforcement at all —
// `cast/3` simply IGNORES a key the attrs do not carry, so an omitted OPTIONAL
// field kept whatever the loaded row held, while the other four backends
// rebuild the aggregate from the request DTO and therefore null it.
//
// Measured on a booted Phoenix + Postgres against `corpus/optional-valueobject`:
// a PUT that dropped `office` read back with the previous `Addr` still in place
// (`expected {"city":"Shelbyville", …} to be null`).
//
// Compile gates are blind to it — both spellings compile — and the wire golden
// only diverges once a request actually omits the key, so the assertion is on
// the ENFORCEMENT surface: the changeset the request hits.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SYSTEM = `system ClearAbsent {
  subdomain S {
    context C {
      aggregate Thing with crudish {
        name: string
        nickname: string?
        score: int?
      }
      repository Things for Thing { }
    }
  }
  api A from S
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable d {
    platform: elixir
    contexts: [C]
    dataSources: [st]
    serves: A
    port: 4000
  }
}`;

async function emitted(suffix: string): Promise<string> {
  const files = await generateSystemFiles(SYSTEM);
  for (const [p, c] of files) if (p.endsWith(suffix)) return c;
  throw new Error(`${suffix} not found in: ${[...files.keys()].join(", ")}`);
}

describe("a relational aggregate's PUT clears an omitted optional field", () => {
  it("nulls exactly the nullable update-editable fields, against the raw attrs", async () => {
    const changeset = await emitted("/thing_changeset.ex");
    expect(changeset).toContain("@update_optional [:nickname, :score]");
    expect(changeset).toContain("|> __clear_absent(attrs, @update_optional)");
    // A required field is the presence check's business, not the clear's.
    expect(changeset).not.toMatch(/@update_optional \[[^\]]*:name/);
    expect(changeset).toContain("@update_required [:name]");
  });

  it("clears by `put_change(…, nil)` only when the key is genuinely absent", async () => {
    const changeset = await emitted("/thing_changeset.ex");
    // A key that IS present and null already reaches `cast`, so the helper must
    // key on PRESENCE, not on the value — otherwise the two paths double-write.
    expect(changeset).toContain(
      "if Map.has_key?(attrs, Atom.to_string(field)) or Map.has_key?(attrs, field)",
    );
    expect(changeset).toContain("else: put_change(cs, field, nil)");
  });

  it("runs inside update_changeset only — create is a construction, not a replacement", async () => {
    const changeset = await emitted("/thing_changeset.ex");
    const update = changeset.slice(changeset.indexOf("def update_changeset("));
    expect(update).toContain("__clear_absent(attrs, @update_optional)");
    const base = changeset.slice(
      changeset.indexOf("def base_changeset("),
      changeset.indexOf("def update_changeset("),
    );
    expect(base).not.toContain("__clear_absent");
  });

  it("stays byte-identical when every updatable field is required", async () => {
    const files = await generateSystemFiles(
      SYSTEM.replace(/\n\s*nickname: string\?\n\s*score: int\?/, ""),
    );
    let changeset = "";
    for (const [p, c] of files) if (p.endsWith("/thing_changeset.ex")) changeset = c;
    expect(changeset, "thing_changeset.ex not emitted").not.toBe("");
    expect(changeset).not.toContain("__clear_absent");
    expect(changeset).not.toContain("@update_optional");
  });
});
