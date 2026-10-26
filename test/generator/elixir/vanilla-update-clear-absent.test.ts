// ---------------------------------------------------------------------------
// RS-26's OPTIONAL twin on the relational write seam: a full-replacement
// update that omits an optional key clears it (`__clear_absent/2`).
//
// The clearing itself is asserted by value on the elixir behavioural leg
// (`corpus/optional-valueobject`: an update that drops `office` reads back
// null).  What stays here is what that leg cannot see: the clear runs on the
// update seam only (a create already starts every optional field at nil), and
// an aggregate whose updatable fields are all required emits none of it.
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
