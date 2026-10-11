import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

// ---------------------------------------------------------------------------
// RS-33 — a refusal INSIDE a workflow's command payload points through it.
//
// `create(c: FileClaim)` with a malformed `c.amount` answers 422 at
// `/c/amount` on node, python and .NET.  java converted the payload with a
// root-relative pointer (`/amount`) and, with no `@NotNull` on the payload
// record, refused a MISSING amount as "Invalid decimal: null"; elixir handed
// the money string unparsed to the aggregate's changeset, which answered
// Ecto's "is invalid" at `/amount`.  The booted proof is
// `corpus/workflow-command-payload`'s golden; these are the seams.
// ---------------------------------------------------------------------------

const CORPUS = join(
  import.meta.dirname,
  "..",
  "fixtures",
  "corpus",
  "workflow-command-payload.ddd",
);
const source = (platform: string) =>
  readFileSync(CORPUS, "utf8").replaceAll("__PLATFORM__", platform);

function all(fs: Map<string, string>, ext: string): string {
  return [...fs]
    .filter(([k]) => k.endsWith(ext))
    .map(([, v]) => v)
    .join("\n");
}

describe("RS-33 — a refusal inside a workflow command payload points through it", () => {
  it("java: the payload mapper is called at the param's path and prefixes its fields' pointers", async () => {
    const java = all(await generateSystemFiles(source("java")), ".java");
    expect(java).toContain('var c = toFileClaim(request.c(), "/c");');
    expect(java).toContain(
      "private static FileClaim toFileClaim(FileClaimResponse request, String at) {",
    );
    expect(java).toContain('WireFormatException.money(request.amount(), at + "/amount")');
  });

  it("java: the payload wire record validates its required members (a missing amount is not a parse failure)", async () => {
    const java = all(await generateSystemFiles(source("java")), "FileClaimResponse.java");
    expect(java).toContain(
      "public record FileClaimResponse(@NotNull UUID cargo, @NotNull String description, @NotNull String amount, @NotNull Integer priority, String note)",
    );
  });

  it("elixir: the payload's money is checked against node's grammar before the body, refused at the param's path", async () => {
    const ex = all(await generateSystemFiles(source("elixir")), ".ex");
    expect(ex).toContain("case __loom_payload_money([{:c, :amount, c.amount}]) do");
    expect(ex).toContain(
      'Ecto.Changeset.add_error(param, "Invalid decimal: " <> Jason.encode!(value), loom_path: [field])',
    );
  });
});
