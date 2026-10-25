import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

// A vendor setting written beside `type:` in a `storage` block, instead of
// under `config: { … }`.  Without the rewrite a keyword key (`from`) reads as
// "rename this keyword" and a plain key (`bucket`) as an unbalanced brace;
// neither names the fix (`src/language/storage-config-key.ts`).

async function onlyError(src: string): Promise<string> {
  const { errors } = await parseString(src);
  expect(errors, "exactly one parse diagnostic").toHaveLength(1);
  return errors[0]!;
}

const sys = (storage: string) => `system S {\n  ${storage}\n}`;

describe("a storage key outside `config:` says where it belongs", () => {
  it("a keyword key (`from` on smtp) is not called a keyword to rename", async () => {
    const err = await onlyError(sys(`storage mailServer { type: smtp, from: "a@b.test" }`));
    expect(err).toBe(
      "2:36 'from' is not a clause of `storage mailServer` (it takes 'type', 'instance', " +
        "'connection', 'config') — vendor settings go inside its config map: " +
        "`config: { from: … }`.",
    );
  });

  it("a plain key (`bucket` on s3) is not reported as a missing brace", async () => {
    const err = await onlyError(sys(`storage files { type: s3, bucket: "app-files" }`));
    expect(err).toContain("2:29 'bucket' is not a clause of `storage files`");
    expect(err).toContain("`config: { bucket: … }`");
  });

  it("a key after an existing config map gets the same hint", async () => {
    const err = await onlyError(
      sys(`storage files { type: s3, config: { bucket: "x" }, region: "eu" }`),
    );
    expect(err).toContain("'region' is not a clause of `storage files`");
  });

  it("the config form parses", async () => {
    const { errors } = await parseString(
      sys(`storage mailServer { type: smtp, config: { from: "a@b.test" } }`),
    );
    expect(errors).toEqual([]);
  });

  it("outside a storage block the reserved-name text is unchanged", async () => {
    const err = await onlyError(`context C {\n  aggregate A { operation: string }\n}`);
    expect(err).toContain("'operation' is a Loom keyword");
  });
});
