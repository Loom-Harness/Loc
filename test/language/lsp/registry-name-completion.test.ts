// Gate for D-REGISTRY-NAMES (docs/decisions).
// LSP completion for the two identifier slots whose admissible names live in a
// registry, not the grammar: `storage { type: … }` (the sourceType registry)
// and `deployable { design: … }` (built-in pack discovery).  The grammar holds
// no vendor keyword there, so without this arm the editor offers nothing.

import { NodeFileSystem } from "langium/node";
import { expectCompletion } from "langium/test";
import { describe, expect, it } from "vitest";
import { createDddServices } from "../../../src/language/ddd-module.js";
import { BUILTIN_PACK_LATEST } from "../../../src/util/builtin-formats.js";
import { registeredSourceTypes } from "../../../src/util/source-types.js";

async function labelsAt(text: string): Promise<string[]> {
  let labels: string[] = [];
  await expectCompletion(createDddServices(NodeFileSystem).Ddd)({
    text,
    index: 0,
    assert: (completions) => {
      labels = completions.items.map((i) => i.label);
    },
    disposeAfterCheck: true,
  });
  return labels;
}

describe("registry-name LSP completion", () => {
  it("offers every registered sourceType at `storage { type: … }`", async () => {
    const labels = await labelsAt("system S { storage pg { type: <|> } }");
    expect(labels).toEqual(expect.arrayContaining(registeredSourceTypes()));
  });

  it("offers every built-in pack family at `design:`", async () => {
    const labels = await labelsAt(
      "system S { deployable web { platform: react design: <|> port: 3000 } }",
    );
    expect(labels).toEqual(expect.arrayContaining(Object.keys(BUILTIN_PACK_LATEST)));
  });
});
