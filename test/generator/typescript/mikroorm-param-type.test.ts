// The MikroORM repository's find-parameter type renderer keeps a collection
// parameter's element type instead of collapsing it to a scalar `string`.

import { describe, expect, it } from "vitest";
import { tsParamType } from "../../../src/generator/typescript/emit/mikroorm-shared.js";
import type { TypeIR } from "../../../src/ir/types/loom-ir.js";

const str: TypeIR = { kind: "primitive", name: "string" };
const id: TypeIR = { kind: "id", targetName: "Tag" } as TypeIR;

describe("mikroorm tsParamType", () => {
  it("types a scalar collection as an array", () => {
    expect(tsParamType({ kind: "array", element: str } as TypeIR)).toBe("string[]");
  });
  it("types an id collection as a branded-id array", () => {
    expect(tsParamType({ kind: "array", element: id } as TypeIR)).toBe("Ids.TagId[]");
  });
  it("keeps the scalar mapping unchanged", () => {
    expect(tsParamType(str)).toBe("string");
    expect(tsParamType(id)).toBe("Ids.TagId");
  });
});
