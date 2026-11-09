// ---------------------------------------------------------------------------
// RS-26's OPTIONAL twin on the relational write seam: a full-replacement
// update that omits an optional key clears it (`__clear_absent/2`).
//
// Full replacement is the contract of an `update` that is a COMMAND — one whose
// body does more than assign its own parameters.  The crudish `update` is a
// merge patch (RS-47): `cast/3` already keeps an absent key's stored value, so
// it emits neither this clear nor the required-key presence check.  What stays
// here is what the behavioural legs cannot see: which seam carries the clear,
// and that an aggregate with nothing to clear emits none of it.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SYSTEM = `system ClearAbsent {
  subdomain S {
    context C {
      aggregate Thing {
        name: string
        nickname: string?
        score: int?
        operation update(name: string, nickname: string?, score: int?) {
          precondition name != "" message "A thing has a name"
          name := name
          nickname := nickname
          score := score
        }
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

  it("is absent from the merge-patch crudish update (RS-47)", async () => {
    const files = await generateSystemFiles(
      SYSTEM.replace("aggregate Thing {", "aggregate Thing with crudish {").replace(
        /\n\s*operation update[\s\S]*?\n {8}\}/,
        "",
      ),
    );
    let changeset = "";
    for (const [p, c] of files) if (p.endsWith("/thing_changeset.ex")) changeset = c;
    expect(changeset, "thing_changeset.ex not emitted").not.toBe("");
    expect(changeset).toContain("def update_changeset(");
    expect(changeset).not.toContain("__clear_absent");
    expect(changeset).not.toContain("__require_keys");
  });

  it("stays byte-identical when every updatable field is required", async () => {
    const files = await generateSystemFiles(
      SYSTEM.replace(/\n\s*nickname: string\?\n\s*score: int\?/, "")
        .replace("update(name: string, nickname: string?, score: int?)", "update(name: string)")
        .replace(/\n\s*nickname := nickname\n\s*score := score/, ""),
    );
    let changeset = "";
    for (const [p, c] of files) if (p.endsWith("/thing_changeset.ex")) changeset = c;
    expect(changeset, "thing_changeset.ex not emitted").not.toBe("");
    expect(changeset).not.toContain("__clear_absent");
    expect(changeset).not.toContain("@update_optional");
  });
});
